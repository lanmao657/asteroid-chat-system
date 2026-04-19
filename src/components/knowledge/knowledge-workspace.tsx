"use client";

import { startTransition, useEffect, useId, useState } from "react";

import { LoaderCircle, RefreshCw, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { KnowledgeDocumentSummary } from "@/lib/knowledge/types";

interface KnowledgeDocumentsResponse {
  items: KnowledgeDocumentSummary[];
}

export interface KnowledgeWorkspaceProps {
  embedded?: boolean;
  presentation?: "page" | "settings";
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

export function KnowledgeWorkspace({
  embedded = false,
  presentation,
}: KnowledgeWorkspaceProps = {}) {
  const resolvedPresentation = presentation ?? (embedded ? "settings" : "page");
  const isSettingsPresentation = resolvedPresentation === "settings";
  const inputId = useId();
  const [documents, setDocuments] = useState<KnowledgeDocumentSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState("加载中…");
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
        setStatusMessage(await getErrorMessage(response, "加载失败。"));
        return;
      }

      const payload = (await response.json()) as KnowledgeDocumentsResponse;
      startTransition(() => {
        setDocuments(payload.items);
      });
      setStatusMessage(payload.items.length > 0 ? "已更新" : "暂无文档");
    } catch {
      setStatusMessage("加载失败。");
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
    setStatusMessage("上传中…");

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
        setStatusMessage(await getErrorMessage(response, "上传失败。"));
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

      setStatusMessage("已上传");
    } catch {
      setStatusMessage("上传失败。");
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
        setStatusMessage(await getErrorMessage(response, "删除失败。"));
        return;
      }

      setDocuments((current) => current.filter((item) => item.id !== documentId));
      setStatusMessage("已删除");
    } catch {
      setStatusMessage("删除失败。");
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const settingsContent = (
    <div className="settings-ui flex flex-col gap-5 text-[#1d1d1b]" data-presentation={resolvedPresentation}>
      <section>
        <div className="flex items-center justify-between gap-4 pb-3">
          <h2 className="text-[1.04rem] font-medium tracking-[-0.02em] text-[#1f1f1d]">文档</h2>
          <Button
            className="min-h-10 rounded-full border-black/[0.1] bg-white px-4 text-[0.95rem] font-medium text-[#1f1f1d] hover:bg-black/[0.02]"
            disabled={isLoadingList}
            onClick={() => void loadDocuments()}
            size="sm"
            type="button"
            variant="outline"
          >
            {isLoadingList ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            刷新
          </Button>
        </div>

        <form className="flex flex-col gap-3 border-t border-black/[0.06] py-4 sm:flex-row sm:flex-wrap sm:items-center" onSubmit={handleUpload}>
          <input
            accept=".txt,.md,.markdown,.pdf,text/plain,text/markdown,application/pdf"
            className="sr-only"
            id={inputId}
            name="file"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <label
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border border-black/[0.12] bg-white px-5 text-[0.98rem] font-medium text-[#1c1c1a] transition-colors hover:bg-black/[0.02]"
            htmlFor={inputId}
          >
            选择文件
          </label>

          <Button
            className="min-h-11 rounded-full bg-[#181818] px-5 text-[0.98rem] font-medium text-white hover:bg-black/90"
            disabled={!selectedFile || isUploading}
            type="submit"
          >
            {isUploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
            {isUploading ? "上传中…" : "上传"}
          </Button>

          <div className="text-sm text-black/48">{selectedFile?.name ?? "未选择文件"}</div>
        </form>

        <div aria-live="polite" className="border-t border-black/[0.06] py-3 text-sm text-black/52">
          {statusMessage}
        </div>

        {documents.length === 0 ? (
          <div className="border-t border-black/[0.06] py-8 text-sm text-black/46">
            暂无文档
          </div>
        ) : (
          <div className="divide-y divide-black/[0.06] border-t border-black/[0.06]">
            {documents.map((document) => {
              const isDeleting = deletingDocumentId === document.id;

              return (
                <article
                  className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6"
                  key={document.id}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[1rem] font-medium tracking-[-0.02em] text-[#20201e]">
                      {document.title}
                    </div>
                    <div className="mt-1 truncate text-sm text-black/48">{document.originalFilename}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-black/45">
                      <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-black/70">
                        {mimeTypeLabel[document.mimeType]}
                      </span>
                      <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-black/70">
                        {statusLabel[document.status]}
                      </span>
                      <span>{document.chunkCount} 个片段</span>
                      <span>{formatDateTime(document.updatedAt)}</span>
                    </div>
                  </div>

                  <Button
                    className="min-h-10 rounded-full border-black/[0.1] bg-white px-4 text-[0.95rem] font-medium text-[#1f1f1d] hover:bg-black/[0.02]"
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
      </section>
    </div>
  );

  if (isSettingsPresentation) {
    return settingsContent;
  }

  return (
    <div className="min-h-screen bg-[#efeeea] px-4 py-6 text-[#1d1d1b] sm:px-6">
      <div className="mx-auto max-w-[960px] rounded-[28px] border border-black/[0.08] bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)] sm:p-7">
        {settingsContent}
      </div>
    </div>
  );
}
