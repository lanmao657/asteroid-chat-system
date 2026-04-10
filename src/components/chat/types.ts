import type { ChatMessage } from "@/lib/agent/types";

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface ActivityItem {
  id: string;
  kind: "memory" | "tool-started" | "tool-progress" | "tool-result" | "run";
  title: string;
  body: string;
  detail?: string;
  createdAt: string;
}

export interface StreamingDraft {
  id: string;
  content: string;
  status: "streaming" | "stopped";
  createdAt: string;
}

export interface PromptSuggestion {
  id: string;
  title: string;
  prompt: string;
  description: string;
}

export type MessageListItem = ChatMessage;
