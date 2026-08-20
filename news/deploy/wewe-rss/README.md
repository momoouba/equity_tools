# wewe-rss 部署（G0 / G1 / 生产）

上游：[cooderl/wewe-rss](https://github.com/cooderl/wewe-rss)（已 archived，镜像仍可用）

## 架构结论

| 方式 | 是否推荐 |
|------|----------|
| 把 wewe **打进**新闻 `app` 镜像 | **否**（技术栈/进程完全不同） |
| Docker-in-Docker（app 里再起 docker） | **否** |
| **同 compose 并列一个 `wewe-rss` 服务** | **是（生产）** → 见仓库根 `news/docker-compose.yml` |
| 仅 `deploy/wewe-rss/docker-compose.yml` 单独 up | **是（本地 G0 / 临时）** |

容器内新闻访问：`WEWE_RSS_BASE_URL=http://wewe-rss:4000`（服务名，不是 localhost）。

---

## 与本仓本地开发的关系

新闻舆情本地是 **`news` + `npm run dev`**，通常**不在 Docker 里跑 news**。

| 进程 | 怎么起 | 端口（默认） |
|------|--------|--------------|
| 新闻前后端 | `cd news` → `npm run dev` | API 约 3001/3002 |
| wewe-rss | `cd news/deploy/wewe-rss && docker compose up -d` | `4000` |

```env
WEWE_RSS_BASE_URL=http://127.0.0.1:4000
WEWE_RSS_AUTH_CODE=与 AUTH_CODE 一致
```

---

## 生产：并入主 docker-compose（华为云）

主文件已含服务 `wewe-rss`（容器名 `newsapp-wewe-rss`），数据卷：`./deploy/wewe-rss/data`。

Node 堆默认约 2GB，全量 feed 会 `heap out of memory`。compose 已设 `NODE_OPTIONS=--max-old-space-size=4096`、容器 `mem_limit: 5g`。同步 `docker-compose.yml` 后执行 `docker compose up -d wewe-rss`（会 recreate 容器，**不要**删 `deploy/wewe-rss/data`，会话在库里）。可用 `WEWE_NODE_OPTIONS` 覆盖。

### 1）云上 `.env` 必填清单

| 变量 | 生产示例 | 说明 |
|------|----------|------|
| `WEWE_RSS_AUTH_CODE` | 强随机串 | **app 与 wewe 共用**；勿用默认 `change-me-wewe` |
| `WEWE_RSS_BASE_URL` | `http://wewe-rss:4000` | 容器内互通；勿写 `127.0.0.1` |
| `WEWE_HOST_BIND` | `127.0.0.1` | 默认只本机映射 4000；需公网直连 wewe 再改 `0.0.0.0` |
| `WEWE_HOST_PORT` | `4000` | 宿主机端口 |
| `WEWE_SERVER_ORIGIN_URL` | `https://域名` 或 `http://IP:4000` | wewe 生成外链用 |
| `WEWE_PLATFORM_URL` | `https://weread.111965.xyz` | 不通可试 `https://weread.965111.xyz` |
| `NEWS_PUBLIC_BASE_URL` | `https://新闻公网域名` | 活码邮件链接指向新闻站 |
| `WEWE_LIVE_QR_SECRET` | 强随机串 | 活码 HMAC；生产必改 |
| `WEWE_OPS_EMAIL` | （可选） | **优先用页面**「专队配置 → ops_email」；仅当页面未填时才用本变量。勿写「运维邮箱」占位中文 |

可选：`WEWE_FEED_MODE` / `WEWE_CRON_EXPRESSION` / `WEWE_UPDATE_DELAY_TIME` / `WEWE_MAX_REQUEST_PER_MINUTE` / `WEWE_LIVE_QR_TTL_HOURS`。

### 2）发布步骤摘要

```bash
cd /opt/newsapp/news
# 同步本批 server + client dist + docker-compose.yml + deploy/wewe-rss/
# 编辑 .env 按上表填写

docker compose pull wewe-rss   # 首次或更新镜像
docker compose up -d wewe-rss
docker compose up -d app nginx # 或 up -d 全量

docker compose ps
docker compose logs wewe-rss --tail 50
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4000/
# 新闻容器内探测
docker compose exec app node -e "require('http').get('http://wewe-rss:4000/',r=>console.log(r.statusCode)).on('error',e=>console.error(e))"
```

前端有 wewe 配置页改动时：照常 build `client` → 覆盖 `news_app_frontend` volume → `restart nginx`。  
后端：volume 挂载 `./server` → `docker compose restart app`。

**嵌入「wewe-rss 管理」空白：** Nginx 须把 `/wewe-rss-gate`、`/dash`、`/trpc`、`/wewe-rss`、`/wewe/` 反代到 `app`（见 `deploy/nginx-site.conf`），否则会落到前端 `index.html`。同步 conf 后 `docker compose restart nginx`。

### 3）上线分步开关（专队）

1. wewe 容器健康 + 账号管理扫码成功（读书账号启用）  
2. 管理员设置 → 私有公众号 wewe：确认 `WEWE` 探测可达、读书账号可用  
3. 先开「总开关 + 允许入队」，观察专队列表  
4. 再开提取 / 入库 / 催办  

默认库内开关多为关；勿一上来全开。

### 4）安全建议

- 4000 **默认绑 127.0.0.1**；运维用 SSH 隧道或新闻站「wewe-rss 管理」嵌入反代  
- 勿把 `AUTH_CODE` / 活码 secret 提交 Git  
- `deploy/wewe-rss/data/*.db` 勿提交  

---

## 本地仅 wewe（G0.1）

```bash
cd news/deploy/wewe-rss
cp .env.example .env
# 编辑 AUTH_CODE
docker compose up -d
```

浏览器：`http://127.0.0.1:4000` → 账号管理扫码 → 公众号源粘贴分享链接。

## Spike

见同目录 `SPIKE.md`。
