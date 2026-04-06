import { listAgentRunLogs } from "@/lib/db/agent-run-log-repository";
import { isDatabaseConfigured } from "@/lib/db/env";

export const runtime = "nodejs";

const normalizeLimit = (value: string | null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 20;
  }

  return Math.min(Math.max(Math.trunc(parsed), 1), 100);
};

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) {
    return Response.json(
      {
        error: "DATABASE_URL is not configured on the server.",
      },
      { status: 503 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId")?.trim() || undefined;
    const limit = normalizeLimit(searchParams.get("limit"));
    const items = await listAgentRunLogs({ sessionId, limit });

    return Response.json({
      items,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query agent run logs.",
      },
      { status: 500 },
    );
  }
}
