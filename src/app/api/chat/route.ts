import { z } from "zod";

import { runAgentTurn } from "@/lib/agent/runtime";
import {
  appendSessionMessage,
  ensureSession,
  getSessionMemorySummary,
  listSessionMessages,
  setSessionMemorySummary,
} from "@/lib/agent/session-store";
import type { AgentStreamEvent, ChatMessage } from "@/lib/agent/types";

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
});

export async function POST(request: Request) {
  const payload = requestSchema.parse(await request.json());
  ensureSession(payload.sessionId);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const closeSafely = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const emit = (event: AgentStreamEvent) => {
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
          const assistantMessage = toMessage("assistant", result.assistantText, {
            runId: result.runId,
          });
          appendSessionMessage(payload.sessionId, assistantMessage);
          emit({ type: "assistant_final", message: assistantMessage });
        }

        emit({ type: "done" });
      } catch (error) {
        emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Unexpected server error",
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
