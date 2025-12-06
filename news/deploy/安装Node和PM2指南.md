# 安装 Node.js 和 PM2 指南

## 🚀 快速安装（推荐）

### 方法1：使用 NodeSource 安装 Node.js 18.x（推荐）

```bash
# 1. 更新系统
sudo apt update

# 2. 安装 Node.js 18.x（包含 npm）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. 验证安装
node --version
npm --version

# 4. 安装 PM2
npm install -g pm2

# 5. 验证 PM2 安装
pm2 --version
```

### 方法2：使用 apt 安装（简单但版本可能较旧）

```bash
# 1. 更新系统
sudo apt update

# 2. 安装 Node.js 和 npm
sudo apt install -y nodejs npm

# 3. 验证安装
node --version
npm --version

# 4. 安装 PM2
npm install -g pm2

# 5. 验证 PM2 安装
pm2 --version
```

---

## 📋 详细步骤

### 步骤1：检查当前环境

```bash
# 检查 Node.js
node --version

# 检查 npm
npm --version

# 检查 PM2
pm2 --version
```

### 步骤2：安装 Node.js

#### 选项A：NodeSource（推荐，版本新）

```bash
# 安装 Node.js 18.x LTS
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 或者安装 Node.js 20.x（最新LTS）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

#### 选项B：使用 apt（简单）

```bash
sudo apt update
sudo apt install -y nodejs npm
```

**注意**：apt 安装的版本可能较旧，建议使用方法A。

### 步骤3：安装 PM2

```bash
# 全局安装 PM2
npm install -g pm2

# 验证安装
pm2 --version
```

### 步骤4：配置 PM2 开机自启

```bash
# 设置 PM2 开机自启
pm2 startup

# 按照提示执行命令（通常是 sudo env PATH=... pm2 startup systemd -u username --hp /home/username）
```

---

## 🔧 常见问题

### 问题1：npm 命令未找到

**原因**：Node.js 未正确安装或 PATH 未配置

**解决方法**：

```bash
# 方法1：重新安装 Node.js（推荐）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 方法2：检查 PATH
echo $PATH
which node
which npm

# 如果找不到，可能需要重新登录或重启终端
```

### 问题2：权限错误

**解决方法**：

```bash
# 使用 sudo 安装
sudo npm install -g pm2

# 或者配置 npm 全局目录权限
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g pm2
```

### 问题3：Node.js 版本过低

**解决方法**：

```bash
# 卸载旧版本
sudo apt remove nodejs npm

# 安装新版本（使用 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

---

## ✅ 验证安装

安装完成后，运行以下命令验证：

```bash
# 检查 Node.js 版本（应该 >= 18.x）
node --version

# 检查 npm 版本
npm --version

# 检查 PM2 版本
pm2 --version

# 检查 PM2 是否正常工作
pm2 list
```

---

## 🎯 安装完成后

### 启动应用

```bash
# 使用 PM2 启动应用
cd /opt/newsapp/news
pm2 start deploy/ecosystem.config.js

# 或直接启动
pm2 start server/index.js --name newsapp

# 保存 PM2 配置
pm2 save
```

### 查看日志

```bash
# 使用 PM2 查看日志
pm2 logs newsapp

# 或使用日志查看脚本
./deploy/view-logs.sh --pm2
```

---

## 📝 一键安装脚本

你也可以创建一个简单的安装脚本：

```bash
#!/bin/bash
# 安装 Node.js 和 PM2

echo "正在安装 Node.js 18.x..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "正在安装 PM2..."
npm install -g pm2

echo "验证安装..."
node --version
npm --version
pm2 --version

echo "安装完成！"
```

保存为 `install-node-pm2.sh`，然后运行：

```bash
chmod +x install-node-pm2.sh
./install-node-pm2.sh
```

---

## 🔗 参考链接

- Node.js 官方：https://nodejs.org/
- NodeSource：https://github.com/nodesource/distributions
- PM2 官方：https://pm2.keymetrics.io/

