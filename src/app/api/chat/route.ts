import { z } from "zod";

import { runAgentTurn } from "@/lib/agent/runtime";
import {
  insertAgentRunLog,
  type PersistedAgentRunStatus,
} from "@/lib/db/agent-run-log-repository";
import { requireApiSession } from "@/lib/auth/session";
import {
  appendMessage,
  createSession,
  getSessionById,
  listMessagesBySession,
  touchSessionLastMessageAt,
  updateSessionSummary,
  updateSessionTitle,
} from "@/lib/db/chat-session-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";
import {
  DEFAULT_CHAT_SESSION_TITLE,
  getChatSessionTitle,
} from "@/lib/chat/sessions";
import type {
  AgentRunTaskCategory,
  AgentStreamEvent,
  ChatMessage,
  ToolResult,
} from "@/lib/agent/types";

const requestSchema = z.object({
  sessionId: z.string().min(1).optional(),
  message: z.string().min(1),
});

const encoder = new TextEncoder();

const toMessage = (
  role: ChatMessage["role"],
  content: string,
  metadata?: Record<string, unknown>,
  options?: {
    id?: string;
    createdAt?: string;
  },
): ChatMessage => ({
  id: options?.id ?? crypto.randomUUID(),
  role,
  content,
  createdAt: options?.createdAt ?? new Date().toISOString(),
  metadata,
});

const toChatMessage = (message: {
  id: string;
  role: ChatMessage["role"];
  content: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}): ChatMessage =>
  toMessage(message.role, message.content, message.metadata, {
    id: message.id,
    createdAt: message.createdAt,
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

const createJsonErrorResponse = (message: string, status: number) =>
  Response.json(
    {
      error: message,
    },
    { status },
  );

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

  if (!isDatabaseConfigured()) {
    return createJsonErrorResponse(DATABASE_NOT_CONFIGURED_MESSAGE, 503);
  }

  const payload = requestSchema.parse(await request.json());
  const userId = authResult.session.user.id;
  const requestedSessionId = payload.sessionId?.trim() || undefined;

  let sessionRecord =
    requestedSessionId == null
      ? await createSession({
          userId,
        })
      : await getSessionById({
          sessionId: requestedSessionId,
          userId,
        });

  if (!sessionRecord && requestedSessionId) {
    sessionRecord = await createSession({
      userId,
      sessionId: requestedSessionId,
    });
  }

  if (!sessionRecord) {
    return createJsonErrorResponse(
      requestedSessionId
        ? "Chat session not found."
        : "Failed to initialize the chat session.",
      requestedSessionId ? 404 : 500,
    );
  }

  const resolvedSessionId = sessionRecord.id;
  const shouldUpdateTitle = sessionRecord.title === DEFAULT_CHAT_SESSION_TITLE;
  const persistedUserMessage = await appendMessage({
    sessionId: resolvedSessionId,
    userId,
    role: "user",
    content: payload.message,
  });

  if (!persistedUserMessage) {
    return createJsonErrorResponse("Failed to persist the user message.", 500);
  }

  if (shouldUpdateTitle) {
    const nextTitle = getChatSessionTitle(payload.message);
    const updatedTitle = await updateSessionTitle({
      sessionId: resolvedSessionId,
      userId,
      title: nextTitle,
    });

    if (!updatedTitle) {
      return createJsonErrorResponse("Failed to update the chat session title.", 500);
    }

    sessionRecord.title = nextTitle;
  }

  const persistedConversation = await listMessagesBySession({
    sessionId: resolvedSessionId,
    userId,
  });
  const conversation = persistedConversation.map(toChatMessage);
  const memorySummary = sessionRecord.summary;

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
        const result = await runAgentTurn({
          sessionId: resolvedSessionId,
          userMessage: payload.message,
          conversation,
          memorySummary,
          knowledgeUserId: userId,
          emit,
          signal: request.signal,
        });

        if (result.memorySummary !== memorySummary) {
          const updatedSummary = await updateSessionSummary({
            sessionId: resolvedSessionId,
            userId,
            summary: result.memorySummary,
          });

          if (!updatedSummary) {
            throw new Error("Failed to persist the session summary.");
          }
        }

        if (result.status === "completed") {
          if (result.trace) {
            emit({ type: "trace", trace: result.trace });
          }
          const persistedAssistantMessage = await appendMessage({
            sessionId: resolvedSessionId,
            userId,
            role: "assistant",
            content: result.assistantText,
            metadata: {
              runId: result.runId,
              trace: result.trace,
              citations: result.citations,
            },
          });

          if (!persistedAssistantMessage) {
            throw new Error("Failed to persist the assistant message.");
          }

          await touchSessionLastMessageAt({
            sessionId: resolvedSessionId,
          });

          const assistantMessage = toMessage("assistant", result.assistantText, {
            runId: result.runId,
            trace: result.trace,
            citations: result.citations,
          }, {
            id: persistedAssistantMessage.id,
            createdAt: persistedAssistantMessage.createdAt,
          });
          emit({ type: "assistant_final", message: assistantMessage });
        }

        await persistRunLogSafely({
          runId: result.runId,
          sessionId: resolvedSessionId,
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
          sessionId: resolvedSessionId,
          provider: providerLabel || "unknown",
          taskCategory: "general",
          status: "errored",
          userMessage: payload.message,
          assistantMessage: "",
          memorySummary,
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
