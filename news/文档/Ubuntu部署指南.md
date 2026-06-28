# Ubuntu Docker 部署指南

## 📋 目录
- [系统要求](#系统要求)
- [快速部署](#快速部署)
- [配置说明](#配置说明)
- [运维管理](#运维管理)
- [故障排除](#故障排除)
- [安全建议](#安全建议)

## 🖥️ 系统要求

### 最低配置
- **操作系统**: Ubuntu 20.04 LTS 或 22.04 LTS
- **CPU**: 2核心 2.4GHz
- **内存**: 4GB RAM
- **存储**: 40GB SSD
- **网络**: 5Mbps带宽

### 推荐配置
- **操作系统**: Ubuntu 22.04 LTS
- **CPU**: 4核心 2.4GHz+
- **内存**: 8GB RAM
- **存储**: 80GB SSD
- **网络**: 10Mbps+ 带宽

### 软件依赖
- Docker 20.10+
- Docker Compose 2.0+

## 🚀 快速部署

### 1. 安装 Docker 和 Docker Compose

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y
如果遇到问题：
/etc/ssh/sshd_config（SSH 登录配置）有新版本，要不要覆盖你现在的配置。
强烈建议：选择 keep the local version currently installed（保持当前本地配置），否则可能把云厂商/你自己改过的 SSH 配置覆盖掉，导致远程登录异常。
操作方法：
用键盘方向键把红色高亮移到：keep the local version currently installed
然后按 Enter（确定）；
遇到问需要重启那些服务，按照默认选项选择即可

# 安装必要的工具
sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release

# 添加 Docker 官方 GPG 密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# 添加 Docker 仓库
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 验证安装
docker --version
docker compose version

# 将当前用户添加到 docker 组（可选，避免每次使用 sudo）
sudo usermod -aG docker $USER
# 需要重新登录才能生效

# 配置 Docker 镜像加速器（解决拉取镜像超时问题，推荐国内服务器使用）
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
EOF

# 重启 Docker 服务使配置生效
sudo systemctl daemon-reload
sudo systemctl restart docker

# 验证镜像加速器配置
docker info | grep -A 10 "Registry Mirrors"
```

### 2. 准备项目文件

本项目已经在你本地开发完成，推荐使用“**上传 zip 压缩包**”的方式把代码传到服务器上。

#### 2.1 在本地打包项目

在你本地电脑（Windows 为例）：

1. 找到项目根目录（例如 `E:\USER\SUREAL\Desktop\news`）。
2. 右键 `news` 目录 → **发送到 → 压缩(zipped)文件夹**，生成 `news.zip`。

后续文档统一以文件名：`news.zip` 为例。

#### 2.2 将压缩包上传到服务器

有多种方式可以上传，这里给出两种常用方式。

- **方式 A：使用 scp（命令行，推荐）**

前提：你的本地电脑已安装 OpenSSH 客户端（Windows 10/11 一般自带），并且能通过 `ssh` 登录服务器。

在本地 PowerShell / CMD 中执行（注意替换服务器 IP 和用户名）：

```bash
cd E:\USER\SUREAL\Desktop

# 将压缩包上传到服务器 /opt 目录
scp news.zip user@服务器IP:/opt/
```

- **方式 B：使用图形工具（如 WinSCP / Xftp 等）**

1. 打开 WinSCP，新建会话：
   - 协议：SFTP
   - 主机名：服务器 IP
   - 端口：22
   - 用户名 / 密码：与你 SSH 登录一致
2. 连接成功后，在右侧服务器目录切换到 `/opt`。
3. 在左侧本地窗口找到 `news.zip`，拖拽到右侧 `/opt` 目录，等待上传完成。

#### 2.3 在服务器上解压并准备目录

上传完成后，登录到服务器，执行：

```bash
# 确认压缩包已在 /opt 目录
ls -lh /opt

# 创建应用目录
sudo mkdir -p /opt/newsapp
sudo chown $USER:$USER /opt/newsapp

# 安装 unzip（只需安装一次）
sudo apt install -y unzip

# 进入应用目录并解压 zip
cd /opt/newsapp
unzip /opt/news.zip

# 解压完成后，目录结构类似：
# /opt/newsapp/news/...
ls
```

> 说明：`news.zip` 解压后会先生成一个 `news` 子目录，真正的程序代码在  
> `/opt/newsapp/news` 下面（包含 `server`、`client`、`package.json` 等文件）。

后续所有命令（例如配置环境变量、启动 Docker 等）都在 **`/opt/newsapp/news`** 目录下执行：

```bash
cd /opt/newsapp/news
```

至此，项目代码已经准备好，可以继续执行后续配置环境变量等步骤。

### 3. 配置环境变量

```bash
cd /opt/newsapp/news

# 复制环境变量模板（使用 deploy/env.production.template）
cp deploy/env.production.template .env

# 编辑环境变量
nano .env
```

环境变量配置示例（根据实际需要修改）：

```bash
# 应用基本配置
NODE_ENV=production
PORT=3001

# 数据库配置（Docker Compose 中 MySQL 服务名为 mysql）
DB_HOST=mysql
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=NewsApp@2024
DB_NAME=investment_tools

# MySQL Root 密码（用于 Docker Compose 初始化）
MYSQL_ROOT_PASSWORD=RootPassword123!

# 安全配置（请务必修改为随机字符串）
JWT_SECRET=your-jwt-secret-key-change-this-in-production-environment  
# 
APP_SECRET=your-app-secret-key-change-this-in-production-environment
SESSION_SECRET=your-session-secret-key-change-this-in-production
```
改完后在 nano 里按 Ctrl+O 保存，回车确认，再按 Ctrl+X 退出。

> **重要提示**：
> - 模板文件 `deploy/env.production.template` 包含更多配置项（日志、文件上传、邮件、Redis 等），可根据实际需求启用
> - 生产环境务必修改 `JWT_SECRET`、`APP_SECRET`、`SESSION_SECRET` 等安全密钥
> - 数据库密码 `DB_PASSWORD` 和 `MYSQL_ROOT_PASSWORD` 也要修改为强密码

### 4. 配置 Nginx（Docker 版本）

```bash
# 复制 Nginx 配置文件
cp deploy/nginx-docker.conf deploy/nginx-site.conf

# 编辑站点配置，将域名改为 news.gf-dsai.com
nano deploy/nginx-site.conf
```

在 `deploy/nginx-site.conf` 中，找到 `server_name` 这一行，修改为：

```nginx
server_name news.gf-dsai.com;
```

如果有 `listen 80;`、`listen 443 ssl;` 等配置，保持不变即可，主要是把原来的占位域名（如 `your-domain.com` 或 `_`) 换成 `news.gf-dsai.com`。

### 5. 构建和启动服务

```bash
# 重要：确保在项目根目录（包含 docker-compose.yml 的目录）执行
cd /opt/newsapp/news

# 构建并启动所有服务
docker compose up -d

# 如果遇到网络超时错误，请参考"故障排除"章节配置镜像加速器
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 6. 验证部署

```bash
# 检查所有容器状态
docker compose ps

# 检查应用健康状态
curl http://localhost/api/health

# 查看应用日志
docker compose logs app

# 查看数据库日志
docker compose logs mysql

# 查看 Nginx 日志
docker compose logs nginx
```

## ⚙️ 配置说明

### Docker Compose 服务说明

#### MySQL 服务
- **镜像**: mysql:8.0
- **数据持久化**: `mysql_data` volume
- **端口**: 3306（默认，可通过环境变量修改）
- **字符集**: utf8mb4
- **初始化脚本**: `deploy/mysql-init/` 目录下的 SQL 文件会自动执行

#### 应用服务
- **构建**: 使用项目根目录的 Dockerfile
- **依赖**: 等待 MySQL 健康检查通过后启动
- **端口**: 3001（容器内），可通过 `APP_PORT` 映射到主机
- **数据卷**:
  - `uploads/`: 上传文件目录
  - `logs/`: 日志文件目录
  - `.env`: 环境变量文件（只读）

#### Nginx 服务
- **镜像**: nginx:alpine
- **端口**: 80（HTTP），443（HTTPS）
- **配置**: `deploy/nginx-site.conf`
- **日志**: `logs/nginx/`

### 环境变量详细说明

```bash
# 数据库配置
DB_HOST=mysql              # Docker Compose 服务名
DB_PORT=3306              # MySQL 端口
DB_USER=newsapp           # 数据库用户
DB_PASSWORD=NewsApp@2024  # 数据库密码（请修改）
DB_NAME=investment_tools  # 数据库名称

# MySQL Root 密码
MYSQL_ROOT_PASSWORD=RootPassword123!  # Root 密码（请修改）

# 应用配置
NODE_ENV=production       # 运行环境
PORT=3001                 # 应用端口（容器内）

# 端口映射（可选）
APP_PORT=3001             # 应用端口映射到主机
MYSQL_PORT=3306           # MySQL 端口映射到主机（可选，建议不暴露）
HTTP_PORT=80              # HTTP 端口
HTTPS_PORT=443            # HTTPS 端口
```

### 数据持久化

Docker Compose 会自动创建以下数据卷：

- **mysql_data**: MySQL 数据文件
- **uploads/**: 应用上传的文件
- **logs/**: 应用和 Nginx 日志

数据卷位置：`/var/lib/docker/volumes/`

## 🛠️ 运维管理

### 服务管理

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务
docker compose down

# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart app
docker compose restart mysql
docker compose restart nginx

# 查看服务状态
docker compose ps

# 查看服务日志
docker compose logs -f app
docker compose logs -f mysql
docker compose logs -f nginx

# 查看最近100行日志
docker compose logs --tail=100 app
```

### 应用更新

```bash
cd /opt/newsapp

# 拉取最新代码
git pull

# 重新构建应用镜像
docker compose build app

# 重启应用服务（零停机更新）
docker compose up -d --no-deps app

# 或者完全重建（会停止服务）
docker compose up -d --build
```

### 数据库管理

```bash
# 进入 MySQL 容器
docker compose exec mysql mysql -u root -p

# 或者使用环境变量中的密码
docker compose exec mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} investment_tools

# 备份数据库
docker compose exec mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} investment_tools > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复数据库
docker compose exec -T mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} investment_tools < backup.sql

# 查看数据库大小
docker compose exec mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SELECT table_schema AS 'Database', ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'Size (MB)' FROM information_schema.tables WHERE table_schema = 'investment_tools' GROUP BY table_schema;"
```

### 日志管理

```bash
# 查看应用日志
docker compose logs -f app

# 查看最近100行日志
docker compose logs --tail=100 app

# 查看错误日志
docker compose logs app | grep -i error

# 查看 Nginx 访问日志
tail -f logs/nginx/access.log

# 查看 Nginx 错误日志
tail -f logs/nginx/error.log

# 清理日志（谨慎操作）
docker compose logs --tail=0 -f  # 只显示新日志
```

### 性能监控

```bash
# 查看容器资源使用情况
docker stats

# 查看特定容器资源使用
docker stats newsapp

# 查看容器详细信息
docker inspect newsapp

# 进入容器内部
docker compose exec app sh
docker compose exec mysql bash
docker compose exec nginx sh
```

### 数据备份

创建备份脚本 `deploy/docker-backup.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/opt/newsapp/backups"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份数据库
docker compose exec -T mysql mysqldump -u root -p${MYSQL_ROOT_PASSWORD} investment_tools > $BACKUP_DIR/db_$DATE.sql

# 备份上传文件
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz uploads/

# 删除7天前的备份
find $BACKUP_DIR -type f -mtime +7 -delete

echo "备份完成: $BACKUP_DIR"
```

```bash
# 给脚本执行权限
chmod +x deploy/docker-backup.sh

# 手动执行备份
./deploy/docker-backup.sh

# 设置定时备份（每天凌晨2点）
crontab -e
# 添加以下行：
# 0 2 * * * /opt/newsapp/deploy/docker-backup.sh
```

## 🔍 故障排除

### 常见问题

#### 1. Docker 镜像拉取超时

**错误信息**：
```
Error response from daemon: failed to resolve reference "docker.io/library/mysql:8.0": 
failed to do request: Head "https://registry-1.docker.io/...": dial tcp ...:443: i/o timeout
```
或
```
dial tcp: lookup docker.mirrors.ustc.edu.cn on 127.0.0.53:53: no such host
```

**原因**：服务器无法访问 Docker Hub 或 DNS 解析失败。

**解决方案**：

1. **检查并修复 DNS 配置**（如果遇到 "no such host" 错误）：

```bash
# 测试 DNS 解析
ping -c 2 docker.mirrors.ustc.edu.cn
ping -c 2 registry-1.docker.io

# 如果 DNS 解析失败，配置备用 DNS 服务器
sudo tee /etc/systemd/resolved.conf <<-'EOF'
[Resolve]
DNS=8.8.8.8 114.114.114.114
FallbackDNS=223.5.5.5
EOF

# 重启 DNS 服务
sudo systemctl restart systemd-resolved

# 再次测试 DNS
ping -c 2 docker.mirrors.ustc.edu.cn
```

2. **配置 Docker 镜像加速器**（DNS 修复后）：

```bash
# 创建 Docker 配置文件目录
sudo mkdir -p /etc/docker

# 配置镜像源（优先使用可用的镜像）
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://dockerproxy.com"
  ]
}
EOF

# 重启 Docker 服务
sudo systemctl daemon-reload
sudo systemctl restart docker

# 验证配置
docker info | grep -A 10 "Registry Mirrors"
```

3. **如果镜像加速器都不可用，尝试直接使用 Docker Hub**：

```bash
```bash
# 手动拉取 MySQL 镜像（使用完整镜像地址）
docker pull docker.io/library/mysql:8.0

# 手动拉取 Nginx 镜像
docker pull docker.io/library/nginx:alpine

# 然后再执行 docker compose up -d
cd /opt/newsapp/news
docker compose up -d
```

5. **如果无法访问 Docker Hub（连接超时）**：

如果 `curl -I https://registry-1.docker.io` 返回 `Connection timed out`，说明服务器网络无法访问 Docker Hub。

**解决方案 A：检查并配置防火墙**

```bash
# 检查防火墙状态
sudo ufw status

# 如果防火墙开启，允许 HTTPS 出站（测试用）
sudo ufw allow out 443/tcp
sudo ufw allow out 80/tcp

# 再次测试
curl -I https://registry-1.docker.io
```

**解决方案 B：使用代理服务器（如果有）**

```bash
# 配置 Docker 使用代理
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf <<-'EOF'
[Service]
Environment="HTTP_PROXY=http://代理地址:端口"
Environment="HTTPS_PROXY=http://代理地址:端口"
Environment="NO_PROXY=localhost,127.0.0.1"
EOF

# 重启 Docker
sudo systemctl daemon-reload
sudo systemctl restart docker

# 测试
docker pull mysql:8.0
```

**解决方案 C：离线安装镜像（推荐，适用于无法访问外网的服务器）**

如果服务器无法访问 Docker Hub，可以在能访问外网的机器上下载镜像，然后导入到服务器。

**步骤 1：在能访问外网的机器上下载镜像**

在你的本地电脑（Windows）上，如果已安装 Docker Desktop：

1. **确保 Docker Desktop 正在运行**
   - 检查系统托盘是否有 Docker 图标
   - 如果 Docker Desktop 未运行，启动它并等待完全启动（图标不再旋转）

2. **配置 Docker Desktop 镜像加速器**（推荐，解决拉取失败问题）
   - 打开 Docker Desktop
   - 点击右上角的设置图标（齿轮）
   - 进入 **Settings → Docker Engine**
   - 在 JSON 配置中添加或修改 `registry-mirrors`：

```json
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
```

   - 点击 **Apply & Restart** 等待 Docker 重启

3. **打开 PowerShell 或 CMD，执行以下命令**：

```powershell
# 测试 Docker 是否正常工作
docker version

# 拉取所需的镜像
docker pull mysql:8.0
docker pull nginx:alpine

# 如果拉取失败，尝试使用完整镜像地址
docker pull docker.io/library/mysql:8.0
docker pull docker.io/library/nginx:alpine

# 导出镜像为 tar 文件（会在当前目录生成 docker-images.tar）
docker save mysql:8.0 nginx:alpine -o docker-images.tar
```

**如果仍然无法拉取镜像，可以尝试：**

- **方案 A：更换其他可用的镜像加速器**

如果遇到 "no such host" 错误，说明当前镜像加速器无法访问。在 Docker Desktop 中尝试其他镜像源：

1. 打开 Docker Desktop → Settings → Docker Engine
2. 将镜像源配置改为以下之一（选择一个可用的）：

```json
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com"
  ]
}
```

或

```json
{
  "registry-mirrors": [
    "https://mirror.baidubce.com"
  ]
}
```

或

```json
{
  "registry-mirrors": [
    "https://dockerproxy.com"
  ]
}
```

3. 点击 Apply & Restart
4. 重新尝试拉取镜像

- **方案 B：移除镜像加速器，直接使用 Docker Hub**

如果镜像加速器都不可用，可以移除配置，直接使用 Docker Hub：

1. 打开 Docker Desktop → Settings → Docker Engine
2. 删除或注释掉 `registry-mirrors` 配置
3. 点击 Apply & Restart
4. 尝试直接拉取：

```powershell
docker pull mysql:8.0
docker pull nginx:alpine
```

- **方案 C：使用阿里云容器镜像服务**（推荐，稳定可靠）

如果 Docker Hub 无法访问，可以使用阿里云容器镜像服务：

1. **注册并登录阿里云账号**
   - 访问：https://cr.console.aliyun.com/
   - 登录后进入"容器镜像服务" → "镜像加速器"
   - 复制你的专属加速地址（格式类似：`https://xxxxx.mirror.aliyuncs.com`）

2. **在 Docker Desktop 中配置阿里云镜像加速器**
   - 打开 Docker Desktop → Settings → Docker Engine
   - 配置如下（替换为你的专属地址）：

```json
{
  "registry-mirrors": [
    "https://你的专属地址.mirror.aliyuncs.com"
  ]
}
```

3. **点击 Apply & Restart，然后尝试拉取镜像**

- **方案 D：使用腾讯云或华为云镜像源**

如果阿里云也不可用，可以尝试其他云服务商的镜像源：

**腾讯云：**
```json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ]
}
```

**华为云：**
```json
{
  "registry-mirrors": [
    "https://3014ef25a0d05cc01f10f00f46b42e09.mirror.swr.myhuaweicloud.com"
  ]
}
```

- **方案 E：在能访问外网的其他服务器上下载（最可靠的方法）**

如果本地网络无法访问所有镜像源，强烈建议使用此方法：

**步骤 E1：在能访问外网的服务器上下载镜像**

找到任何一台能访问外网的服务器（可以是：
- 其他云服务器（Linux）
- 本地虚拟机（Linux）
- 开发环境的 Linux 机器
- **或者你的本地 Windows 电脑（如果 Docker Desktop 能正常拉取镜像）**

**如果在 Linux 服务器上执行：**

```bash
# 拉取所需镜像
docker pull mysql:8.0
docker pull nginx:alpine

# 导出镜像为 tar 文件
docker save mysql:8.0 nginx:alpine -o docker-images.tar

# 检查文件大小（应该有几个 GB）
ls -lh docker-images.tar
```

**如果在 Windows PowerShell 中执行：**

```powershell
# 拉取所需镜像
docker pull mysql:8.0
docker pull nginx:alpine

# 导出镜像为 tar 文件
docker save mysql:8.0 nginx:alpine -o docker-images.tar

# 检查文件大小（PowerShell 语法）
Get-Item docker-images.tar | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB,2)}}

# 或者简单查看文件信息
ls docker-images.tar
```

**步骤 E2：下载 tar 文件到本地**

从服务器下载 `docker-images.tar` 到本地电脑：

```bash
# 使用 scp 下载（在本地 PowerShell 中执行）
scp user@服务器IP:/path/to/docker-images.tar E:\USER\SUREAL\Desktop\

# 或使用 WinSCP 图形工具下载
```

**步骤 E3：上传到目标服务器**

使用 WinSCP 将 `docker-images.tar` 上传到目标服务器（部署应用的那台服务器）的 `/opt` 目录。

**步骤 E4：在目标服务器上导入镜像**

登录目标服务器，执行：

```bash
# 导入镜像
docker load -i /opt/docker-images.tar

# 验证镜像（应该能看到 mysql:8.0 和 nginx:alpine）
docker images
```

**步骤 E5：处理构建镜像问题（重要）**

如果 `docker compose up -d` 时报错无法拉取 `node:18-alpine`，需要先拉取或导入该镜像：

**方法 A：如果服务器能访问外网，直接拉取**

```bash
# 移除或更换镜像加速器配置（如果配置的镜像源无法访问）
sudo rm -f /etc/docker/daemon.json
sudo systemctl daemon-reload
sudo systemctl restart docker

# 尝试直接拉取 node 镜像
docker pull node:18-alpine

# 如果还是失败，尝试使用其他镜像源
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://hub-mirror.c.163.com"
  ]
}
EOF
sudo systemctl restart docker
docker pull node:18-alpine
```

**方法 B：如果服务器无法访问外网，需要离线导入 node 镜像**

在能访问外网的机器上（例如你的本地电脑），执行：

```powershell
# 拉取 node 镜像
docker pull node:18-alpine

# 导出 node 镜像
docker save node:18-alpine -o node-image.tar
```

然后将 `node-image.tar` 上传到服务器 `/opt` 目录，在服务器上执行：

```bash
# 导入 node 镜像
docker load -i /opt/node-image.tar

# 验证所有镜像都已加载
docker images
# 应该能看到：mysql:8.0, nginx:alpine, node:18-alpine
```

**步骤 E6：启动服务**

所有镜像都准备好后，启动服务：

```bash
cd /opt/newsapp/news
docker compose up -d

# 查看服务状态
docker compose ps

# 如果 newsapp 容器启动失败，查看详细日志
docker compose logs app

# 查看所有服务日志
docker compose logs -f
```

**步骤 E7：更新代码文件（如果需要修改代码）**

如果本地修改了代码文件，需要上传到服务器：

**方法 A：使用 WinSCP 上传单个文件**

1. 打开 WinSCP，连接到服务器
2. 导航到服务器的 `/opt/newsapp/news/server/` 目录
3. 将本地修改后的 `server/db.js` 文件拖拽上传，覆盖服务器上的文件
4. 在服务器上重新构建容器：

```bash
cd /opt/newsapp/news

# 停止服务
docker compose down

# 删除旧的应用镜像（确保完全重新构建）
docker rmi news-app 2>/dev/null || true

# 重新构建（不使用缓存）
docker compose build --no-cache app

# 启动服务
docker compose up -d

# 查看日志（实时查看启动过程）
docker compose logs -f app
```

**重要提示：** 如果文件已更新但容器仍然报错，可能是 Docker 使用了缓存的旧镜像。确保执行 `docker rmi news-app` 删除旧镜像后再重新构建。

**方法 B：使用 scp 命令上传文件**

在本地 PowerShell 中执行：

```powershell
# 上传单个文件到服务器
scp E:\USER\SUREAL\Desktop\news\server\db.js root@服务器IP:/opt/newsapp/news/server/

# 然后在服务器上重新构建
```

**方法 C：重新打包整个项目上传**

如果修改了多个文件，可以重新打包：

1. 在本地将整个项目重新打包为 `news.zip`
2. 上传到服务器的 `/opt` 目录
3. 在服务器上解压覆盖：

```bash
cd /opt/newsapp
# 备份当前项目（可选）
mv news news_backup_$(date +%Y%m%d_%H%M%S)

# 解压新文件
unzip -o /opt/news.zip -d /opt/newsapp/

# 如果解压后有嵌套的 news 目录
if [ -d "/opt/newsapp/news/news" ]; then
    mv /opt/newsapp/news/news/* /opt/newsapp/news/
    rmdir /opt/newsapp/news/news
fi

# 重新构建并启动
cd /opt/newsapp/news
docker compose build --no-cache
docker compose up -d
```

**如果 newsapp 容器启动失败（unhealthy），常见原因和解决方法：**

1. **检查应用日志（最重要）**：

```bash
# 查看应用容器的详细日志
docker compose logs app

# 查看最近的错误日志（最后100行）
docker compose logs app --tail=100

# 实时查看日志
docker compose logs -f app
```

**常见错误及解决方法：**

**错误 A：数据库表初始化失败（Failed to open the referenced table 'email_config'）**

如果看到这个错误，说明服务器上的 `server/db.js` 文件还没有更新：

```bash
# 确认文件是否已更新（检查文件修改时间）
ls -lh /opt/newsapp/news/server/db.js

# 如果文件没有更新，重新上传 server/db.js 文件
# 然后重新构建：
docker compose build --no-cache app
docker compose up -d
```

**错误 B：.env 文件不存在或配置错误**

```bash
# 确保 .env 文件存在
ls -la /opt/newsapp/news/.env

# 如果不存在，从模板创建
cd /opt/newsapp/news
cp deploy/env.production.template .env
nano .env  # 编辑配置，确保数据库配置正确
```

**错误 C：数据库连接失败**

```bash
# 检查 MySQL 容器是否正常运行
docker compose ps mysql

# 查看 MySQL 日志
docker compose logs mysql

# 测试数据库连接
docker compose exec mysql mysql -u newsapp -p investment_tools
# 输入密码（.env 文件中的 DB_PASSWORD）
```

**错误 D：端口被占用**

```bash
# 检查端口是否被占用
netstat -tulpn | grep 3001

# 如果被占用，修改 .env 文件中的 APP_PORT
```

2. **完全重新启动服务**：

```bash
# 停止所有服务
docker compose down

# 清理数据库卷（注意：这会清空所有数据！仅在首次部署或测试时使用）
# docker volume rm news_mysql_data

# 重新启动
docker compose up -d

# 查看日志
docker compose logs -f app
```

3. **如果问题持续，检查容器状态**：

```bash
# 查看容器详细状态
docker compose ps -a

# 查看容器的健康检查状态
docker inspect newsapp | grep -A 10 Health

# 测试健康检查端点（在容器内）
docker compose exec app node -e "require('http').get('http://localhost:3001/api/health', (r) => {let data='';r.on('data',d=>data+=d);r.on('end',()=>{console.log('Status:',r.statusCode);console.log('Response:',data);process.exit(r.statusCode===200?0:1)})})"

# 或者直接访问健康检查端点
curl http://localhost:3001/api/health
```

**错误 D：应用已启动但容器显示 unhealthy**

如果日志显示"服务器已就绪"，但容器状态是 unhealthy，可能是健康检查失败：

```bash
# 检查健康检查端点
docker compose exec app curl http://localhost:3001/api/health

# 如果健康检查失败，检查应用是否真的在运行
docker compose exec app ps aux | grep node

# 查看完整的容器日志
docker compose logs app | tail -50
```

**登录问题：admin 账号密码**

默认 admin 账号信息：
- **账号**：`admin`
- **密码**：`wenchao`（不是 `admin`）

如果需要修改 admin 密码，可以在服务器上执行：

```bash
cd /opt/newsapp/news

# 方法1：使用 Node.js 脚本重置密码
docker compose exec app node -e "
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'mysql',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'newsapp',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'investment_tools'
  });
  
  const newPassword = 'admin'; // 新密码
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  await connection.execute(
    'UPDATE users SET password = ? WHERE account = ?',
    [hashedPassword, 'admin']
  );
  
  console.log('密码已重置为: admin');
  await connection.end();
})();
"
```

**文件上传失败：权限问题**

如果上传文件时出现 `EACCES: permission denied` 错误，是因为 `uploads` 目录权限不正确。

**解决方法：**

```bash
cd /opt/newsapp/news

# 创建 uploads 和 logs 目录（如果不存在）
mkdir -p uploads logs

# 设置正确的权限（允许容器内的 nodejs 用户写入）
# nodejs 用户的 UID 是 1001
chown -R 1001:1001 uploads logs

# 或者使用更宽松的权限（不推荐，但可以快速解决问题）
chmod -R 777 uploads logs

# 重启应用容器使权限生效
docker compose restart app

# 验证权限
ls -la uploads/
ls -la logs/
```

**如果还是失败，检查容器内的用户 ID：**

```bash
# 查看容器内 nodejs 用户的 UID
docker compose exec app id nodejs

# 如果 UID 不是 1001，使用实际的 UID
# 例如，如果 UID 是 1000，则执行：
chown -R 1000:1000 uploads logs
```

**永久解决方案：在 docker-compose.yml 中设置权限**

为了确保权限在容器重启后仍然有效，可以修改 `docker-compose.yml`，在应用容器启动时自动设置权限：

编辑 `docker-compose.yml`，在 `app` 服务的 volumes 部分后添加 `user` 配置（但这会改变容器运行用户，不推荐）。

**或者，创建一个启动脚本自动设置权限：**

```bash
# 创建一个启动脚本
cat > /opt/newsapp/news/fix-permissions.sh << 'EOF'
#!/bin/bash
chown -R 1001:1001 /app/uploads /app/logs
chmod -R 755 /app/uploads /app/logs
exec "$@"
EOF

chmod +x /opt/newsapp/news/fix-permissions.sh
```

然后在 `docker-compose.yml` 中修改 app 服务的 command：

```yaml
command: ["/bin/sh", "-c", "chown -R 1001:1001 /app/uploads /app/logs && chmod -R 755 /app/uploads /app/logs && node server/index.js"]
```

**更简单的方法：每次重启后重新设置权限**

```bash
# 创建一个便捷脚本
cat > /opt/newsapp/news/fix-perms.sh << 'EOF'
#!/bin/bash
cd /opt/newsapp/news
chown -R 1001:1001 uploads logs
chmod -R 755 uploads logs
docker compose restart app
EOF

chmod +x /opt/newsapp/news/fix-perms.sh

# 每次上传失败后执行
./fix-perms.sh
```

**执行脚本时如果遇到 "Permission denied" 错误：**

```bash
# 给脚本添加执行权限
chmod +x fix-upload-perms.sh

# 然后再执行
./fix-upload-perms.sh
```

**或者直接执行命令而不创建脚本：**

```bash
cd /opt/newsapp/news

# 直接修复权限
chown -R 1001:1001 uploads logs
chmod -R 755 uploads logs

# 在容器内也修复权限
docker compose exec app chown -R nodejs:nodejs /app/uploads /app/logs
docker compose exec app chmod -R 755 /app/uploads /app/logs

# 重启应用容器
docker compose restart app
```

**错误 J：上传文件后无法访问（404 Not Found）**

如果上传文件成功，但访问上传的文件时返回 404：

**快速诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 检查上传的文件是否存在（宿主机）
ls -la uploads/ | grep file-1764671213737-289324164.jpg

# 2. 检查容器内的文件
docker compose exec app ls -la /app/uploads/ | grep file-1764671213737-289324164.jpg

# 3. 测试通过 Nginx 访问（从宿主机测试，最简单）
curl -I http://localhost/api/uploads/file-1764671213737-289324164.jpg

# 4. 查看应用日志（查看是否有错误）
docker compose logs app --tail=50 | grep -i "uploads\|static\|404\|error"

# 5. 查看 Nginx 日志
docker compose logs nginx --tail=50 | grep -i "uploads\|404"
```

**常见原因和解决方法：**

1. **文件确实不存在（上传失败）**：

检查上传日志：
```bash
docker compose logs app | grep -i "文件\|upload\|compress\|sharp"
```

如果看到压缩错误，可能是 `sharp` 库的问题。检查容器内是否有文件：
```bash
docker compose exec app ls -la /app/uploads/
```

2. **文件存在但路径不对**：

确认文件路径和访问路径一致：
```bash
# 查看实际的文件名
docker compose exec app ls -la /app/uploads/ | grep -i jpg

# 测试应用静态文件服务
docker compose exec app curl -I http://127.0.0.1:3001/api/uploads/文件名
```

3. **Nginx 代理配置问题**：

确保 `/api/uploads` 被正确代理。测试：
```bash
# 测试 API 代理
curl -v http://localhost/api/uploads/

# 查看 Nginx 日志
docker compose logs nginx | tail -20
```

4. **权限问题导致文件无法读取**：

```bash
# 修复文件权限
docker compose exec app chmod 644 /app/uploads/*.jpg
docker compose exec app chown nodejs:nodejs /app/uploads/*.jpg

# 检查静态文件服务配置
docker compose exec app cat /app/server/index.js | grep -A 5 "express.static"
```

5. **文件被压缩处理时出错**：

如果上传时返回成功，但文件不存在，检查压缩日志：
```bash
docker compose logs app | grep -i "压缩\|sharp\|toFile"
```

如果压缩失败，文件可能被删除了。查看是否有原始文件：
```bash
docker compose exec app find /app/uploads -name "*file-*" -type f
```

**6. 测试静态文件服务是否正常工作：**

```bash
# 方法1: 从宿主机测试通过 Nginx 访问（推荐）
curl -I http://localhost/api/uploads/file-1764671213737-289324164.jpg

# 方法2: 使用 Node.js 在容器内测试（容器内没有 curl，但可以用 Node.js）
docker compose exec app node -e "require('http').get('http://127.0.0.1:3001/api/uploads/file-1764671213737-289324164.jpg', (r) => {console.log('Status:', r.statusCode); r.on('data', () => {}); r.on('end', () => process.exit(r.statusCode === 200 ? 0 : 1))})"

# 方法3: 查看应用是否能读取文件
docker compose exec app cat /app/uploads/file-1764671213737-289324164.jpg | head -c 100

# 方法4: 查看 Nginx 错误日志
docker compose logs nginx | grep -i error | tail -20

# 方法5: 查看应用日志（查看是否有相关错误）
docker compose logs app --tail=50 | grep -i "uploads\|static\|404"
```

**如果文件存在但访问返回 404，可能是以下原因：**

**A. Express 静态文件服务配置问题：**

检查静态文件服务是否在路由之前配置：
```bash
docker compose exec app grep -n "express.static.*uploads" /app/server/index.js
```

应该看到类似：`app.use('/api/uploads', express.static(uploadsDir));`

**B. Nginx 代理配置问题：**

确保 `/api/uploads` 请求被正确代理。测试：
```bash
# 测试应用是否能响应静态文件请求（使用 Node.js，因为容器内没有 curl）
docker compose exec app node -e "require('http').get('http://127.0.0.1:3001/api/uploads/file-1764671213737-289324164.jpg', (r) => {console.log('HTTP Status:', r.statusCode); console.log('Headers:', JSON.stringify(r.headers, null, 2)); r.on('data', () => {}); r.on('end', () => process.exit(r.statusCode === 200 ? 0 : 1))}).on('error', (e) => {console.error('Error:', e.message); process.exit(1)})"

# 如果返回 200，说明应用端正常，问题在 Nginx
# 如果返回 404，说明应用端有问题

# 从宿主机测试 Nginx 代理
curl -v http://localhost/api/uploads/file-1764671213737-289324164.jpg
```

**C. 文件权限问题（即使文件存在也可能无法读取）：**

```bash
# 修复文件权限（确保 nodejs 用户可以读取）
docker compose exec app chmod 644 /app/uploads/*.jpg
docker compose exec app chown nodejs:nodejs /app/uploads/*.jpg

# 检查文件权限
docker compose exec app ls -la /app/uploads/file-1764671213737-289324164.jpg
```

**D. 路由顺序问题：**

如果 `/api/uploads` 被其他路由拦截，静态文件服务可能无法生效。检查路由顺序：
```bash
docker compose exec app grep -n "app.use.*\/api" /app/server/index.js
```

`express.static` 应该在路由之前配置。

**临时解决方案：禁用压缩**

如果压缩一直失败，可以临时修改上传逻辑，直接使用原文件（需要修改代码）。

**错误 F：登录时出现 503 Service Unavailable**

如果登录时出现 `503 (Service Unavailable)` 错误，说明 Nginx 无法连接到后端应用。

**立即诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 检查所有容器状态
docker compose ps

# 2. 检查应用容器是否正常运行（应该是 healthy）
docker compose ps app

# 3. 测试应用是否可以直接访问
curl http://localhost:3001/api/health

# 4. 从 Nginx 容器测试应用连接（关键步骤）
docker compose exec nginx wget -O- http://app:3001/api/health

# 5. 检查 Nginx 配置中的 upstream 是否正确
docker compose exec nginx cat /etc/nginx/conf.d/default.conf | grep -A 3 upstream

# 6. 检查网络连接
docker network inspect news_newsapp-network | grep -A 5 newsapp

# 7. 查看 Nginx 错误日志
docker compose logs nginx --tail=50 | grep error
```

**常见原因和解决方法：**

1. **应用容器崩溃或未启动**：

```bash
# 查看应用容器状态
docker compose ps app

# 如果状态不是 "Up (healthy)"，查看详细日志
docker compose logs app

# 重启应用容器
docker compose restart app

# 等待启动后查看状态
sleep 10
docker compose ps app
```

2. **应用启动失败**：

```bash
# 查看完整的启动日志
docker compose logs app | tail -100

# 如果看到数据库连接错误，检查数据库容器
docker compose ps mysql
docker compose logs mysql --tail=20
```

3. **Nginx 无法连接到应用**：

```bash
# 检查 Nginx 配置
docker compose exec nginx nginx -t

# 测试从 Nginx 到应用的连接
docker compose exec nginx wget -O- http://app:3001/api/health

# 如果失败，检查网络连接
docker network inspect news_newsapp-network
```

4. **端口冲突**：

```bash
# 检查端口是否被占用
netstat -tulpn | grep 3001

# 如果被占用，修改 .env 文件中的 APP_PORT
```

**错误 I：登录后跳转到 503 错误页面**

如果登录成功但跳转后显示 503，可能是 Dashboard 页面加载时请求失败。

**诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 测试登录接口
curl -X POST http://localhost/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"wenchao"}'

# 2. 测试系统配置接口（Dashboard 加载时会请求这个）
curl http://localhost/api/system/basic-config

# 3. 测试通过 Nginx 访问（模拟浏览器请求）
curl -H "Host: news.gf-dsai.com" http://localhost/api/system/basic-config

# 4. 查看 Nginx 访问日志（查看浏览器请求记录）
docker compose exec nginx tail -30 /var/log/nginx/access.log

# 5. 查看 Nginx 错误日志
docker compose exec nginx tail -30 /var/log/nginx/error.log

# 6. 查看应用日志（查看是否有错误）
docker compose logs app --tail=50 | grep -i error
```

**常见原因和解决方法：**

1. **系统配置接口返回错误**：

```bash
# 检查接口是否正常
curl http://localhost/api/system/basic-config

# 如果返回错误，查看应用日志
docker compose logs app --tail=100
```

2. **前端路由问题**：

登录成功后跳转到 `/dashboard`，如果前端路由配置有问题，可能导致 503。

检查前端文件是否正确构建：
```bash
docker compose exec nginx ls -la /usr/share/nginx/html/
docker compose exec nginx cat /usr/share/nginx/html/index.html
```

3. **API 请求失败**：

如果 Dashboard 加载时请求 `/api/system/basic-config` 失败，检查：
- Nginx 是否能正确代理 `/api` 请求
- 应用容器是否正常运行

**临时解决方案：**

如果系统配置接口有问题，可以临时修改 Dashboard 组件，让它在接口失败时也能正常显示：

```javascript
// 在 Dashboard.jsx 中，修改 fetchSystemConfig 函数
const fetchSystemConfig = async () => {
  try {
    const response = await axios.get('/api/system/basic-config')
    if (response.data.success) {
      setSystemConfig(response.data.data || { system_name: '', logo: '' })
    }
  } catch (error) {
    console.error('获取系统配置失败:', error)
    // 设置默认配置，避免页面无法加载
    setSystemConfig({ system_name: '股权投资小工具', logo: '' })
  }
}
```

**错误 H：通过域名访问返回 503，但本地访问正常**

如果通过域名 `http://news.gf-dsai.com` 访问返回 503，但 `curl http://localhost/` 正常：

**诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 检查 Nginx 错误日志
docker compose logs nginx --tail=50 | grep -i error

# 2. 检查 Nginx 访问日志
docker compose exec nginx tail -20 /var/log/nginx/access.log

# 3. 检查 Nginx 配置中的 server_name
docker compose exec nginx cat /etc/nginx/conf.d/default.conf | grep server_name

# 4. 测试域名解析
nslookup news.gf-dsai.com

# 5. 检查是否有其他 Nginx 配置
docker compose exec nginx ls -la /etc/nginx/conf.d/

# 6. 检查 Nginx 主配置
docker compose exec nginx cat /etc/nginx/nginx.conf
```

**常见原因和解决方法：**

1. **server_name 配置问题**：

确保 `nginx-site.conf` 中的 `server_name` 包含域名：
```nginx
server_name news.gf-dsai.com _;
```

2. **Nginx 配置未正确加载**：

```bash
# 完全重启 Nginx
docker compose stop nginx
docker compose rm -f nginx
docker compose up -d nginx

# 等待启动后测试
sleep 5
curl -I http://news.gf-dsai.com/
```

3. **DNS 解析问题**：

```bash
# 检查域名是否解析到服务器 IP
nslookup news.gf-dsai.com

# 如果解析不正确，需要配置 DNS 记录
```

4. **防火墙或代理问题**：

```bash
# 检查服务器防火墙
ufw status

# 检查端口是否开放
netstat -tulpn | grep :80
```

**错误 J：上传文件后无法访问（404 Not Found）**

如果上传文件成功，但访问上传的文件时返回 404：

**诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 检查上传的文件是否存在
ls -la uploads/

# 2. 检查容器内的文件
docker compose exec app ls -la /app/uploads/

# 3. 测试访问上传的文件
curl -I http://localhost/api/uploads/file-1764671213737-289324164.jpg

# 4. 查看应用日志（查看上传相关的日志）
docker compose logs app --tail=50 | grep -i upload

# 5. 检查 Nginx 是否能正确代理 /api/uploads 请求
curl -v http://localhost/api/uploads/
```

**常见原因和解决方法：**

1. **文件上传成功但路径不对**：

检查应用容器的 uploads 目录：
```bash
docker compose exec app ls -la /app/uploads/
```

2. **Nginx 代理配置问题**：

确保 `/api` 路由能正确代理到应用。测试：
```bash
# 测试 API 代理
curl http://localhost/api/uploads/

# 应该返回目录列表或 403/404（说明路由是通的）
```

3. **文件确实不存在**：

如果上传时返回成功，但文件不存在，可能是：
- 上传后文件被移动或删除
- 权限问题导致文件写入失败
- 压缩处理时文件路径错误

检查上传日志：
```bash
docker compose logs app | grep -i "文件\|upload\|compress"
```

**错误 G：网站刷新后无法进入，静态文件加载失败**

如果网站刷新后出现空白页面，CSS/JS 文件出现 `ERR_CONTENT_LENGTH_MISMATCH` 或 503 错误：

**诊断步骤：**

```bash
cd /opt/newsapp/news

# 1. 检查前端文件是否存在
docker compose exec nginx ls -la /usr/share/nginx/html/

# 2. 检查 assets 目录中的文件
docker compose exec nginx ls -la /usr/share/nginx/html/assets/

# 3. 检查前端文件是否在应用容器中
docker compose exec app ls -la /app/client/dist/

# 4. 检查应用容器中的 assets 目录
docker compose exec app ls -la /app/client/dist/assets/

# 5. 检查 volume 是否正确挂载
docker volume inspect news_app_frontend

# 6. 测试静态文件访问
curl -I http://localhost/assets/index-BMulA4nM.js

# 7. 查看 Nginx 错误日志
docker compose logs nginx --tail=50 | grep -i error

# 8. 检查 Nginx 访问日志
docker compose exec nginx tail -20 /var/log/nginx/access.log
```

**常见原因和解决方法：**

1. **前端文件未构建或未复制到 volume**：

```bash
# 检查应用容器中是否有前端文件
docker compose exec app ls -la /app/client/dist/

# 如果没有文件，需要重新构建应用
docker compose build --no-cache app
docker compose up -d app

# 等待构建完成后，检查文件是否复制到 volume
docker compose exec nginx ls -la /usr/share/nginx/html/
```

2. **Volume 挂载问题**：

```bash
# 检查 volume 是否存在
docker volume ls | grep app_frontend

# 如果不存在，重新创建
docker compose down
docker compose up -d

# 或者手动复制文件（临时方案）
docker compose exec app tar -czf /tmp/frontend.tar.gz -C /app/client/dist .
docker compose cp app:/tmp/frontend.tar.gz /tmp/
docker compose cp /tmp/frontend.tar.gz nginx:/tmp/
docker compose exec nginx tar -xzf /tmp/frontend.tar.gz -C /usr/share/nginx/html/
```

3. **Nginx 配置问题**：

```bash
# 重新加载 Nginx 配置
docker compose exec nginx nginx -s reload

# 或者重启 Nginx
docker compose restart nginx
```

4. **内容长度不匹配（gzip 问题）**：

如果出现 `ERR_CONTENT_LENGTH_MISMATCH`，可能是 gzip 压缩问题。检查 Nginx 配置中的 gzip 设置，确保 `gzip_vary on;` 已设置。

**错误 E：Nginx 容器 unhealthy**

如果 `newsapp-nginx` 容器状态是 `unhealthy`，检查 Nginx 健康检查和日志：

```bash
cd /opt/newsapp/news

# 1. 查看 Nginx 健康检查状态
docker inspect newsapp-nginx | grep -A 20 Health

# 2. 查看 Nginx 日志
docker compose logs nginx --tail=50

# 3. 测试 Nginx 健康检查端点
docker compose exec nginx wget -O- http://localhost/health

# 4. 测试从 Nginx 到应用的连接
docker compose exec nginx wget -O- http://app:3001/api/health

# 5. 检查 Nginx 配置
docker compose exec nginx nginx -t
```

**常见原因和解决方法：**

1. **健康检查端点配置错误**：

Nginx 健康检查配置在 `docker-compose.yml` 中：
```yaml
healthcheck:
  test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
```

确保 `nginx-site.conf` 中有 `/health` 路由配置：
```nginx
location /health {
    proxy_pass http://app_backend/api/health;
    access_log off;
}
```

2. **Nginx 无法连接到应用容器**：

```bash
# 测试从 Nginx 到应用的连接
docker compose exec nginx wget -O- http://app:3001/api/health

# 如果失败，检查网络
docker network inspect news_newsapp-network | grep -A 10 newsapp
```

3. **Nginx 配置语法错误**：

```bash
# 测试配置文件
docker compose exec nginx nginx -t

# 如果失败，检查配置文件
cat deploy/nginx-site.conf
```

4. **临时禁用健康检查（仅用于测试）**：

如果健康检查一直失败但不影响功能，可以临时禁用：

编辑 `docker-compose.yml`，注释掉 Nginx 的健康检查：
```yaml
# healthcheck:
#   test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost/health"]
#   interval: 30s
#   timeout: 10s
#   retries: 3
```

然后重启：
```bash
docker compose up -d nginx
```

**错误 F：Nginx 容器一直重启**

如果 `newsapp-nginx` 容器状态是 `Restarting`，检查 Nginx 日志：

```bash
# 查看 Nginx 容器日志
docker compose logs nginx

# 查看最近的错误日志
docker compose logs nginx --tail=50
```

**常见原因和解决方法：**

1. **Nginx 配置文件不存在或路径错误**：

```bash
# 检查配置文件是否存在
ls -la /opt/newsapp/news/deploy/nginx-site.conf

# 如果不存在，检查是否有模板文件
ls -la /opt/newsapp/news/deploy/
```

2. **Nginx 配置文件语法错误**：

```bash
# 在容器内测试配置文件语法
docker compose exec nginx nginx -t
```

3. **SSL 证书目录不存在**（如果配置了 HTTPS）：

```bash
# 检查 SSL 目录
ls -la /opt/newsapp/news/deploy/ssl/

# 如果不存在，创建目录（即使没有证书，也要创建空目录）
mkdir -p /opt/newsapp/news/deploy/ssl
```

4. **前端文件目录不存在**：

```bash
# 检查前端文件目录
ls -la /opt/newsapp/news/client/dist/

# 如果不存在，可能需要先构建前端
```

**临时解决方案：如果健康检查一直失败，可以暂时禁用健康检查**

编辑 `docker-compose.yml`，注释掉健康检查部分（不推荐，仅用于测试）：

```yaml
# healthcheck:
#   test: ["CMD", "node", "-e", "..."]
#   interval: 30s
#   timeout: 10s
#   retries: 3
#   start_period: 40s
```

- **方案 F：如果本地网络完全无法访问（推荐使用方案 E）**

如果本地电脑上的所有镜像源都无法连接（连接超时），说明本地网络环境受限。**强烈建议使用方案 E：在其他能访问外网的服务器上下载镜像**。

如果确实没有其他服务器可用，可以：

1. **检查是否在公司网络环境**
   - 公司网络可能阻止了 Docker 镜像拉取
   - 尝试连接手机热点，然后重试拉取镜像
   - 或者联系网络管理员配置代理

2. **检查防火墙设置**
   ```powershell
   # 临时关闭 Windows 防火墙测试（不推荐，仅用于测试）
   # 或添加防火墙规则允许 Docker 访问外网
   ```

3. **直接跳过本地下载，在目标服务器上尝试**

如果目标服务器能访问 Docker Hub，可以直接在服务器上拉取：

```bash
# 在目标服务器上直接尝试拉取
docker pull mysql:8.0
docker pull nginx:alpine

# 如果成功，直接启动服务
cd /opt/newsapp/news
docker compose up -d
```

> **注意**：如果本地电脑没有 Docker Desktop，可以在任何能访问外网的 Linux 服务器上执行上述命令。

**步骤 2：上传 tar 文件到服务器**

使用 WinSCP 或 scp 将 `docker-images.tar` 上传到服务器的 `/opt` 目录：

```bash
# 方式 A：使用 scp（在本地 PowerShell 中执行）
scp docker-images.tar user@服务器IP:/opt/

# 方式 B：使用 WinSCP 图形工具
# 1. 打开 WinSCP，连接到服务器
# 2. 在左侧找到 docker-images.tar 文件
# 3. 拖拽到右侧的 /opt 目录
```

**步骤 3：在服务器上导入镜像**

登录到服务器，执行：

```bash
# 导入镜像（可能需要几分钟，文件较大）
docker load -i /opt/docker-images.tar

# 验证镜像已加载
docker images

# 应该能看到类似以下输出：
# REPOSITORY   TAG       IMAGE ID       CREATED       SIZE
# mysql        8.0       ...            ...           ...
# nginx        alpine    ...            ...           ...
```

**步骤 4：启动服务**

镜像导入成功后，启动 Docker Compose 服务：

```bash
cd /opt/newsapp/news
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

> **提示**：如果后续需要更新镜像，可以重复上述步骤，或者联系服务器管理员配置网络访问。

**解决方案 D：联系服务器管理员**

- 检查网络策略是否允许访问 Docker Hub
- 检查是否需要配置代理
- 确认服务器是否有外网访问权限

```bash
# 临时移除镜像加速器配置，直接使用 Docker Hub
sudo rm /etc/docker/daemon.json
sudo systemctl daemon-reload
sudo systemctl restart docker

# 测试能否访问 Docker Hub
curl -I https://registry-1.docker.io

# 如果可以直接访问，尝试拉取镜像
docker pull mysql:8.0
docker pull nginx:alpine
```

4. **手动拉取镜像**（如果加速器仍失败）：

#### 2. 容器无法启动

```bash
# 查看容器日志
docker compose logs app

# 查看容器状态
docker compose ps -a

# 检查容器配置
docker compose config

# 重新创建容器
docker compose up -d --force-recreate app
```

#### 2. 数据库连接失败

```bash
# 检查 MySQL 容器状态
docker compose ps mysql

# 查看 MySQL 日志
docker compose logs mysql

# 测试数据库连接
docker compose exec mysql mysql -u newsapp -p investment_tools

# 检查环境变量
docker compose exec app env | grep DB_
```

#### 3. 应用无法访问

```bash
# 检查应用容器状态
docker compose ps app

# 查看应用日志
docker compose logs app

# 检查端口占用
sudo netstat -tulpn | grep 3001

# 测试应用健康检查
curl http://localhost:3001/api/health

# 检查 Nginx 配置
docker compose exec nginx nginx -t
```

#### 4. Nginx 502 错误

```bash
# 查看 Nginx 错误日志
docker compose logs nginx | grep error

# 检查应用是否运行
docker compose ps app

# 测试应用连接
docker compose exec nginx wget -O- http://app:3001/api/health

# 重新加载 Nginx 配置
docker compose exec nginx nginx -s reload
```

#### 5. 磁盘空间不足

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理未使用的镜像和容器
docker system prune -a

# 清理未使用的数据卷（谨慎操作）
docker volume prune

# 查看日志文件大小
du -sh logs/
```

### 日志分析

```bash
# 实时查看所有服务日志
docker compose logs -f

# 查看特定服务的错误日志
docker compose logs app | grep -i error
docker compose logs mysql | grep -i error
docker compose logs nginx | grep -i error

# 查看最近1小时的日志
docker compose logs --since 1h app
```

## 🔒 安全建议

### 1. Docker 安全

```bash
# 配置 Docker 守护进程安全选项
sudo nano /etc/docker/daemon.json
```

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "userns-remap": "default"
}
```

```bash
# 重启 Docker
sudo systemctl restart docker
```

### 2. 防火墙配置

```bash
# 配置 UFW 防火墙
sudo ufw enable
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 不暴露 MySQL 端口到外网（如果不需要远程访问）
# 默认配置中 MySQL 端口已映射，但建议不开放防火墙
```

### 3. SSL/TLS 配置

```bash
# 安装 Certbot（在主机上）
sudo apt install certbot

# 获取 SSL 证书
sudo certbot certonly --standalone -d your-domain.com

# 复制证书到项目目录
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem deploy/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem deploy/ssl/

# 修改 Nginx 配置启用 HTTPS
# 编辑 deploy/nginx-site.conf 添加 SSL 配置
```

### 4. 环境变量安全

- 使用强密码
- 定期轮换密钥
- 不要将 `.env` 文件提交到 Git
- 使用 Docker secrets（生产环境推荐）

### 5. 容器安全

```bash
# 定期更新镜像
docker compose pull
docker compose up -d

# 扫描镜像漏洞（需要安装 docker scan）
docker scan newsapp:latest
```

## 📦 生产环境优化

### 1. 资源限制

在 `docker-compose.yml` 中添加资源限制：

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 2. 日志轮转

Docker 默认日志驱动已配置日志大小限制，如需自定义：

```yaml
services:
  app:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 3. 健康检查

所有服务已配置健康检查，Docker 会自动监控服务状态。

### 4. 自动重启

所有服务配置了 `restart: unless-stopped`，容器异常退出时会自动重启。

## 🔄 升级和维护

### 更新应用代码

```bash
cd /opt/newsapp

# 备份数据
./deploy/docker-backup.sh

# 拉取最新代码
git pull

# 重新构建并启动
docker compose build app
docker compose up -d --no-deps app

# 验证更新
docker compose logs -f app
curl http://localhost/api/health
```

### 更新 Docker 镜像

```bash
# 更新 MySQL 镜像
docker compose pull mysql
docker compose up -d mysql

# 更新 Nginx 镜像
docker compose pull nginx
docker compose up -d nginx
```

### 清理和维护

```bash
# 清理未使用的镜像
docker image prune -a

# 清理未使用的容器
docker container prune

# 清理未使用的数据卷（谨慎操作）
docker volume prune

# 清理所有未使用的资源
docker system prune -a --volumes
```

## 📞 技术支持

如果在部署过程中遇到问题，请：

1. 查看相关容器日志：`docker compose logs [service-name]`
2. 检查容器状态：`docker compose ps`
3. 验证配置文件：`docker compose config`
4. 参考故障排除章节

### 常用命令速查

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 进入容器
docker compose exec app sh

# 查看资源使用
docker stats

# 备份数据库
docker compose exec mysql mysqldump -u root -p investment_tools > backup.sql
```

---

**注意**: 请在生产环境部署前，务必修改所有默认密码和密钥，并进行充分的测试。
