# 容器部署更新操作指南

## 更新步骤

### 方法一：使用脚本（推荐）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 给脚本添加执行权限（首次使用）
chmod +x deploy/update-deployment.sh

# 3. 执行更新脚本
./deploy/update-deployment.sh
```

### 方法二：手动操作

#### 步骤1：重新构建前端（如果前端代码有更改）

```bash
cd /opt/newsapp/news/client
npm run build
cd ..
```

#### 步骤2：重启应用容器

```bash
cd /opt/newsapp/news

# 重启应用容器（server目录已挂载为volume，代码会自动同步）
sudo docker compose restart app

# 或者完全重启（如果遇到问题）
sudo docker compose down
sudo docker compose up -d
```

#### 步骤3：检查容器状态

```bash
# 查看容器状态
sudo docker compose ps

# 查看应用日志
sudo docker compose logs -f app
```

#### 步骤4：验证数据库表已创建

```bash
# 检查 news_sync_execution_log 表是否已创建
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "SHOW TABLES LIKE 'news_sync_execution_log';"

# 查看表结构
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "DESC news_sync_execution_log;"
```

## 重要说明

### 1. 代码同步方式

- **后端代码（server目录）**：已挂载为volume (`./server:/app/server`)，代码更改会**自动同步**到容器，只需重启容器即可
- **前端代码（client目录）**：需要重新构建，构建后的文件会复制到容器中

### 2. 数据库表自动创建

数据库表 `news_sync_execution_log` 会在应用启动时自动创建（通过 `server/db.js` 中的 `CREATE TABLE IF NOT EXISTS`）。

### 3. 如果遇到问题

```bash
# 查看详细日志
sudo docker compose logs app --tail 100

# 查看错误日志
sudo docker compose logs app | grep -i error

# 重启所有服务
sudo docker compose restart

# 完全重建（谨慎使用，会重新构建镜像）
sudo docker compose up -d --build
```

## 验证更新是否成功

1. **检查容器运行状态**
   ```bash
   sudo docker compose ps
   ```
   应该看到所有容器状态为 `Up` 和 `healthy`

2. **检查应用日志**
   ```bash
   sudo docker compose logs app | grep "数据库初始化完成"
   ```
   应该看到数据库初始化成功的消息

3. **测试功能**
   - 访问定时任务管理页面
   - 切换到"新闻接口同步"标签
   - 点击任意配置的"日志"按钮
   - 应该能看到日志查看窗口

4. **检查数据库表**
   ```bash
   sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "SELECT COUNT(*) FROM news_sync_execution_log;"
   ```

## ⚠️ 重要：前端更新问题

**问题原因：**
`docker-compose.yml` 中使用了命名 volume `app_frontend:/app/client/dist`，这会覆盖镜像中的前端文件。如果只更新了前端代码但没有重新构建镜像，新代码不会生效。

**解决方案（三选一）：**

### 方案1：重新构建镜像（推荐，最彻底）

```bash
cd /opt/newsapp/news

# 1. 重新构建前端
cd client
npm run build
cd ..

# 2. 重新构建Docker镜像（包含新的前端文件）
sudo docker compose build app

# 3. 重启容器
sudo docker compose up -d app

# 4. 查看日志
sudo docker compose logs -f app
```

### 方案2：使用快速更新脚本（推荐，最简单）

```bash
cd /opt/newsapp/news

# 给脚本添加执行权限（首次使用）
chmod +x deploy/update-frontend-only.sh

# 执行快速更新脚本
./deploy/update-frontend-only.sh
```

### 方案3：手动复制文件到volume

```bash
cd /opt/newsapp/news

# 1. 重新构建前端
cd client
npm run build
cd ..

# 2. 查找volume路径
VOLUME_NAME=$(sudo docker compose config | grep "app_frontend:" | awk '{print $2}' | tr -d ':')
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

# 3. 复制文件到volume
sudo cp -r client/dist/* "$VOLUME_PATH/"

# 4. 重启容器
sudo docker compose restart app
```

## 快速更新命令（仅后端代码更改）

如果只更新了后端代码（server目录），可以使用以下快速命令：

```bash
cd /opt/newsapp/news
sudo docker compose restart app
sudo docker compose logs -f app
```

## 完整更新命令（包含前端）

如果同时更新了前端代码，**必须重新构建镜像**：

```bash
cd /opt/newsapp/news

# 方法1：使用修复脚本（推荐）
chmod +x deploy/fix-frontend-deployment.sh
./deploy/fix-frontend-deployment.sh

# 方法2：手动执行
cd client && npm run build && cd ..
sudo docker compose build app
sudo docker compose up -d app
sudo docker compose logs -f app
```

