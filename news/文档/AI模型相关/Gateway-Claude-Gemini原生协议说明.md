# Gateway Claude / Gemini 原生协议配置（Phase 4）

DMGateway 对 **GPT** 推荐 OpenAI Responses；**Claude** 走 Anthropic Messages；**Gemini** 走 Google generateContent。本系统在 `provider=gateway` 时按模型名自动选择协议。

---

## Claude（Anthropic Messages）

| 字段 | 值 |
|------|-----|
| 提供商 | `gateway` |
| 令牌分组 | `CC` / `claude-officially` |
| 模型名 | `claude-opus-4.5`、`claude-sonnet-4` 等 |
| API 端点 | `https://gateway.di-matrix.ai/v1` |
| API 协议 | `anthropic_messages` |
| 联网模式 | `anthropic_web_search` |

实际请求：`POST https://gateway.di-matrix.ai/v1/messages`

Headers：`x-api-key`、`anthropic-version: 2023-06-01`

联网 tools：

```json
{
  "type": "web_search_20250305",
  "name": "web_search",
  "max_uses": 5
}
```

降级：联网参数被拒时改为无 tools 的 Messages；融资/竞品 `searchRequired=true` 时会抛错。

---

## Gemini（generateContent）

| 字段 | 值 |
|------|-----|
| 提供商 | `gateway` |
| 令牌分组 | `Gemini` / `gemini-slb` |
| 模型名 | `gemini-2.5-pro` 等 |
| API 端点 | `https://gateway.di-matrix.ai` 或 `/v1` |
| API 协议 | `gemini_generate_content` |
| 联网模式 | `gemini_google_search` |

实际请求：`POST https://gateway.di-matrix.ai/v1beta/models/gemini-2.5-pro:generateContent`

Headers：`x-goog-api-key` 或 `Authorization: Bearer`

联网 tools：

```json
{ "tools": [{ "google_search": {} }] }
```

---

## 与旧配置兼容

若已手工设置 `wire_protocol=responses` + Claude 模型，仍走 OpenAI Responses 路径。新建配置或清空「API 协议」后保存，将按模型名推断为原生协议。

---

## 代码索引

| 模块 | 路径 |
|------|------|
| Claude 适配 | `news/server/utils/llm/adapters/anthropicMessages.js` |
| Gemini 适配 | `news/server/utils/llm/adapters/geminiGenerateContent.js` |
| 端点 | `news/server/utils/llm/gatewayNativeEndpoint.js` |
| Profile 推断 | `news/server/utils/llm/llmProfile.js` |

---

## 相关文档

- [API 网关 Gateway 模型配置说明](./API网关Gateway模型配置说明.md)
