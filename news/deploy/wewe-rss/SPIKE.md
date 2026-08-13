# wewe-rss Spike 备忘（G1 填写）

| 项 | 内容 |
|----|------|
| 填写日期 | 2026-08-12 |
| 本地 G0 | **通过**（`npm run probe:wewe` 可读标题/链接/正文） |
| 华为云 G1 | **通过**（`http://119.3.127.211:4000` 可开；订阅可见；新增链接正常） |
| 镜像标签 | `cooderl/wewe-rss-sqlite:latest` |
| PLATFORM_URL | `https://weread.111965.xyz`（沿用） |
| 实测 session TTL | 待专队联调细测；初值按 24h 配置 |
| 提取方案选定 | **倾向 A**：`GET /feeds/:feedId.rss?update=true` 单 feed 刷新后再读 `.json`；B 作降级 |

## 接口清单（实测）

| 能力 | 方法/路径 | 是否需 AUTH | 实测结果 |
|------|-----------|-------------|----------|
| 全部 feed JSON | `GET /feeds/all.json` | 否（探路已通） | OK，含 `content_html` / `date_modified` |
| 单 feed JSON | `GET /feeds/:feedId.json?limit=` | | OK（管理页可见） |
| 单 feed 刷新 | `GET /feeds/:feedId.rss?update=true` | | 管理页「立即更新」可用；代码侧 P3 再验 |
| 管理页 | `GET /` | 浏览器 AUTH_CODE | OK |
| 账号失效字段 | 管理页账号状态 | | 有小黑屋/失效等状态 |

## 决策

- [x] **通过 G1** → 启动 P1～P7  
- [ ] **失败结项** → 不开发专队（原因：）

## 备注

- 服务器 Docker 原 `ustc` 镜像源 DNS 失效，已换可用 mirror 后 pull 成功。  
- 云上可迁本地 `data/` 卷延续会话与订阅。  
- `SERVER_ORIGIN_URL` 须为 `http://IP:4000`（勿写成 `IP/:4000`）。  
- 新闻侧专队入队默认 **关**（`wewe_enabled`/`enqueue_enabled`=0），测入队需管理员 PATCH 打开。  
