import { requireApiSession } from "@/lib/auth/session";
import {
  deleteKnowledgeDocument,
  getKnowledgeDocumentById,
} from "@/lib/db/knowledge-repository";
import { DATABASE_NOT_CONFIGURED_MESSAGE, isDatabaseConfigured } from "@/lib/db/env";
import { toKnowledgeDocumentDetail } from "@/lib/knowledge/presentation";

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

    return Response.json({
      item: toKnowledgeDocumentDetail(document),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to query the knowledge document.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
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
    const deleted = await deleteKnowledgeDocument({
      documentId,
      userId: authResult.session.user.id,
    });

    if (!deleted) {
      return Response.json(
        {
          error: "Knowledge document not found.",
        },
        { status: 404 },
      );
    }

    return Response.json({
      id: documentId,
      deleted: true,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete the knowledge document.",
      },
      { status: 500 },
    );
  }
}
