import { requireApiSession } from "@/lib/auth/session";
import { getKnowledgeDocumentById } from "@/lib/db/knowledge-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";
import { embedKnowledgeChunks } from "@/lib/knowledge/embedding";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
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
    const { documentId } = await context.params;
    const document = await getKnowledgeDocumentById({
      documentId,
      userId: authResult.session.user.id,
    });

    if (!document) {
      return Response.json(
        {
          error: "Knowledge document not found.",
        },
        { status: 404 },
      );
    }

    const result = await embedKnowledgeChunks({
      userId: authResult.session.user.id,
      documentId,
      limit: Math.max(document.chunkCount, 1),
    });

    return Response.json({
      documentId,
      attemptedCount: result.attemptedCount,
      readyCount: result.readyCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      failures: result.failures,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate knowledge embeddings.",
      },
      { status: 500 },
    );
  }
}
