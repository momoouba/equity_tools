# Docker环境前端显示问题排查指南

## 问题描述

**现象：** 本地环境可以正常显示，但Docker环境页面空白或显示错误

**可能原因：**
1. Docker volume包含旧的前端文件，覆盖了新构建的文件
2. 前端构建失败或构建产物不完整
3. Docker镜像构建时没有包含最新的前端代码
4. 浏览器缓存问题
5. Nginx配置问题

## 快速修复方案

### 方案1：使用自动修复脚本（推荐）

```bash
cd /opt/newsapp/news
chmod +x deploy/fix-docker-frontend-issue.sh
./deploy/fix-docker-frontend-issue.sh
```

这个脚本会自动：
1. 重新构建前端
2. 删除旧的Docker volume
3. 重新构建Docker镜像
4. 启动容器并验证

### 方案2：手动修复步骤

#### 步骤1：重新构建前端

```bash
cd /opt/newsapp/news/client
npm install  # 如果需要更新依赖
npm run build
cd ..
```

**验证构建是否成功：**
```bash
ls -la client/dist/ | head -10
# 应该看到 index.html 和其他构建文件
```

#### 步骤2：停止容器并删除旧volume

```bash
cd /opt/newsapp/news
sudo docker compose down

# 查找并删除前端volume
VOLUME_NAME=$(sudo docker compose config | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "Volume名称: $VOLUME_NAME"
sudo docker volume rm $VOLUME_NAME 2>/dev/null || echo "volume不存在，跳过"
```

#### 步骤3：重新构建Docker镜像

```bash
# 清理构建缓存（可选，但推荐）
sudo docker builder prune -f

# 重新构建镜像（不使用缓存，确保使用最新代码）
sudo docker compose build --no-cache app
```

#### 步骤4：启动容器

```bash
sudo docker compose up -d
```

#### 步骤5：等待并验证

```bash
# 等待应用启动
sleep 20

# 检查容器状态
sudo docker compose ps

# 检查前端文件是否存在
sudo docker compose exec app ls -la /app/client/dist/ | head -10

# 检查应用健康状态
sudo docker compose exec app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 查看应用日志
sudo docker compose logs --tail=50 app
```

## 详细排查步骤

### 1. 检查前端构建产物

```bash
cd /opt/newsapp/news
ls -la client/dist/
```

**应该看到：**
- `index.html`
- `assets/` 目录（包含JS和CSS文件）
- 其他静态资源

**如果dist目录为空或不存在：**
```bash
cd client
npm install
npm run build
```

### 2. 检查Docker volume内容

```bash
# 查找volume路径
VOLUME_NAME="news_app_frontend"
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -n "$VOLUME_PATH" ]; then
    echo "Volume路径: $VOLUME_PATH"
    sudo ls -la "$VOLUME_PATH" | head -20
else
    echo "Volume不存在"
fi
```

**如果volume中有旧文件：**
```bash
sudo docker compose down
sudo docker volume rm news_app_frontend
sudo docker compose up -d
```

### 3. 检查容器内的前端文件

```bash
# 检查文件是否存在
sudo docker compose exec app test -f /app/client/dist/index.html && echo "✓ 文件存在" || echo "❌ 文件不存在"

# 列出文件
sudo docker compose exec app ls -la /app/client/dist/ | head -20

# 检查文件修改时间
sudo docker compose exec app stat /app/client/dist/index.html
```

### 4. 检查Nginx配置

```bash
# 检查Nginx容器状态
sudo docker compose ps nginx

# 查看Nginx配置
sudo docker compose exec nginx cat /etc/nginx/conf.d/default.conf

# 检查Nginx日志
sudo docker compose logs --tail=50 nginx
```

### 5. 检查浏览器控制台

1. 打开浏览器开发者工具（F12）
2. 切换到Console标签
3. 查看是否有错误信息
4. 切换到Network标签
5. 刷新页面，检查资源加载情况

**常见错误：**
- `404 Not Found` - 文件路径问题
- `React error #130` - 组件返回undefined
- `Failed to load resource` - 资源加载失败

### 6. 清除浏览器缓存

**Chrome/Edge:**
- 按 `Ctrl + Shift + Delete`
- 选择"缓存的图片和文件"
- 点击"清除数据"
- 或者按 `Ctrl + F5` 硬刷新

**Firefox:**
- 按 `Ctrl + Shift + Delete`
- 选择"缓存"
- 点击"立即清除"
- 或者按 `Ctrl + F5` 硬刷新

## 常见问题

### Q1: 为什么本地正常，Docker环境不行？

**A:** 可能的原因：
1. **Volume覆盖问题**：Docker volume包含旧文件，覆盖了镜像中的新文件
2. **构建缓存**：Docker使用了缓存的旧构建层
3. **环境差异**：本地和Docker环境的Node.js版本或依赖版本不同

**解决方案：**
- 删除volume并重新构建
- 使用 `--no-cache` 重新构建镜像
- 确保本地和Docker使用相同的Node.js版本

### Q2: 重新构建后仍然显示旧内容？

**A:** 可能的原因：
1. 浏览器缓存
2. Nginx缓存
3. Volume仍然包含旧文件

**解决方案：**
```bash
# 1. 清除浏览器缓存并硬刷新（Ctrl + F5）
# 2. 清除Nginx缓存（如果配置了）
sudo docker compose exec nginx rm -rf /var/cache/nginx/*
sudo docker compose restart nginx

# 3. 确保volume已删除
sudo docker compose down
sudo docker volume rm news_app_frontend
sudo docker compose up -d
```

### Q3: 构建失败怎么办？

**A:** 检查构建日志：
```bash
cd /opt/newsapp/news/client
npm run build 2>&1 | tee build.log
```

**常见构建错误：**
- **依赖问题**：运行 `npm install`
- **内存不足**：增加Node.js内存限制 `NODE_OPTIONS=--max-old-space-size=4096 npm run build`
- **语法错误**：检查代码是否有语法错误

### Q4: 如何验证修复是否成功？

**A:** 执行以下检查：

```bash
# 1. 检查容器状态
sudo docker compose ps

# 2. 检查前端文件
sudo docker compose exec app ls -la /app/client/dist/

# 3. 检查应用健康
sudo docker compose exec app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 4. 检查Nginx状态
curl -I http://localhost/

# 5. 查看应用日志
sudo docker compose logs --tail=50 app
```

## 预防措施

### 1. 使用CI/CD流程

在代码更新时自动：
- 构建前端
- 重新构建Docker镜像
- 部署新镜像

### 2. 定期清理

```bash
# 清理未使用的Docker资源
sudo docker system prune -a --volumes

# 清理构建缓存
sudo docker builder prune -a
```

### 3. 验证脚本

创建一个验证脚本，每次部署后自动检查：
- 前端文件是否存在
- 应用是否健康
- 关键API是否可访问

## 联系支持

如果以上步骤都无法解决问题，请提供：
1. 应用日志：`sudo docker compose logs app > app.log`
2. Nginx日志：`sudo docker compose logs nginx > nginx.log`
3. 构建日志：`npm run build > build.log`
4. 浏览器控制台错误截图
5. 容器状态：`sudo docker compose ps`
