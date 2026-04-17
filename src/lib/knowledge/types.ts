export type KnowledgeDocumentStatus = "uploaded" | "parsed" | "chunked" | "failed";

export type KnowledgeChunkEmbeddingStatus = "pending" | "ready" | "failed";

export interface KnowledgeChunkInput {
  id?: string;
  chunkIndex: number;
  content: string;
  charCount: number;
  embeddingStatus?: KnowledgeChunkEmbeddingStatus;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeChunkRecord {
  id: string;
  documentId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  charCount: number;
  embeddingStatus: KnowledgeChunkEmbeddingStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeDocumentRecord {
  id: string;
  userId: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  extractedText: string;
  status: KnowledgeDocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentSummary {
  id: string;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  status: KnowledgeDocumentStatus;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  extractedText: string;
  errorMessage: string | null;
}

export interface ParsedKnowledgeFile {
  mimeType: SupportedKnowledgeMimeType;
  text: string;
}

export interface IngestKnowledgeFileResult {
  document: KnowledgeDocumentRecord;
}

export type SupportedKnowledgeMimeType =
  | "text/plain"
  | "text/markdown"
  | "application/pdf";
