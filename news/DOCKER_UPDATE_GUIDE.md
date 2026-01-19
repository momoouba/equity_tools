# Docker 环境前端更新指南

## 🚀 快速更新（推荐）

如果你修改了前端代码（如 `ShareNewsPage.jsx` 和 `ShareNewsPage.css`），使用以下命令快速更新：

```bash
# 1. 进入项目目录
cd /opt/newsapp/news
# 或者你的实际项目路径
cd E:\USER\SUREAL\Desktop\equity_news\news

# 2. 给脚本添加执行权限（首次使用）
chmod +x deploy/update-frontend-only.sh

# 3. 执行快速更新脚本
sudo ./deploy/update-frontend-only.sh
```

这个脚本会：
- ✅ 自动重新构建前端代码
- ✅ 将构建后的文件复制到 Docker volume
- ✅ 重启应用容器
- ✅ 无需重新构建整个 Docker 镜像（节省时间）

---

## 🔨 方法二：重新构建 Docker 镜像（最彻底）

如果需要完全重新构建（推荐用于生产环境）：

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 重新构建前端
cd client
npm run build
cd ..

# 3. 重新构建 Docker 镜像
sudo docker compose build app

# 4. 重启容器
sudo docker compose up -d app

# 5. 查看日志确认启动成功
sudo docker compose logs -f app
```

---

## ⚡ 方法三：手动操作（适合调试）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 重新构建前端
cd client
npm run build
cd ..

# 3. 查找 volume 路径
VOLUME_NAME=$(sudo docker compose config | grep "app_frontend:" | awk '{print $2}' | tr -d ':')
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

# 4. 复制文件到 volume
sudo cp -r client/dist/* "$VOLUME_PATH/"

# 5. 重启容器
sudo docker compose restart app
```

---

## 📋 完整操作步骤（针对本次 ShareNewsPage 更新）

### 步骤 1：确认文件已保存
确保以下文件已保存：
- ✅ `client/src/pages/ShareNewsPage.jsx`
- ✅ `client/src/pages/ShareNewsPage.css`

### 步骤 2：执行更新

**在服务器上执行：**

```bash
# 进入项目目录
cd /opt/newsapp/news

# 使用快速更新脚本
chmod +x deploy/update-frontend-only.sh
sudo ./deploy/update-frontend-only.sh
```

### 步骤 3：验证更新

```bash
# 查看容器状态
sudo docker compose ps

# 查看应用日志
sudo docker compose logs app --tail 50

# 检查前端文件是否更新
sudo docker compose exec app ls -la /app/client/dist
```

### 步骤 4：清除浏览器缓存

在浏览器中：
1. 按 `F12` 打开开发者工具
2. 右键点击刷新按钮
3. 选择 **"清空缓存并硬性重新加载"**

或者：
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

---

## 🔍 验证更新是否成功

1. **访问分享页面**
   - 打开浏览器访问：`http://your-domain/share/your-token`
   - 或：`http://localhost/share/your-token`

2. **检查按钮是否显示**
   - 应该能看到四个按钮：导出、清理无效关联、刷新、AI重新分析
   - 按钮位置：在时间范围 Tab 和企业相关/全部过滤按钮之间

3. **检查控制台**
   - 按 `F12` 打开开发者工具
   - 查看 Console 是否有错误

---

## ⚠️ 常见问题

### Q: 更新后看不到新按钮？
**A:** 
1. 清除浏览器缓存（硬刷新：`Ctrl + Shift + R`）
2. 检查容器日志：`sudo docker compose logs app`
3. 确认前端文件已更新：`sudo docker compose exec app ls -la /app/client/dist`

### Q: 更新脚本执行失败？
**A:**
1. 检查是否在项目根目录执行
2. 检查是否有 sudo 权限
3. 手动执行构建步骤：
   ```bash
   cd client
   npm run build
   cd ..
   sudo docker compose build app
   sudo docker compose up -d app
   ```

### Q: 容器启动失败？
**A:**
```bash
# 查看详细错误日志
sudo docker compose logs app

# 检查容器状态
sudo docker compose ps

# 重启所有服务
sudo docker compose restart
```

---

## 📝 注意事项

1. **后端代码更新**：如果只修改了 `server/` 目录下的代码，只需重启容器：
   ```bash
   sudo docker compose restart app
   ```
   因为 `server/` 目录已挂载为 volume，代码会自动同步。

2. **前端代码更新**：必须重新构建前端并更新到容器中。

3. **数据库更改**：数据库表结构更改会在应用启动时自动执行（通过 `server/db.js`）。

4. **生产环境**：建议在更新前备份数据，并在测试环境验证后再部署到生产环境。

---

## 🎯 快速命令参考

```bash
# 仅更新前端（最快）
sudo ./deploy/update-frontend-only.sh

# 仅重启后端（后端代码已挂载）
sudo docker compose restart app

# 完全重新构建（包含前端）
cd client && npm run build && cd ..
sudo docker compose build app
sudo docker compose up -d app

# 查看日志
sudo docker compose logs -f app

# 查看容器状态
sudo docker compose ps
```
