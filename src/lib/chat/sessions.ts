export const DEFAULT_CHAT_SESSION_TITLE = "新对话";
export const CHAT_SESSION_TITLE_MAX_LENGTH = 24;

export interface SessionSummaryShape {
  id: string;
  updatedAt: string | number;
  lastMessageAt?: string | null;
}

const toTimestamp = (value: string | number | null | undefined) => {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  return 0;
};

export const getChatSessionTitle = (message: string) => {
  const compact = message.trim().replace(/\s+/g, " ");
  return compact.length > CHAT_SESSION_TITLE_MAX_LENGTH
    ? `${compact.slice(0, CHAT_SESSION_TITLE_MAX_LENGTH)}...`
    : compact || DEFAULT_CHAT_SESSION_TITLE;
};

export const hasComposerDraft = (value: string) => value.trim().length > 0;

export const shouldPreserveLocalSessionState = ({
  hasLocalSessionActivity,
  draft,
}: {
  hasLocalSessionActivity: boolean;
  draft: string;
}) => hasLocalSessionActivity || hasComposerDraft(draft);

export const sortSessionsByActivity = <T extends SessionSummaryShape>(sessions: T[]) =>
  [...sessions].sort((left, right) => {
    const rightTime = toTimestamp(right.lastMessageAt ?? right.updatedAt);
    const leftTime = toTimestamp(left.lastMessageAt ?? left.updatedAt);

    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }

    return toTimestamp(right.updatedAt) - toTimestamp(left.updatedAt);
  });

export const mergePersistedSessions = <T extends SessionSummaryShape>(
  persistedSessions: T[],
  currentSessions: T[],
) => {
  const knownSessionIds = new Set(currentSessions.map((session) => session.id));
  const missingPersistedSessions = persistedSessions.filter(
    (session) => !knownSessionIds.has(session.id),
  );

  return sortSessionsByActivity([...currentSessions, ...missingPersistedSessions]);
};

export const buildChatSessionMessagesPath = (sessionId: string) =>
  `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`;

export const buildInitialSessionList = <T extends SessionSummaryShape>(
  persistedSessions: T[],
  draftSession: T,
) => {
  if (persistedSessions.length === 0) {
    return {
      sessions: [draftSession],
      activeSessionId: draftSession.id,
    };
  }

  const sessions = sortSessionsByActivity(persistedSessions);
  return {
    sessions,
    activeSessionId: sessions[0].id,
  };
};
