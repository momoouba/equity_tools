# 部署文件说明

本目录包含了新闻管理系统在Ubuntu Linux环境下的完整部署方案。

## 📁 文件结构

```
deploy/
├── ubuntu-deploy.sh          # 自动部署脚本
├── nginx.conf               # Nginx配置文件
├── ecosystem.config.js      # PM2进程管理配置
├── env.production.template  # 生产环境变量模板
├── newsapp.service         # systemd服务配置
├── backup.sh               # 数据备份脚本
├── ssl-setup.sh            # SSL证书配置脚本
├── monitoring.sh           # 系统监控脚本
├── view-logs.sh            # Linux日志查看脚本
├── view-logs.ps1           # Windows日志查看脚本
├── create-user.sh          # 创建应用用户脚本
├── install-node-pm2.sh     # 安装Node.js和PM2脚本
├── 日志查看指南.md          # 日志查看详细指南
├── 用户管理指南.md          # 用户管理详细指南
├── 安装Node和PM2指南.md     # Node.js和PM2安装指南
└── README.md               # 本文件
```

## 🚀 快速开始

### 0. 创建应用用户（推荐，避免使用root）

```bash
# 使用脚本创建用户 guofang
chmod +x deploy/create-user.sh
sudo ./deploy/create-user.sh guofang

# 切换到新用户
su - guofang
```

**详细说明**：查看 `deploy/用户管理指南.md`

### 1. 一键部署
```bash
# 给脚本执行权限
chmod +x deploy/ubuntu-deploy.sh

# 执行自动部署
./deploy/ubuntu-deploy.sh
```

### 2. SSL证书配置
```bash
# 配置SSL证书 (需要域名)
chmod +x deploy/ssl-setup.sh
./deploy/ssl-setup.sh your-domain.com your-email@domain.com
```

### 3. 设置监控
```bash
# 配置系统监控
chmod +x deploy/monitoring.sh

# 添加到定时任务 (每5分钟检查一次)
crontab -e
# 添加: */5 * * * * /opt/newsapp/deploy/monitoring.sh
```

### 4. 配置备份
```bash
# 配置数据备份
chmod +x deploy/backup.sh

# 添加到定时任务 (每天凌晨2点备份)
crontab -e
# 添加: 0 2 * * * /opt/newsapp/deploy/backup.sh
```

## 📋 详细说明

### ubuntu-deploy.sh
**功能**: 自动化部署脚本
- 检查系统环境
- 安装必要软件 (Node.js, MySQL, Nginx, PM2)
- 配置防火墙
- 部署应用代码
- 配置服务

**使用方法**:
```bash
./deploy/ubuntu-deploy.sh
```

### nginx.conf
**功能**: Nginx反向代理配置
- 静态文件服务
- API代理
- Gzip压缩
- 安全头设置
- 日志配置

**部署位置**: `/etc/nginx/sites-available/newsapp`

### ecosystem.config.js
**功能**: PM2进程管理配置
- 集群模式运行
- 自动重启
- 日志管理
- 内存监控
- 部署配置

**使用方法**:
```bash
pm2 start deploy/ecosystem.config.js
pm2 save
```

### env.production.template
**功能**: 生产环境变量模板
- 数据库配置
- 安全密钥
- 日志配置
- API配置

**使用方法**:
```bash
cp deploy/env.production.template .env
# 编辑 .env 文件，修改相应配置
```

### newsapp.service
**功能**: systemd系统服务配置
- 开机自启动
- 服务管理
- 安全设置
- 资源限制

**部署位置**: `/etc/systemd/system/newsapp.service`

**使用方法**:
```bash
sudo cp deploy/newsapp.service /etc/systemd/system/
sudo systemctl enable newsapp
sudo systemctl start newsapp
```

### backup.sh
**功能**: 数据备份脚本
- 数据库备份
- 应用文件备份
- 配置文件备份
- 自动清理旧备份

**使用方法**:
```bash
# 手动备份
./deploy/backup.sh

# 定时备份 (添加到crontab)
0 2 * * * /opt/newsapp/deploy/backup.sh
```

### ssl-setup.sh
**功能**: SSL证书自动配置
- Let's Encrypt证书申请
- Nginx HTTPS配置
- 自动续期设置
- 安全配置优化

**使用方法**:
```bash
./deploy/ssl-setup.sh your-domain.com your-email@domain.com
```

### monitoring.sh
**功能**: 系统监控脚本
- 系统资源监控
- 应用状态检查
- 数据库状态检查
- 自动故障恢复
- 告警通知

**使用方法**:
```bash
# 基本监控检查
./deploy/monitoring.sh

# 生成详细报告
./deploy/monitoring.sh --report

# 定时监控 (添加到crontab)
*/5 * * * * /opt/newsapp/deploy/monitoring.sh
```

### create-user.sh
**功能**: 创建应用管理用户脚本
- 创建非root用户
- 配置sudo权限
- 设置应用目录权限
- 配置SSH密钥（可选）
- 安装Node.js和PM2（可选）

**使用方法**:
```bash
# 创建用户 guofang
chmod +x deploy/create-user.sh
sudo ./deploy/create-user.sh guofang

# 创建其他用户
sudo ./deploy/create-user.sh 用户名
```

**详细说明**：查看 `deploy/用户管理指南.md`

### install-node-pm2.sh
**功能**: 一键安装Node.js和PM2脚本
- 自动检测已安装的组件
- 安装Node.js 18.x
- 安装PM2
- 验证安装

**使用方法**:
```bash
chmod +x deploy/install-node-pm2.sh
./deploy/install-node-pm2.sh
```

## ⚙️ 配置要点

### 1. 环境变量配置
重要配置项需要修改：
- `JWT_SECRET`: JWT密钥
- `APP_SECRET`: 应用密钥  
- `SESSION_SECRET`: 会话密钥
- `DB_PASSWORD`: 数据库密码

### 2. 安全配置
- 修改默认密码
- 配置防火墙
- 启用SSL证书
- 设置访问控制

### 3. 性能优化
- 调整PM2集群数量
- 配置Nginx缓存
- 优化数据库连接池
- 设置日志轮转

### 4. 监控告警
- 配置邮件告警
- 设置资源阈值
- 定期健康检查
- 日志分析

## 🔧 常用命令

### 应用管理
```bash
# 查看应用状态
pm2 status

# 重启应用
pm2 restart newsapp

# 查看日志
pm2 logs newsapp

# 监控面板
pm2 monit
```

### 服务管理
```bash
# Nginx
sudo systemctl status nginx
sudo systemctl restart nginx

# MySQL
sudo systemctl status mysql
sudo systemctl restart mysql

# 系统服务
sudo systemctl status newsapp
sudo systemctl restart newsapp
```

### 日志查看

#### 快速查看（推荐使用脚本）

**Linux服务器上：**
```bash
# 使用日志查看脚本（推荐）
chmod +x deploy/view-logs.sh
./deploy/view-logs.sh                    # 实时查看合并日志
./deploy/view-logs.sh --pm2              # 使用PM2查看日志
./deploy/view-logs.sh --error           # 查看错误日志
./deploy/view-logs.sh --grep ERROR      # 过滤包含ERROR的日志
```

**Windows系统（通过SSH）：**
```powershell
# 使用PowerShell脚本
.\deploy\view-logs.ps1 -Server 192.168.1.100 -User root
.\deploy\view-logs.ps1 -Server 192.168.1.100 -User root -LogType error
```

**详细说明请参考：`deploy/日志查看指南.md`**

#### 直接使用命令

```bash
# 应用日志
tail -f /var/log/newsapp/combined.log
pm2 logs newsapp                         # 使用PM2查看

# Nginx日志
tail -f /var/log/nginx/newsapp_access.log
tail -f /var/log/nginx/newsapp_error.log

# 系统日志
sudo journalctl -u newsapp -f
```

## 🆘 故障排除

### 1. 应用无法启动
```bash
# 检查日志
pm2 logs newsapp

# 检查配置
cat /opt/newsapp/.env

# 检查端口
netstat -tulpn | grep 3001
```

### 2. 数据库连接失败
```bash
# 检查MySQL状态
sudo systemctl status mysql

# 测试连接
mysql -u newsapp -p investment_tools
```

### 3. Nginx配置错误
```bash
# 测试配置
sudo nginx -t

# 查看错误日志
sudo tail -f /var/log/nginx/error.log
```

## 📞 技术支持

如果在部署过程中遇到问题：

1. 查看相关日志文件
2. 检查系统资源使用情况
3. 验证配置文件语法
4. 参考Ubuntu部署指南.md

---

**注意**: 请在生产环境部署前，务必修改所有默认密码和密钥，并进行充分的测试。
