import "server-only";

import {
  createKnowledgeDocument,
  persistKnowledgeDocumentChunks,
  updateKnowledgeDocumentStatus,
} from "@/lib/db/knowledge-repository";
import { agentEnv } from "@/lib/agent/env";
import { chunkText, knowledgeChunkDefaults } from "@/lib/knowledge/chunker";
import {
  getDocumentTitleFromFilename,
  getSupportedMimeType,
  parseKnowledgeFile,
} from "@/lib/knowledge/parser";
import type { IngestKnowledgeFileResult, KnowledgeDocumentRecord } from "@/lib/knowledge/types";

export const KNOWLEDGE_MAX_FILE_SIZE_BYTES = agentEnv.knowledgeBaseMaxFileSize;

export class KnowledgeIngestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "KnowledgeIngestError";
  }
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Failed to ingest knowledge document.";

const formatFileSizeLimit = (value: number) => {
  if (value >= 1024 * 1024) {
    const megaBytes = value / (1024 * 1024);
    return Number.isInteger(megaBytes) ? `${megaBytes} MB` : `${megaBytes.toFixed(1)} MB`;
  }

  if (value >= 1024) {
    const kiloBytes = value / 1024;
    return Number.isInteger(kiloBytes) ? `${kiloBytes} KB` : `${kiloBytes.toFixed(1)} KB`;
  }

  return `${value} bytes`;
};

const failDocumentSafely = async ({
  document,
  errorMessage,
}: {
  document: KnowledgeDocumentRecord | null;
  errorMessage: string;
}) => {
  if (!document) {
    return;
  }

  try {
    await updateKnowledgeDocumentStatus({
      documentId: document.id,
      userId: document.userId,
      status: "failed",
      errorMessage,
    });
  } catch (updateError) {
    console.error("Failed to persist knowledge document failure state:", updateError);
  }
};

export const ingestKnowledgeFile = async ({
  userId,
  file,
}: {
  userId: string;
  file: File;
}): Promise<IngestKnowledgeFileResult> => {
  const filename = file.name?.trim() || "untitled";
  if (file.size > KNOWLEDGE_MAX_FILE_SIZE_BYTES) {
    throw new KnowledgeIngestError(
      `File size exceeds the ${formatFileSizeLimit(KNOWLEDGE_MAX_FILE_SIZE_BYTES)} limit.`,
      413,
    );
  }

  const supportedMimeType = getSupportedMimeType({
    filename,
    mimeType: file.type,
  });
  if (!supportedMimeType) {
    throw new KnowledgeIngestError("Unsupported file type. Only txt, md, and pdf are allowed.", 415);
  }

  let document: KnowledgeDocumentRecord | null = null;

  try {
    document = await createKnowledgeDocument({
      userId,
      title: getDocumentTitleFromFilename(filename),
      originalFilename: filename,
      mimeType: supportedMimeType,
      fileSize: file.size,
      status: "uploaded",
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseKnowledgeFile({
      filename,
      mimeType: supportedMimeType,
      buffer,
    });

    if (!parsed.text.trim()) {
      throw new KnowledgeIngestError("The uploaded document does not contain extractable text.", 422);
    }

    const parsedDocument = await updateKnowledgeDocumentStatus({
      documentId: document.id,
      userId,
      status: "parsed",
      extractedText: parsed.text,
      errorMessage: null,
    });

    if (!parsedDocument) {
      throw new Error("Failed to update the knowledge document after parsing.");
    }

    const chunks = chunkText(parsed.text, knowledgeChunkDefaults);
    if (chunks.length === 0) {
      throw new KnowledgeIngestError("The uploaded document did not produce any chunks.", 422);
    }

    const persisted = await persistKnowledgeDocumentChunks({
      documentId: document.id,
      userId,
      chunks,
    });

    return {
      document: persisted.document,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await failDocumentSafely({
      document,
      errorMessage,
    });

    if (error instanceof KnowledgeIngestError) {
      throw error;
    }

    throw new KnowledgeIngestError(errorMessage, 500);
  }
};
