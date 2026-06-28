# 安装和配置 MySQL

## ✅ 当前状态

- 端口 3306 已释放
- 准备安装 MySQL

## 📋 安装 MySQL 步骤

### 步骤1：清理残留（如果之前安装失败）

```bash
# 清理之前失败的 MySQL 安装
sudo apt remove --purge mysql-server mysql-server-8.0 mysql-client mysql-common -y
sudo apt autoremove -y
sudo rm -rf /var/lib/mysql /var/log/mysql /etc/mysql /run/mysqld
```

### 步骤2：修复包管理器

```bash
# 修复可能损坏的包
sudo apt --fix-broken install

# 更新包列表
sudo apt update
```

### 步骤3：安装 MySQL

```bash
# 安装 MySQL 服务器
sudo apt install mysql-server -y
```

### 步骤4：启动 MySQL

```bash
# 启动 MySQL 服务
sudo systemctl start mysql

# 设置开机自启
sudo systemctl enable mysql

# 检查状态
sudo systemctl status mysql
```

### 步骤5：配置 MySQL（设置 root 密码）

```bash
# 运行安全配置脚本
sudo mysql_secure_installation
```

按提示操作：
- 设置 root 密码：Y（输入并确认密码）
- 移除匿名用户：Y
- 禁止 root 远程登录：Y（如果只本地使用）
- 移除测试数据库：Y
- 重新加载权限表：Y

### 步骤6：创建应用数据库

```bash
# 登录 MySQL（使用刚才设置的密码）
sudo mysql -u root -p

# 在 MySQL 中执行
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 查看数据库
SHOW DATABASES;

# 退出
exit;
```

### 步骤7：更新 .env 文件

```bash
cd /opt/newsapp/news

# 编辑 .env 文件
nano .env
```

确保数据库配置正确：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你刚才设置的MySQL root密码
DB_NAME=investment_tools
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

## 🚀 一键安装命令

```bash
# 清理残留
sudo apt remove --purge mysql-server mysql-server-8.0 mysql-client mysql-common -y 2>/dev/null
sudo apt autoremove -y
sudo rm -rf /var/lib/mysql /var/log/mysql /etc/mysql /run/mysqld

# 修复包管理器
sudo apt --fix-broken install
sudo apt update

# 安装 MySQL
sudo apt install mysql-server -y

# 启动 MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# 检查状态
sudo systemctl status mysql --no-pager -l | head -20
```

## 🔧 如果安装过程中有错误

### 错误1：安装配置失败

```bash
# 查看错误日志
sudo tail -100 /var/log/mysql/error.log

# 尝试修复配置
sudo dpkg --configure -a
sudo apt --fix-broken install
```

### 错误2：端口仍然被占用

```bash
# 再次检查并清理
sudo lsof -i :3306
sudo fuser -k 3306/tcp
sudo pkill -9 mysql mysqld
sleep 3
sudo systemctl start mysql
```

### 错误3：权限问题

```bash
# 修复权限
sudo chown -R mysql:mysql /var/lib/mysql
sudo chmod 755 /var/lib/mysql
sudo systemctl start mysql
```

## 📋 安装后配置

### 1. 设置 root 密码（如果安装时未设置）

```bash
# 登录 MySQL（如果未设置密码，可以直接登录）
sudo mysql -u root

# 在 MySQL 中设置密码
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的密码';
FLUSH PRIVILEGES;
exit;
```

### 2. 创建应用数据库

```bash
# 登录 MySQL
sudo mysql -u root -p

# 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 查看数据库
SHOW DATABASES;

# 退出
exit;
```

### 3. 测试连接

```bash
# 测试连接
mysql -h localhost -u root -p

# 或使用 sudo（如果未设置密码）
sudo mysql -u root
```

## ✅ 验证安装

```bash
# 1. 检查服务状态
sudo systemctl status mysql

# 2. 测试连接
sudo mysql -u root -p -e "SELECT 1;"

# 3. 查看数据库
sudo mysql -u root -p -e "SHOW DATABASES;"

# 4. 检查端口
sudo netstat -tulpn | grep 3306

# 5. 重启应用
cd /opt/newsapp/news
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## 🔍 常见问题

### 问题1：安装后无法启动

```bash
# 查看错误日志
sudo tail -100 /var/log/mysql/error.log

# 检查权限
sudo ls -la /var/lib/mysql

# 修复权限
sudo chown -R mysql:mysql /var/lib/mysql
sudo systemctl start mysql
```

### 问题2：忘记 root 密码

```bash
# 停止 MySQL
sudo systemctl stop mysql

# 以安全模式启动
sudo mysqld_safe --skip-grant-tables &

# 登录并重置密码
mysql -u root
ALTER USER 'root'@'localhost' IDENTIFIED BY '新密码';
FLUSH PRIVILEGES;
exit;

# 重启 MySQL
sudo systemctl restart mysql
```

### 问题3：应用无法连接

```bash
# 检查 .env 配置
cd /opt/newsapp/news
cat .env | grep DB_

# 测试连接
mysql -h localhost -u root -p investment_tools

# 检查 MySQL 用户权限
sudo mysql -u root -p
SELECT user, host FROM mysql.user;
```

## 📝 完整安装流程

```bash
# 1. 清理残留
sudo apt remove --purge mysql-server mysql-server-8.0 mysql-client mysql-common -y 2>/dev/null
sudo apt autoremove -y
sudo rm -rf /var/lib/mysql /var/log/mysql /etc/mysql /run/mysqld

# 2. 修复并更新
sudo apt --fix-broken install
sudo apt update

# 3. 安装 MySQL
sudo apt install mysql-server -y

# 4. 启动 MySQL
sudo systemctl start mysql
sudo systemctl enable mysql

# 5. 运行安全配置（设置密码）
sudo mysql_secure_installation

# 6. 创建数据库
sudo mysql -u root -p <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SHOW DATABASES;
EOF

# 7. 更新 .env（记住在 mysql_secure_installation 中设置的密码）
cd /opt/newsapp/news
# 编辑 .env 文件，设置 DB_PASSWORD

# 8. 重启应用
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

