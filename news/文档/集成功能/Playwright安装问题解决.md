# Playwright安装问题解决

## 问题：权限不足

在容器中执行 `apk add` 时遇到：
```
ERROR: Unable to lock database: Permission denied
```

**原因**：容器中的用户是 `nodejs`（非root用户），没有权限安装系统包。

## 解决方案

### 方案1：以root用户进入容器（快速测试）

```bash
# 以root用户进入容器
sudo docker compose exec -u root app sh

# 现在可以安装系统依赖
apk add --no-cache nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont

# 升级pip
python3 -m pip install --upgrade pip --break-system-packages

# 安装Playwright
pip install playwright --break-system-packages

# 安装Chromium浏览器
playwright install chromium

# 验证安装
python3 -c "from playwright.sync_api import sync_playwright; print('Playwright安装成功')"

# 退出容器
exit
```

### 方案2：重新构建镜像（永久方案，推荐）

已更新 `Dockerfile`，包含所有必要的系统依赖和Playwright。重新构建镜像：

```bash
cd /opt/newsapp/news

# 重新构建镜像（包含Playwright和所有依赖）
sudo docker compose build app

# 重启容器
sudo docker compose up -d app
```

### 方案3：临时切换到root用户执行命令

```bash
# 在容器外执行，以root用户运行命令
sudo docker compose exec -u root app apk add --no-cache nss freetype freetype-dev harfbuzz ca-certificates ttf-freefont
sudo docker compose exec -u root app python3 -m pip install --upgrade pip --break-system-packages
sudo docker compose exec -u root app pip install playwright --break-system-packages
sudo docker compose exec -u root app playwright install chromium
```

## 验证安装

安装完成后，验证：

```bash
# 测试Playwright是否可用
sudo docker compose exec app python3 -c "from playwright.sync_api import sync_playwright; print('Playwright安装成功')"
```

## 注意事项

1. **Alpine Linux限制**：Alpine Linux是轻量级Linux，某些包可能不可用
2. **镜像大小**：安装Playwright和Chromium会增加镜像大小（约300MB+）
3. **构建时间**：重新构建镜像需要较长时间

## 如果Alpine Linux安装失败

如果Alpine Linux上安装Playwright仍然失败，可以考虑：

1. **使用Debian基础镜像**：将 `FROM node:18-alpine` 改为 `FROM node:18`
2. **使用预构建的Playwright镜像**：使用包含Playwright的Docker镜像
3. **使用外部服务**：使用第三方API服务获取微信公众号内容

