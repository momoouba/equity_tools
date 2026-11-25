# 私有公众号专队与 we-mp-rss

> 归属：**新闻舆情**模块。管理员设置 → **私有公众号采集**。  
> 部署步骤见 [正常更新部署流程 · 场景4](../正常更新部署流程.md)（we-mp-rss）；本地采集端见 `news/deploy/we-mp-rss/README.md`。

## 1. 背景

原 **wewe-rss** 依赖的微信读书中转 `PLATFORM_URL`（如 weread.111965.xyz）已失效（502/404），专队无法稳定扫码与采文。现改为：

- 采集后端：**we-mp-rss**（直连 weread.qq.com，端口默认 **8001**）
- 新闻侧通过 `collector_provider=werss` 切换适配层（`mpClient` → `mpRssClient`）

旧 wewe-rss 容器可停用清理，专队业务表（`wewe_private_*`）仍由新闻库使用。

## 2. 协作关系

```
舆情监控对象（有公众号 id）     we-mp-rss（独立 Docker 容器）
第三方/额外公众号  ──同步──►  专队账号  ──订号/读 Feed/催登──►  微信读书采文
                              │
                         提取 → 暂存表
                              │
                         入库 → news_detail → AI
```

| 侧 | 职责 |
|----|------|
| **专队账号**（新闻库） | 抓谁：`active` + `mapped` + `feed_id`；定时提取/入库/催办开关 |
| **we-mp-rss** | 微信读书 Cookie/扫码；订阅公众号；输出 `/feed/MP_WXS_*.json` |
| **新闻提取** | 按专队 `feed_id` 拉 Feed，按业务日写入 `wewe_private_article_stage` |
| **新闻入库** | 暂存 → `news_detail`（定时默认处理 **≤ 昨天** 的业务日，通常凌晨跑） |

要点：

- **不是**专队与 we-mp-rss 名单双向自动同步；「粘贴链接」时会调 we-mp-rss 订号并写回 `feed_id`。
- **调度以专队为准**；仅在 we-mp-rss 停用订阅，专队仍会尝试该号（通常拿不到新文）。正式停抓用专队「退订」。
- we-mp-rss 管理页列表 ≠ `news_detail`；进新闻库必须走提取 → 暂存 → 入库。

## 3. 专队名单从哪来

**不再**由新榜「数据不存在」自动入队、抓成功自动出队。

| 来源 | 规则 |
|------|------|
| 新闻舆情监控对象（`invested_enterprises`） | 属于新闻舆情应用；`wechat_official_account_id` 非空；排除退出状态「完全退出」「不再观察」（**含已上市**） |
| 第三方/额外公众号（`additional_wechat_accounts`） | `status=active` 且公众号 id 非空 |

页面操作：专队账号 → **「从监控同步」**（`POST /api/wewe-probe/team/sync-from-monitor`）。

- 只增改：新增 / 刷新 `source_type` / 将未禁入队的已出队号拉回待订阅  
- **不会**因监控侧删号而自动退订专队账号；停抓请用「退订」或「批量退订」  
- 同步后会对未映射号异步尝试历史分享链接自动映射；失败则「粘贴链接」

配置里「允许入队」为遗留开关，正式名单以「从监控同步」为准。

## 4. 页面能力（管理员设置 → 私有公众号采集）

| 子页 | 能力 |
|------|------|
| 专队配置 | `collector_provider`（wewe / **we-mp-rss**）、Base URL、分步开关、催办邮箱、会话探测 |
| 专队账号 | 从监控同步、筛选、批量退订、粘贴链接映射、禁止重新入队、退订 |
| we-mp-rss 管理 | iframe 嵌入采集端（默认 `http://127.0.0.1:8001`） |

映射：文章分享 URL → we-mp-rss `by_article` 解析 `mp_id` / `mp_info.biz` → 订号 → 专队写入 **`MP_WXS_*`** 的 `feed_id`（勿把文章 id 当 feed id）。

## 5. 配置与环境变量

页面（优先）：

- `collector_provider=werss`
- `wewe_base_url`：生产同网建议 `http://we-mp-rss:8001`；本机 `http://127.0.0.1:8001`

新闻 `.env`（示例）：

```env
MP_RSS_PROVIDER=werss
MP_RSS_BASE_URL=http://we-mp-rss:8001
MP_RSS_USERNAME=admin
MP_RSS_PASSWORD=请改强密码

# 催登活码外链（可与旧 wewe 变量共用）
NEWS_PUBLIC_BASE_URL=https://你的新闻域名
WEWE_LIVE_QR_SECRET=请换成强随机串
WEWE_LIVE_QR_TTL_HOURS=48
```

催登邮件文案可能仍带「wewe」字样，实际二维码/会话按 `collector_provider` 走 **we-mp-rss**。

## 6. 提取 / 入库节奏

| 环节 | 行为 |
|------|------|
| 当晚提取 | `extract_start`（默认 21:00）起抓**当天**稿 |
| 隔日补抓 | `catchup_extract_start`（默认 06:00）补**昨天**（含 21:00 后） |
| 入库 | `ingest_at`（默认 00:00）处理业务日 **≤ 昨天** 的暂存；当天暂存需等到次日凌晨，或运维强制入库 |

企业字段匹配入库时仍排除「完全退出 / 已上市 / 不再观察」的企业元数据填充（与舆情其它匹配一致）；**已上市**仍可在专队名单中，文章可入库，但企业全称等可能为空。

## 7. 生产部署与清理旧 wewe（摘要）

推荐：主 `docker-compose.yml` 并列服务 `we-mp-rss`（与 `app` 同网），**不是** Docker-in-Docker。

```bash
cd /opt/newsapp/news
docker compose up -d we-mp-rss
docker compose up -d --force-recreate app
```

旧 wewe-rss 可停删：

```bash
docker compose stop wewe-rss && docker compose rm -f wewe-rss
# 可选：docker compose up -d --scale wewe-rss=0
# 可选清理数据：deploy/wewe-rss/data（不可恢复）
```

细节与验收见 [正常更新部署流程 · 场景4](../正常更新部署流程.md)。

## 8. 相关代码 / 探活

| 路径 | 说明 |
|------|------|
| `server/utils/wewe/mpClient.js` | 采集门面（wewe / werss） |
| `server/utils/wewe/mpRssClient.js` | we-mp-rss 客户端 |
| `server/utils/wewe/wewePrivateTeam.js` | 专队同步 / 退订 |
| `server/scripts/mp-rss-probe.js` | 本地探活 |
| `deploy/we-mp-rss/` | 采集端 compose / README |
