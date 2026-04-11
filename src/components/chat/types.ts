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

export interface AssistantMessageMetadata extends Record<string, unknown> {
  draftLength?: number;
  finalMessageLength?: number;
  kind?: string;
  protectedLongDraft?: boolean;
  runId?: string;
  thoughts?: ActivityItem[];
}

export interface StreamingDraft {
  id: string;
  content: string;
  status: "streaming" | "stopped";
  createdAt: string;
  thoughts?: ActivityItem[];
}

export interface PromptSuggestion {
  id: string;
  title: string;
  prompt: string;
  description: string;
}

export type MessageListItem = ChatMessage;

export const getMessageThoughts = (message: MessageListItem): ActivityItem[] => {
  const thoughts = (message.metadata as AssistantMessageMetadata | undefined)?.thoughts;
  return Array.isArray(thoughts) ? thoughts : [];
};
