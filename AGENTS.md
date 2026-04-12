<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

## 1. 文档定位

- 本文档面向自动化 Agent 和协作者，定义当前仓库的事实约束、默认工作流与提交前检查。
- 先对齐目录职责与运行前提，再改代码，再做验证。
- 这是仓库规则，不是产品说明书；一次性调试步骤、局部实现细节、临时 workaround 不应写入这里。

权威来源：

- Next.js 框架行为、运行时、路由约定以 `node_modules/next/dist/docs/` 为准。
- 项目命令与依赖以 `package.json` 为准。
- 环境变量模板与默认值以 `.env.example` 为准。
- 认证前提与鉴权边界以 `src/lib/auth.ts`、`src/lib/auth/session.ts`、`src/app/api/auth/[...all]/route.ts` 为准。
- 数据库前提与持久化行为以 `src/lib/db/*` 为准。
- 聊天流式接口以 `src/app/api/chat/route.ts` 为准。
- 聊天历史接口以 `src/app/api/chat/sessions/route.ts`、`src/app/api/chat/sessions/[sessionId]/messages/route.ts` 为准。
- run log 查询接口以 `src/app/api/agent-runs/route.ts` 为准。

## 2. 项目事实

- 技术栈：`Next.js 16.2.2 + React 19 + TypeScript + App Router`。
- 主要能力：`better-auth` 认证、SSE 聊天流、agent runtime、web search、PostgreSQL 聊天持久化与 run logs、Vitest 测试。
- UI 基础：Tailwind 4、`shadcn` 配置、`lucide-react`、`next/font`。
- 路径别名：统一使用 `@/* -> src/*`。

顶层职责：

- `src/app/`：App Router 路由、layout、页面与 API routes。
- `src/components/`：界面组件、聊天 UI、认证 UI、前端交互测试。
- `src/lib/agent/`：agent runtime、provider、tools、trace、session store。
- `src/lib/auth/` 与 `src/lib/auth.ts`：认证集成、session helper、schema 初始化。
- `src/lib/db/`：数据库 env、连接池、Kysely、schema、repository。
- `src/tools/`：可复用外部能力封装，当前包含 web search。

关键路径：

- 聊天 API：`src/app/api/chat/route.ts`
- 聊天历史 API：`src/app/api/chat/sessions/route.ts`、`src/app/api/chat/sessions/[sessionId]/messages/route.ts`
- run log API：`src/app/api/agent-runs/route.ts`
- Auth API：`src/app/api/auth/[...all]/route.ts`
- 受保护首页：`src/app/(app)/page.tsx`
- 公共页面：`src/app/(public)/login/page.tsx`、`src/app/(public)/register/page.tsx`

运行语义：

- `/api/chat` 是 `runtime = "nodejs"` 的 `SSE` 流式接口，返回协议基于 `ReadableStream`。
- `/api/chat` 当前先做 `requireApiSession()` 鉴权，再检查数据库配置；会话、消息、摘要写入 PostgreSQL 后再执行 agent turn，并在结束后继续尝试持久化 run log。
- `/api/chat/sessions` 与 `/api/chat/sessions/[sessionId]/messages` 是鉴权后的历史查询接口，只返回当前登录用户自己的会话与消息。
- `/api/agent-runs` 是鉴权后的服务端查询接口；缺少 `DATABASE_URL` 时会返回数据库未配置错误，不是匿名可访问接口。
- 认证依赖 `better-auth + Kysely + PostgreSQL`；不要假设“没有数据库也能正常登录”。
- 受保护聊天与历史恢复同样依赖 PostgreSQL；不要假设“没有数据库也能正常聊天，只是历史不保存”。
- 路由边界固定为：`src/app/(app)` 是受保护区域，`src/app/(public)` 是登录/注册公共区域。
- `src/lib/auth*`、`src/lib/db*`、其他带 `server-only` 的模块默认只允许在服务端边界内使用。

## 3. 标准工作流

### 3.1 依赖与配置

- 安装依赖：`npm install`
- 初始化本地 env：`copy .env.example .env.local`
- 本地默认要检查的关键 env：
  - `BETTER_AUTH_URL`
  - `BETTER_AUTH_SECRET`
  - `DATABASE_URL`
  - `OPENAI_COMPAT_API_KEY`
  - `OPENAI_MODEL`
  - `MODEL_PROVIDER`
- 涉及联网搜索能力时，再核对：
  - `TAVILY_API_KEY`
  - `SEARCH_API_KEY`
  - `SEARCH_PROVIDERS`
- 只改环境变量名、默认值或是否必填的行为时，必须同步检查 `.env.example`、`README.md`、`AGENTS.md`。

### 3.2 启动

- 开发模式入口：`npm run dev`
- 生产构建入口：`npm run build`
- 生产启动入口：`npm run start`
- 当前项目的认证链路依赖数据库；本地开发若要完整验证登录、受保护页面、chat API 与 auth API，必须保证 `DATABASE_URL` 可用。
- 聊天会话、消息、摘要与 run log 持久化都依赖数据库；如果只验证前端静态 UI，可不走数据库链路，但这不代表认证或受保护聊天可降级工作。

### 3.3 校验与测试

- 代码风格与静态检查：`npm run lint`
- 单元测试：`npm run test`
- 类型检查：`npm run typecheck`
- 结构性改动、依赖升级、Next.js 行为调整后，补跑：`npm run build`
- 除非用户明确要求只做文档或纯分析，任何行为改动至少运行一次相关检查；未执行时必须说明原因和风险。

### 3.4 针对性验证

- 认证与 session 改动优先检查：
  - `src/lib/auth.test.ts`
  - `src/lib/auth/session.test.ts`
- agent runtime、tool orchestration、provider 改动优先检查：
  - `src/lib/agent/runtime.test.ts`
  - `src/lib/agent/provider.test.ts`
  - `src/lib/agent/tools.test.ts`
  - `src/lib/agent/session-store.test.ts`
  - `src/lib/agent/trace-presentation.test.ts`
- 聊天流式展示与消息合并改动优先检查：
  - `src/components/chat-stream.test.ts`
  - `src/components/chat/message-list.test.tsx`
  - `src/components/chat/thinking-block.test.tsx`
  - `src/components/chat-message-content.test.tsx`
- 数据库与 run log 改动优先检查：
  - `src/lib/db/agent-run-log-repository.test.ts`
  - `src/lib/db/chat-session-repository.test.ts`
- 聊天历史接口与会话状态改动优先检查：
  - `src/app/api/chat/route.test.ts`
  - `src/app/api/chat/sessions/route.test.ts`
  - `src/app/api/chat/sessions/[sessionId]/messages/route.test.ts`
  - `src/lib/chat/sessions.test.ts`
- web search 改动优先检查：
  - `src/tools/webSearch.test.ts`

## 4. 改动规则

- 优先最小改动，只改与当前任务直接相关的文件。
- 涉及 Next.js 框架行为、路由约定、导航、缓存、渲染模式、runtime 时，先查 `node_modules/next/dist/docs/`，再改代码。
- 默认按 App Router 思维实现，不套用旧版 Next.js 或 Pages Router 习惯。
- 不把服务端基础设施拉进客户端边界；新增服务端专用模块时，继续显式保持 `server-only` 边界。
- 涉及认证、数据库、agent runtime、外部请求时，优先复用现有 helper、repository、env parsing、session helper，不平行重写第二套入口。
- 前端继续沿用现有 `shadcn`、Tailwind 变量、字体和组件风格，不另起设计系统。
- `/api/chat` 的 SSE 事件流、`runtime = "nodejs"` 前提、鉴权时机、run log 持久化时机如果变化，必须同步更新 `AGENTS.md`。
- `/api/chat` 的数据库前提、会话/消息/摘要持久化时机如果变化，必须同步更新 `AGENTS.md`。
- `/api/chat/sessions` 与 `/api/chat/sessions/[sessionId]/messages` 的鉴权要求、返回语义或数据库依赖如果变化，必须同步更新 `AGENTS.md`。
- `/api/agent-runs` 的鉴权要求、查询参数、返回语义或数据库依赖如果变化，必须同步更新 `AGENTS.md`。
- `(app)` 与 `(public)` 的访问边界、登录重定向规则、关键 env 前提如果变化，必须同步检查并更新：
  - `AGENTS.md`
  - `README.md`
  - `.env.example`
- 页面文案、一次性 bug 修复、局部样式微调、临时调试步骤不要写进 `AGENTS.md`。

## 5. 提交前检查

- 命令与 `package.json` 保持一致，没有引用不存在的脚本。
- `BETTER_AUTH_URL`、`BETTER_AUTH_SECRET`、`DATABASE_URL` 的前提与当前代码一致。
- `/api/chat` 的 SSE 契约、`runtime = "nodejs"`、鉴权边界没有被意外破坏。
- `/api/chat` 仍然在数据库不可用时明确返回错误，不会静默降级到仅内存聊天。
- `/api/chat/sessions` 与 `/api/chat/sessions/[sessionId]/messages` 仍然保持鉴权保护，且只返回当前用户自己的数据。
- `/api/agent-runs` 仍然保持鉴权保护，且数据库未配置时的行为与文档描述一致。
- 相关测试已运行；如果没有运行，必须在最终说明中写清原因和风险。
- 文档变更没有机械复制 `README.md`，而是只保留长期有效的规则与工作流。
- 中文内容保存为正常 UTF-8，可读，不接受继续留存乱码版本。

## 6. 默认策略

- 不确定时，优先兼容现有 API、现有路由分组、现有 env 名称与现有测试习惯。
- 结构性改动先明确影响范围，再实施变更。
- 发现仓库已有清晰实现路径时，优先沿用，而不是抽象出新的并行体系。
- 新增长期有效的环境变量、接口约束、鉴权边界、跨模块规则、测试门槛时，同步更新 `AGENTS.md`。
- 普通局部修补不补文档；只有会影响后续多次开发决策的规则才写入这里。
