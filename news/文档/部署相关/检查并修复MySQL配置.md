# 检查并修复 MySQL 配置

## 🔍 当前问题

1. `.env` 文件中 `DB_HOST=mysql`（需要改为 `localhost`）
2. MySQL 服务未找到（可能未安装或服务名不同）

## ✅ 解决步骤

### 步骤1：检查 MySQL/MariaDB 是否安装

```bash
# 检查 MySQL 服务
sudo systemctl status mysql
sudo systemctl status mysqld

# 检查 MariaDB 服务（很多系统使用 MariaDB）
sudo systemctl status mariadb

# 检查是否安装了 MySQL/MariaDB
which mysql
which mysqld
dpkg -l | grep mysql
dpkg -l | grep mariadb
```

### 步骤2：修改 .env 文件

无论 MySQL 是否安装，都需要先修改 `.env` 文件：

```bash
cd /opt/newsapp/news

# 修改 DB_HOST
sed -i 's/DB_HOST=mysql/DB_HOST=localhost/g' .env

# 验证修改
cat .env | grep DB_HOST
# 应该显示：DB_HOST=localhost
```

### 步骤3：如果 MySQL 已安装但服务名不同

#### 情况A：使用 MariaDB

```bash
# 检查 MariaDB 状态
sudo systemctl status mariadb

# 启动 MariaDB
sudo systemctl start mariadb

# 设置开机自启
sudo systemctl enable mariadb
```

#### 情况B：使用 MySQL 但服务名不同

```bash
# 查找所有 MySQL 相关服务
sudo systemctl list-units | grep -i mysql
sudo systemctl list-units | grep -i mariadb

# 尝试启动找到的服务
sudo systemctl start <服务名>
```

### 步骤4：如果 MySQL 未安装

#### 安装 MySQL

```bash
# 更新包列表
sudo apt update

# 安装 MySQL 服务器
sudo apt install mysql-server -y

# 启动 MySQL
sudo systemctl start mysql

# 设置开机自启
sudo systemctl enable mysql

# 运行安全配置（设置 root 密码）
sudo mysql_secure_installation
```

#### 或安装 MariaDB（MySQL 的替代品）

```bash
# 更新包列表
sudo apt update

# 安装 MariaDB 服务器
sudo apt install mariadb-server -y

# 启动 MariaDB
sudo systemctl start mariadb

# 设置开机自启
sudo systemctl enable mariadb

# 运行安全配置
sudo mysql_secure_installation
```

### 步骤5：配置数据库

```bash
# 登录 MySQL（如果设置了密码）
sudo mysql -u root -p

# 或如果未设置密码
sudo mysql -u root

# 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 创建用户（如果需要）
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;

# 退出
exit;
```

### 步骤6：更新 .env 文件

```bash
cd /opt/newsapp/news

# 编辑 .env 文件
nano .env
```

确保配置正确：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你的数据库密码
DB_NAME=investment_tools
```

### 步骤7：测试数据库连接

```bash
# 安装 MySQL 客户端（如果未安装）
sudo apt install mysql-client-core-8.0 -y

# 或安装 MariaDB 客户端
sudo apt install mariadb-client-core-10.6 -y

# 测试连接
mysql -h localhost -u root -p

# 或使用配置中的用户
mysql -h localhost -u <DB_USER> -p
```

### 步骤8：重启应用

```bash
# 重启 PM2 应用
pm2 restart newsapp

# 查看日志
pm2 logs newsapp --lines 50

# 检查错误
pm2 logs newsapp --err --lines 20
```

## 🚀 快速修复命令

### 如果 MySQL 已安装（只是服务名不同）

```bash
cd /opt/newsapp/news && \
sed -i 's/DB_HOST=mysql/DB_HOST=localhost/g' .env && \
sudo systemctl start mariadb 2>/dev/null || sudo systemctl start mysql 2>/dev/null || true && \
pm2 restart newsapp && \
pm2 logs newsapp --lines 50
```

### 如果 MySQL 未安装（需要安装）

```bash
# 1. 修改 .env
cd /opt/newsapp/news
sed -i 's/DB_HOST=mysql/DB_HOST=localhost/g' .env

# 2. 安装 MySQL
sudo apt update
sudo apt install mysql-server -y
sudo systemctl start mysql
sudo systemctl enable mysql

# 3. 配置数据库
sudo mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOF

# 4. 重启应用
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## 🔍 检查清单

修复后，确认以下事项：

- [ ] `.env` 文件中 `DB_HOST=localhost`（不是 mysql）
- [ ] MySQL/MariaDB 服务正在运行：`sudo systemctl status mysql` 或 `sudo systemctl status mariadb`
- [ ] 可以手动连接数据库：`mysql -h localhost -u root -p`
- [ ] 数据库 `investment_tools` 已创建
- [ ] `pm2 status` 显示所有实例为 `online`
- [ ] `pm2 logs newsapp` 没有数据库连接错误
- [ ] `curl http://localhost:3001/api/health` 返回正常

## 📋 常用 MySQL 命令

```bash
# 检查服务状态
sudo systemctl status mysql
sudo systemctl status mariadb

# 启动服务
sudo systemctl start mysql
sudo systemctl start mariadb

# 停止服务
sudo systemctl stop mysql
sudo systemctl stop mariadb

# 重启服务
sudo systemctl restart mysql
sudo systemctl restart mariadb

# 查看端口
netstat -tulpn | grep 3306

# 登录 MySQL
sudo mysql -u root
mysql -h localhost -u root -p

# 查看数据库
mysql -h localhost -u root -p -e "SHOW DATABASES;"
```

## ⚠️ 注意事项

1. **如果使用 Docker**：MySQL 可能在 Docker 容器中，需要检查容器状态
2. **如果使用远程数据库**：需要修改 `DB_HOST` 为实际的数据库服务器 IP
3. **防火墙**：确保端口 3306 没有被防火墙阻止

## 📞 如果仍然有问题

1. **查看 MySQL 错误日志**：
   ```bash
   sudo tail -f /var/log/mysql/error.log
   ```

2. **检查端口占用**：
   ```bash
   sudo netstat -tulpn | grep 3306
   ```

3. **查看应用详细错误**：
   ```bash
   pm2 logs newsapp --err --lines 100
   ```

