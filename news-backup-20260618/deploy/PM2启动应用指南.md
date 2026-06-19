# PM2 启动应用指南

## ❌ 问题：PM2 中找不到应用

**错误信息**：`[PM2] [ERROR] Process or Namespace newsapp not found`

**原因**：应用还没有使用 PM2 启动

---

## ✅ 解决方法

### 方法1：使用配置文件启动（推荐）

```bash
# 1. 确认当前目录
cd /opt/newsapp/news

# 2. 检查配置文件是否存在
ls -la deploy/ecosystem.config.js

# 3. 使用配置文件启动应用
pm2 start deploy/ecosystem.config.js

# 4. 保存PM2配置（开机自启）
pm2 save

# 5. 查看状态
pm2 status
```

### 方法2：直接启动应用

```bash
# 1. 进入应用目录
cd /opt/newsapp/news

# 2. 直接启动（不使用配置文件）
pm2 start server/index.js --name newsapp

# 3. 保存配置
pm2 save

# 4. 查看状态
pm2 status
```

### 方法3：检查并修复配置文件路径

如果配置文件中的路径不对，需要修改：

```bash
# 1. 查看当前目录结构
pwd
# 应该显示：/opt/newsapp/news

# 2. 检查配置文件
cat deploy/ecosystem.config.js | grep cwd
# 如果显示 cwd: '/opt/newsapp'，需要修改为 '/opt/newsapp/news'

# 3. 修改配置文件（如果需要）
nano deploy/ecosystem.config.js
# 将 cwd: '/opt/newsapp' 改为 cwd: '/opt/newsapp/news'
# 将 script: './server/index.js' 保持不变（相对于cwd）

# 4. 使用修改后的配置启动
pm2 start deploy/ecosystem.config.js
```

---

## 🔍 完整启动流程

### 步骤1：检查应用目录

```bash
# 确认应用目录结构
cd /opt/newsapp/news
ls -la

# 应该看到：
# - server/
# - client/
# - deploy/
# - package.json
```

### 步骤2：检查 Node.js 和依赖

```bash
# 检查 Node.js
node --version

# 检查依赖是否安装
ls -la node_modules/

# 如果 node_modules 不存在，需要安装
npm install
```

### 步骤3：检查环境变量

```bash
# 检查 .env 文件
ls -la .env

# 如果不存在，需要创建
cp deploy/env.production.template .env
nano .env
```

### 步骤4：启动应用

```bash
# 方式1：使用配置文件（推荐）
pm2 start deploy/ecosystem.config.js

# 方式2：直接启动
pm2 start server/index.js --name newsapp --env production

# 方式3：如果配置文件路径不对，手动指定
pm2 start server/index.js --name newsapp \
  --cwd /opt/newsapp/news \
  --env production \
  --log /var/log/newsapp/combined.log \
  --out /var/log/newsapp/out.log \
  --error /var/log/newsapp/error.log
```

### 步骤5：验证启动

```bash
# 查看状态
pm2 status

# 应该显示 newsapp 进程，状态为 online

# 查看日志
pm2 logs newsapp --lines 50

# 检查端口
netstat -tulpn | grep 3001

# 测试API
curl http://localhost:3001/api/health
```

### 步骤6：保存配置

```bash
# 保存PM2配置（开机自启）
pm2 save

# 设置PM2开机自启（如果还没设置）
pm2 startup
# 按照提示执行命令
```

---

## 🛠️ 常见问题

### 问题1：配置文件路径错误

**错误**：`Error: Cannot find module '/opt/newsapp/server/index.js'`

**解决方法**：

```bash
# 检查实际路径
cd /opt/newsapp/news
ls -la server/index.js

# 修改配置文件中的 cwd
nano deploy/ecosystem.config.js
# 将 cwd: '/opt/newsapp' 改为 cwd: '/opt/newsapp/news'
```

### 问题2：端口被占用

**错误**：`Error: listen EADDRINUSE: address already in use :::3001`

**解决方法**：

```bash
# 查找占用端口的进程
netstat -tulpn | grep 3001
# 或
lsof -i :3001

# 停止占用端口的进程
kill <进程ID>

# 或使用PM2停止
pm2 stop all
pm2 delete all
```

### 问题3：数据库连接失败

**错误**：`数据库连接失败` 或 `ER_ACCESS_DENIED_ERROR`

**解决方法**：

```bash
# 检查 .env 文件配置
cat .env

# 测试数据库连接
mysql -u <DB_USER> -p <DB_NAME>

# 检查数据库服务
sudo systemctl status mysql
```

### 问题4：权限问题

**错误**：`EACCES: permission denied`

**解决方法**：

```bash
# 检查日志目录权限
ls -la /var/log/newsapp/

# 如果不存在或权限不对，创建并设置权限
sudo mkdir -p /var/log/newsapp
sudo chown -R guofang:guofang /var/log/newsapp

# 检查应用目录权限
ls -la /opt/newsapp/news
sudo chown -R guofang:guofang /opt/newsapp/news
```

---

## 📋 快速启动命令

### 一键启动（推荐）

```bash
cd /opt/newsapp/news && \
pm2 start deploy/ecosystem.config.js && \
pm2 save && \
pm2 status
```

### 如果配置文件路径不对

```bash
cd /opt/newsapp/news && \
pm2 start server/index.js \
  --name newsapp \
  --cwd /opt/newsapp/news \
  --log /var/log/newsapp/combined.log \
  --out /var/log/newsapp/out.log \
  --error /var/log/newsapp/error.log && \
pm2 save && \
pm2 status
```

---

## ✅ 验证清单

启动后，确认以下事项：

- [ ] `pm2 status` 显示 newsapp 进程，状态为 `online`
- [ ] `pm2 logs newsapp` 显示应用正常启动日志
- [ ] `netstat -tulpn | grep 3001` 显示端口正在监听
- [ ] `curl http://localhost:3001/api/health` 返回正常响应
- [ ] 没有错误日志：`pm2 logs newsapp --err`

---

## 🔄 更新代码后的操作

```bash
# 1. 同步代码（Git或手动上传）
cd /opt/newsapp/news
git pull  # 或手动上传文件

# 2. 重启应用
pm2 restart newsapp

# 3. 查看日志确认
pm2 logs newsapp --lines 50
```

---

## 📞 需要帮助？

如果仍然无法启动：

1. 查看详细错误：`pm2 logs newsapp --err`
2. 检查代码语法：`node -c server/index.js`
3. 手动测试启动：`node server/index.js`
4. 查看系统日志：`sudo journalctl -u newsapp -n 100`

