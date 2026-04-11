const PRESENTATION_SIGNALS = [
  "汇报",
  "presentation",
  "lecture",
  "课堂",
  "讲解",
  "slides",
  "slide",
  "outline",
  "10分钟",
  "15分钟",
  "演讲",
  "报告",
];

const DIRECT_SCRIPT_SIGNALS = [
  "标准说法",
  "标准回复",
  "标准话术",
  "怎么回复",
  "如何回复",
  "客户应该怎么说",
  "客户应该怎么回复",
  "客服应该怎么回复",
  "销售应该怎么回复",
  "直接话术",
];

export const isPresentationIntent = (value: string) => {
  const normalized = value.toLowerCase();
  return PRESENTATION_SIGNALS.some((signal) =>
    normalized.includes(signal.toLowerCase()),
  );
};

export const isDirectScriptIntent = (value: string) => {
  const normalized = value.toLowerCase();
  return DIRECT_SCRIPT_SIGNALS.some((signal) =>
    normalized.includes(signal.toLowerCase()),
  );
};

export const getPresentationStyleInstruction = (value: string) => {
  if (!isPresentationIntent(value)) {
    return "";
  }

  return [
    "The user wants a presentation-ready answer.",
    "Prefer clean Markdown with a title, section headings, and concise bullet lists.",
    "Organize the content like a classroom presentation for 10-15 minutes.",
    "Emphasize modeling, abstraction, trade-offs, and why-driven explanation.",
    "When appropriate, include motivation, workflow, pitfalls, and takeaways.",
  ].join(" ");
};

export const getDirectScriptStyleInstruction = (value: string) => {
  if (!isDirectScriptIntent(value)) {
    return "";
  }

  return [
    "The user wants directly usable customer-facing wording.",
    "Start the answer with a section titled 标准话术 and make that section directly copyable.",
    "Only add a short 补充说明 section when it is necessary to avoid misuse.",
    "Add 来源 only when source attribution materially helps.",
    "Do not default to the longer SOP-summary structure for this request type.",
  ].join(" ");
};
