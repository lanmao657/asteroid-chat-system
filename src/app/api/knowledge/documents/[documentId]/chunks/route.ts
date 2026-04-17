import { requireApiSession } from "@/lib/auth/session";
import {
  getKnowledgeDocumentById,
  listKnowledgeChunksByDocument,
} from "@/lib/db/knowledge-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";

export const runtime = "nodejs";

export async function GET(
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

    const items = await listKnowledgeChunksByDocument({
      documentId,
      userId: authResult.session.user.id,
    });

    return Response.json({
      items,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query knowledge chunks.",
      },
      { status: 500 },
    );
  }
}
