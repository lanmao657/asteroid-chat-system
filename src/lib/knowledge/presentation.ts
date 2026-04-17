import type {
  KnowledgeDocumentDetail,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSummary,
} from "@/lib/knowledge/types";

export const toKnowledgeDocumentSummary = (
  document: KnowledgeDocumentRecord,
): KnowledgeDocumentSummary => ({
  id: document.id,
  title: document.title,
  originalFilename: document.originalFilename,
  mimeType: document.mimeType,
  fileSize: document.fileSize,
  status: document.status,
  chunkCount: document.chunkCount,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
});

export const toKnowledgeDocumentDetail = (
  document: KnowledgeDocumentRecord,
): KnowledgeDocumentDetail => ({
  ...toKnowledgeDocumentSummary(document),
  extractedText: document.extractedText,
  errorMessage: document.errorMessage,
});
