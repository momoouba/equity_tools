# we-mp-rss（本地公众号采集）

替代已失效的 `wewe-rss`（其 `PLATFORM_URL` 中转已 502）。本服务直连微信读书 / 公众平台，输出 JSON Feed，供新闻专队拉取。

**文档（新闻舆情）**

- 产品 / 名单 / 协作：[文档/需求说明/私有公众号专队与we-mp-rss说明.md](../../文档/需求说明/私有公众号专队与we-mp-rss说明.md)
- 生产部署步骤：[文档/正常更新部署流程.md](../../文档/正常更新部署流程.md) → 场景4

## 快速启动

```bash
cd news/deploy/we-mp-rss
copy .env.example .env
docker compose up -d
```

- 管理页：http://127.0.0.1:8001
- 默认账号：`admin` / `admin@123`（首次登录后请改密）
- JSON Feed：`http://127.0.0.1:8001/feed/{MP_WXS_xxx}.json`

## 新闻侧配置

1. 系统配置 → 私有公众号 → **采集后端**选 `we-mp-rss`
2. Base URL（**服务端**）生产填 `http://we-mp-rss:8001`；本地可 `http://127.0.0.1:8001`
3. 浏览器管理页走新闻站同源反代 **`/we-mp-rss/`**（nginx），不要在浏览器打开 `http://we-mp-rss:8001`
4. 环境变量（新闻 `news/.env` 或进程环境）：

```env
MP_RSS_PROVIDER=werss
MP_RSS_BASE_URL=http://we-mp-rss:8001
MP_RSS_USERNAME=admin
MP_RSS_PASSWORD=admin@123
```

5. 在 we-mp-rss 管理页完成「微信读书」扫码或粘贴 Cookie，并订阅目标公众号
6. 专队账号「粘贴分享链接」映射 `feed_id`，再开提取/入库开关

单独 compose 起的 `we-mp-rss` 要挂到新闻网络，nginx 才能反代：

```bash
docker network connect news_newsapp-network we-mp-rss
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
```

## 探活

```bash
cd news
node server/scripts/mp-rss-probe.js
```

## 与 wewe 的关系

| 项 | wewe-rss | we-mp-rss |
|----|----------|-----------|
| 端口 | 4000 | 8001 |
| 中转 | 依赖死掉的 weread.111965.xyz | 直连 weread.qq.com |
| Feed | `/feeds/:id.json` | `/feed/:id.json` |
| 登录 | wewe tRPC 扫码 | 管理页 / Cookie / 读书扫码 |

本地可同时保留 wewe 容器做对照；新闻侧用 `collector_provider=werss` 切换。

## Linux 生产部署

```bash
# 服务器上
cd /opt/equity_news/news/deploy/we-mp-rss   # 或你的部署目录
cp .env.example .env
# 编辑 .env：改密码；若需局域网访问改 MP_RSS_HOST_BIND=0.0.0.0
docker compose up -d
```

新闻侧（同机 Docker 网或内网）：

```env
MP_RSS_PROVIDER=werss
MP_RSS_BASE_URL=http://we-mp-rss:8001
# 或 http://<内网IP>:8001
MP_RSS_USERNAME=admin
MP_RSS_PASSWORD=<与 .env 一致>
```

专队配置页同步：`collector_provider=werss`，Base URL 同上。容器起来后先在管理页完成微信读书扫码/Cookie，再开提取/入库开关。

数据卷 `./data` 请纳入备份（含 db、Cookie/会话）。注意勿把含密码的 `.env`、`data/.secret_key`、`*.lic` 提交进 git。
