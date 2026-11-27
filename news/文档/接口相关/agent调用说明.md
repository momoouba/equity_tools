# agent 调用说明

任何能发 HTTPS 请求的 agent 都可以调用。系统不检查调用方是不是某一个产品。接口只读：返回系统里已经算好的可比公司和盈利预测。不能创建项目、不能改数、不能触发重算。

立项会报告不在本系统。agent 自己决定报告里用立项会的可比公司，还是用本接口返回的系统结果。这个选择不要提交回来。

不要调用 `/api/valuation`、`/api/competitor-analysis`、`/api/h5/*`。不要传 `x-user-id` 或 `x-publish-token`。

## 你需要事先拿到的信息

管理员在 **系统配置 → agent调用** 里创建凭证后，会给你三样东西：

| 名称 | 说明 |
| --- | --- |
| 系统地址 | 这套系统对外的 HTTPS 根地址，不含路径 |
| `client_id` | 调用方 ID |
| `client_secret` | 密钥。只在创建或重置时出现一次 |

如果凭证上填了来源 IP 白名单，请求必须从这些地址发出，否则返回 403。

基础路径：

```text
{系统地址}/api/integrations/agent/v1
```

任何能发 HTTPS 的 agent 都使用这一路径。

## 1. 换票

`POST /token`

请求头：`Content-Type: application/json`

请求体只允许这两个字段：

```json
{
  "client_id": "管理员给你的调用方 ID",
  "client_secret": "管理员给你的密钥"
}
```

成功时 HTTP 200：

```json
{
  "success": true,
  "data": {
    "access_token": "后续请求使用的令牌",
    "token_type": "Bearer",
    "expires_in": 3600,
    "scopes": ["competitor:read", "valuation:read"]
  }
}
```

`expires_in` 是秒。令牌大约 1 小时后失效，失效后用同一对 `client_id` 和 `client_secret` 再换一次。不要把密钥放进查询参数，也不要长期缓存超过有效期的令牌。

凭证错误返回 401，正文不说明是 ID 错还是密钥错。密钥被管理员关闭后，换票和已发出的令牌都会立即失效。

## 2. 之后的每个请求

```http
Authorization: Bearer {access_token}
```

可选请求头 `X-Request-Id`：只使用字母、数字、下划线和连字符，最长 64。服务端会在响应头 `X-Request-Id` 里原样返回；不传则由服务端生成。排错时把这个值告诉管理员。

查询参数和请求体字段必须落在下面列出的白名单里。多出来的参数返回 400，接口不会忽略。

成功响应都是：

```json
{ "success": true, "data": {} }
```

失败响应都是：

```json
{ "success": false, "message": "原因" }
```

## 3. 先查有哪些项目

`GET /subjects?stage=pre&page=1&pageSize=20`

或 `stage=post`。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `stage` | 是 | `pre` 投前项目，`post` 竞品分析里的被投企业 |
| `keyword` | 否 | 按名称、简称、编号或统一社会信用代码筛选 |
| `page` | 否 | 从 1 开始，默认 1 |
| `pageSize` | 否 | 默认 20，最大 50 |

`data.list` 里每一条：

| 字段 | 用途 |
| --- | --- |
| `id` | 主体 id。查可比公司时用 |
| `stage` | `pre` 或 `post` |
| `name` | 企业全称 |
| `project_abbreviation` | 简称，可能为空 |
| `unified_credit_code` | 统一社会信用代码，可能为空 |
| `competitor_run_id` | 最近一次成功的竞品分析。没有则为 null |
| `valuation_case_id` | 估值案件 id。查盈利预测时用。没有案件则为 null |
| `latest_version_id` | 最新已保存估值版本。没有存档则为 null |
| `latest_version_no` | 最新已保存版本号 |

没有成功的竞品分析，或估值还没保存过版本，对应字段是 null。先看这两个字段再决定要不要往下查。

## 4. 读取系统跑出的可比公司

```http
GET /competitor/subjects/{stage}/{id}/comparables
```

`stage` 和 `id` 用上一步列表里的值。这个地址不能带查询参数。

`data.source` 固定为 `system_run`，表示这是系统竞品分析跑出来的结果，不是立项会报告。

`data.list` 里每一家：

| 字段 | 说明 |
| --- | --- |
| `name` | 公司名称 |
| `unified_credit_code` | 统一社会信用代码 |
| `stock_code` | 股票代码。解析不到则为 null |
| `listing_market` | 上市市场，如 `sse`、`szse`、`bse`、`neeq` |
| `relevance_score` | 相关度 |
| `selectable` | true 表示能解析成可进入境内上市可比池的代码 |
| `disabled_reason` | 不能进池的原因。没有代码或属于港美股时仍会返回该公司，`selectable` 为 false |

`selectable` 不是「估值案件里已经勾选的公司」。没有成功跑批时 `list` 为空，原因看 `data.message`。

`data.run_subject_id` 如果和请求的 `id` 不同，说明按信用代码对到了另一条更新的成功跑批，列表属于那条主体。

写报告时，在立项会可比公司和这份 `system_run` 列表之间选一套。不要把选择结果回写到本接口。

## 5. 读取盈利预测

有 `valuation_case_id` 时：

```http
GET /valuation/cases/{valuation_case_id}/forecast
```

要看历史存档而不是最新一版时，加上已保存的版本 id：

```http
GET /valuation/cases/{valuation_case_id}/forecast?version_id={latest_version_id}
```

只允许查询参数 `version_id`。不要传 `0` 或 `draft`，草稿会返回 400。不传 `version_id` 就是最新已保存版本。

案件存在但从未保存版本时，HTTP 200，`data.lines` 为空，`data.message` 为「尚未保存估值版本」。

`data.lines` 按预测年排列。金额字段的单位是元（`money_unit` 为 `yuan`）：

`fiscal_year`、`revenue`、`cogs`、`gross_profit`、`selling`、`admin`、`rd`、`operating_profit`、`net_income`

`revenue_growth` 是比例，不是百分比，也不是金额。例如 `0.2` 表示增长 20%（`revenue_growth_unit` 为 `ratio`）。

`data.conclusion` 是给报告引用的短结论，单位是亿元（`unit` 为 `yi`）。包含市场法 PS、市场法 PE，以及 DCF 区间。没有三表明细、敏感性格子或分年现金流。

`data.notice` 说明：这份盈利预测对应该版本测算时使用的可比公司，可能和当前竞品分析名单、也可能和立项会名单不是同一套。引用时不要把另一套公司的名字安到这份预测上。

## 建议的调用顺序

1. 换票，保存 `access_token` 和过期时间。
2. `GET /subjects?stage=pre` 或 `stage=post`，按企业名称或信用代码找到项目。
3. 有 `competitor_run_id` 时，读取 `/comparables`。
4. 有 `valuation_case_id` 时，读取 `/forecast`。
5. 报告里的可比公司，由你在立项会名单和 `source=system_run` 之间选择。盈利预测只使用本接口返回的已保存结果，不要自己重算。

## 错误

| HTTP | 含义 | 处理 |
| --- | --- | --- |
| 400 | 参数或字段不在白名单内，或试图读草稿 | 去掉多余参数，改用已保存的 `version_id` |
| 401 | 密钥或访问令牌无效，或密钥已关闭 | 重新换票。仍然 401 就向管理员确认凭证是否被关闭 |
| 403 | 来源 IP 不在白名单，或令牌没有对应读权限 | 从允许的网络调用，或请管理员检查凭证 |
| 404 | 主体、案件或指定版本不存在 | 回到主体列表核对 id |
| 500 | 查询失败 | 把 `X-Request-Id` 交给管理员，不要重试修改数据 |

## 管理员

凭证在 **系统配置 → agent调用** 里创建、关闭和查看日志。密钥只在创建或重置时显示一次。关闭后，该密钥和已发出的访问令牌立即失效。

也可以用环境变量预置一把客户端，库里只存密钥哈希：

- `AGENT_CLIENT_ID`
- `AGENT_CLIENT_SECRET`：至少 16 位
- `AGENT_IP_ALLOWLIST`：可选，逗号分隔。不设则不限制来源
- `AGENT_TRUST_PROXY`：设为 `1` 时，白名单看 `X-Forwarded-For` 的第一段

调用方不使用系统登录账号，也不要传 `x-user-id`。
