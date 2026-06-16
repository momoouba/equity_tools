# 火山引擎豆包（Volcengine）模型配置说明

生产环境常用 **火山方舟 + 豆包**，不走 DMGateway。本说明对应 **Phase 3**：`provider=volcengine` 专有适配（Responses / Bot / Chat 降级），与 [API 网关 Gateway 说明](./API网关Gateway模型配置说明.md) 并列。

---

## 1. 与 Gateway / 阿里的区别

| 项 | 火山豆包 `volcengine` | Gateway `gateway` | 阿里 `alibaba` |
|----|----------------------|-------------------|----------------|
| 联网方式 | `tools: [{type:"web_search"}]`（Responses 或 Chat） | 同上（OpenAI Responses） | `enable_search: true` |
| 无 `enable_search` | 是 | — | 使用 enable_search |
| Bot 应用 | `bot-xxx` + `bots/chat/completions` | 无 | 无 |
| 默认端点 | `https://ark.cn-beijing.volces.com/api/v3` | `https://gateway.di-matrix.ai/v1` | DashScope compatible-mode |

---

## 2. 推荐配置（控制台推理接入点）

### 2.1 标准豆包模型（ep-xxx 或 doubao-xxx）

| 字段 | 推荐值 |
|------|--------|
| 提供商 | `volcengine`（数据字典 `ai_model_volcengine`） |
| API 端点 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` 或仅填 `https://ark.cn-beijing.volces.com/api/v3` |
| API 类型 | Chat Completion API |
| API 协议 | `responses`（自动推断亦可） |
| 联网模式 | `volcengine_web_search_tool` |
| 模型名 | 控制台「推理接入点」ID，如 `ep-xxxxxxxx` 或 `doubao-pro-32k` |

联网时请求走 **`POST …/api/v3/responses`**，body 含 `tools: [{ "type": "web_search" }]`。

### 2.2 Bot 应用（控制台已配联网插件）

| 字段 | 推荐值 |
|------|--------|
| 模型名 | `bot-xxxxxxxx`（必须以 `bot-` 开头） |
| API 协议 | `volcengine_bot` |
| 联网模式 | `volcengine_bot` |
| 实际 URL | `…/api/v3/bots/chat/completions` |

联网能力在 **火山控制台 Bot 应用** 内配置，请求体为常规 Chat Completions。

---

## 3. 业务场景与联网策略

| 场景 | searchRequired | 说明 |
|------|----------------|------|
| 融资企业/产品描述补齐 | `true` | 必须联网；降级会报错 |
| 竞品分析 | `true` | 同上 |
| 被投企业补齐 | `false` | 允许无联网降级 |
| BP 解析 | `wantSearch: false` | 不请求联网 |

大批量融资任务：**不使用** 百炼 Batch File（与 Gateway 相同），走并发池 + Responses。

---

## 4. 调用链与降级顺序

`llmInvoke` → `invokeVolcengineSearch`：

1. **Bot 模型**（`bot-`）→ `bots/chat/completions`
2. **不需联网** → 普通 `chat/completions`
3. **需联网** → `responses` + `web_search`
4. 若 Responses 被拒（400）→ `chat/completions` + `tools: web_search`
5. 仍被拒 → 无联网 Chat（`search_degraded=true`）；若 `searchRequired` 则抛错

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `LLM_VOLCENGINE_CONCURRENCY` | `3` | 火山并发上限（1–16） |

Gateway 异步相关变量对火山 **不适用**（火山走同步 Responses，无 `background` 轮询）。

---

## 6. 配置测试

AI 配置页「测试」或接口测试会按 Profile 选择：

- Bot → `bots/chat/completions`
- 其它火山 → Volcengine Responses（`input` 为 `input_text` 块格式）
- 失败时与线上一致降级

---

## 7. 代码索引

| 模块 | 路径 |
|------|------|
| 火山适配 | `news/server/utils/llm/adapters/volcengineSearch.js` |
| 端点规范化 | `news/server/utils/llm/volcengineEndpoint.js` |
| 并发池 | `news/server/utils/llm/volcengineConcurrency.js` |
| Profile | `news/server/utils/llm/llmProfile.js`（`is_volcengine`） |
| 统一入口 | `news/server/utils/llm/llmInvoke.js` |
| 数据字典种子 | `db.js` → `ai_model_volcengine` |

---

## 8. 常见问题

### 8.1 联网无效

确认 **联网模式** 为 `volcengine_web_search_tool` 或 Bot 模式；模型/接入点是否在控制台开通「联网内容插件」。

### 8.2 端点 404

勿把 Responses URL 配成 Chat 路径。可只填 `https://ark.cn-beijing.volces.com/api/v3`，由系统自动拼 `/responses` 或 `/chat/completions`。

### 8.3 与 Gateway 混用

同一配置请固定 `provider=volcengine`；GPT/Claude/Gemini 走 `provider=gateway`，不要混用 `openai`。

---

## 9. 相关文档

- [API 网关 Gateway 模型配置说明](./API网关Gateway模型配置说明.md)
- [AI 模型配置说明](./AI模型配置说明.md)
