# 修复 MySQL 目录问题

## ❌ 错误信息

```
Directory '/var/run/mysqld' for UNIX socket file don't exists.
```

## ✅ 解决方法

### 步骤1：停止当前进程

```bash
# 停止安全模式的 MySQL
sudo pkill mysqld
sudo pkill mysqld_safe

# 等待进程停止
sleep 2
```

### 步骤2：创建缺失的目录

```bash
# 创建 socket 目录
sudo mkdir -p /var/run/mysqld

# 设置权限
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld
```

### 步骤3：重新以安全模式启动

```bash
# 以安全模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &

# 等待启动
sleep 5

# 检查进程
ps aux | grep mysqld
```

### 步骤4：登录并重置密码

```bash
# 登录 MySQL（不需要密码）
mysql -u root

# 在 MySQL 中执行
```

```sql
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
FLUSH PRIVILEGES;
exit;
```

### 步骤5：停止安全模式并正常启动

```bash
# 停止安全模式的 MySQL
sudo pkill mysqld
sudo pkill mysqld_safe

# 正常启动 MySQL
sudo systemctl start mysql

# 检查状态
sudo systemctl status mysql
```

## 🚀 一键修复命令

```bash
# 停止所有 MySQL 进程
sudo pkill mysqld mysqld_safe 2>/dev/null
sleep 2

# 创建目录并设置权限
sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld

# 以安全模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &
sleep 5

# 重置密码
mysql -u root <<EOF
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
FLUSH PRIVILEGES;
EOF

# 停止安全模式
sudo pkill mysqld mysqld_safe

# 正常启动
sudo systemctl start mysql

# 创建数据库和远程用户
sudo mysql -u root -pRootPassword123 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
EOF

# 配置防火墙
sudo ufw allow 3306/tcp

# 验证
sudo systemctl status mysql --no-pager -l | head -10
sudo netstat -tulpn | grep 3306
```

**注意**：请将 `RootPassword123` 替换为你想要的 root 密码。

## 📋 详细步骤

### 步骤1：清理并创建目录

```bash
# 停止所有 MySQL 相关进程
sudo pkill mysqld
sudo pkill mysqld_safe
sudo systemctl stop mysql 2>/dev/null

# 等待进程停止
sleep 3

# 创建目录
sudo mkdir -p /var/run/mysqld

# 设置权限
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld

# 验证目录
ls -la /var/run/mysqld
```

### 步骤2：以安全模式启动

```bash
# 启动安全模式
sudo mysqld_safe --skip-grant-tables --skip-networking &

# 等待启动
sleep 5

# 检查是否启动成功
ps aux | grep mysqld | grep -v grep
```

### 步骤3：重置密码

```bash
# 登录 MySQL
mysql -u root

# 执行 SQL
```

```sql
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
FLUSH PRIVILEGES;
exit;
```

### 步骤4：正常启动 MySQL

```bash
# 停止安全模式
sudo pkill mysqld
sudo pkill mysqld_safe

# 等待停止
sleep 2

# 正常启动
sudo systemctl start mysql

# 检查状态
sudo systemctl status mysql
```

### 步骤5：创建远程用户

```bash
# 使用新密码登录
sudo mysql -u root -pRootPassword123
```

```sql
-- 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建远程用户
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';

-- 授予权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW DATABASES;

-- 退出
exit;
```

### 步骤6：配置防火墙

```bash
# 开放端口
sudo ufw allow 3306/tcp
sudo ufw reload
```

## ✅ 验证

```bash
# 1. 检查 MySQL 状态
sudo systemctl status mysql

# 2. 检查监听地址
sudo netstat -tulpn | grep 3306

# 3. 测试 root 登录
sudo mysql -u root -pRootPassword123 -e "SELECT 1;"

# 4. 测试 newsapp 用户
mysql -h localhost -u newsapp -p98K6^7s8!9Z8*76p8 -e "SELECT 1;"
```

## 🔍 如果仍然有问题

### 检查错误日志

```bash
# 查看 MySQL 错误日志
sudo tail -50 /var/log/mysql/error.log
```

### 检查目录权限

```bash
# 检查所有相关目录
ls -la /var/run/mysqld
ls -la /var/lib/mysql
ls -la /var/log/mysql
```

### 修复所有权限

```bash
# 修复所有 MySQL 相关目录权限
sudo chown -R mysql:mysql /var/lib/mysql
sudo chown -R mysql:mysql /var/log/mysql
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld
```

