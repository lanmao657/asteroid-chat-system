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

export const isPresentationIntent = (value: string) => {
  const normalized = value.toLowerCase();
  return PRESENTATION_SIGNALS.some((signal) =>
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
