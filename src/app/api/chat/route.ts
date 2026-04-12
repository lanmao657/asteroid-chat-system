import { z } from "zod";

import { runAgentTurn } from "@/lib/agent/runtime";
import {
  appendSessionMessage,
  ensureSession,
  getSessionMemorySummary,
  listSessionMessages,
  setSessionMemorySummary,
} from "@/lib/agent/session-store";
import {
  insertAgentRunLog,
  type PersistedAgentRunStatus,
} from "@/lib/db/agent-run-log-repository";
import { requireApiSession } from "@/lib/auth/session";
import type {
  AgentRunTaskCategory,
  AgentStreamEvent,
  ChatMessage,
  ToolResult,
} from "@/lib/agent/types";

const requestSchema = z.object({
  sessionId: z.string().min(1),
  message: z.string().min(1),
});

const encoder = new TextEncoder();

const toMessage = (
  role: ChatMessage["role"],
  content: string,
  metadata?: Record<string, unknown>,
): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: new Date().toISOString(),
  metadata,
});

const formatSse = (event: AgentStreamEvent) =>
  `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

const createStreamHeaders = () => ({
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Content-Type-Options": "nosniff",
  "X-Accel-Buffering": "no",
});

export const runtime = "nodejs";

const persistRunLogSafely = async ({
  runId,
  sessionId,
  taskCategory,
  provider,
  status,
  userMessage,
  assistantMessage,
  memorySummary,
  toolResults,
  errorMessage,
  startedAt,
  finishedAt,
}: {
  runId: string;
  sessionId: string;
  taskCategory: AgentRunTaskCategory;
  provider: string;
  status: PersistedAgentRunStatus;
  userMessage: string;
  assistantMessage: string;
  memorySummary: string;
  toolResults: ToolResult[];
  errorMessage?: string;
  startedAt: string;
  finishedAt: string;
}) => {
  try {
    await insertAgentRunLog({
      runId,
      sessionId,
      provider,
      taskCategory,
      status,
      userMessage,
      assistantMessage,
      memorySummary,
      toolResults,
      errorMessage,
      startedAt,
      finishedAt,
    });
  } catch (error) {
    console.error("Failed to persist agent run log:", error);
  }
};

export async function POST(request: Request) {
  const authResult = await requireApiSession(request);
  if (authResult.response) {
    return authResult.response;
  }

  const payload = requestSchema.parse(await request.json());
  ensureSession(payload.sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = new Date().toISOString();
      let currentRunId = "";
      let providerLabel = "";
      let closed = false;
      const closeSafely = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const emit = (event: AgentStreamEvent) => {
        if (event.type === "run_started") {
          currentRunId = event.runId;
        }
        if (event.type === "session") {
          providerLabel = event.provider;
        }
        if (!closed) {
          controller.enqueue(encoder.encode(formatSse(event)));
        }
      };

      try {
        const userMessage = toMessage("user", payload.message);
        appendSessionMessage(payload.sessionId, userMessage);

        const conversation = listSessionMessages(payload.sessionId);
        const memorySummary = getSessionMemorySummary(payload.sessionId);

        const result = await runAgentTurn({
          sessionId: payload.sessionId,
          userMessage: payload.message,
          conversation,
          memorySummary,
          emit,
          signal: request.signal,
        });

        if (result.memorySummary !== memorySummary) {
          setSessionMemorySummary(payload.sessionId, result.memorySummary);
        }

        if (result.status === "completed") {
          if (result.trace) {
            emit({ type: "trace", trace: result.trace });
          }
          const assistantMessage = toMessage("assistant", result.assistantText, {
            runId: result.runId,
            trace: result.trace,
          });
          appendSessionMessage(payload.sessionId, assistantMessage);
          emit({ type: "assistant_final", message: assistantMessage });
        }

        await persistRunLogSafely({
          runId: result.runId,
          sessionId: payload.sessionId,
          provider: providerLabel || "unknown",
          taskCategory: result.taskCategory,
          status: result.status === "aborted" ? "aborted" : "completed",
          userMessage: payload.message,
          assistantMessage: result.assistantText,
          memorySummary: result.memorySummary,
          toolResults: result.toolResults,
          startedAt,
          finishedAt: new Date().toISOString(),
        });

        emit({ type: "done" });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unexpected server error";
        emit({
          type: "error",
          message: errorMessage,
        });

        await persistRunLogSafely({
          runId: currentRunId || crypto.randomUUID(),
          sessionId: payload.sessionId,
          provider: providerLabel || "unknown",
          taskCategory: "general",
          status: "errored",
          userMessage: payload.message,
          assistantMessage: "",
          memorySummary: getSessionMemorySummary(payload.sessionId),
          toolResults: [],
          errorMessage,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
      } finally {
        closeSafely();
      }
    },
  });

  return new Response(stream, {
    headers: createStreamHeaders(),
  });
}
