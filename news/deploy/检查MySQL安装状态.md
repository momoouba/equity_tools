# 检查 MySQL 安装状态

## 🔍 检查 MySQL 是否可用

即使安装有报错，MySQL 可能仍然可用。让我们先检查：

### 步骤1：检查 MySQL 服务状态

```bash
# 检查服务状态
sudo systemctl status mysql

# 检查进程是否运行
ps aux | grep mysql

# 检查端口是否监听
sudo netstat -tulpn | grep 3306
```

### 步骤2：尝试启动 MySQL

```bash
# 尝试启动 MySQL
sudo systemctl start mysql

# 检查状态
sudo systemctl status mysql
```

### 步骤3：测试连接

```bash
# 尝试连接 MySQL
sudo mysql -u root

# 或
mysql -h localhost -u root
```

## ✅ 如果 MySQL 可以连接

如果能够连接 MySQL，说明虽然安装有报错，但 MySQL 基本可用：

```bash
# 1. 创建数据库
sudo mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SHOW DATABASES;
EOF

# 2. 更新 .env（如果 root 无密码）
cd /opt/newsapp/news
# 确保 DB_PASSWORD 为空或正确

# 3. 重启应用
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## ❌ 如果 MySQL 无法使用

如果 MySQL 无法启动或连接，需要修复：

### 方法1：修复配置问题

```bash
# 查看 MySQL 错误日志
sudo tail -50 /var/log/mysql/error.log

# 尝试手动初始化
sudo mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql

# 启动 MySQL
sudo systemctl start mysql
```

### 方法2：完全清理并使用 MariaDB（推荐）

如果 MySQL 一直有问题，建议使用 MariaDB：

```bash
# 1. 完全清理 MySQL
sudo apt remove --purge mysql-server mysql-server-8.0 mysql-client mysql-common -y
sudo apt autoremove -y
sudo rm -rf /var/lib/mysql /var/log/mysql /etc/mysql

# 2. 修复包管理器
sudo apt --fix-broken install

# 3. 安装 MariaDB
sudo apt update
sudo apt install mariadb-server -y

# 4. 启动 MariaDB
sudo systemctl start mariadb
sudo systemctl enable mariadb

# 5. 创建数据库
sudo mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOF
```

## 🚀 快速检查命令

```bash
# 一键检查 MySQL 状态
echo "=== 检查 MySQL 服务 ===" && \
sudo systemctl status mysql --no-pager -l && \
echo -e "\n=== 检查 MySQL 进程 ===" && \
ps aux | grep mysql | grep -v grep && \
echo -e "\n=== 检查端口 ===" && \
sudo netstat -tulpn | grep 3306 && \
echo -e "\n=== 测试连接 ===" && \
sudo mysql -u root -e "SELECT 1;" 2>&1
```

## 📋 判断标准

### MySQL 可用的情况

如果以下命令都成功，说明 MySQL 可用：

```bash
# 1. 服务运行
sudo systemctl status mysql | grep "active (running)"

# 2. 可以连接
sudo mysql -u root -e "SELECT 1;"

# 3. 端口监听
sudo netstat -tulpn | grep 3306
```

### MySQL 不可用的情况

如果以下情况出现，需要修复：

- 服务无法启动：`sudo systemctl start mysql` 失败
- 无法连接：`sudo mysql -u root` 报错
- 端口未监听：`netstat -tulpn | grep 3306` 无输出
- 错误日志有严重错误：`sudo tail /var/log/mysql/error.log`

## 💡 建议

1. **先检查是否可用**：即使有安装错误，MySQL 可能仍然可用
2. **如果可用**：直接使用，创建数据库即可
3. **如果不可用**：使用 MariaDB 替代（更稳定）

## 🔧 如果选择修复 MySQL

```bash
# 查看详细错误
sudo tail -100 /var/log/mysql/error.log

# 尝试修复配置
sudo dpkg --configure -a

# 重新配置 MySQL
sudo dpkg-reconfigure mysql-server-8.0
```

