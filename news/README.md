# 新闻舆情管理系统

一个完整的新闻舆情管理和分析系统，用于投资机构管理被投企业、监控舆情动态、进行AI智能分析，并提供邮件通知等功能。

## 功能特性

### 核心功能模块

- **用户管理**
  - 用户注册和登录
  - 密码加密存储
  - 会员等级管理
  - 应用权限管理
  - 角色权限控制（管理员/普通用户）

- **被投企业管理**
  - 企业信息管理（企业全称、统一信用代码等）
  - 公众号信息管理
  - 企业退出状态管理（支持：未退出、部分退出、完全退出、继续观察、已上市）
  - 批量导入功能
  - 定时数据同步（支持从外部数据库定时同步企业数据）

- **新闻舆情管理**
  - 新闻数据同步（支持定时任务和手动同步）
  - 舆情信息查看（支持昨日/本周/上周/本月/全部舆情Tab切换）
  - 批量选择和AI重新分析（所有Tab页签支持复选框选择和批量AI分析）
  - 舆情数据导出（Excel格式，支持多种时间范围）
  - 用户舆情统计（昨日发布新闻企业个数、累计新闻条数等）
  - 管理员舆情管理（查看全部数据、详情查看、正文查看）
  - 智能过滤（自动排除"已上市"和"完全退出"状态的企业，不抓取新闻数据）

- **AI智能分析**
  - 多AI模型配置（支持阿里云千问、OpenAI、百度文心一言、腾讯混元等）
  - 新闻情绪分析（正面/中性/负面）
  - 新闻类型分类（企业发展、荣誉、产品发布、融资等）
  - 新闻摘要生成
  - 企业关联性分析（自动识别新闻与被投企业的关联度）
  - 批量分析和单条分析功能
  - 列表页面批量选择重新分析（支持所有Tab页签，实时显示分析进度）

- **公众号管理**
  - 额外公众号数据源管理（管理员功能）
  - 公众号信息增删改查
  - 批量导入公众号
  - 状态管理（生效/失效）

- **邮件管理**
  - 邮件服务器配置
  - 收件人管理
  - 定时邮件发送任务
  - 邮件发送记录查询

- **系统配置**
  - 基础系统配置（系统名称、Logo、登录背景等）
  - 企查查API配置
  - 新闻接口配置
  - 节假日配置
  - AI模型配置
  - 外部数据库连接配置（支持连接外部MySQL数据库）

- **定时任务**
  - 每日新闻自动同步（每天00:00:00）
  - 定时邮件发送任务管理

## 技术栈

- **后端**：Node.js + Express + MySQL
- **前端**：React + Vite + React Router
- **数据库**：MySQL 8.0+
- **密码加密**：bcrypt
- **定时任务**：node-cron
- **邮件服务**：nodemailer
- **Excel处理**：xlsx
- **文件上传**：multer

## 前置要求

- **Node.js** (版本 18.x 或更高)
  - 如果未安装，请访问 https://nodejs.org/ 下载并安装
  - 安装后需要重新打开 CMD/PowerShell 窗口
- **MySQL 8.0+**
  - 安装并确保 MySQL 服务已启动
  - 创建数据库用户并记录主机、端口、用户名、密码
  - 首次运行前创建 `.env` 文件写入数据库配置（示例见 `.env.example`）

## 安装和运行

### 1. 打开 CMD 并切换到项目目录

```cmd
cd /d E:\USER\SUREAL\Desktop\news
```

**重要**：确保命令提示符显示的是项目目录路径：
```
E:\USER\SUREAL\Desktop\news>
```

### 2. 安装依赖

```cmd
npm run install-all
```

这个命令会安装后端和前端的所有依赖包。

**注意**：
- 如果提示 "'npm'不是内部或外部命令"，请先安装 Node.js（见上方前置要求）
- 如果提示找不到 package.json，请确保您在正确的项目目录中

### 3. 配置数据库连接

在项目根目录创建 `.env` 文件（如果不存在），并添加以下内容：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的MySQL密码
DB_NAME=investment_tools
```

**重要提示**：
- 将 `DB_PASSWORD` 替换为你的 MySQL root 用户密码
- 如果 MySQL 运行在其他主机或端口，请相应修改 `DB_HOST` 和 `DB_PORT`
- 确保 MySQL 服务已启动

### 4. 启动开发服务器

```cmd
npm run dev
```

这将同时启动：
- **后端服务器**：http://localhost:3001
- **前端开发服务器**：http://localhost:5173

### 5. 访问应用

打开浏览器，访问：**http://localhost:5173**

### 6. 停止程序

在运行 `npm run dev` 的 CMD 窗口中按 `Ctrl + C`

## 数据库

系统默认使用 **MySQL**，首次运行会自动创建数据库及表结构，并插入默认的应用与会员等级数据。请确保 `.env` 中的数据库账户拥有创建数据库与建表权限。

详细运行说明请查看 `运行指南.md` 文件。

## 项目结构

```
.
├── server/                    # 后端代码
│   ├── index.js              # 服务器入口
│   ├── db.js                 # 数据库配置和初始化
│   ├── middleware/           # 中间件
│   │   └── auth.js           # 认证中间件
│   ├── routes/               # 路由文件
│   │   ├── auth.js           # 用户认证路由
│   │   ├── enterprises.js   # 被投企业管理路由
│   │   ├── companies.js     # 公司管理路由
│   │   ├── news.js          # 新闻舆情路由
│   │   ├── newsAnalysis.js  # 新闻分析路由
│   │   ├── aiConfig.js      # AI配置路由
│   │   ├── email.js         # 邮件管理路由
│   │   ├── scheduledTasks.js # 定时任务路由
│   │   ├── additionalAccounts.js # 额外公众号路由
│   │   ├── system.js        # 系统配置路由
│   │   └── qichacha.js      # 企查查路由
│   └── utils/               # 工具函数
│       ├── newsAnalysis.js  # 新闻分析工具
│       ├── emailSender.js  # 邮件发送工具
│       ├── scheduledEmailTasks.js # 定时邮件任务
│       └── ...
├── client/                   # 前端代码
│   ├── src/
│   │   ├── pages/           # 页面组件
│   │   │   ├── Login.jsx    # 登录页面
│   │   │   ├── Register.jsx # 注册页面
│   │   │   ├── Dashboard.jsx # 主面板
│   │   │   ├── EnterpriseManagement.jsx # 被投企业管理
│   │   │   ├── NewsInfo.jsx # 舆情信息
│   │   │   ├── AIConfig.jsx # AI配置
│   │   │   ├── EmailManagement.jsx # 邮件管理
│   │   │   ├── SystemConfig.jsx # 系统配置
│   │   │   └── ...
│   │   ├── components/      # 公共组件
│   │   ├── utils/          # 工具函数
│   │   └── App.jsx         # 主应用组件
│   └── vite.config.js      # Vite配置
├── uploads/                 # 上传文件目录
├── deploy/                  # 部署相关文件
├── package.json            # 后端依赖配置
└── README.md              # 项目说明文档
```

## 主要功能说明文档

系统提供了详细的功能说明文档，位于项目根目录：

- `被投企业管理功能说明.md` - 被投企业管理功能详细说明
- `大模型新闻分析功能说明.md` - AI分析功能详细说明
- `管理员舆情功能说明.md` - 管理员舆情管理功能
- `用户舆情统计功能说明.md` - 用户端统计功能
- `管理员公众号管理功能说明.md` - 公众号管理功能
- `舆情导出功能说明.md` - 舆情导出功能
- `新闻同步和AI分析状态说明.md` - 新闻同步机制说明
- `外部数据库连接及数据同步功能说明.md` - 外部数据库连接和数据同步功能说明
- `企查查新闻特殊网站正文提取说明.md` - 企查查新闻特殊网站（新浪、每经网、东方财富网等）正文提取说明
- `企查查正文提取增强说明.md` - 企查查正文提取增强说明
- `格隆汇网站正文提取优化说明.md` - 格隆汇网站正文提取优化说明
- `运行指南.md` - 详细的运行指南
- `安装指南.md` - 安装步骤说明
- `Ubuntu部署指南.md` - Ubuntu服务器部署指南

## API接口说明

### 认证相关
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录

### 被投企业管理
- `GET /api/enterprises` - 获取企业列表
- `POST /api/enterprises` - 新增企业
- `PUT /api/enterprises/:id` - 更新企业
- `DELETE /api/enterprises/:id` - 删除企业

### 新闻舆情
- `GET /api/news` - 获取舆情列表（管理员）
- `GET /api/news/user-news` - 获取用户相关舆情
- `GET /api/news/user-stats` - 获取用户统计信息
- `POST /api/news/sync` - 同步新闻数据
- `POST /api/news/export` - 导出舆情数据

### AI分析
- `GET /api/ai-config` - 获取AI配置列表
- `POST /api/ai-config` - 新增AI配置
- `POST /api/ai-config/:id/test` - 测试AI配置
- `POST /api/news-analysis/analyze` - 批量分析新闻
- `GET /api/news-analysis/stats` - 获取分析统计

### 邮件管理
- `GET /api/email/config` - 获取邮件配置
- `POST /api/email/config` - 更新邮件配置
- `GET /api/email/recipients` - 获取收件人列表
- `POST /api/email/send` - 发送测试邮件

### 定时任务
- `GET /api/scheduled-tasks` - 获取定时任务列表
- `POST /api/scheduled-tasks` - 创建定时任务
- `PUT /api/scheduled-tasks/:id` - 更新定时任务
- `DELETE /api/scheduled-tasks/:id` - 删除定时任务

更多API接口详情请参考各路由文件。

