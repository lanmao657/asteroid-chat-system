import { requireApiSession } from "@/lib/auth/session";
import { listKnowledgeDocumentsByUser } from "@/lib/db/knowledge-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";
import { ingestKnowledgeFile, KnowledgeIngestError } from "@/lib/knowledge/ingest";
import { toKnowledgeDocumentSummary } from "@/lib/knowledge/presentation";

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
    const items = await listKnowledgeDocumentsByUser({
      userId: authResult.session.user.id,
      limit: normalizeLimit(searchParams.get("limit")),
    });

    return Response.json({
      items: items.map(toKnowledgeDocumentSummary),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query knowledge documents.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        {
          error: "A file upload is required.",
        },
        { status: 400 },
      );
    }

    const result = await ingestKnowledgeFile({
      userId: authResult.session.user.id,
      file,
    });

    return Response.json(
      {
        item: toKnowledgeDocumentSummary(result.document),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof KnowledgeIngestError) {
      return Response.json(
        {
          error: error.message,
        },
        { status: error.status },
      );
    }

    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to ingest the knowledge document.",
      },
      { status: 500 },
    );
  }
}
