import { requireApiSession } from "@/lib/auth/session";
import { listSessionsByUser } from "@/lib/db/chat-session-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";

export const runtime = "nodejs";

const normalizeLimit = (value: string | null) => {
  if (value == null || value.trim() === "") {
    return 50;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
};

export async function GET(request: Request) {
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
    const { searchParams } = new URL(request.url);
    const items = await listSessionsByUser({
      userId: authResult.session.user.id,
      limit: normalizeLimit(searchParams.get("limit")),
    });

    return Response.json({
      items: items.map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        lastMessageAt: session.lastMessageAt,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query chat sessions.",
      },
      { status: 500 },
    );
  }
}
