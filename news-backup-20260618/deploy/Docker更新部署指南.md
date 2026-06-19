# Docker 环境更新部署指南

## 📋 本次更新涉及的文件

### 数据库变更
- `server/db.js` - 添加了 `qichacha_category_codes` 字段

### 后端代码
- `server/routes/news.js` - 添加了企查查类别相关的API和逻辑
- `server/utils/scheduledEmailTasks.js` - 修改了邮件发送过滤逻辑

### 前端代码
- `client/src/pages/RecipientManagement.jsx` - 添加了企查查类别选择功能

### 文档
- `企查查邮件推送新闻类型说明.md` - 更新了文档
- `邮件发送新闻功能说明.md` - 更新了文档

---

## 🐳 Docker 重新构建和启动指南

### 方式一：完全重建（清除所有缓存）- 推荐

适用于代码或依赖有较大变更时，确保使用最新代码：

```bash
# 进入项目目录
cd /opt/newsapp/news  # 或你的实际项目路径

# 停止并删除所有容器（保留数据卷）
docker compose down

# 重新构建镜像（清除缓存）
docker compose build --no-cache

# 启动所有服务
docker compose up -d
```

### 方式二：仅重新构建（使用缓存）- 更快

适用于代码有少量变更时，构建速度更快：

```bash
cd /opt/newsapp/news
docker compose down
docker compose build
docker compose up -d
```

### 方式三：一步完成重建和启动（最快捷）

```bash
cd /opt/newsapp/news
docker compose up --build -d
```

### 方式四：仅重启应用服务（如果只修改了应用代码）

如果只修改了应用代码，且 server 目录是 volume 挂载的，可以只重建 app 服务：

```bash
cd /opt/newsapp/news

# 只重新构建 app 服务
docker compose build app

# 重启 app 服务
docker compose up -d app
```

### 查看服务状态和日志

```bash
# 查看服务状态
docker compose ps

# 查看应用日志
docker compose logs -f app

# 查看所有服务日志
docker compose logs -f

# 查看最近50行日志
docker compose logs app --tail 50
```

### 注意事项

1. **确保 Docker Desktop 已启动**（Windows/Mac）或 Docker 服务已运行（Linux）
2. **完全重建（`--no-cache`）**会清除所有缓存，构建时间更长，但更彻底
3. **使用 `-d` 参数**后台运行服务
4. **如果数据库服务（mysql）已运行正常**，方式四可以只重建 app，避免重启数据库
5. **PowerShell 环境**：在 Windows PowerShell 中，需要分步执行命令（不支持 `&&`）

---

## 🐳 Docker 部署更新步骤

### 步骤1：确认文件已更新到服务器

```bash
# 进入项目目录（根据你的实际路径调整）
cd /opt/newsapp/news  # 或你的实际项目路径

# 确认关键文件已更新
ls -la server/db.js
ls -la server/routes/news.js
ls -la server/utils/scheduledEmailTasks.js
ls -la client/src/pages/RecipientManagement.jsx
```

### 步骤2：重新构建前端（必须）

```bash
# 进入前端目录
cd client

# 安装依赖（如果package.json有变化）
npm install

# 重新构建前端
npm run build

# 返回项目根目录
cd ..
```

### 步骤3：更新前端文件到 Docker Volume

有两种方法：

#### 方法A：使用自动脚本（推荐）

```bash
# 确保脚本有执行权限
chmod +x deploy/clear-cache-and-update.sh

# 执行更新脚本
./deploy/clear-cache-and-update.sh
```

#### 方法B：手动更新

```bash
# 查找前端volume路径
VOLUME_PATH=$(sudo docker volume inspect news_app_frontend 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

# 如果找不到，尝试使用docker-compose的volume名称
if [ -z "$VOLUME_PATH" ]; then
  VOLUME_PATH=$(sudo docker volume inspect newsapp_app_frontend 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
fi

# 如果还是找不到，使用临时容器方式（推荐）
sudo docker run --rm \
  -v newsapp_app_frontend:/target \
  -v $(pwd)/client/dist:/source \
  alpine sh -c "rm -rf /target/* && cp -r /source/* /target/"
```

### 步骤4：重启服务

```bash
# 方式1：只重启应用容器（后端代码会自动生效，因为server目录是volume挂载）
sudo docker compose restart app

# 方式2：重启所有服务（如果nginx配置有变化）
sudo docker compose restart

# 或者使用docker-compose down/up（完全重启）
sudo docker compose down
sudo docker compose up -d
```

### 步骤5：等待数据库迁移完成

由于本次更新添加了新的数据库字段，系统启动时会自动执行数据库迁移：

```bash
# 查看应用日志，确认数据库迁移是否成功
sudo docker compose logs app --tail 100 | grep -i "qichacha_category_codes\|已添加\|migration\|migrate"

# 应该看到类似以下信息：
# ✓ 已添加 recipient_management 表的 qichacha_category_codes 字段
```

### 步骤6：验证部署

```bash
# 1. 检查容器状态
sudo docker compose ps

# 2. 查看应用日志（确认没有错误）
sudo docker compose logs app --tail 50

# 3. 查看nginx日志（如果有问题）
sudo docker compose logs nginx --tail 50

# 4. 测试API接口
curl http://localhost:3001/api/health

# 5. 测试企查查类别API（新功能）
curl http://localhost:3001/api/news/qichacha-categories

# 6. 检查数据库字段是否已添加
sudo docker compose exec mysql mysql -u newsapp -p${DB_PASSWORD:-NewsApp@2024} investment_tools -e "DESCRIBE recipient_management;" | grep qichacha_category_codes
```

---

## 🚀 快速部署命令（一键执行）

### 完整更新流程（推荐）

```bash
cd /opt/newsapp/news && \
cd client && npm run build && cd .. && \
chmod +x deploy/clear-cache-and-update.sh && \
./deploy/clear-cache-and-update.sh && \
sudo docker compose restart app && \
sleep 5 && \
sudo docker compose logs app --tail 50
```

### 仅更新后端代码（如果只修改了后端）

```bash
cd /opt/newsapp/news && \
sudo docker compose restart app && \
sudo docker compose logs app --tail 50
```

### 仅更新前端代码（如果只修改了前端）

```bash
cd /opt/newsapp/news && \
cd client && npm run build && cd .. && \
chmod +x deploy/clear-cache-and-update.sh && \
./deploy/clear-cache-and-update.sh && \
sudo docker compose restart nginx
```

---

## ⚠️ 重要注意事项

### 1. 数据库迁移

- 本次更新添加了 `qichacha_category_codes` 字段
- 系统启动时会自动检测并添加该字段
- 现有收件管理记录的该字段为 NULL，表示使用默认类别
- **无需手动初始化数据**，系统会自动处理

### 2. 前端缓存问题

更新前端后，用户浏览器可能缓存了旧文件：

- **在浏览器中清除缓存**：按 `Ctrl+Shift+Delete` 清除缓存
- **强制刷新**：按 `Ctrl+F5` 强制刷新页面
- **或在开发者工具中**：右键刷新按钮，选择"清空缓存并硬性重新加载"

### 3. 检查文件修改时间

确认文件确实已更新：

```bash
# 查看文件修改时间
stat server/db.js
stat server/routes/news.js
stat client/src/pages/RecipientManagement.jsx
```

### 4. Volume 挂载说明

根据 `docker-compose.yml`：

- **server目录**：直接挂载，修改后重启容器即可生效
- **client/dist目录**：通过volume挂载，需要重新构建并复制到volume
- **uploads和logs目录**：直接挂载，数据持久化

---

## 🔍 故障排查

### 问题1：前端更新后看不到变化

**解决方法：**
```bash
# 1. 确认前端已重新构建
ls -lht client/dist/ | head -5

# 2. 确认文件已复制到volume
sudo docker run --rm -v newsapp_app_frontend:/target alpine ls -la /target | head -10

# 3. 清除浏览器缓存
# 在浏览器中按 Ctrl+Shift+Delete

# 4. 重启nginx容器
sudo docker compose restart nginx
```

### 问题2：数据库字段未添加

**解决方法：**
```bash
# 1. 查看应用日志，确认迁移是否执行
sudo docker compose logs app | grep -i "qichacha_category_codes"

# 2. 手动检查数据库
sudo docker compose exec mysql mysql -u newsapp -p investment_tools -e "DESCRIBE recipient_management;"

# 3. 如果字段不存在，手动添加（不推荐，应该让系统自动处理）
sudo docker compose exec mysql mysql -u newsapp -p investment_tools -e "ALTER TABLE recipient_management ADD COLUMN qichacha_category_codes JSON COMMENT '企查查新闻类别编码列表（JSON数组），为空时使用默认类别';"
```

### 问题3：应用无法启动

**解决方法：**
```bash
# 1. 查看详细错误日志
sudo docker compose logs app --tail 100

# 2. 检查代码语法
sudo docker compose exec app node -c /app/server/routes/news.js

# 3. 检查数据库连接
sudo docker compose exec app node -e "const db = require('./server/db'); db.query('SELECT 1').then(() => console.log('OK')).catch(e => console.error(e));"

# 4. 重启容器
sudo docker compose restart app
```

### 问题4：API接口返回错误

**解决方法：**
```bash
# 1. 测试健康检查接口
curl http://localhost:3001/api/health

# 2. 测试企查查类别API
curl http://localhost:3001/api/news/qichacha-categories

# 3. 查看应用日志
sudo docker compose logs app --tail 50 | grep -i "error\|fail"

# 4. 检查容器状态
sudo docker compose ps
```

---

## ✅ 部署验证清单

部署完成后，请确认：

- [ ] 前端文件已重新构建（`client/dist` 目录已更新）
- [ ] 前端文件已复制到 Docker volume
- [ ] 后端代码文件已更新到服务器
- [ ] 应用容器已成功重启（状态为 `running`）
- [ ] 数据库字段已自动添加（`qichacha_category_codes`）
- [ ] 日志中没有错误信息
- [ ] API接口可以正常访问（`/api/health` 返回200）
- [ ] 企查查类别API可以正常访问（`/api/news/qichacha-categories`）
- [ ] 前端页面可以正常访问
- [ ] 收件管理编辑页面可以打开类别选择弹窗
- [ ] 类别选择功能可以正常工作

---

## 📝 验证新功能

### 1. 测试类别选择功能

1. 登录系统
2. 进入"邮件管理" → "收件管理"
3. 点击"编辑"按钮
4. 点击"选择消息类型"按钮
5. 确认弹窗可以正常显示所有类别
6. 选择几个类别，点击"确定"
7. 保存收件配置
8. 确认配置已保存

### 2. 测试API接口

```bash
# 测试获取类别映射API
curl http://localhost:3001/api/news/qichacha-categories

# 应该返回JSON格式的类别映射数据
```

### 3. 检查数据库

```bash
# 检查字段是否存在
sudo docker compose exec mysql mysql -u newsapp -p investment_tools -e "DESCRIBE recipient_management;" | grep qichacha

# 查看现有记录的字段值（应该为NULL）
sudo docker compose exec mysql mysql -u newsapp -p investment_tools -e "SELECT id, qichacha_category_codes FROM recipient_management LIMIT 5;"
```

---

## 🆘 需要帮助？

如果遇到问题：

1. **查看日志**：
   ```bash
   sudo docker compose logs app --tail 100
   sudo docker compose logs nginx --tail 50
   ```

2. **检查状态**：
   ```bash
   sudo docker compose ps
   ```

3. **检查容器健康状态**：
   ```bash
   sudo docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}"
   ```

4. **参考文档**：
   - `deploy/README.md`
   - `deploy/文件更新后部署操作指南.md`
   - `deploy/代码更新部署指南.md`

---

**更新时间**：2024-12-XX  
**适用环境**：Docker Compose 部署  
**功能状态**：✅ 已完成

