import { describe, expect, it } from "vitest";

import { chunkText } from "@/lib/knowledge/chunker";

describe("knowledge chunker", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("Short paragraph", {
      targetChunkSize: 120,
      overlapSize: 20,
    });

    expect(chunks).toEqual([
      {
        chunkIndex: 0,
        content: "Short paragraph",
        charCount: "Short paragraph".length,
      },
    ]);
  });

  it("prefers paragraph boundaries when splitting text", () => {
    const paragraphA = "A".repeat(360);
    const paragraphB = "B".repeat(360);

    const chunks = chunkText(`${paragraphA}\n\n${paragraphB}`, {
      targetChunkSize: 500,
      overlapSize: 50,
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe(paragraphA);
    expect(chunks[1]?.content.includes(paragraphB)).toBe(true);
  });

  it("falls back to hard splits for oversized text and preserves overlap", () => {
    const source = "abcdefghijklmnopqrstuvwxyz".repeat(12);
    const chunks = chunkText(source, {
      targetChunkSize: 60,
      overlapSize: 10,
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0]?.content.length).toBeLessThanOrEqual(60);
    expect(chunks[1]?.content.startsWith(chunks[0]!.content.slice(-10))).toBe(true);
  });

  it("removes empty content and produces stable chunk indices", () => {
    const chunks = chunkText("\n\nFirst paragraph\n\n\nSecond paragraph\n\n", {
      targetChunkSize: 16,
      overlapSize: 4,
    });

    expect(chunks.every((chunk, index) => chunk.chunkIndex === index)).toBe(true);
    expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(true);
  });

  it("returns no chunks for blank text", () => {
    expect(chunkText("   \n\n\t")).toEqual([]);
  });
});
