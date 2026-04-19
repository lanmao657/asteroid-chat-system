# Enterprise Knowledge Assistant

一个基于 Next.js 16、React 19 和 TypeScript 的企业培训 / 内部知识助手原型，当前支持：

- 单 SSE 通道流式回答
- 会话摘要记忆压缩
- 内部知识库检索、联网补充检索与天气查询
- 查询重写、相关性评分门控与可选 rerank
- 实时 RAG 过程可视化
- 前端主动停止生成
- Assistant 回答的安全 Markdown 渲染

当前聊天会话、聊天消息和摘要会持久化到 PostgreSQL，刷新页面后可以恢复历史；前端流式状态与运行中草稿仍是请求期 / 页面期状态。

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
| `KNOWLEDGE_BASE_MIN_SCORE` | 知识库最小保留分数 | `0.18` |
| `KNOWLEDGE_BASE_ENABLE_RERANK` | 是否启用可选 rerank | `true` |
| `KNOWLEDGE_BASE_SEARCH_MODE` | 知识检索模式 | `fts` |
| `KNOWLEDGE_BASE_CHUNK_SIZE` | 默认 chunk 字符长度 | `1200` |
| `KNOWLEDGE_BASE_CHUNK_OVERLAP` | 默认 chunk overlap 字符长度 | `200` |
| `KNOWLEDGE_BASE_MAX_FILE_SIZE` | 上传文件大小上限，单位 bytes | `5242880` |
| `KNOWLEDGE_BASE_EMBEDDING_MODEL` | OpenAI-compatible embedding 模型 | `text-embedding-3-small` |
| `KNOWLEDGE_BASE_EMBEDDING_BATCH_SIZE` | 单次 embedding 请求的 chunk 数 | `8` |
| `KNOWLEDGE_BASE_EMBEDDING_TIMEOUT_MS` | embedding 请求超时，单位毫秒 | `30000` |
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
- Protected chat now depends on PostgreSQL for session, message, and summary persistence.
- `agent_run_logs` remains best-effort persistence for per-turn run telemetry.
- Database access lives under `src/lib/db/`:
  - `env.ts`: database env parsing
  - `client.ts`: shared `pg` pool
  - `schema.ts`: lazy `CREATE TABLE IF NOT EXISTS`
  - `agent-run-log-repository.ts`: run log repository
  - `chat-session-repository.ts`: chat session/message repository
- Verification routes are available at:
  - `GET /api/chat/sessions?limit=10`
  - `GET /api/chat/sessions/<sessionId>/messages`
  - `GET /api/agent-runs?sessionId=<id>&limit=10`

### Required env

Add these to `.env.local` when enabling PostgreSQL locally:

```bash
DATABASE_URL=postgresql://lanmao:550695@localhost:5432/mydb
DATABASE_MAX_CONNECTIONS=5
DATABASE_IDLE_TIMEOUT_MS=30000
DATABASE_CONNECTION_TIMEOUT_MS=5000
```

If `DATABASE_URL` is missing, authentication, protected chat, chat history recovery, and run-log persistence are not available.

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
The same `sql/init-postgres.sql` script also upgrades existing local databases with the knowledge embedding columns by using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

### Persisted tables

`chat_sessions`

- `id`: chat session identifier
- `user_id`: owning user id from better-auth
- `title`: current session title
- `summary`: persisted memory summary used by the runtime
- `next_message_sequence`: monotonic sequence counter for message ordering
- `created_at` / `updated_at` / `last_message_at`: lifecycle timestamps

`chat_messages`

- `id`: chat message identifier
- `session_id`: owning chat session id
- `role`: `user` or `assistant`
- `content`: final stored message text
- `metadata`: JSONB metadata such as assistant trace/run id
- `sequence_no`: stable message order within a session
- `created_at`: message timestamp

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
4. Open `http://localhost:3000`, log in, and send one chat message.
5. Query the persisted sessions:

```bash
curl "http://localhost:3000/api/chat/sessions?limit=5"
```

6. Query the messages for one returned session id:

```bash
curl "http://localhost:3000/api/chat/sessions/<sessionId>/messages"
```

7. Query the persisted logs:

```bash
curl "http://localhost:3000/api/agent-runs?limit=5"
```

You should see the latest persisted session, messages, and run log rows in JSON.

You can also verify directly in PostgreSQL:

```bash
psql postgresql://lanmao:550695@localhost:5432/mydb -c "select id, user_id, title, last_message_at from chat_sessions order by coalesce(last_message_at, updated_at) desc limit 5;"
psql postgresql://lanmao:550695@localhost:5432/mydb -c "select session_id, sequence_no, role, created_at from chat_messages order by created_at desc limit 10;"
psql postgresql://lanmao:550695@localhost:5432/mydb -c "select run_id, session_id, status, finished_at from agent_run_logs order by finished_at desc limit 5;"
```

## Knowledge Retrieval

- Internal knowledge retrieval now reads from persisted `knowledge_chunks`, scoped to the current authenticated user.
- The default retrieval path is PostgreSQL text search with lightweight keyword fallback. No vector database is required for this phase.
- Embedding vectors are now persisted on `knowledge_chunks` through the OpenAI-compatible `/embeddings` API, but retrieval still stays on the existing PostgreSQL text path for now.
- Assistant answers may include `citations` metadata in `chat_messages.metadata`, and the existing chat UI renders those citations under assistant messages.
- New retrieval envs:
  - `KNOWLEDGE_BASE_MAX_RESULTS`
  - `KNOWLEDGE_BASE_MIN_SCORE`
  - `KNOWLEDGE_BASE_ENABLE_RERANK`
  - `KNOWLEDGE_BASE_SEARCH_MODE`

## Knowledge Ingestion

- Knowledge ingestion is a separate protected flow. It does not rewrite `/api/chat`, the SSE contract, or the existing chat workspace data flow.
- Uploaded source files are parsed on the server and discarded after ingestion. This phase stores document metadata, extracted text, and chunks in PostgreSQL only.
- After chunk persistence, the server automatically attempts chunk-level embedding generation. Embedding failures do not roll back the document to a non-`chunked` state; they are tracked on each chunk instead.
- Supported upload types are `text/plain`, `text/markdown`, and `application/pdf`.
- Default chunking and upload limits are controlled by:
  - `KNOWLEDGE_BASE_CHUNK_SIZE`
  - `KNOWLEDGE_BASE_CHUNK_OVERLAP`
  - `KNOWLEDGE_BASE_MAX_FILE_SIZE`
- Default embedding behavior is controlled by:
  - `KNOWLEDGE_BASE_EMBEDDING_MODEL`
  - `KNOWLEDGE_BASE_EMBEDDING_BATCH_SIZE`
  - `KNOWLEDGE_BASE_EMBEDDING_TIMEOUT_MS`
- The protected settings page is available at `/settings`, and it now contains both account actions and the knowledge base management UI. The legacy `/knowledge` route redirects there.

### Knowledge APIs

- `POST /api/knowledge/documents`
  - Accepts `multipart/form-data` with a single `file` field.
  - Parses the file, stores the document row, chunks the extracted text, and persists chunks.
- `GET /api/knowledge/documents?limit=50`
  - Lists the current user's documents.
- `GET /api/knowledge/documents/<documentId>`
  - Returns the current user's document detail, including `extractedText`.
- `GET /api/knowledge/documents/<documentId>/chunks`
  - Returns the current user's chunk list for the document.
- `POST /api/knowledge/documents/<documentId>/embeddings`
  - Re-runs embedding for the current user's pending or failed chunks under that document.
- `DELETE /api/knowledge/documents/<documentId>`
  - Deletes the current user's document and cascades chunk deletion through PostgreSQL foreign keys.

### Knowledge Status Model

- `knowledge_documents.status` progresses through `uploaded`, `parsed`, `chunked`, or `failed`.
- Parse or ingest failures persist `error_message` on the document row.
- Final chunk persistence and document finalization run in one PostgreSQL transaction so the document does not end up marked `chunked` without persisted chunks.
- `knowledge_chunks.embedding_status` progresses through `pending`, `ready`, or `failed`.
- Chunk embedding failures persist `embedding_error_message`, and successful writes clear any prior chunk-level embedding error.

### Knowledge Tables

`knowledge_documents`

- `id`: document identifier
- `user_id`: owning user id from better-auth
- `title`: derived document title
- `original_filename`: uploaded filename
- `mime_type`: normalized supported MIME type
- `file_size`: uploaded file size in bytes
- `extracted_text`: parsed plain text used for later retrieval/indexing work
- `status`: `uploaded`, `parsed`, `chunked`, or `failed`
- `error_message`: persisted failure reason when ingestion fails
- `chunk_count`: number of persisted chunks
- `created_at` / `updated_at`: lifecycle timestamps

`knowledge_chunks`

- `id`: chunk identifier
- `document_id`: owning document id
- `user_id`: owning user id for strict data isolation
- `chunk_index`: stable in-document order
- `content`: chunk text
- `char_count`: chunk size in characters
- `embedding_status`: `pending`, `ready`, or `failed`
- `embedding_vector`: persisted embedding vector stored as JSONB for a later vector or hybrid retrieval phase
- `embedding_provider` / `embedding_model` / `embedding_dimensions`: stable embedding metadata for later retrieval work
- `embedding_error_message`: persisted per-chunk failure reason when embedding generation fails
- `metadata`: reserved JSONB payload for future retrieval/indexing extensions
- `created_at`: chunk timestamp

### Knowledge Verification

1. Start PostgreSQL and log in to the app.
2. Open `http://localhost:3000/settings`.
3. Upload a `txt`, `md`, or `pdf` file smaller than the configured `KNOWLEDGE_BASE_MAX_FILE_SIZE` limit. The default is 5 MB.
4. Confirm the document reaches `chunked` (or `failed`) and appears in the settings list with the latest status and timestamp.
5. Optionally call `POST /api/knowledge/documents/<documentId>/embeddings` to re-run embedding for an existing document.
6. Inspect `knowledge_chunks` and confirm `embedding_status` moves to `ready` or `failed`, with `embedding_error_message` filled when needed.
7. Delete the document and confirm it disappears from the list.
