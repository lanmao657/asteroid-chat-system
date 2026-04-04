import { z } from "zod";

import { runAgentTurn } from "@/lib/agent/runtime";
import {
  appendSessionMessage,
  ensureSession,
  listSessionMessages,
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

export async function POST(request: Request) {
  const payload = requestSchema.parse(await request.json());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(formatSse(event)));
      };

      try {
        ensureSession(payload.sessionId);

        const userMessage = toMessage("user", payload.message);
        appendSessionMessage(payload.sessionId, userMessage);

        const conversation = listSessionMessages(payload.sessionId);
        const result = await runAgentTurn({
          sessionId: payload.sessionId,
          userMessage: payload.message,
          conversation,
          emit,
        });

        const assistantMessage = toMessage("assistant", result.assistantText, {
          toolCount: result.toolResults.length,
        });

        appendSessionMessage(payload.sessionId, assistantMessage);
        emit({ type: "assistant_final", message: assistantMessage });
        emit({ type: "done" });
      } catch (error) {
        emit({
          type: "error",
          message:
            error instanceof Error ? error.message : "Unexpected server error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
