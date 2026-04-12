import type { ChatMessage } from "@/lib/agent/types";
import { requireApiSession } from "@/lib/auth/session";
import {
  getSessionById,
  listMessagesBySession,
} from "@/lib/db/chat-session-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";

export const runtime = "nodejs";

const toChatMessage = (message: {
  id: string;
  role: ChatMessage["role"];
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}) => ({
  id: message.id,
  role: message.role,
  content: message.content,
  metadata: message.metadata,
  createdAt: message.createdAt,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const authResult = await requireApiSession(request);
  if (authResult.response) {
    return authResult.response;
  }

  if (!isDatabaseConfigured()) {
    return Response.json(
      {
        error: DATABASE_NOT_CONFIGURED_MESSAGE,
      },
      { status: 503 },
    );
  }

  try {
    const { sessionId } = await context.params;
    const session = await getSessionById({
      sessionId,
      userId: authResult.session.user.id,
    });

    if (!session) {
      return Response.json(
        {
          error: "Chat session not found.",
        },
        { status: 404 },
      );
    }

    const items = await listMessagesBySession({
      sessionId,
      userId: authResult.session.user.id,
    });

    return Response.json({
      session: {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastMessageAt: session.lastMessageAt,
      },
      items: items.map(toChatMessage),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query chat messages.",
      },
      { status: 500 },
    );
  }
}
