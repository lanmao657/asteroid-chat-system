import type { ChatMessage } from "@/lib/agent/types";

interface SessionRecord {
  id: string;
  messages: ChatMessage[];
  memorySummary: string;
  updatedAt: number;
}

const sessions = new Map<string, SessionRecord>();

const cloneMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  metadata: message.metadata ? { ...message.metadata } : undefined,
});

const cloneMessages = (messages: ChatMessage[]) => messages.map(cloneMessage);

const cloneSession = (session: SessionRecord): SessionRecord => ({
  ...session,
  messages: cloneMessages(session.messages),
});

export const ensureSession = (sessionId: string) => {
  const existing = sessions.get(sessionId);
  if (existing) {
    return existing;
  }

  const created: SessionRecord = {
    id: sessionId,
    messages: [],
    memorySummary: "",
    updatedAt: Date.now(),
  };

  sessions.set(sessionId, created);
  return created;
};

export const listSessionMessages = (sessionId: string) => {
  const session = ensureSession(sessionId);
  return cloneMessages(session.messages);
};

export const getSessionMemorySummary = (sessionId: string) => {
  const session = ensureSession(sessionId);
  return session.memorySummary;
};

export const setSessionMemorySummary = (sessionId: string, summary: string) => {
  const session = ensureSession(sessionId);
  session.memorySummary = summary;
  session.updatedAt = Date.now();
};

export const appendSessionMessage = (sessionId: string, message: ChatMessage) => {
  const session = ensureSession(sessionId);
  session.messages.push(cloneMessage(message));
  session.updatedAt = Date.now();
};

export const getSessionSnapshot = (sessionId: string) => cloneSession(ensureSession(sessionId));

export const clearSessions = () => {
  sessions.clear();
};
