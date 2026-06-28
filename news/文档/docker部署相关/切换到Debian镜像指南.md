# 切换到Debian基础镜像指南

## 问题

Playwright不支持Alpine Linux（musl libc），需要切换到Debian基础镜像。

## 解决方案

### 步骤1：备份当前Dockerfile

```bash
cd /opt/newsapp/news
cp Dockerfile Dockerfile.alpine.backup
```

### 步骤2：使用新的Dockerfile

已创建 `Dockerfile.debian`，可以：

**选项A：直接替换**
```bash
cp Dockerfile.debian Dockerfile
```

**选项B：手动修改**
将 `Dockerfile` 中的 `FROM node:18-alpine` 改为 `FROM node:18-slim`，并更新系统包安装命令。

### 步骤3：重新构建镜像

```bash
cd /opt/newsapp/news

# 重新构建镜像（包含Playwright和所有依赖）
sudo docker compose build app

# 重启容器
sudo docker compose up -d app
```

### 步骤4：验证安装

```bash
# 检查Playwright是否安装成功
sudo docker compose exec app python3 -c "from playwright.sync_api import sync_playwright; print('Playwright安装成功')"

# 查看日志
sudo docker compose logs app | grep -i playwright
```

## 镜像大小对比

- **Alpine版本**：约200-300MB
- **Debian版本**：约400-500MB（增加约200MB）

## 注意事项

1. **构建时间**：首次构建需要较长时间（下载Playwright和Chromium）
2. **磁盘空间**：确保有足够的磁盘空间（至少1GB）
3. **网络**：需要稳定的网络连接下载依赖

## 回滚方案

如果遇到问题，可以回滚到Alpine版本：

```bash
cp Dockerfile.alpine.backup Dockerfile
sudo docker compose build app
sudo docker compose up -d app
```

