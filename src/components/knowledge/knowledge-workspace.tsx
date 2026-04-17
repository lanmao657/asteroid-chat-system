"use client";

import { startTransition, useEffect, useId, useState } from "react";

import { FileText, LoaderCircle, RefreshCw, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { KnowledgeDocumentSummary } from "@/lib/knowledge/types";

interface KnowledgeDocumentsResponse {
  items: KnowledgeDocumentSummary[];
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const statusLabel: Record<KnowledgeDocumentSummary["status"], string> = {
  uploaded: "已上传",
  parsed: "已解析",
  chunked: "可检索",
  failed: "失败",
};

const mimeTypeLabel: Record<KnowledgeDocumentSummary["mimeType"], string> = {
  "application/pdf": "PDF",
  "text/markdown": "Markdown",
  "text/plain": "TXT",
};

const getErrorMessage = async (response: Response, fallback: string) => {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error?.trim() || fallback;
  } catch {
    return fallback;
  }
};

export function KnowledgeWorkspace({ embedded = false }: { embedded?: boolean } = {}) {
  const inputId = useId();
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState("正在加载文档列表...");
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

  const loadDocuments = async () => {
    setIsLoadingList(true);
    try {
      const response = await fetch("/api/knowledge/documents?limit=50");
      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }
      if (!response.ok) {
        setStatusMessage(await getErrorMessage(response, "加载文档列表失败。"));
        return;
      }

      const payload = (await response.json()) as KnowledgeDocumentsResponse;
      startTransition(() => {
        setDocuments(payload.items);
      });
      setStatusMessage(payload.items.length > 0 ? "文档列表已更新。" : "还没有上传任何文档。");
    } catch {
      setStatusMessage("加载文档列表失败。");
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, []);

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile || isUploading) {
      return;
    }

    setIsUploading(true);
    setStatusMessage(`正在上传 ${selectedFile.name}...`);

    try {
      const formData = new FormData();
      formData.set("file", selectedFile);

      const response = await fetch("/api/knowledge/documents", {
        method: "POST",
        body: formData,
      });

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok) {
        setStatusMessage(await getErrorMessage(response, "上传文档失败。"));
        return;
      }

      const payload = (await response.json()) as { item: KnowledgeDocumentSummary };
      setDocuments((current) => [
        payload.item,
        ...current.filter((item) => item.id !== payload.item.id),
      ]);
      setSelectedFile(null);

      const fileInput = event.currentTarget.elements.namedItem("file");
      if (fileInput instanceof HTMLInputElement) {
        fileInput.value = "";
      }

      setStatusMessage(`已导入 ${payload.item.originalFilename}。`);
    } catch {
      setStatusMessage("上传文档失败。");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (documentId: string) => {
    if (deletingDocumentId) {
      return;
    }

    setDeletingDocumentId(documentId);
    try {
      const response = await fetch(`/api/knowledge/documents/${documentId}`, {
        method: "DELETE",
      });

      if (response.status === 401) {
        window.location.assign("/login");
        return;
      }

      if (!response.ok) {
        setStatusMessage(await getErrorMessage(response, "删除文档失败。"));
        return;
      }

      setDocuments((current) => current.filter((item) => item.id !== documentId));
      setStatusMessage("文档已删除。");
    } catch {
      setStatusMessage("删除文档失败。");
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const content = (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
        {!embedded ? (
          <div className="border-b border-black/10 px-6 py-6 sm:px-8">
            <div className="text-[0.68rem] font-semibold uppercase tracking-[0.26em] text-black/35">
              知识文档
            </div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight text-black">文档管理</h1>
            <p className="mt-2 text-sm leading-7 text-black/58">
              上传并维护当前账号的知识文档，处理完成后即可用于检索。
            </p>
          </div>
        ) : null}

        <div className="grid gap-6 px-6 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-lg border border-black/10 bg-white text-black">
                <Upload className="size-4" />
              </span>
              <div>
                <div className="text-lg font-semibold tracking-tight text-black">上传文档</div>
                <p className="mt-1 text-sm leading-6 text-black/58">
                  支持 TXT、Markdown 和 PDF，上传后会自动解析并切分为知识片段。
                </p>
              </div>
            </div>
          </div>

          <form className="flex w-full flex-col gap-3 sm:flex-row sm:items-center" onSubmit={handleUpload}>
            <input
              accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
              className="sr-only"
              id={inputId}
              name="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <label
              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-black/10 bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:border-black/20 hover:bg-black/[0.02]"
              htmlFor={inputId}
            >
              选择文件
            </label>
            <Button
              className="rounded-lg border border-black bg-black px-5 text-white transition-colors hover:bg-black/90"
              disabled={!selectedFile || isUploading}
              type="submit"
            >
              {isUploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
              {isUploading ? "上传中..." : "开始上传"}
            </Button>
          </form>
        </div>

        <div className="border-t border-black/10 px-6 py-4 text-sm text-black/58 sm:px-8">
          <span className="font-medium text-black">当前选择：</span>
          {selectedFile?.name ?? "未选择文件"}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-black/10 bg-white">
        <div className="flex flex-col gap-4 border-b border-black/10 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-flex size-11 items-center justify-center rounded-lg border border-black/10 bg-white text-black">
                <FileText className="size-4" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-black">已上传文档</h2>
                <p className="mt-1 text-sm leading-6 text-black/58">
                  查看文档状态、更新时间和切分结果，并按需删除不再使用的文档。
                </p>
              </div>
            </div>
          </div>

          <Button
            className="rounded-lg border border-black/10 bg-white px-4 text-black transition-colors hover:bg-black/[0.02]"
            disabled={isLoadingList}
            onClick={() => void loadDocuments()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoadingList ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            刷新列表
          </Button>
        </div>

        <div
          aria-live="polite"
          className="border-b border-black/10 px-6 py-4 text-sm text-black/58 sm:px-8"
        >
          {statusMessage}
        </div>

        <div className="px-6 py-2 sm:px-8">
          {documents.length === 0 ? (
            <div className="my-4 rounded-lg border border-dashed border-black/15 px-6 py-12 text-center text-sm text-black/50">
              暂时还没有文档，上传 txt、md 或 pdf 文件后会显示在这里。
            </div>
          ) : (
            <div className="divide-y divide-black/10">
              {documents.map((document) => {
                const isDeleting = deletingDocumentId === document.id;

                return (
                  <article
                    className="grid gap-4 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    key={document.id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-start gap-4">
                        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white text-black">
                          <FileText className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold tracking-tight text-black">
                            {document.title}
                          </div>
                          <div className="mt-1 truncate text-sm text-black/50">
                            {document.originalFilename}
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-black/45">
                            <span className="rounded-lg border border-black/10 px-2.5 py-1 text-black">
                              {mimeTypeLabel[document.mimeType]}
                            </span>
                            <span className="rounded-lg border border-black/10 px-2.5 py-1 text-black">
                              {statusLabel[document.status]}
                            </span>
                            <span>{document.chunkCount} 个文本片段</span>
                            <span>{formatDateTime(document.updatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Button
                      className="rounded-lg border border-black/10 bg-white px-4 text-black transition-colors hover:bg-black/[0.02]"
                      disabled={isDeleting}
                      onClick={() => void handleDelete(document.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {isDeleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
                      删除
                    </Button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen bg-[#f4f3ef] text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {content}
      </div>
    </div>
  );
}
