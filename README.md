# Enterprise Knowledge Assistant

一个基于 Next.js 16、React 19 和 TypeScript 的企业培训 / 内部知识助手原型，当前支持：

- 单 SSE 通道流式回答
- 会话摘要记忆压缩
- 内部知识库检索、联网补充检索与天气查询
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

## Web Search

- `src/tools/webSearch.ts` adds a reusable `webSearch(query)` tool backed by Tavily.
- `SEARCH_PROVIDERS` now prefers `tavily` and falls back to the existing providers.
- The agent only attempts `web_search` for prompts that look like they need live web data.
- If the model endpoint does not support function/tool calling, the chat flow degrades gracefully and continues without `web_search`.
- If search fails or returns no results, the tool returns an empty result or an explicit failure path. It never fabricates search hits.

## PostgreSQL Persistence

- PostgreSQL is wired on the server side only. The frontend chat UI and SSE contract stay unchanged.
- The existing in-memory session store is kept as-is to avoid breaking the current chat/runtime flow.
- The first persisted business object is `agent_run_logs`, which records one row per agent turn.
- Database access lives under `src/lib/db/`:
  - `env.ts`: database env parsing
  - `client.ts`: shared `pg` pool
  - `schema.ts`: lazy `CREATE TABLE IF NOT EXISTS`
  - `agent-run-log-repository.ts`: insert/query repository
- A verification route is available at `GET /api/agent-runs?sessionId=<id>&limit=10`

### Required env

Add these to `.env.local` when enabling PostgreSQL locally:

```bash
DATABASE_URL=postgresql://lanmao:550695@localhost:5432/mydb
DATABASE_MAX_CONNECTIONS=5
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=5000
```

If `DATABASE_URL` is missing, the app still runs and the chat flow still works, but run logs will not be persisted.

### Local PostgreSQL

If you already have PostgreSQL installed locally:

```bash
createdb mydb
```

Or with Docker:

```bash
docker run --name xin-postgres -e POSTGRES_PASSWORD=550695 -e POSTGRES_USER=lanmao -e POSTGRES_DB=mydb -p 5432:5432 -d postgres:16
```

You can initialize the schema manually with:

```bash
psql postgresql://lanmao:550695@localhost:5432/mydb -f sql/init-postgres.sql
```

This project also lazily creates the table on first successful database write, so manual init is optional for local development.

### Persisted table

`agent_run_logs`

- `run_id`: unique run identifier
- `session_id`: current chat session id
- `task_category`: inferred task category such as `policy_qa`, `training_summary`, `sop_lookup`, `case_review`, or `general`
- `provider`: model/provider label emitted by the runtime
- `status`: `completed`, `aborted`, or `errored`
- `user_message`: incoming user prompt
- `assistant_message`: final or partial assistant text
- `memory_summary`: post-run memory summary snapshot
- `tool_results`: JSONB payload of tool execution results
- `error_message`: error detail when a run fails
- `started_at` / `finished_at`: request lifecycle timestamps

### Verification

1. Start PostgreSQL and set `DATABASE_URL` in `.env.local`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:3000` and send one chat message.
5. Query the persisted logs:

```bash
curl "http://localhost:3000/api/agent-runs?limit=5"
```

You should see the latest run log row in JSON.

You can also verify directly in PostgreSQL:

```bash
psql postgresql://lanmao:550695@localhost:5432/mydb -c "select run_id, session_id, status, finished_at from agent_run_logs order by finished_at desc limit 5;"
```
