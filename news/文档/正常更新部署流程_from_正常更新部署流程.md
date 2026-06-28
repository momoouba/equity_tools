# 正常更新部署流程

## 📋 更新前后端代码后的部署步骤

### 场景1: 只更新了后端代码（server目录）

**后端代码通过 volume 挂载，代码更改会自动同步，只需重启容器：**

```bash
cd /opt/newsapp/news

# 1. 重启应用容器（代码已自动同步）
docker compose restart app

# 2. 查看日志确认启动成功
docker compose logs -f app
```

**验证：**
```bash
# 检查容器状态
docker compose ps

# 测试健康检查
curl http://localhost:3001/api/health
```

---

### 场景2: 只更新了前端代码（client目录）

**前端需要重新构建并复制到 volume：**

#### 方法1: 从本地上传构建文件（推荐，最快）

**在本地：**
```powershell
# 1. 构建前端
cd E:\USER\SUREAL\Desktop\equity_news\news\client
npm run build

# 2. 使用 WinSCP 将 dist 目录上传到服务器 /tmp/dist
```

**在服务器：**
```bash
cd /opt/newsapp/news

# 1. 复制到 volume
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r /tmp/dist/* "$VOLUME_PATH/"

# 2. 重启 nginx
docker compose restart nginx

# 3. 验证
docker compose exec nginx stat -c%s /usr/share/nginx/html/index.html
```

#### 方法2: 在服务器上构建（推荐，如果服务器有 Node.js）

**使用脚本（推荐）：**
```bash
cd /opt/newsapp/news
chmod +x deploy/在服务器上构建前端.sh
bash deploy/在服务器上构建前端.sh
```

**或手动执行：**
```bash
cd /opt/newsapp/news

# 1. 检查 Node.js（如果没有需要先安装）
node --version || echo "需要安装 Node.js"

# 2. 构建前端
cd client
npm install  # 首次构建需要
npm run build
cd ..

# 3. 复制到 volume
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"

# 4. 重启 nginx
docker compose restart nginx
```

#### 方法3: 在容器内构建（如果服务器没有 Node.js）

```bash
cd /opt/newsapp/news
chmod +x deploy/在容器内构建前端.sh
bash deploy/在容器内构建前端.sh
```

---

### 场景3: 同时更新了前后端代码

**按顺序执行：**

```bash
cd /opt/newsapp/news

# 步骤1: 更新前端（从本地上传或服务器构建）
# 如果从本地上传：
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r /tmp/dist/* "$VOLUME_PATH/"

# 步骤2: 重启应用容器（后端代码已自动同步）
docker compose restart app

# 步骤3: 重启 nginx
docker compose restart nginx

# 步骤4: 验证
docker compose ps
docker compose logs app --tail 20
```

---

## 🚀 快速命令参考

### 仅后端更新
```bash
cd /opt/newsapp/news && docker compose restart app
```

### 仅前端更新（在服务器上构建）
```bash
cd /opt/newsapp/news
cd client
npm run build
cd ..
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"
docker compose restart nginx
```

### 仅前端更新（从本地上传）
```bash
cd /opt/newsapp/news
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r /tmp/dist/* "$VOLUME_PATH/"
docker compose restart nginx
```

### 前后端都更新（在服务器上构建前端）
```bash
cd /opt/newsapp/news
# 1. 构建前端
cd client
npm run build
cd ..
# 2. 复制到 volume
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"
# 3. 重启容器
docker compose restart app nginx
```

### 前后端都更新（从本地上传前端）
```bash
cd /opt/newsapp/news
# 先更新前端（从本地上传）
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r /tmp/dist/* "$VOLUME_PATH/"
# 再重启容器
docker compose restart app nginx
```

---

## 📝 重要说明

### 1. 后端代码（server目录）
- ✅ **自动同步**：通过 volume 挂载 `./server:/app/server`
- ✅ **无需重建镜像**：代码更改后只需重启容器
- ✅ **即时生效**：重启后立即生效

### 2. 前端代码（client目录）
- ⚠️ **需要构建**：必须先运行 `npm run build`
- ⚠️ **需要复制到 volume**：构建后的文件需要复制到 `app_frontend` volume
- ⚠️ **需要重启 nginx**：复制后需要重启 nginx 容器

### 3. 数据库变更
- 如果修改了数据库结构，需要手动执行 SQL 迁移
- 或者通过应用启动时的自动创建逻辑（如果实现了）

---

## 🔍 验证更新是否成功

### 检查容器状态
```bash
docker compose ps
# 所有容器应该显示 "Up" 和 "healthy"
```

### 检查应用日志
```bash
docker compose logs app --tail 50
# 应该看到应用正常启动，没有错误
```

### 检查前端文件
```bash
docker compose exec nginx ls -lh /usr/share/nginx/html/ | head -10
docker compose exec nginx stat -c%s /usr/share/nginx/html/index.html
# index.html 应该大于 1KB
```

### 测试访问
1. 清除浏览器缓存（Ctrl+Shift+Delete）
2. 硬刷新页面（Ctrl+F5）
3. 打开开发者工具 Network 标签，检查资源是否都返回 200

---

## ⚠️ 常见问题

### Q: 前端更新后页面还是旧的？
A: 
1. 检查文件是否已复制到 volume
2. 清除浏览器缓存
3. 检查 nginx 是否已重启

### Q: 后端更新后接口还是旧的？
A: 
1. 检查容器是否已重启
2. 查看应用日志确认代码已加载
3. 检查 server 目录是否正确挂载

### Q: 如何查看详细错误？
A:
```bash
# 查看应用日志
docker compose logs app --tail 100

# 查看 nginx 日志
docker compose logs nginx --tail 50

# 查看所有服务日志
docker compose logs --tail 50
```
