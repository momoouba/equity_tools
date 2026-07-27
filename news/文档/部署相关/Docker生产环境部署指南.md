# Docker 生产环境部署指南

## 📋 部署前准备

### 1. 确认修改的文件

本次更新主要涉及以下文件：
- `client/src/pages/ShareNewsPage.jsx` - 简化代码，移除循环逻辑
- `client/src/utils/axios.js` - 移除调试日志
- `client/src/App.jsx` - 移除调试日志
- `client/src/main.jsx` - 移除调试日志
- `client/vite.config.js` - 移除代理日志

### 2. 确认服务器环境

确保服务器已安装：
- Docker
- Docker Compose

## 🚀 部署步骤

### 方法1：使用 Docker Compose（推荐）

#### 步骤1：连接到服务器

```bash
# SSH 连接到服务器
ssh user@your-server-ip
```

#### 步骤2：进入项目目录

```bash
cd /path/to/news  # 替换为实际的项目路径，例如 /opt/newsapp/news
```

#### 步骤3：同步代码

**如果使用 Git：**
```bash
# 拉取最新代码
git pull origin main
# 或
git pull origin master
```

**如果手动上传：**
```bash
# 确保修改的文件已上传到服务器
# 检查关键文件是否存在
ls -la client/src/pages/ShareNewsPage.jsx
```

#### 步骤4：停止旧容器

```bash
# 停止并删除旧容器（保留数据卷）
docker compose down

# 或者只停止不删除
docker compose stop
```

#### 步骤5：重新构建镜像

有多种方式可以选择：

**方式1：完全重建（清除所有缓存）- 推荐**

```bash
# 构建新镜像（会重新构建前端，不使用缓存）
docker compose build --no-cache
```

**方式2：仅重新构建（使用缓存）- 更快**

```bash
# 使用缓存构建，速度更快
docker compose build
```

**方式3：仅构建应用服务**

```bash
# 如果只修改了应用代码，可以只构建 app 服务
docker compose build --no-cache app
```

**注意：** `--no-cache` 参数确保使用最新代码，不使用缓存，但构建时间更长。

#### 步骤6：启动新容器

**方式1：分步执行（推荐）**

```bash
# 先停止容器
docker compose down

# 重新构建
docker compose build --no-cache

# 启动所有服务
docker compose up -d
```

**方式2：一步完成（快捷）**

```bash
# 一步完成重建和启动
docker compose up --build -d
```

**查看启动日志：**

```bash
# 查看应用日志（实时）
docker compose logs -f app

# 查看最近100行日志
docker compose logs app --tail 100

# 查看所有服务状态
docker compose ps
```

#### 步骤7：验证部署

```bash
# 检查容器状态
docker compose ps

# 检查应用健康状态
curl http://localhost/api/health

# 查看应用日志
docker compose logs app --tail 100
```

#### 步骤8：Playwright Chromium（上市进展 · 辅导备案）

若使用 **上市进展 · 证监会辅导备案** 同步（数据源为 `eid.csrc.gov.cn`），除镜像内 `pip install -r server/utils/requirements.txt` 已包含的 `playwright` 包外，须在容器内安装 **Chromium 浏览器二进制**，否则抓取会回退为纯 HTTP、**无法**模拟点击「备案时间」排序。

在项目根目录（含 `docker-compose.yml`）执行：

```bash
# 推荐：不依赖 PATH 中的 playwright 可执行文件
sudo docker compose exec -u root app python3 -m playwright install chromium
```

验证：

```bash
docker compose exec app python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    b.close()
print('playwright chromium OK')
"
```

完整参数说明见：**`news/上市进展/辅导备案与Playwright部署说明.md`**；容器内手动排错见 **`news/手动安装Playwright.md`**。

#### 步骤9：百度百科查词（宿主机 Chromium CDP）

若生产需使用融资/投前等模块的 **百度百科批量查词**，容器内 headless 常被百度拦截。推荐：

1. 宿主机安装 Chromium（或 Chrome），以 `--remote-debugging-port=9222 --remote-allow-origins=*` 启动（可用 `xvfb-run`）。
2. `socat` 将 `0.0.0.0:9223` 转到 `127.0.0.1:9222`。
3. `.env` / compose：`BAIKE_BROWSER_MODE=cdp`，`BAIKE_CDP_URL=http://host.docker.internal:9223`，并 recreate `app`。
4. 冒烟：容器内执行 `baidu_baike_fetch_browser.py --mode=cdp ...`，确认 `ok: true`。

专文（含 snap profile 路径、Host/IP 改写原因、systemd 示例）：

**`news/文档/部署相关/百度百科CDP与Playwright部署说明.md`**

（容器内 `python3 -m playwright install chromium` 仍建议保留，供 **辅导备案** 等 headless 场景使用，与百科 CDP 互补。）

#### 步骤10：验证部署（可选补充）

```bash
# 百科环境变量
docker compose exec app printenv BAIKE_BROWSER_MODE BAIKE_CDP_URL
```

### 方法2：使用部署脚本

如果服务器上有 `deploy/docker-deploy.sh` 脚本：

```bash
# 1. 同步代码（Git 或手动上传）
git pull origin main

# 2. 运行部署脚本
chmod +x deploy/docker-deploy.sh
./deploy/docker-deploy.sh
```

## 🔍 验证更新

### 1. 检查前端构建

```bash
# 进入容器检查前端文件
docker exec -it newsapp ls -la /app/client/dist

# 检查 ShareNewsPage 相关文件
docker exec -it newsapp find /app/client/dist -name "*ShareNewsPage*"
```

### 2. 测试分享页面

1. 访问分享页面：`http://your-domain/share/your-token`
2. 打开浏览器开发者工具（F12）
3. 查看控制台，应该看到：
   ```
   ═══════════════════════════════════════════════════════
   [ShareNewsPage] 版本: 2.0.0-simplified
   已移除所有循环逻辑（MutationObserver、setInterval等）
   ═══════════════════════════════════════════════════════
   ```
4. **不应该**看到：
   - `MutationObserver 触发`
   - `找到 9 个表头元素`
   - `已为9个表头单元格设置样式`

### 3. 检查性能

- 页面应该正常加载，不再卡顿
- 控制台不应该有大量循环日志
- 内存占用应该正常

## 🛠️ 故障排查

### 问题1：构建失败

```bash
# 查看详细构建日志
docker compose build --no-cache app 2>&1 | tee build.log

# 检查是否有依赖问题
docker compose build --no-cache app --progress=plain
```

### 问题2：容器启动失败

```bash
# 查看容器日志
docker compose logs app

# 检查容器状态
docker compose ps

# 进入容器调试
docker exec -it newsapp /bin/bash
```

### 问题3：前端未更新

```bash
# 强制重新构建前端
docker compose build --no-cache frontend-builder

# 或者完全清理后重建
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### 问题4：Nginx 缓存问题

如果 Nginx 有缓存：

```bash
# 重启 Nginx 容器
docker compose restart nginx

# 或者在 Nginx 配置中禁用缓存（开发环境）
```

## 📝 常用命令

```bash
# 查看所有容器状态
docker compose ps

# 查看应用日志
docker compose logs -f app

# 查看 Nginx 日志
docker compose logs -f nginx

# 重启应用容器
docker compose restart app

# 重启所有服务
docker compose restart

# 停止所有服务
docker compose stop

# 停止并删除容器（保留数据卷）
docker compose down

# 停止并删除容器和数据卷（谨慎使用）
docker compose down -v

# 查看资源使用情况
docker stats
```

## ⚠️ 注意事项

1. **数据备份**：部署前建议备份数据库和上传的文件
2. **环境变量**：确保 `.env` 文件配置正确
3. **端口冲突**：确保端口 3001、80、443 未被占用
4. **磁盘空间**：确保有足够的磁盘空间用于构建镜像（**Playwright Chromium** 约数百 MB，见 **`news/上市进展/辅导备案与Playwright部署说明.md`**）
5. **构建时间**：首次构建可能需要较长时间，请耐心等待
6. **上市进展 · 辅导备案**：更新 Python 依赖或新装机后，勿忘在容器内执行 **`python3 -m playwright install chromium`**（见上文「步骤8」）
7. **百度百科查词**：生产推荐宿主机 Chromium CDP + socat，见上文「步骤9」与 **`news/文档/部署相关/百度百科CDP与Playwright部署说明.md`**

## 🔄 回滚操作

如果部署后出现问题，可以回滚到之前的版本：

```bash
# 1. 停止当前容器
docker compose down

# 2. 切换到之前的代码版本（Git）
git checkout <previous-commit-hash>

# 3. 重新构建和启动
docker compose build --no-cache
docker compose up -d
```

## 📞 支持

如果遇到问题，请检查：
1. Docker 和 Docker Compose 版本
2. 服务器资源（CPU、内存、磁盘）
3. 网络连接
4. 日志文件：`logs/` 目录
