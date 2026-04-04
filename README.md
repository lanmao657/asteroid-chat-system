# 小行星聊天系统

小行星聊天系统是一个基于 Next.js 16、React 19 和 TypeScript 构建的 Agent 聊天应用原型。它提供了一个面向研究与信息整理场景的对话工作台，支持会话管理、流式回复、联网检索、网页抓取，以及在外部服务不可用时的降级回答。

当前项目更偏向 Agent MVP：

- 前端提供聊天工作台界面，包含会话列表、消息时间线、运行状态和工具输出面板
- 后端通过 `/api/chat` 以 SSE 方式返回流式事件
- Agent 运行时会先判断问题是否需要联网，再决定直接回答或调用工具
- 检索链路支持主搜索源和备用搜索源回退
- 页面抓取失败、搜索失败、模型限流时都能继续产出可解释的回答

## 适用场景

- 演示带检索能力的聊天系统
- 验证 Agent 的“决策 -> 搜索 -> 抓取 -> 生成”链路
- 搭建后续接入真实模型、持久化存储和更多工具的基础骨架

## 当前功能

### 1. 对话工作台

- 单页聊天界面，入口在 `src/app/page.tsx`
- 支持新建会话、切换会话、查看消息记录
- 支持展示当前 Provider、工具执行状态和最近工具结果
- 支持 `Cmd/Ctrl + Enter` 快速发送

### 2. Agent 运行时

- 运行时入口位于 `src/lib/agent/runtime.ts`
- 基于 `@langchain/langgraph` 组织状态流转
- 基本流程为：

```text
decide -> search -> fetch-pages -> compose
```

- 当请求不需要联网时，会直接进入回答阶段

### 3. 搜索与网页抓取

- 搜索工具位于 `src/lib/agent/tools.ts`
- 当前支持的搜索源：
  - `search-api`
  - `duckduckgo-html`
  - `bing-rss`
- 支持搜索结果过滤、降权、重试和回退
- 支持对搜索结果抓取正文摘要，用于提升回答依据质量

### 4. Provider 机制

- Provider 位于 `src/lib/agent/provider.ts`
- 当前支持两种模式：
  - `mock`：本地演示模式，不依赖真实模型即可跑通链路
  - OpenAI Compatible：兼容 OpenAI 风格接口的模型服务

### 5. 会话管理

- 会话存储位于 `src/lib/agent/session-store.ts`
- 当前使用内存存储
- 这意味着服务重启后，会话内容不会保留

## 项目结构

```text
src/
  app/
    api/chat/route.ts        # 聊天 API，返回 SSE 流
    layout.tsx               # 应用布局
    page.tsx                 # 首页，挂载聊天工作台
  components/
    chat-workspace.tsx       # 聊天工作台组件
    chat-workspace.module.css
  lib/agent/
    env.ts                   # 环境变量读取与默认值
    provider.ts              # Provider 与回答策略
    runtime.ts               # Agent 状态图运行时
    session-store.ts         # 内存会话存储
    tools.ts                 # 搜索与网页抓取工具
    *.test.ts                # 运行时、Provider、工具测试
```

## 环境要求

- Node.js 20 及以上
- npm 10 及以上

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

先复制示例文件：

```bash
copy .env.example .env.local
```

然后根据需要填写配置。

如果你只是想先本地跑通界面和链路，可以保留：

```env
MODEL_PROVIDER=mock
```

如果你要接入真实模型，至少需要配置：

```env
MODEL_PROVIDER=openai
OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1
OPENAI_COMPAT_API_KEY=your_api_key
OPENAI_MODEL=gpt-4.1-mini
```

如果你要启用主搜索 API，还需要配置：

```env
SEARCH_API_KEY=your_search_api_key
```

### 3. 启动开发环境

```bash
npm run dev
```

浏览器打开：

```text
http://localhost:3000
```

## 环境变量说明

| 变量名 | 说明 | 默认值 |
| --- | --- | --- |
| `MODEL_PROVIDER` | 模型提供方，`mock` 表示本地演示模式 | `mock` |
| `OPENAI_COMPAT_BASE_URL` | OpenAI 兼容接口地址 | `https://api.openai.com/v1` |
| `OPENAI_COMPAT_API_KEY` | OpenAI 兼容接口密钥 | 空 |
| `OPENAI_MODEL` | 使用的模型名称 | `gpt-4.1-mini` |
| `SEARCH_API_BASE_URL` | 主搜索服务地址 | `https://google.serper.dev/search` |
| `SEARCH_API_KEY` | 主搜索服务密钥 | 空 |
| `SEARCH_MAX_RESULTS` | 保留的搜索结果数量 | `5` |
| `SEARCH_PROVIDERS` | 搜索源优先级 | `search-api,duckduckgo-html,bing-rss` |
| `SEARCH_BLOCKED_DOMAINS` | 明确屏蔽的站点列表 | 空 |
| `SEARCH_DEMOTED_DOMAINS` | 需要降权的站点列表 | `zhihu.com,baidu.com,tieba.baidu.com` |
| `SEARCH_NEWS_KEYWORDS` | 识别新闻/时效性问题的关键词 | 内置默认值 |
| `FETCH_MAX_PAGES` | 最多抓取的页面数量 | `3` |
| `WEB_FETCH_TIMEOUT_MS` | 搜索与抓取超时时间 | `12000` |

## 开发命令

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run test
npm run test:watch
npm run typecheck
```

## 测试覆盖

当前仓库已经包含基础测试，主要覆盖：

- Agent 运行时在直答、联网搜索、搜索失败、跳过抓取等情况下的行为
- 搜索工具的回退策略、排序和过滤逻辑
- Provider 在搜索失败、仅摘要回答、模型限流时的降级策略

测试文件位于：

- `src/lib/agent/runtime.test.ts`
- `src/lib/agent/tools.test.ts`
- `src/lib/agent/provider.test.ts`
- `src/lib/agent/session-store.test.ts`

## 当前限制

- 会话数据目前仅保存在内存中，服务重启后会丢失
- 当前只有搜索和网页抓取两类工具
- 真实模型模式依赖 OpenAI 兼容接口，未内置更多 Provider
- 搜索质量会受到外部搜索源可用性和网页可抓取性的影响
- 项目仍处于原型阶段，适合演示与迭代，不适合直接作为生产版本上线

## 后续可扩展方向

- 接入数据库，实现会话持久化
- 增加用户系统和多端同步
- 增加更多工具，如网页总结、文档解析、结构化抽取
- 引入更完善的来源引用和结果可信度展示
- 支持多模型路由与更细粒度的 Agent 策略控制

## 许可证

当前仓库未声明开源许可证。如需开源或商用，请补充对应 License 文件。
