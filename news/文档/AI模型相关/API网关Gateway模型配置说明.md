# API 网关（Gateway / DMGateway）模型配置说明

本文说明本系统如何接入 **DMGateway** 等中转 API，用于 GPT、Claude、Gemini 等境外模型的 **联网分析**；并与阿里云千问、火山豆包等国内模型并存。

官方网关文档：[DMGateway 使用说明](https://docgateway.di-matrix.ai/#overview)

---

## 1. 适用场景

| 业务 | 是否必须联网 | 推荐模型来源 | 说明 |
|------|-------------|-------------|------|
| 融资事件 — 企业描述 / 产品描述 AI 提取 | **是** | Gateway（gpt-5.5、claude-opus、gemini 等） | 联网失败则任务失败，不静默降级 |
| 竞品分析 — S4 联网检索 | **是** | 同上 | 同上 |
| 被投企业 AI 补齐 | 否（允许降级） | 阿里 / 火山 / Gateway 均可 | 联网失败可记为「未开联网」仍可能成功 |
| 新闻情绪分析 | 否 | 阿里千问（生产现状） | 一般不配 Gateway |
| BP 解析 | 否 | 阿里等 | 不启用联网 |

生产环境当前主力仍为 **阿里云千问**、**火山豆包**；Gateway 用于需要 **GPT / Claude / Gemini + 联网** 的项目挖掘与竞品场景。

---

## 2. 系统架构（调用链）

```
业务（融资补齐 / 竞品分析 / 被投补齐 …）
        ↓
  llmInvoke（news/server/utils/llm/llmInvoke.js）
        ↓
  resolveLlmProfile（读 ai_model_config + 端点启发式）
        ↓
┌──────────────────┬─────────────────────┬────────────────────┐
│ dashscope_search │ openai_responses    │ plain_chat         │
│ 阿里 enable_search│ /v1/responses       │ /chat/completions  │
└──────────────────┴─────────────────────┴────────────────────┘
        ↓ 融资/竞品若 searchRequired 且降级 → 抛错
```

### 2.1 配置表字段（`ai_model_config`）

| 字段 | 含义 | Gateway 典型值 |
|------|------|----------------|
| `provider` | 提供商字典 | **`gateway`**（API 网关） |
| `model_name` | 模型广场名称 | `gpt-5.5`、`claude-opus-4.5`、`gemini-2.5-pro` |
| `api_endpoint` | 根地址 | `https://gateway.di-matrix.ai/v1` |
| `api_type` | 兼容类型 | `chat_completion` |
| `wire_protocol` | HTTP 协议 | `responses`（或留空自动推断） |
| `web_search_mode` | 联网方式 | `openai_web_search_tool` |
| `reasoning_effort` | Responses 推理力度 | `medium` / `high`（可选） |
| `enable_thinking` | 阿里深度思考 | Gateway 一般留空 |

日志字段 `invoke_mode`（`chat_with_search` 等）表示 **业务结果**，与 `wire_protocol` 不同。

### 2.2 Gateway 与阿里/字节的区别

| 维度 | 阿里云千问 | API Gateway | 火山豆包 |
|------|-----------|-------------|----------|
| 提供商 | `alibaba` | `gateway` | `volcengine` |
| 联网参数 | `enable_search` | `tools: [{type:"web_search"}]` on Responses | 火山专有 API（未走 Gateway） |
| 端点 | `…/compatible-mode/v1/chat/completions` | `…/v1` → 自动拼 `/responses` | 火山控制台地址 |
| 大批量异步 | 百炼 **Batch File** | **Responses background + 轮询** + 并发队列 | 按火山能力配置 |

---

## 3. DMGateway 控制台配置要点

### 3.1 基础地址

- 主入口：`https://gateway.di-matrix.ai`
- OpenAI 兼容客户端在末尾加 `/v1`
- 本系统 **API 端点** 填：`https://gateway.di-matrix.ai/v1`（不要填 `/responses`，由系统自动拼接）

### 3.2 令牌分组与模型（须一致）

| 模型系列 | 建议令牌分组 | 示例模型名 |
|----------|-------------|-----------|
| GPT / Codex | `codex` | `gpt-5.5`、`gpt-4o-mini` |
| Claude | `CC`、`claude-officially` | `claude-opus-4.5`、`claude-sonnet-4` |
| Gemini | `Gemini`、`gemini-slb` | `gemini-2.5-pro` |

模型名须与 **模型广场** 中复制的一致（区分大小写、后缀）。

### 3.3 Codex 文档中的联网方式

DMGateway 文档中 Codex CLI 使用：

- `wire_api = "responses"`
- `web_search_request = true`
- `POST https://gateway.di-matrix.ai/v1/responses`

本系统与之对齐：`wire_protocol=responses` + `web_search_mode=openai_web_search_tool`。

### 3.4 Claude / Gemini 原生协议（Phase 4，自动推断）

| 模型名特征 | API 协议 | 联网模式 | 实际 URL |
|-----------|----------|----------|----------|
| `gpt-*` / `o*` | `responses` | `openai_web_search_tool` | `…/v1/responses` |
| `claude*` | `anthropic_messages` | `anthropic_web_search` | `…/v1/messages` |
| `gemini*` | `gemini_generate_content` | `gemini_google_search` | `…/v1beta/models/{model}:generateContent` |

详见 [Gateway Claude / Gemini 原生协议说明](./Gateway-Claude-Gemini原生协议说明.md)。

---

## 4. 管理端配置步骤

路径：**系统设置 → AI 模型配置 → 新增/编辑**

### 4.1 项目挖掘 — 竞品分析（示例）

| 项 | 值 |
|----|-----|
| 配置名称 | 项目挖掘-竞品 |
| 提供商 | AI模型（API网关） |
| 模型名称 | `gpt-5.5` |
| API 类型 | Chat Completion API |
| API 端点 | `https://gateway.di-matrix.ai/v1` |
| API 协议 | Responses API |
| 联网模式 | OpenAI web_search 工具 |
| Reasoning Effort | medium（可选） |
| 应用类型 | 竞品分析应用 |
| 使用类型 | 竞品匹配 |
| API Key | 对应分组令牌（如 codex） |

### 4.2 融资联网 AI 增强

同上模型配置，在 **模型提示词** 中绑定 `project_sourcing_financing_web_enrich`，或设置 `application_type=项目挖掘分析` 的默认模型。

### 4.3 阿里云配置注意

- 端点为 `compatible-mode` 时，**API 类型** 应选 **Chat Completion API**，不要选「Chat API（原生）」。
- 原生 Chat API 仅用于 `…/text-generation/generation` 类地址。

### 4.4 测试

保存后点击 **测试**。成功日志示例：

```
[测试AI模型] provider=gateway wire=responses …
Responses POST https://gateway.di-matrix.ai/v1/responses …
```

阿里成功示例：

```
wire=chat_completions
POST …/compatible-mode/v1/chat/completions
```

---

## 5. Phase 2：异步与防堵塞（已实现）

Gateway 联网请求耗时长（检索 + 推理），系统采用 **提交 + 后台轮询**，避免 HTTP 长时间阻塞单连接。

### 5.1 单次调用（融资/竞品/被投）

1. `provider=gateway` 且走 Responses 时，默认 `background: true` 提交任务。
2. 轮询 `GET …/v1/responses/{id}` 直至 `completed`。
3. 网关并发由独立池限制（默认 2），与阿里 `FINANCING_AI_CONCURRENCY` 分开。

### 5.2 融资日期范围大批量

| 条件 | 行为 |
|------|------|
| 去重后条数 ≤ 100（默认阈值） | 并发队列 + 波次间隔 |
| 去重后条数 > 100 且模型为 **阿里** | 百炼 Batch File 异步 |
| 去重后条数 > 100 且模型为 **Gateway** | **不走**百炼 Batch，改走并发队列 + Responses 后台轮询 |

### 5.3 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LLM_GATEWAY_ASYNC_RESPONSES` | `1` | Gateway Responses 是否 `background` + 轮询 |
| `LLM_RESPONSES_POLL_INTERVAL_MS` | `3000` | 轮询间隔 |
| `LLM_RESPONSES_POLL_MAX_MS` | `600000` | 轮询最长等待（10 分钟） |
| `LLM_GATEWAY_CONCURRENCY` | `2` | 同时进行中的 Gateway 请求数 |
| `FINANCING_AI_CONCURRENCY` | `4` | 阿里等融资并发（与 Gateway 池独立） |
| `FINANCING_AI_BATCH_FILE_THRESHOLD` | `100` | 超过该去重条数才尝试百炼 Batch（仅阿里） |
| `FINANCING_AI_BATCH_GAP_MS` | `500` | 并发波次间隔 |

关闭 Gateway 后台模式（仅同步等待，不推荐生产）：

```env
LLM_GATEWAY_ASYNC_RESPONSES=0
```

---

## 6. 代码位置索引

| 模块 | 路径 |
|------|------|
| 统一入口 | `news/server/utils/llm/llmInvoke.js` |
| Profile 推断 | `news/server/utils/llm/llmProfile.js` |
| 端点规范化 | `news/server/utils/llm/llmEndpoint.js` |
| Responses 适配 | `news/server/utils/llm/adapters/openaiResponses.js` |
| Claude Messages | `news/server/utils/llm/adapters/anthropicMessages.js` |
| Gemini generateContent | `news/server/utils/llm/adapters/geminiGenerateContent.js` |
| 原生端点规范化 | `news/server/utils/llm/gatewayNativeEndpoint.js` |
| 火山适配 | `news/server/utils/llm/adapters/volcengineSearch.js` |
| Gateway 并发池 | `news/server/utils/llm/gatewayConcurrency.js` |
| 异步开关 | `news/server/utils/llm/gatewayAsync.js` |
| 配置测试 | `news/server/utils/testLlmConfig.js` |
| 融资补齐 | `news/server/utils/project-sourcing/financingAiEnrichService.js` |
| 竞品 AI | `news/server/utils/competitor-analysis/competitorAnalysisAi.js` |
| 前端配置 | `news/client/src/pages/AIConfig.jsx` |
| 数据字典 | `ai_model_gateway` 及子项模型名 |

---

## 7. 常见问题

### 7.1 `input is required`

端点配成 `/v1/responses` 但请求体用了 `messages`。应设 **API 协议 = Responses**，或端点填 `/v1` 由系统拼接。

### 7.2 阿里测试 404

端点为 `compatible-mode/v1` 但 API 类型为「Chat API（原生）」。改为 **Chat Completion API**。

### 7.3 模型不存在 / 403

检查令牌 **分组** 与 **模型名** 是否匹配；在网关控制台「模型广场」复制准确名称。

### 7.4 竞品/融资报「必须联网」

Gateway 未真正带上 `web_search`，或令牌无联网权限。查日志 `web_search=1`、`Responses POST` 是否成功。

### 7.5 与纯 OpenAI 官方的区别

`provider=gateway` 表示走 **中转**；若直连 OpenAI 官方，也可用 `openai` + 官方 Key，但联网仍建议 `responses` + `openai_web_search_tool`。

---

## 8. 后续规划（Phase 5+）

- 可选：配置表增加 `async_mode` 字段，替代部分环境变量

Claude Messages / Gemini generateContent 原生适配已完成（Phase 4）。

---

## 9. 相关文档

- [Gateway Claude / Gemini 原生协议说明](./Gateway-Claude-Gemini原生协议说明.md)
- [火山引擎豆包 Volcengine 模型配置说明](./火山引擎豆包Volcengine模型配置说明.md)

- [AI模型配置说明](./AI模型配置说明.md)
- [AI配置测试功能说明](./AI配置测试功能说明.md)
- [AI配置测试故障排除指南](./AI配置测试故障排除指南.md)
- [使用OpenAI兼容格式避免配额限制说明](../需求说明/使用OpenAI兼容格式避免配额限制说明.md)
