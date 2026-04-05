import { afterEach, describe, expect, it, vi } from "vitest";

describe("provider selection and API behavior", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    delete process.env.MODEL_PROVIDER;
    delete process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_COMPAT_BASE_URL;
    delete process.env.AGENT_COMPOSE_INPUT_CHAR_BUDGET;
    delete process.env.AGENT_MAX_CONTINUATIONS;
    delete process.env.AGENT_CONTINUATION_TAIL_CHARS;
  });

  it("prefers OpenAI when configuration is present and can summarize", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "summary text",
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const summary = await provider.summarizeConversation({
      existingSummary: "",
      messagesToSummarize: [],
    });

    expect(provider.label).toBe("OpenAI Compatible");
    expect(summary).toBe("summary text");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("streams incremental tokens from an OpenAI-compatible response", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
          ),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const deltas: string[] = [];
    const answer = await provider.streamAnswer({
      userMessage: "hello",
      recentConversation: [],
      memorySummary: "",
      searchResults: [],
      pageContents: [],
      retrievalDocuments: [],
      toolResults: [],
      onDelta: async (delta) => {
        deltas.push(delta);
      },
    });

    expect(answer).toEqual({
      text: "hello world",
      finishReason: "unknown",
    });
    expect(deltas).toEqual(["hello ", "world"]);
  });

  it("captures finish_reason from a streamed OpenAI-compatible response", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"part 1 "},"finish_reason":null}]}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"part 2"},"finish_reason":"length"}]}\n\n',
          ),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const answer = await provider.streamAnswer({
      userMessage: "hello",
      recentConversation: [],
      memorySummary: "",
      searchResults: [],
      pageContents: [],
      retrievalDocuments: [],
      toolResults: [],
      onDelta: async () => {},
    });

    expect(answer).toEqual({
      text: "part 1 part 2",
      finishReason: "length",
    });
  });

  it("does not truncate streamed output to the input char budget", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.AGENT_COMPOSE_INPUT_CHAR_BUDGET = "10";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"this is definitely longer than ten"}}]}\n\n',
          ),
        );
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const answer = await provider.streamAnswer({
      userMessage: "hello",
      recentConversation: [],
      memorySummary: "",
      searchResults: [],
      pageContents: [],
      retrievalDocuments: [],
      toolResults: [],
      onDelta: async () => {},
    });

    expect(answer).toEqual({
      text: "this is definitely longer than ten",
      finishReason: "unknown",
    });
  });

  it("can produce structured rewrite and grade decisions", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"mode":"step-back","query":"agent workspace overview","reason":"broaden the query"}',
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const rewrite = await provider.rewriteQuery({
      userMessage: "tell me the latest workspace design",
      retrievalContext: [],
    });

    expect(rewrite.mode).toBe("step-back");
    expect(rewrite.query).toContain("overview");
  });

  it("injects presentation guidance for lecture-style requests", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };

      expect(body.messages[0].content).toContain("presentation-ready");
      expect(body.messages[0].content).toContain("trade-offs");

      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });

    vi.stubGlobal("fetch", fetchSpy);

    const { createProvider } = await import("./provider");
    const provider = createProvider();

    await expect(
      provider.streamAnswer({
        userMessage: "请给我一份 10分钟 database systems 课堂汇报 presentation",
        recentConversation: [],
        memorySummary: "",
        searchResults: [],
        pageContents: [],
        retrievalDocuments: [],
        toolResults: [],
        onDelta: async () => {},
      }),
    ).rejects.toThrow("Model response did not contain content.");
  });

  it("does not truncate non-stream model output to the input char budget", async () => {
    process.env.MODEL_PROVIDER = "openai";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";
    process.env.OPENAI_COMPAT_BASE_URL = "https://example.com/v1";
    process.env.AGENT_COMPOSE_INPUT_CHAR_BUDGET = "8";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"decision":"answer","averageScore":0.82,"reason":"This is comfortably longer than eight."}',
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const grade = await provider.gradeDocuments({
      userMessage: "hello",
      retrievalContext: [],
    });

    expect(grade.reason).toBe("This is comfortably longer than eight.");
  });

  it("keeps explicit mock mode without calling OpenAI", async () => {
    process.env.MODEL_PROVIDER = "mock";
    process.env.OPENAI_COMPAT_API_KEY = "test-key";
    process.env.OPENAI_MODEL = "test-model";

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { createProvider } = await import("./provider");
    const provider = createProvider();
    const deltas: string[] = [];
    const answer = await provider.streamAnswer({
      userMessage: "请总结 AI agent 的价值",
      recentConversation: [],
      memorySummary: "",
      searchResults: [],
      pageContents: [],
      retrievalDocuments: [],
      toolResults: [],
      onDelta: async (delta) => {
        deltas.push(delta);
      },
    });

    expect(provider.label).toBe("Mock Provider");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(answer.text).toContain("mock provider");
    expect(answer.finishReason).toBe("stop");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("throws when OpenAI mode is selected but configuration is missing", async () => {
    process.env.MODEL_PROVIDER = "openai";

    const { createProvider } = await import("./provider");
    expect(() => createProvider()).toThrow(
      "OpenAI-compatible API is not configured. Please set OPENAI_COMPAT_API_KEY and OPENAI_MODEL.",
    );
  });
});
