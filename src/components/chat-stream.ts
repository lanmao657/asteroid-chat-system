import type { ChatMessage } from "@/lib/agent/types";

export const resolveAssistantFinalMessage = ({
  draftContent,
  finalMessage,
}: {
  draftContent?: string;
  finalMessage: ChatMessage;
}) => {
  const normalizedDraft = draftContent?.trim() ?? "";
  const normalizedFinal = finalMessage.content.trim();

  if (normalizedDraft && normalizedDraft.length > normalizedFinal.length) {
    return {
      message: {
        ...finalMessage,
        content: draftContent ?? finalMessage.content,
        metadata: {
          ...finalMessage.metadata,
          protectedLongDraft: true,
          finalMessageLength: normalizedFinal.length,
          draftLength: normalizedDraft.length,
        },
      },
      usedDraft: true,
    };
  }

  return {
    message: finalMessage,
    usedDraft: false,
  };
};
