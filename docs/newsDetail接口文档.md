# 1 新闻详情查询接口

## 1.1 接口说明

新闻详情查询接口实现了通过标准接口查询新闻详情（news_detail）数据的功能。第三方系统可通过本接口分页获取新闻列表，或根据 ID 获取单条新闻完整详情（含正文等字段）。  
使用接口地址时需在请求头添加鉴权信息，列表接口请求方式为 **GET**，参数通过 **URL Query** 传递；单条详情请求方式为 **GET**，新闻 ID 通过 **URL 路径** 传递。响应正文格式均为 **application/json; charset=UTF-8**。

---

## 1.2 接口服务说明

**接口地址：**

| 环境 | 地址 |
|------|------|
| 生产环境 | `https://news.gf-dsai.com/api/news-detail`（列表）<br>`https://news.gf-dsai.com/api/news-detail/{id}`（单条） |

- **列表接口**：`GET /api/news-detail`，分页查询，仅返回未删除数据，支持关键词、企业全称、公众号、时间范围、实体类型等筛选。
- **单条接口**：`GET /api/news-detail/{id}`，根据新闻详情 ID 查询单条记录，若不存在或已删除则返回 404。

---

## 1.3 鉴权说明（请求头）

调用上述接口时必须在请求头中携带用户 API Token（由平台在用户表中维护）。支持以下两种方式任选其一：

| 参数名 | 示例 | 类型 | 是否必填 | 说明 |
|--------|------|------|----------|------|
| Authorization | Bearer a1b2c3d4e5f6... | String | 是 | 鉴权方式一：Bearer + 空格 + 用户 API Token |
| X-Api-Token | a1b2c3d4e5f6... | String | 是（与 Authorization 二选一） | 鉴权方式二：直接传递用户 API Token |

Token 由用户在登录后调用 **GET /api/auth/api-token** 获取或生成，并存储在用户表中。未提供 Token 或 Token 无效/已失效时，接口返回 401。

---

## 1.4 新闻详情列表接口

### 1.4.1 请求报文格式

请求方式：**GET**。无请求体，参数通过 URL 查询字符串传递。

**请求 URL 示例：**

```
GET https://news.gf-dsai.com/api/news-detail?page=1&pageSize=20&keyword=关键词
```

**Query 参数说明：**

| 属性 | 名称 | 数据类型 | 是否必填 | 说明 |
|------|------|----------|----------|------|
| page | 页码 | Integer | 否 | 页码，从 1 开始，默认 1 |
| pageSize | 每页条数 | Integer | 否 | 每页条数，默认 20，最大 100 |
| keyword | 关键词 | String | 否 | 匹配标题、公众号名称、微信号、企业全称 |
| enterpriseFullName | 被投企业全称 | String | 否 | 按被投企业全称精确筛选 |
| wechatAccount | 微信号 | String | 否 | 公众号微信号 |
| entityType | 实体类型 | String | 否 | 如：被投企业、基金相关主体、子基金、子基金管理人、子基金GP |
| startTime | 发布时间起始 | String | 否 | 日期格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss |
| endTime | 发布时间截止 | String | 否 | 日期格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss |

### 1.4.2 响应报文格式

**响应报文字段说明如下表所示：**

| 属性 | 名称 | 数据类型 | 说明 |
|------|------|----------|------|
| success | 是否成功 | Boolean | true 表示成功，false 表示失败 |
| message | 提示信息 | String | 失败时返回错误说明 |
| data | 查询结果 | Array | 新闻详情列表，见下表 |
| total | 总条数 | Integer | 符合条件的总条数 |
| page | 当前页码 | Integer | 当前请求的页码 |
| pageSize | 每页条数 | Integer | 当前请求的每页条数 |

**Data 数据字段说明：**

| 属性 | 名称 | 数据类型 | 说明 |
|------|------|----------|------|
| id | 数据ID | String | 年月日时分秒+5位自增序列 |
| account_name | 公众号名称 | String | - |
| wechat_account | 微信号 | String | - |
| enterprise_full_name | 被投企业全称 | String | 可为空 |
| enterprise_abbreviation | 企业简称 | String | 可为空 |
| entity_type | 企业类型 | String | 被投企业/基金相关主体/子基金/子基金管理人/子基金GP，可为空 |
| public_time | 发布时间 | String | 日期格式：yyyy-MM-dd HH:mm:ss |
| title | 图文标题 | String | 可为空 |
| source_url | 原文链接 | String | 可为空 |
| keywords | 关键词 | Array / Object | JSON 数组或对象，可为空 |
| fund | 基金 | String | 可为空 |
| sub_fund | 子基金 | String | 可为空 |
| news_abstract | 新闻摘要 | String | AI 提取，可为空 |
| news_sentiment | 新闻情绪 | String | positive-正面，neutral-中性，negative-负面 |

**响应报文样例：**

```json
{
  "success": true,
  "data": [
    {
      "id": "2025022112000100001",
      "account_name": "示例公众号",
      "wechat_account": "example_account",
      "enterprise_full_name": "某某科技有限公司",
      "enterprise_abbreviation": "某某科技",
      "entity_type": "被投企业",
      "public_time": "2025-02-20T10:00:00",
      "title": "示例新闻标题",
      "source_url": "https://example.com/article/1",
      "keywords": ["关键词1", "关键词2"],
      "fund": null,
      "sub_fund": null,
      "news_abstract": "本则新闻摘要内容",
      "news_sentiment": "neutral"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

**失败/鉴权失败示例：**

```json
{
  "success": false,
  "message": "缺少鉴权信息，请提供 Authorization: Bearer <token> 或 X-Api-Token: <token>"
}
```

---

## 1.5 新闻详情单条接口

### 1.5.1 请求报文格式

请求方式：**GET**。无请求体，新闻 ID 通过 URL 路径传递。

**请求 URL 示例：**

```
GET https://news.gf-dsai.com/api/news-detail/2025022112000100001
```

**路径参数说明：**

| 属性 | 名称 | 数据类型 | 是否必填 | 说明 |
|------|------|----------|----------|------|
| id | 新闻详情ID | String | 是 | 新闻主键，如年月日时分秒+5位序列（VARCHAR 19） |

请求头鉴权要求同 **1.3 鉴权说明**。

### 1.5.2 响应报文格式

**响应报文字段说明如下表所示：**

| 属性 | 名称 | 数据类型 | 说明 |
|------|------|----------|------|
| success | 是否成功 | Boolean | true 表示成功，false 表示失败 |
| message | 提示信息 | String | 失败时返回错误说明 |
| data | 查询结果 | Object | 单条新闻详情，见下表 |

**Data 数据字段说明：**

| 属性 | 名称 | 数据类型 | 说明 |
|------|------|----------|------|
| id | 数据ID | String | - |
| account_name | 公众号名称 | String | - |
| wechat_account | 微信号 | String | - |
| enterprise_full_name | 被投企业全称 | String | 可为空 |
| enterprise_abbreviation | 企业简称 | String | 可为空 |
| entity_type | 企业类型 | String | 可为空 |
| created_at | 创建时间 | String | 入库时间，日期格式：yyyy-MM-dd HH:mm:ss |
| source_url | 原文链接 | String | 可为空 |
| title | 图文标题 | String | 可为空 |
| summary | 图文摘要 | String | 可为空 |
| public_time | 发布时间 | String | 可为空 |
| content | 正文 | String | 正文内容（LONGTEXT），可为空 |
| keywords | 关键词 | Array / Object | 可为空 |
| news_abstract | 新闻摘要 | String | AI 提取，可为空 |
| news_sentiment | 新闻情绪 | String | positive / neutral / negative |
| APItype | 接口类型 | String | 如 新榜/企查查，可为空 |
| news_category | 新闻类别 | String | 中文，可为空 |
| fund | 基金 | String | 可为空 |
| sub_fund | 子基金 | String | 可为空 |

**响应报文样例：**

```json
{
  "success": true,
  "data": {
    "id": "2025022112000100001",
    "account_name": "示例公众号",
    "wechat_account": "example_account",
    "enterprise_full_name": "某某科技有限公司",
    "enterprise_abbreviation": "某某科技",
    "entity_type": "被投企业",
    "created_at": "2025-02-21T12:00:01",
    "source_url": "https://example.com/article/1",
    "title": "示例新闻标题",
    "summary": "图文摘要",
    "public_time": "2025-02-20T10:00:00",
    "content": "正文内容……",
    "keywords": ["关键词1", "关键词2"],
    "news_abstract": "本则新闻摘要内容",
    "news_sentiment": "neutral",
    "APItype": "新榜",
    "news_category": "新闻舆情",
    "fund": null,
    "sub_fund": null
  }
}
```

**未找到或已删除时（404）：**

```json
{
  "success": false,
  "message": "未找到该 ID 或已删除"
}
```

---

## 附录：常见响应码

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未提供 Token 或 Token 无效/已失效 |
| 404 | 单条接口中未找到该 ID 或已删除 |
| 500 | 服务器内部错误 |
