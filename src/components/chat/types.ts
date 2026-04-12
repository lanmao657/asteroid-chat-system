import type { AgentRunTrace, ChatMessage, RetrievalStep } from "@/lib/agent/types";
import type { SessionSummaryShape } from "@/lib/chat/sessions";

export interface SessionSummary extends SessionSummaryShape {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt: string | number;
  lastMessageAt?: string | null;
  isDraft?: boolean;
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
  trace?: AgentRunTrace;
  thoughts?: ActivityItem[];
}

export interface StreamingDraft {
  id: string;
  content: string;
  status: "streaming" | "stopped";
  createdAt: string;
  trace?: AgentRunTrace;
  thoughts?: ActivityItem[];
}

export interface PromptSuggestion {
  id: string;
  title: string;
  prompt: string;
  description: string;
}

export type MessageListItem = ChatMessage;

const traceStepToActivity = (step: RetrievalStep, index: number): ActivityItem => ({
  id: `trace-step-${index}-${step.stage}`,
  kind: "run",
  title: step.label,
  body: step.detail,
  detail: step.metadata ? JSON.stringify(step.metadata, null, 2) : undefined,
  createdAt: new Date(0).toISOString(),
});

export const getMessageThoughts = (message: MessageListItem): ActivityItem[] => {
  const metadata = message.metadata as AssistantMessageMetadata | undefined;
  const thoughts = metadata?.thoughts;
  if (Array.isArray(thoughts) && thoughts.length > 0) {
    return thoughts;
  }

  const steps = metadata?.trace?.steps;
  return Array.isArray(steps) ? steps.map(traceStepToActivity) : [];
};

export const getMessageTrace = (message: MessageListItem): AgentRunTrace | undefined =>
  (message.metadata as AssistantMessageMetadata | undefined)?.trace;
