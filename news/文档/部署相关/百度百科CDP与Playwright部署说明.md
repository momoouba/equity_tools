# 百度百科查词（CDP / Playwright）生产部署说明

本文说明 **竞品分析 / 项目寻源** 中「百度百科批量查词」在 Docker 生产环境的依赖、推荐架构与运维步骤。

> **适用分支**：`release/clean` 及生产部署仓（文档位于 `news/文档/`，随 `news/` 一并发布）。

## 背景与结论

| 模式 | 用途 | 生产可用性 |
|------|------|------------|
| **HTTP**（`baidu_baike_fetch.py`） | 轻量请求 | 易被反爬，常拿不到词条正文 |
| **headless**（容器内 Playwright Chromium） | 无宿主机浏览器时的兜底 | 基础设施可跑，但百度 BIOC 常返回 `anti_crawl` / `lemma_not_loaded` |
| **cdp**（宿主机真实 Chromium + 远程调试） | **生产推荐** | 已验证可取出真实 `company_intro` |

生产环境默认 compose 变量：

- `BAIKE_BROWSER_MODE=cdp`（推荐）或 `headless`
- `BAIKE_CDP_URL=http://host.docker.internal:9223`（经 socat 转发时用 **9223**）
- `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`（辅导备案 / headless 共用）
- `extra_hosts: host.docker.internal:host-gateway`（`docker-compose.yml` 已配置）

相关代码：

- `server/utils/project-sourcing/baidu_baike_fetch.py` — HTTP
- `server/utils/project-sourcing/baidu_baike_fetch_browser.py` — CDP / headless
- `server/utils/project-sourcing/baikeLookupService.js` — Node 编排
- `server/utils/project-sourcing/baikeBatchJobService.js` — UI 批量后台任务（202 受理 + 进度日志）
- `server/scripts/startChromeForBaike.sh` — Linux 宿主机启动 CDP Chromium

## 架构（推荐）

```
┌──────────────────────────── 宿主机 ────────────────────────────┐
│  Chromium (snap/deb)                                            │
│    --remote-debugging-port=9222                                 │
│    --remote-allow-origins=*                                     │
│    仅监听 127.0.0.1:9222                                        │
│                              ▲                                  │
│                              │ TCP                              │
│  socat 0.0.0.0:9223 ─────────┘                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ host-gateway
┌──────────────────────────────▼──────────────────────────────────┐
│  Docker app                                                      │
│    BAIKE_BROWSER_MODE=cdp                                        │
│    BAIKE_CDP_URL=http://host.docker.internal:9223                │
│    连接时：HTTP 伪装 Host=127.0.0.1:9222；                       │
│            WebSocket 改写为网关 IP（如 172.17.0.1:9223）         │
└──────────────────────────────────────────────────────────────────┘
```

**为何不能只用 headless：** 容器内 Chromium 易被百度判为爬虫，表现为词条壳在、简介为站点通用文案或空（`miss_reason=anti_crawl`，`error=lemma_not_loaded`）。

**为何要 socat + Host/IP 改写：**

1. snap Chromium 的 CDP 通常只绑 `127.0.0.1`，容器访问不到。
2. 经 `host.docker.internal` 访问时，若 `Host` 头不是本机地址，Chrome 对 `/json/version` 返回 **500**。
3. WebSocket 的 `Host` 若是主机名（非 IP / localhost），Chrome 报：  
   `Host header is specified and is not an IP address or localhost`。  
   脚本会把 `host.docker.internal` **解析成网关 IP** 再连 WS。

## 一、环境变量（`.env` / compose）

```bash
# 生产推荐
BAIKE_BROWSER_MODE=cdp
BAIKE_CDP_URL=http://host.docker.internal:9223

# 可选：HTTP /json/version 伪装 Host（一般无需改，脚本会自动尝试 127.0.0.1:9222）
# BAIKE_CDP_HTTP_HOST=127.0.0.1:9222

# 可选：百科 Playwright 额外启动参数、代理
# BAIKE_PLAYWRIGHT_EXTRA_ARGS=
# BAIKE_HTTP_PROXY=   # 或复用 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY
# BAIKE_BROWSER_BATCH=20
```

修改后需 recreate app，使 compose 注入生效：

```bash
cd /opt/newsapp/news
docker compose up -d app --force-recreate
docker compose exec app printenv BAIKE_BROWSER_MODE BAIKE_CDP_URL
```

## 二、宿主机：安装 Chromium

Ubuntu 默认源**没有** `google-chrome-stable` 包名时，用：

```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
# 或：sudo apt-get install -y chromium
# 或官方 deb：
#   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
#   sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
```

无桌面时安装虚拟显示：

```bash
sudo apt-get install -y xvfb socat
```

**注意（snap Chromium）：**

- 自定义 profile **不要**用 `~/.chrome-baike-poc`（Permission denied）。
- 使用：`~/snap/chromium/common/baike-poc`。

## 三、宿主机：启动 CDP + socat（批跑前常驻）

### 3.1 启动 Chromium（终端保持运行）

```bash
mkdir -p ~/snap/chromium/common/baike-poc

xvfb-run -a chromium-browser \
  --remote-debugging-port=9222 \
  --remote-allow-origins='*' \
  --user-data-dir="$HOME/snap/chromium/common/baike-poc" \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --disable-dev-shm-usage \
  "https://baike.baidu.com/"
```

看到 `DevTools listening on ws://127.0.0.1:9222/...` 即成功。  
`xdg-settings` / AppArmor / WebGL 等告警一般可忽略。

脚本入口（需保证 LF 换行）：`server/scripts/startChromeForBaike.sh`  
若报 `bash\r`：`sed -i 's/\r$//' server/scripts/startChromeForBaike.sh`

### 3.2 本机确认 CDP

```bash
curl -s --max-time 3 http://127.0.0.1:9222/json/version
```

### 3.3 socat 转发（另一终端常驻）

```bash
socat TCP-LISTEN:9223,bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:9222
```

```bash
curl -s --max-time 3 http://127.0.0.1:9223/json/version
```

## 四、容器冒烟

```bash
# 容器内无 curl 时用 Python；必须伪装 Host
docker compose exec app python3 -c "
import urllib.request
req = urllib.request.Request(
  'http://host.docker.internal:9223/json/version',
  headers={'Host': '127.0.0.1:9222'}
)
print(urllib.request.urlopen(req, timeout=5).read().decode()[:220])
"

docker compose exec app python3 /app/server/utils/project-sourcing/baidu_baike_fetch_browser.py \
  --mode=cdp --cdp-url=http://host.docker.internal:9223 --name '科大讯飞股份有限公司'
```

期望：

- stderr：`[baike-browser] CDP http=... host=127.0.0.1:9222 → ws=ws://172.x.x.x:9223/devtools/browser/...`（**IP**，不是主机名）
- stdout JSON：`"ok": true`，`company_intro` 为真实企业简介

## 五、业务侧使用

- 管理后台「批量百科查词」：立即 **202 受理**，后台执行；进度见：

```bash
docker compose logs app -f | grep -E 'baikeBatchJob|baikeLookup|baikeBrowserWorker'
```

- 同 scope 重复提交会 **409**（已有任务在跑）。
- 单条查词走 `fetchBaike`（HTTP → 浏览器兜底）。
- CLI 示例：

```bash
docker compose exec app node server/scripts/backfillFinancingBaikeLookup.js --mode=browser --limit=50
```

## 六、可选：systemd 常驻（建议）

将 Chromium / socat 做成服务，避免 SSH 断开后进程退出。示例（按实际用户路径调整）：

**`/etc/systemd/system/baike-chromium-cdp.service`**

```ini
[Unit]
Description=Baike Chromium CDP (xvfb)
After=network.target

[Service]
User=guofang
Environment=HOME=/home/guofang
ExecStart=/usr/bin/xvfb-run -a /usr/bin/chromium-browser --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=/home/guofang/snap/chromium/common/baike-poc --no-first-run --no-default-browser-check --disable-gpu --disable-dev-shm-usage https://baike.baidu.com/
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/baike-cdp-socat.service`**

```ini
[Unit]
Description=Forward host CDP 9223 to Chromium 9222
After=baike-chromium-cdp.service
Requires=baike-chromium-cdp.service

[Service]
ExecStart=/usr/bin/socat TCP-LISTEN:9223,bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:9222
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now baike-chromium-cdp baike-cdp-socat
sudo systemctl status baike-chromium-cdp baike-cdp-socat
```

安全建议：9223 仅对本机 / Docker 网桥开放，**勿对公网暴露**。

## 七、常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| headless 冒烟 `anti_crawl` / `lemma_not_loaded` | 百度拦容器 Chromium | 改用 **cdp** |
| `Unable to locate package google-chrome-stable` | 无 Google apt 源 | 装 `chromium-browser` 或官方 deb |
| `bash\r`: No such file | Windows CRLF | `sed -i 's/\r$//' server/scripts/startChromeForBaike.sh` |
| `SingletonLock: Permission denied` | snap 不能写 `~/.chrome-baike-poc` | 改用 `~/snap/chromium/common/baike-poc` |
| 宿主机 curl 9222 通，容器读 9223 得 **500** | Host 头不是本机 | 伪装 `Host: 127.0.0.1:9222`；更新脚本 |
| WS：`Host ... not an IP address or localhost` | 用了主机名连 WS | 更新脚本（解析为网关 IP） |
| 容器内 `curl: not found` | 镜像未装 curl | 用上文 Python 探测 |
| 批量无日志 | 旧接口同步阻塞且少日志 | 已改为后台任务 + `[baikeBatchJob]` 日志；确认已部署新代码 |
| xvfb 下无法点验证码 | 无图形界面 | 安装 VNC，或接受偶发 anti_crawl；有条件用住宅代理 |

## 八、与「辅导备案 Playwright」的关系

| 能力 | 浏览器位置 | 模式 |
|------|------------|------|
| 证监会辅导备案 | **容器内** `/ms-playwright` | headless `launch` |
| 百度百科查词（生产） | **宿主机** Chromium CDP | `connect_over_cdp` |

两者都依赖 `playwright` Python 包；辅导备案另需：

```bash
docker compose exec -u root app python3 -m playwright install chromium
```

百科 **cdp 模式不依赖** 容器内是否装好 Chromium 二进制（连的是宿主机浏览器）；若回退 headless 则仍需要上述安装。

## 相关文档

- `news/文档/正常更新部署流程.md` — 日常更新与 Playwright 自检
- `news/文档/部署相关/Docker生产环境部署指南.md` — 首次部署步骤
- `news/文档/部署相关/README.md` — 运维索引
- `news/上市进展/辅导备案与Playwright部署说明.md` 或仓库内等价路径 — 辅导备案专用
- `news/.env.example` — 环境变量模板
