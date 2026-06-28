# 生产环境 Docker 更新指南

## 📋 本次更新内容

### 前端更新
- ✅ `client/src/pages/ShareNewsPage.jsx` - 添加复选框和按钮功能
- ✅ `client/src/pages/ShareNewsPage.css` - 添加复选框和按钮样式

### 后端更新
- ✅ `server/routes/newsAnalysis.js` - 添加批量清理无效关联接口

---

## 🚀 更新步骤（推荐方法）

### 方法一：使用快速更新脚本（最快，推荐）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news
# 或者你的实际项目路径

# 2. 给脚本添加执行权限（首次使用）
chmod +x deploy/update-frontend-only.sh

# 3. 执行快速更新脚本（只更新前端）
sudo ./deploy/update-frontend-only.sh

# 4. 重启应用容器（使后端代码生效，因为 server 目录已挂载为 volume）
sudo docker compose restart app

# 5. 查看日志确认启动成功
sudo docker compose logs -f app
```

**说明：**
- 前端代码需要重新构建并复制到 volume
- 后端代码（`server/` 目录）已挂载为 volume，只需重启容器即可生效

---

### 方法二：完全重新构建（最彻底，适合生产环境）

```bash
# 1. 进入项目目录
cd /opt/newsapp/news

# 2. 重新构建前端
cd client
npm run build
cd ..

# 3. 重新构建 Docker 镜像（包含新的前端文件）
sudo docker compose build app

# 4. 重启容器
sudo docker compose up -d app

# 5. 查看日志确认启动成功
sudo docker compose logs -f app
```

---

## 📝 详细操作步骤

### 步骤 1：确认文件已更新

在本地或服务器上，确认以下文件已保存：

**前端文件：**
- ✅ `client/src/pages/ShareNewsPage.jsx`
- ✅ `client/src/pages/ShareNewsPage.css`

**后端文件：**
- ✅ `server/routes/newsAnalysis.js`

### 步骤 2：上传文件到服务器（如果使用 Git）

```bash
# 如果使用 Git，在本地提交并推送
git add .
git commit -m "添加 ShareNewsPage 复选框和按钮功能"
git push

# 在服务器上拉取最新代码
cd /opt/newsapp/news
git pull
```

### 步骤 3：更新 Docker 容器

**选项 A：快速更新（推荐）**

```bash
cd /opt/newsapp/news

# 更新前端
chmod +x deploy/update-frontend-only.sh
sudo ./deploy/update-frontend-only.sh

# 重启后端（使后端代码生效）
sudo docker compose restart app
```

**选项 B：完全重新构建**

```bash
cd /opt/newsapp/news

# 重新构建前端
cd client
npm run build
cd ..

# 重新构建镜像
sudo docker compose build app

# 重启容器
sudo docker compose up -d app
```

### 步骤 4：验证更新

```bash
# 1. 检查容器状态
sudo docker compose ps
# 应该看到所有容器状态为 "Up" 和 "healthy"

# 2. 查看应用日志
sudo docker compose logs app --tail 50
# 应该看到应用正常启动，没有错误

# 3. 检查前端文件是否更新
sudo docker compose exec app ls -la /app/client/dist
# 应该看到最新的构建文件

# 4. 测试后端接口（可选）
curl http://localhost:3001/api/news-analysis/test
# 应该返回成功响应
```

### 步骤 5：清除浏览器缓存

在浏览器中访问分享页面：
1. 按 `F12` 打开开发者工具
2. 右键点击刷新按钮
3. 选择 **"清空缓存并硬性重新加载"**

或者使用快捷键：
- Windows/Linux: `Ctrl + Shift + R`
- Mac: `Cmd + Shift + R`

---

## ✅ 验证功能是否正常

### 1. 检查页面元素

访问分享页面：`http://your-domain/share/your-token`

应该能看到：
- ✅ 表格第一列有复选框
- ✅ 表头有全选复选框
- ✅ 四个操作按钮：导出、清理无效关联、刷新、AI重新分析
- ✅ 按钮位置在时间范围 Tab 和企业相关/全部过滤按钮之间

### 2. 测试复选框功能

- ✅ 点击表头复选框应该能全选/取消全选当前页
- ✅ 点击行首复选框应该能选择/取消选择单条新闻
- ✅ 选择数据后，`AI重新分析` 和 `清理无效关联` 按钮应该启用并显示选中数量

### 3. 测试按钮功能

- ✅ 点击"导出"按钮应该能导出 Excel 文件
- ✅ 选择数据后点击"清理无效关联"应该能清理选中的数据
- ✅ 选择数据后点击"AI重新分析"应该能分析选中的数据
- ✅ 点击"刷新"按钮应该能刷新数据

### 4. 检查控制台

按 `F12` 打开开发者工具，查看 Console：
- ✅ 不应该有错误信息
- ✅ 应该看到版本信息：`[ShareNewsPage] 版本: 2.0.0-simplified`

---

## ⚠️ 注意事项

### 1. 后端代码自动同步

由于 `docker-compose.yml` 中 `server/` 目录已挂载为 volume：
```yaml
volumes:
  - ./server:/app/server
```

所以后端代码修改后，**只需重启容器即可生效**，无需重新构建镜像。

### 2. 前端代码需要重新构建

前端代码（`client/` 目录）需要：
1. 运行 `npm run build` 构建
2. 将构建后的文件（`client/dist/`）复制到 Docker volume 或重新构建镜像

### 3. 权限问题

如果遇到权限问题：
```bash
# 确保脚本有执行权限
chmod +x deploy/update-frontend-only.sh

# 确保有 sudo 权限
sudo docker compose ...
```

### 4. 备份数据（重要）

在生产环境更新前，建议：
```bash
# 备份数据库
sudo docker compose exec mysql mysqldump -u newsapp -p investment_tools > backup_$(date +%Y%m%d_%H%M%S).sql

# 或者备份整个数据卷
sudo docker run --rm -v news_mysql_data:/data -v $(pwd):/backup alpine tar czf /backup/mysql_backup_$(date +%Y%m%d_%H%M%S).tar.gz /data
```

---

## 🔧 故障排除

### 问题 1：更新后看不到新按钮

**解决方案：**
```bash
# 1. 清除浏览器缓存（硬刷新：Ctrl + Shift + R）
# 2. 检查容器日志
sudo docker compose logs app

# 3. 确认前端文件已更新
sudo docker compose exec app ls -la /app/client/dist

# 4. 如果文件未更新，重新执行更新脚本
sudo ./deploy/update-frontend-only.sh
```

### 问题 2：后端接口报错

**解决方案：**
```bash
# 1. 检查后端代码是否正确上传
ls -la server/routes/newsAnalysis.js

# 2. 重启容器使后端代码生效
sudo docker compose restart app

# 3. 查看日志
sudo docker compose logs app --tail 100
```

### 问题 3：容器启动失败

**解决方案：**
```bash
# 1. 查看详细错误日志
sudo docker compose logs app

# 2. 检查容器状态
sudo docker compose ps

# 3. 检查配置文件
sudo docker compose config

# 4. 重启所有服务
sudo docker compose restart
```

### 问题 4：复选框功能不工作

**解决方案：**
```bash
# 1. 清除浏览器缓存
# 2. 检查控制台是否有 JavaScript 错误
# 3. 确认前端文件已正确更新
sudo docker compose exec app cat /app/client/dist/assets/*.js | grep handleSelectAll
```

---

## 📞 快速命令参考

```bash
# 快速更新前端
cd /opt/newsapp/news
sudo ./deploy/update-frontend-only.sh
sudo docker compose restart app

# 完全重新构建
cd /opt/newsapp/news
cd client && npm run build && cd ..
sudo docker compose build app
sudo docker compose up -d app

# 查看日志
sudo docker compose logs -f app

# 查看容器状态
sudo docker compose ps

# 重启服务
sudo docker compose restart app

# 检查前端文件
sudo docker compose exec app ls -la /app/client/dist

# 检查后端文件
sudo docker compose exec app ls -la /app/server/routes/newsAnalysis.js
```

---

## 🎯 更新检查清单

- [ ] 确认所有文件已保存并上传到服务器
- [ ] 执行前端更新脚本或重新构建
- [ ] 重启应用容器
- [ ] 检查容器状态（所有容器应为 "Up" 和 "healthy"）
- [ ] 查看应用日志（无错误信息）
- [ ] 访问分享页面验证功能
- [ ] 清除浏览器缓存
- [ ] 测试复选框功能
- [ ] 测试按钮功能
- [ ] 检查控制台无错误

---

**更新完成后，请清除浏览器缓存并测试所有功能！**
