# FinalShell 文件上传清单

## 📋 本次更新需要替换的文件

### 方法1：只上传修改的文件（推荐，需要重新构建）

上传以下文件到服务器的对应位置：

```
news/
└── client/
    ├── src/
    │   ├── pages/
    │   │   └── ShareNewsPage.jsx          ← 主要修改文件
    │   ├── utils/
    │   │   └── axios.js                    ← 移除调试日志
    │   ├── App.jsx                         ← 移除调试日志
    │   └── main.jsx                        ← 移除调试日志
    └── vite.config.js                      ← 移除代理日志
```

**服务器路径示例：**
- `/opt/newsapp/news/client/src/pages/ShareNewsPage.jsx`
- `/opt/newsapp/news/client/src/utils/axios.js`
- `/opt/newsapp/news/client/src/App.jsx`
- `/opt/newsapp/news/client/src/main.jsx`
- `/opt/newsapp/news/client/vite.config.js`

**上传后需要执行：**
```bash
# 重新构建 Docker 镜像
cd /opt/newsapp/news
docker compose build --no-cache app
docker compose restart app
```

### 方法2：上传整个 client 目录（如果路径不确定）

如果不确定文件路径，可以上传整个 `client` 目录：

```
news/
└── client/  ← 上传整个目录
```

**上传后需要执行：**
```bash
# 重新构建 Docker 镜像
cd /opt/newsapp/news
docker compose build --no-cache app
docker compose restart app
```

## 📝 详细文件列表

### 1. ShareNewsPage.jsx（最重要）
- **本地路径：** `news/client/src/pages/ShareNewsPage.jsx`
- **服务器路径：** `news/client/src/pages/ShareNewsPage.jsx`
- **修改内容：** 移除所有循环逻辑（MutationObserver、setInterval等）

### 2. axios.js
- **本地路径：** `news/client/src/utils/axios.js`
- **服务器路径：** `news/client/src/utils/axios.js`
- **修改内容：** 移除所有调试日志

### 3. App.jsx
- **本地路径：** `news/client/src/App.jsx`
- **服务器路径：** `news/client/src/App.jsx`
- **修改内容：** 移除调试日志

### 4. main.jsx
- **本地路径：** `news/client/src/main.jsx`
- **服务器路径：** `news/client/src/main.jsx`
- **修改内容：** 移除调试日志

### 5. vite.config.js
- **本地路径：** `news/client/vite.config.js`
- **服务器路径：** `news/client/vite.config.js`
- **修改内容：** 移除代理日志

## 🚀 FinalShell 上传步骤

### 步骤1：连接到服务器
1. 打开 FinalShell
2. 连接到你的服务器

### 步骤2：定位服务器目录
```bash
# 在 FinalShell 终端中执行
cd /opt/newsapp/news  # 或你的实际项目路径
pwd  # 确认当前路径
```

### 步骤3：上传文件

**方式A：逐个上传（推荐）**
1. 在 FinalShell 文件管理器中，导航到服务器项目目录
2. 上传以下文件：
   - `client/src/pages/ShareNewsPage.jsx`
   - `client/src/utils/axios.js`
   - `client/src/App.jsx`
   - `client/src/main.jsx`
   - `client/vite.config.js`

**方式B：上传整个 client 目录**
1. 在 FinalShell 文件管理器中，导航到服务器项目目录
2. 上传整个 `client` 目录（会覆盖现有文件）

### 步骤4：验证文件已上传
```bash
# 检查文件是否存在
ls -la client/src/pages/ShareNewsPage.jsx
ls -la client/src/utils/axios.js
ls -la client/src/App.jsx
ls -la client/src/main.jsx
ls -la client/vite.config.js

# 检查文件内容（确认版本信息）
grep -n "2.0.0-simplified" client/src/pages/ShareNewsPage.jsx
```

### 步骤5：重新构建和重启

```bash
# 进入项目目录
cd /opt/newsapp/news  # 或你的实际路径

# 停止容器
docker compose down

# 重新构建镜像（不使用缓存）
docker compose build --no-cache app

# 启动容器
docker compose up -d

# 查看日志确认启动成功
docker compose logs -f app
```

## ⚡ 快速更新脚本（可选）

如果经常需要更新，可以创建一个脚本：

```bash
# 创建更新脚本
cat > /opt/newsapp/news/update-frontend.sh << 'EOF'
#!/bin/bash
cd /opt/newsapp/news
echo "停止容器..."
docker compose down
echo "重新构建镜像..."
docker compose build --no-cache app
echo "启动容器..."
docker compose up -d
echo "查看日志..."
docker compose logs -f app --tail 50
EOF

# 赋予执行权限
chmod +x /opt/newsapp/news/update-frontend.sh

# 使用脚本
/opt/newsapp/news/update-frontend.sh
```

## ✅ 验证更新成功

1. **检查容器状态**
   ```bash
   docker compose ps
   ```

2. **访问分享页面**
   - 打开浏览器访问：`http://your-domain/share/your-token`
   - 按 F12 打开开发者工具
   - 查看控制台，应该看到：
     ```
     ═══════════════════════════════════════════════════════
     [ShareNewsPage] 版本: 2.0.0-simplified
     已移除所有循环逻辑（MutationObserver、setInterval等）
     ═══════════════════════════════════════════════════════
     ```
   - **不应该**看到循环日志

3. **检查应用日志**
   ```bash
   docker compose logs app --tail 100
   ```

## ⚠️ 注意事项

1. **备份原文件**（可选但推荐）
   ```bash
   # 备份原文件
   cp client/src/pages/ShareNewsPage.jsx client/src/pages/ShareNewsPage.jsx.bak
   ```

2. **文件权限**
   - 确保上传的文件权限正确
   - 如果权限不对，执行：`chmod 644 client/src/pages/ShareNewsPage.jsx`

3. **路径确认**
   - 确认服务器上的项目路径
   - 如果不确定，执行：`find / -name "ShareNewsPage.jsx" 2>/dev/null`

4. **构建时间**
   - 重新构建 Docker 镜像可能需要几分钟
   - 请耐心等待构建完成

## 🔄 如果更新失败

1. **查看构建日志**
   ```bash
   docker compose build --no-cache app 2>&1 | tee build.log
   ```

2. **检查文件内容**
   ```bash
   # 确认文件已正确上传
   head -20 client/src/pages/ShareNewsPage.jsx
   ```

3. **回滚操作**
   ```bash
   # 如果有备份，恢复备份
   cp client/src/pages/ShareNewsPage.jsx.bak client/src/pages/ShareNewsPage.jsx
   docker compose build --no-cache app
   docker compose up -d
   ```
