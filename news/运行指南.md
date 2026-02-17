# 运行指南

## 快速开始

### 步骤 1：打开 CMD 并切换到项目目录

```cmd
cd /d E:\USER\SUREAL\Desktop\news
```

**重要提示**：确保命令提示符显示的是项目目录路径，例如：
```
E:\USER\SUREAL\Desktop\news>
```

### 步骤 2：配置 MySQL 与环境变量

1. 确保本地已安装并启动 MySQL（8.0 及以上版本）
2. 创建或确认有权限的数据库用户（需要 CREATE DATABASE、CREATE TABLE、INSERT 等权限）
3. 在项目根目录创建 `.env` 文件（如果尚未创建），内容示例：
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=你的密码
   DB_NAME=investment_tools
   ```
4. 保存 `.env` 后再继续以下步骤

### 步骤 3：安装依赖

在项目目录中运行：

```cmd
npm run install-all
```

这个命令会：
- 安装后端依赖（server 目录）
- 安装前端依赖（client 目录）

**如果遇到错误**：
- 确保您在正确的目录中（使用 `cd /d E:\USER\SUREAL\Desktop\news`）
- 确保 Node.js 已正确安装（运行 `node --version` 和 `npm --version` 检查）

### 步骤 4：启动程序

安装完成后，运行：

```cmd
npm run dev
```

这将同时启动：
- **后端服务器**：http://localhost:3001
- **前端开发服务器**：http://localhost:5173

### 步骤 5：访问应用

打开浏览器，访问：**http://localhost:5173**

---

## 在苹果电脑 (macOS) 上运行

### 步骤 1：打开终端并切换到项目目录

打开 **终端**（Terminal）应用（可通过 Spotlight 搜索「终端」打开），执行：

```bash
cd /Users/你的用户名/Desktop/equity_news/news
```

或使用拖拽方式：输入 `cd ` 后，将项目文件夹拖入终端窗口，按回车。

**提示**：确保终端提示符显示的是项目目录路径，例如：
```
username@MacBook news %
```

### 步骤 2：配置 MySQL 与环境变量

1. **安装 MySQL**（如未安装）：
   - 使用 Homebrew：`brew install mysql`，安装后运行 `brew services start mysql` 启动服务
   - 或从 [MySQL 官网](https://dev.mysql.com/downloads/mysql/) 下载 macOS 安装包
2. 创建或确认有权限的数据库用户（需要 CREATE DATABASE、CREATE TABLE、INSERT 等权限）
3. 在项目根目录创建 `.env` 文件（如果尚未创建），内容示例：
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=你的密码
   DB_NAME=investment_tools
   ```
4. 保存 `.env` 后再继续以下步骤

### 步骤 3：安装依赖

在项目目录中运行：

```bash
npm run install-all
```

**如果遇到错误**：
- 确保在正确的目录中（使用 `pwd` 查看当前路径）
- 确保 Node.js 已正确安装（运行 `node --version` 和 `npm --version` 检查）
- 如未安装 Node.js，可使用 `brew install node` 或从 [Node.js 官网](https://nodejs.org/) 下载

### 步骤 4：启动程序

```bash
npm run dev
```

将同时启动：
- **后端服务器**：http://localhost:3001
- **前端开发服务器**：http://localhost:5173

### 步骤 5：访问应用

打开浏览器，访问：**http://localhost:5173**

### 在 macOS 上停止程序

在运行 `npm run dev` 的终端窗口中按 `Ctrl + C`

### macOS 单独运行（可选）

**终端 1 - 运行后端：**
```bash
cd /Users/你的用户名/Desktop/equity_news/news
npm run server
```

**终端 2 - 运行前端：**
```bash
cd /Users/你的用户名/Desktop/equity_news/news
npm run client
```

---

## 完整命令序列

**Windows (CMD)：**
```cmd
# 1. 切换到项目目录
cd /d E:\USER\SUREAL\Desktop\news

# 2. 配置 .env（只需一次，具体见运行指南）

# 3. 安装依赖（只需运行一次）
npm run install-all

# 4. 启动程序
npm run dev
```

**macOS / Linux (终端)：**
```bash
# 1. 切换到项目目录
cd /Users/你的用户名/Desktop/equity_news/news

# 2. 配置 .env（只需一次，具体见运行指南）

# 3. 安装依赖（只需运行一次）
npm run install-all

# 4. 启动程序
npm run dev
```

## 常见问题

### Q: 提示找不到 package.json？
**A:** 确保您在项目根目录中运行命令。
- Windows：`E:\USER\SUREAL\Desktop\news` 或 `E:\USER\SUREAL\Desktop\equity_news\news`
- macOS：`/Users/你的用户名/Desktop/equity_news/news`（使用 `pwd` 查看当前路径）

### Q: 端口被占用？
**A:** 
- 后端端口 3001 被占用：修改 `server/index.js` 中的端口号
- 前端端口 5173 被占用：修改 `client/vite.config.js` 中的端口号

### Q: 如何停止程序？
**A:** 在运行 `npm run dev` 的终端/CMD 窗口中按 `Ctrl + C`

### Q: 数据库在哪里？
**A:** 系统使用 MySQL，数据库名称由 `.env` 中的 `DB_NAME` 指定。首次运行会自动创建数据库和表结构。

### Q: 提示 "Access denied for user 'root'@'localhost'" 错误？
**A:** 这是 MySQL 连接配置问题，请按以下步骤解决：
1. 确保 MySQL 服务已启动（Windows：服务管理器；macOS：`brew services list` 或系统偏好设置）
2. 在项目根目录创建 `.env` 文件（如果不存在）
3. 在 `.env` 文件中配置正确的 MySQL 密码：
   ```
   DB_PASSWORD=你的MySQL密码
   ```
4. 如果 MySQL root 用户没有密码，可以设置为空：`DB_PASSWORD=`
5. 保存 `.env` 文件后重新运行 `npm run dev`

## 单独运行（可选）

如果您想分别运行前端和后端，可打开两个终端窗口：

**终端 1 - 运行后端：**
```bash
# Windows: cd /d E:\USER\SUREAL\Desktop\news
# macOS:   cd /Users/你的用户名/Desktop/equity_news/news
npm run server
```

**终端 2 - 运行前端：**
```bash
# Windows: cd /d E:\USER\SUREAL\Desktop\news
# macOS:   cd /Users/你的用户名/Desktop/equity_news/news
npm run client
```

