import "server-only";

import { createRequire } from "node:module";

import type { ParsedKnowledgeFile, SupportedKnowledgeMimeType } from "@/lib/knowledge/types";

type PdfParseModule = {
  PDFParse: new (options: { data: Buffer | Uint8Array }) => {
    getText(): Promise<{ text?: string | null }>;
    destroy(): Promise<void>;
  };
};

const supportedExtensionToMimeType: Record<string, SupportedKnowledgeMimeType> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
};

const supportedMimeTypes = new Set<SupportedKnowledgeMimeType>([
  "text/plain",
  "text/markdown",
  "application/pdf",
]);

const require = createRequire(import.meta.url);

let cachedPdfParseModule: PdfParseModule | null = null;

const normalizeWhitespace = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const getExtension = (filename: string) => {
  const match = filename.toLowerCase().match(/(\.[^.]+)$/);
  return match?.[1] ?? "";
};

const loadPdfParse = (): PdfParseModule => {
  if (cachedPdfParseModule) {
    return cachedPdfParseModule;
  }

  const loadedModule = require("pdf-parse") as Partial<PdfParseModule>;
  if (typeof loadedModule.PDFParse !== "function") {
    throw new Error("Failed to load the PDF parser.");
  }

  cachedPdfParseModule = loadedModule as PdfParseModule;
  return cachedPdfParseModule;
};

const parsePdfText = async (buffer: Buffer) => {
  const { PDFParse } = loadPdfParse();
  const parser = new PDFParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    return normalizeWhitespace(parsed.text ?? "");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown PDF parsing failure.";
    throw new Error(`Failed to parse PDF document. ${errorMessage}`);
  } finally {
    await parser.destroy();
  }
};

export const getSupportedMimeType = ({
  filename,
  mimeType,
}: {
  filename: string;
  mimeType?: string;
}) => {
  const normalizedMimeType = mimeType?.trim().toLowerCase();
  if (normalizedMimeType && supportedMimeTypes.has(normalizedMimeType as SupportedKnowledgeMimeType)) {
    return normalizedMimeType as SupportedKnowledgeMimeType;
  }

  const extension = getExtension(filename);
  return supportedExtensionToMimeType[extension] ?? null;
};

export const getDocumentTitleFromFilename = (filename: string) =>
  filename.replace(/\.[^.]+$/, "").trim() || "Untitled document";

export const parseKnowledgeFile = async ({
  filename,
  mimeType,
  buffer,
}: {
  filename: string;
  mimeType?: string;
  buffer: Buffer;
}): Promise<ParsedKnowledgeFile> => {
  const supportedMimeType = getSupportedMimeType({ filename, mimeType });
  if (!supportedMimeType) {
    throw new Error("Unsupported file type.");
  }

  if (supportedMimeType === "application/pdf") {
    return {
      mimeType: supportedMimeType,
      text: await parsePdfText(buffer),
    };
  }

  return {
    mimeType: supportedMimeType,
    text: normalizeWhitespace(buffer.toString("utf-8")),
  };
};
