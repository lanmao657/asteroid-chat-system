import type { KnowledgeBaseDocument } from "@/lib/agent/types";

export const knowledgeBaseDocuments: KnowledgeBaseDocument[] = [
  {
    id: "kb-agent-overview",
    title: "Agent Workspace Product Overview",
    source: "internal-doc",
    url: "kb://agent-workspace/overview",
    tags: ["agent", "workspace", "product", "overview"],
    content:
      "Agent Workspace is a conversational product shell that combines chat, retrieval, streaming answer generation, and observable execution logs. It is designed for demos where users need to understand what the system searched, how documents were graded, and why a final answer was produced.",
  },
  {
    id: "kb-rag-observability",
    title: "RAG Observability Design Notes",
    source: "internal-doc",
    url: "kb://agent-workspace/rag-observability",
    tags: ["rag", "observability", "search", "grading", "rewrite"],
    content:
      "The recommended RAG trace should expose routing, retrieval, grading, query rewriting, reranking, and final source usage. Frontend UI should let users expand each stage to inspect scores, rewritten queries, and retained sources without mixing these traces into formal chat history.",
  },
  {
    id: "kb-tool-extensibility",
    title: "Tool Extensibility Guidance",
    source: "internal-doc",
    url: "kb://agent-workspace/tools",
    tags: ["tools", "weather", "knowledge-base", "api"],
    content:
      "Tools should be pluggable and side-effect free. A weather example is useful for third-party API integration. A knowledge base retrieval example is useful for enterprise content. Both should emit progress events so the chat UI remains observable while tools are executing.",
  },
  {
    id: "kb-hybrid-retrieval",
    title: "Hybrid Retrieval Approach",
    source: "internal-doc",
    url: "kb://agent-workspace/hybrid-retrieval",
    tags: ["hybrid", "bm25", "dense", "rrf", "rerank"],
    content:
      "A practical TypeScript adaptation of hybrid retrieval can combine sparse lexical scoring and dense semantic-style scoring, then merge rankings with reciprocal rank fusion. If external reranking is configured, rerank the top candidates and expose rerank scores. If sparse retrieval fails, fall back to dense-only retrieval instead of failing the turn.",
  },
];
