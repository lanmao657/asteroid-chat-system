import { agentEnv } from "@/lib/agent/env";
import type { KnowledgeChunkInput } from "@/lib/knowledge/types";

export interface ChunkTextOptions {
  targetChunkSize?: number;
  overlapSize?: number;
}

const DEFAULT_TARGET_CHUNK_SIZE = agentEnv.knowledgeBaseChunkSize;
const DEFAULT_OVERLAP_SIZE = agentEnv.knowledgeBaseChunkOverlap;
const MIN_BOUNDARY_SEARCH = 100;

const normalizeText = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const trimChunk = (value: string) => value.trim();

const findChunkEnd = (text: string, start: number, targetChunkSize: number) => {
  const maxEnd = Math.min(start + targetChunkSize, text.length);
  if (maxEnd >= text.length) {
    return text.length;
  }

  const minBoundary = Math.min(
    start + Math.max(Math.floor(targetChunkSize * 0.4), MIN_BOUNDARY_SEARCH),
    maxEnd,
  );
  const paragraphBoundary = text.lastIndexOf("\n\n", maxEnd);
  if (paragraphBoundary >= minBoundary) {
    return paragraphBoundary;
  }

  const lineBoundary = text.lastIndexOf("\n", maxEnd);
  if (lineBoundary >= minBoundary) {
    return lineBoundary;
  }

  return maxEnd;
};

const moveStartForward = (text: string, start: number) => {
  let nextStart = start;
  while (nextStart < text.length && /\s/.test(text[nextStart] ?? "")) {
    nextStart += 1;
  }
  return nextStart;
};

export const chunkText = (
  text: string,
  options: ChunkTextOptions = {},
): KnowledgeChunkInput[] => {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const targetChunkSize = Math.max(
    Math.trunc(options.targetChunkSize ?? DEFAULT_TARGET_CHUNK_SIZE),
    50,
  );
  const overlapSize = Math.max(
    0,
    Math.min(Math.trunc(options.overlapSize ?? DEFAULT_OVERLAP_SIZE), targetChunkSize - 1),
  );

  const chunks: KnowledgeChunkInput[] = [];
  let start = 0;

  while (start < normalizedText.length) {
    const end = findChunkEnd(normalizedText, start, targetChunkSize);
    const content = trimChunk(normalizedText.slice(start, end));

    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        charCount: content.length,
      });
    }

    if (end >= normalizedText.length) {
      break;
    }

    const nextStart = moveStartForward(normalizedText, Math.max(end - overlapSize, start + 1));
    start = nextStart <= start ? end : nextStart;
  }

  return chunks;
};

export const knowledgeChunkDefaults = {
  targetChunkSize: DEFAULT_TARGET_CHUNK_SIZE,
  overlapSize: DEFAULT_OVERLAP_SIZE,
};
