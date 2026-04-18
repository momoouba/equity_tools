# Docker 环境更新重试功能操作指南

## 📋 更新内容

本次更新涉及以下文件：
- ✅ 后端代码：`server/db.js`、`server/routes/system.js`、`server/routes/scheduledTasks.js`、`server/routes/news.js`
- ✅ 前端代码：`client/src/pages/ScheduledTaskManagement.jsx`

## 🚀 更新步骤（Ubuntu + Docker）

### 方法一：完整更新（推荐，确保所有更改生效）

```bash
# 1. 进入项目目录（根据您的实际路径调整）
cd /opt/newsapp/news
# 或者
cd /path/to/equity_news/news

# 2. 重新构建前端
cd client
npm run build
cd ..

# 3. 重新构建 Docker 镜像（包含新的前端文件）
sudo docker compose build app

# 4. 重启应用容器（数据库迁移会自动执行）
sudo docker compose up -d app

# 5. 查看日志，确认更新成功
sudo docker compose logs -f app
```

**预期日志输出：**
```
✓ 数据库连接已就绪
正在初始化数据库...
✓ 服务器运行在 http://localhost:3001
```

### 方法二：快速更新（如果前端更新脚本可用）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 给脚本添加执行权限（首次使用）
chmod +x deploy/update-frontend-only.sh

# 3. 执行快速更新脚本（会自动构建前端并更新）
./deploy/update-frontend-only.sh

# 4. 重启应用容器
sudo docker compose restart app

# 5. 查看日志
sudo docker compose logs -f app
```

### 方法三：仅后端更新（如果前端没有更改，但本次前端有更改，不适用）

**注意：本次更新包含前端代码，必须使用方法一或方法二！**

如果将来只更新后端代码，可以使用：

```bash
# 后端代码已挂载为 volume，只需重启容器
sudo docker compose restart app
sudo docker compose logs -f app
```

## ✅ 验证更新是否成功

### 1. 检查容器状态

```bash
sudo docker compose ps
```

应该看到 `newsapp` 容器状态为 `Up` 和 `healthy`。

### 2. 检查数据库字段

```bash
# 连接到 MySQL 容器，检查字段是否已添加
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "DESCRIBE news_interface_config;"
```

应该能看到 `retry_count` 和 `retry_interval` 两个字段。

或者使用更详细的查询：

```bash
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT, COLUMN_COMMENT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'investment_tools' AND TABLE_NAME = 'news_interface_config' AND COLUMN_NAME IN ('retry_count', 'retry_interval');"
```

### 3. 检查应用日志

```bash
# 查看最近的日志
sudo docker compose logs app --tail 100

# 查看是否有数据库迁移相关的日志
sudo docker compose logs app | grep -i "retry"
```

### 4. 测试前端功能

1. 在浏览器中访问应用
2. 清除浏览器缓存（Ctrl+F5 或 Cmd+Shift+R）
3. 登录系统，进入"定时任务管理"
4. 切换到"新闻接口同步"标签页
5. 点击"编辑"或"新增"按钮
6. **确认表单中出现了以下两个字段：**
   - "重新抓取次数" 输入框
   - "重新抓取间隔（分钟）" 输入框

## 🔍 故障排除

### 问题1：前端看不到新字段

**原因：** 前端文件没有正确更新到容器中。

**解决方案：**
```bash
# 方法1：删除 volume 并重新构建（推荐）
sudo docker compose down
sudo docker volume rm news_app_frontend 2>/dev/null || true
sudo docker compose build app
sudo docker compose up -d

# 方法2：手动复制文件到 volume
cd /opt/newsapp/news
cd client && npm run build && cd ..
VOLUME_NAME="news_app_frontend"
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
sudo cp -r client/dist/* "$VOLUME_PATH/"
sudo docker compose restart app
```

### 问题2：数据库字段未添加

**原因：** 数据库迁移未执行或执行失败。

**解决方案：**
```bash
# 1. 查看详细错误日志
sudo docker compose logs app | grep -i "error\|warn" | tail -50

# 2. 手动执行 SQL 添加字段
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools << EOF
ALTER TABLE news_interface_config 
ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0 COMMENT '未获取数据时的重新抓取次数，0表示不重试';

ALTER TABLE news_interface_config 
ADD COLUMN IF NOT EXISTS retry_interval INT DEFAULT 0 COMMENT '重新抓取间隔（单位：分钟）';
EOF

# 3. 验证字段已添加
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "DESCRIBE news_interface_config;"
```

### 问题3：容器启动失败

**解决方案：**
```bash
# 1. 查看详细错误日志
sudo docker compose logs app --tail 200

# 2. 检查数据库连接
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 -e "SELECT 1;"

# 3. 重启所有服务
sudo docker compose restart

# 4. 如果还是失败，完全重建
sudo docker compose down
sudo docker compose up -d --build
```

### 问题4：重试功能不工作

**检查清单：**
1. ✅ 确认 `retry_count > 0` 且 `retry_interval > 0`
2. ✅ 确认任务状态为"启用"
3. ✅ 确认是定时任务触发（手动触发不会重试）
4. ✅ 查看服务器日志，确认是否有错误信息

```bash
# 查看重试相关日志
sudo docker compose logs app | grep -i "重试\|retry" | tail -50
```

## 📝 重要说明

1. **后端代码自动同步**：`server` 目录已挂载为 volume，代码更改会自动同步到容器，但需要重启容器才能生效。

2. **前端代码需要重新构建**：前端文件在 Docker 镜像构建时被复制，并且使用了命名 volume，所以必须重新构建镜像或手动更新 volume。

3. **数据库迁移自动执行**：服务器启动时会自动检查并添加字段，无需手动执行 SQL。

4. **容器重启不会丢失数据**：数据库数据存储在 Docker volume 中，重启容器不会丢失数据。

## 🎯 快速参考命令

```bash
# 完整更新（推荐）
cd /opt/newsapp/news && \
cd client && npm run build && cd .. && \
sudo docker compose build app && \
sudo docker compose up -d app && \
sudo docker compose logs -f app

# 仅检查状态
sudo docker compose ps
sudo docker compose logs app --tail 50

# 检查数据库字段
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "DESCRIBE news_interface_config;"
```

## 📞 需要帮助？

如果遇到问题，请提供以下信息：
- 容器状态：`sudo docker compose ps`
- 应用日志：`sudo docker compose logs app --tail 100`
- 数据库字段检查结果：`sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "DESCRIBE news_interface_config;"`

