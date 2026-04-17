import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createRequireMock,
  destroyMock,
  getTextMock,
  requireMock,
} = vi.hoisted(() => ({
  createRequireMock: vi.fn(),
  destroyMock: vi.fn(),
  getTextMock: vi.fn(),
  requireMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("node:module", () => ({
  createRequire: createRequireMock,
}));

const importParserModule = () => import("./parser");

describe("knowledge parser", () => {
  beforeEach(() => {
    vi.resetModules();

    destroyMock.mockReset();
    destroyMock.mockResolvedValue(undefined);

    getTextMock.mockReset();
    getTextMock.mockResolvedValue({
      text: "",
    });

    requireMock.mockReset();
    const PDFParseMock = vi.fn(function PDFParseMock() {
      return {
        getText: getTextMock,
        destroy: destroyMock,
      };
    });
    requireMock.mockReturnValue({
      PDFParse: PDFParseMock,
    });

    createRequireMock.mockReset();
    createRequireMock.mockReturnValue(requireMock);
  });

  it("parses plain text files and normalizes whitespace", async () => {
    const { parseKnowledgeFile } = await importParserModule();

    await expect(
      parseKnowledgeFile({
        filename: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello   \r\n\r\n\r\nworld \n"),
      }),
    ).resolves.toEqual({
      mimeType: "text/plain",
      text: "hello\n\nworld",
    });
  });

  it("parses markdown files and normalizes whitespace", async () => {
    const { parseKnowledgeFile } = await importParserModule();

    await expect(
      parseKnowledgeFile({
        filename: "notes.md",
        mimeType: "text/markdown",
        buffer: Buffer.from("# Title\r\n\r\nParagraph\t \n"),
      }),
    ).resolves.toEqual({
      mimeType: "text/markdown",
      text: "# Title\n\nParagraph",
    });
  });

  it("parses pdf files through the runtime-loaded pdf parser", async () => {
    getTextMock.mockResolvedValueOnce({
      text: "Page 1\r\n\r\n\r\nPage 2",
    });

    const { parseKnowledgeFile } = await importParserModule();

    await expect(
      parseKnowledgeFile({
        filename: "guide.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("pdf"),
      }),
    ).resolves.toEqual({
      mimeType: "application/pdf",
      text: "Page 1\n\nPage 2",
    });

    expect(createRequireMock).toHaveBeenCalledTimes(1);
    expect(requireMock).toHaveBeenCalledWith("pdf-parse");
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("destroys the pdf parser and surfaces a stable error when pdf parsing fails", async () => {
    getTextMock.mockRejectedValueOnce(
      new Error(
        "Setting up fake worker failed: Cannot find module 'pdf.worker.mjs' imported from server chunk.",
      ),
    );

    const { parseKnowledgeFile } = await importParserModule();

    await expect(
      parseKnowledgeFile({
        filename: "broken.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("pdf"),
      }),
    ).rejects.toThrow(
      "Failed to parse PDF document. Setting up fake worker failed: Cannot find module 'pdf.worker.mjs' imported from server chunk.",
    );

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported file types", async () => {
    const { parseKnowledgeFile } = await importParserModule();

    await expect(
      parseKnowledgeFile({
        filename: "notes.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: Buffer.from("docx"),
      }),
    ).rejects.toThrow("Unsupported file type.");
  });
});
