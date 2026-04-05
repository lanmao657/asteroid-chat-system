# Agent Chat Workspace

一个基于 Next.js 16、React 19 和 TypeScript 的聊天原型，当前支持：

- 单 SSE 通道流式回答
- 会话摘要记忆压缩
- 联网检索、知识库检索与天气查询
- 查询重写、相关性评分门控与可选 rerank
- 实时 RAG 过程可视化
- 前端主动停止生成
- Assistant 回答的安全 Markdown 渲染

当前会话、摘要和运行状态都只保存在进程内存中，服务重启后不会保留。

## 启动

```bash
npm install
copy .env.example .env.local
npm run dev
```

访问 `http://localhost:3000`

## 关键环境变量

| Name | Purpose | Default |
| --- | --- | --- |
| `MODEL_PROVIDER` | `openai` 或 `mock` | `openai` |
| `OPENAI_COMPAT_BASE_URL` | OpenAI-compatible base URL | `https://api.openai.com/v1` |
| `OPENAI_COMPAT_API_KEY` | 模型 API key | empty |
| `OPENAI_MODEL` | 模型名 | `gpt-4.1-mini` |
| `AGENT_COMPOSE_INPUT_CHAR_BUDGET` | 输入上下文字符预算，不用于截断最终回答 | `4200` |
| `AGENT_CONVERSATION_WINDOW` | 对话裁剪窗口 | `6` |
| `AGENT_COMPOSE_OUTPUT_TOKEN_LIMIT` | 单轮输出 token 上限；命中上限时会触发自动续写 | `700` |
| `AGENT_MAX_CONTINUATIONS` | 单次回答允许的最大自动续写次数 | `2` |
| `AGENT_CONTINUATION_TAIL_CHARS` | 续写时附带的上一轮回答尾部字符数 | `1000` |
| `AGENT_SUMMARY_TRIGGER_MESSAGES` | 触发摘要压缩的消息数 | `8` |
| `AGENT_SUMMARY_RECENT_WINDOW` | 保留原始最近消息数 | `4` |
| `SEARCH_API_BASE_URL` | 主搜索服务地址 | `https://google.serper.dev/search` |
| `SEARCH_API_KEY` | 主搜索服务 key | empty |
| `SEARCH_MAX_RESULTS` | 保留搜索结果数 | `5` |
| `SEARCH_PROVIDERS` | 搜索源优先级 | `search-api,duckduckgo-html,bing-rss` |
| `FETCH_MAX_PAGES` | 最多抓取页面数 | `3` |
| `WEB_FETCH_TIMEOUT_MS` | 搜索/抓取超时 | `12000` |
| `KNOWLEDGE_BASE_MAX_RESULTS` | 知识库候选条数 | `4` |
| `JINA_API_KEY` | 可选 Jina Rerank API key | empty |
| `JINA_RERANK_MODEL` | Jina rerank 模型 | `jina-reranker-v2-base-multilingual` |
| `WEATHER_API_BASE_URL` | 天气查询服务地址 | `https://wttr.in` |

## Markdown 渲染

- Assistant 消息会按安全 Markdown 渲染，支持标题、列表、粗体、引用、行内代码和代码块。
- User 消息仍按纯文本显示，不会解析 Markdown。
- 原始 HTML 不会被执行，只支持安全 Markdown 子集。
- 公式、Mermaid、富表格等增强渲染暂未接入。

## 命令

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run typecheck
```
