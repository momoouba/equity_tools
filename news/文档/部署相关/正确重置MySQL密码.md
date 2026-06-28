# 正确重置 MySQL 密码

## ❌ 错误原因

在 `--skip-grant-tables` 模式下，不能使用 `ALTER USER` 命令，因为该命令需要访问权限表。

## ✅ 正确方法：直接更新 mysql.user 表

### 步骤1：停止当前 MySQL 进程

```bash
# 停止安全模式的 MySQL
sudo pkill mysqld
sudo pkill mysqld_safe

# 等待停止
sleep 2
```

### 步骤2：以安全模式启动

```bash
# 确保目录存在
sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld

# 以安全模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &

# 等待启动
sleep 5
```

### 步骤3：直接更新 mysql.user 表（正确方法）

```bash
mysql -u root <<EOF
USE mysql;
UPDATE user SET authentication_string=PASSWORD('Mqdqxygyqy!!!klklsys24678') WHERE User='root' AND Host='localhost';
FLUSH PRIVILEGES;
exit;
EOF
```

**注意**：如果 `PASSWORD()` 函数不可用，使用以下方法：

```bash
mysql -u root <<EOF
USE mysql;
UPDATE user SET plugin='mysql_native_password', authentication_string='' WHERE User='root' AND Host='localhost';
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Mqdqxygyqy!!!klklsys24678';
FLUSH PRIVILEGES;
exit;
EOF
```

### 步骤4：停止安全模式并正常启动

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

### 步骤5：使用新密码登录测试

```bash
# 测试登录
sudo mysql -u root -pMqdqxygyqy!!!klklsys24678 -e "SELECT 1;"
```

## 🚀 完整一键重置命令

```bash
# 停止所有 MySQL 进程
sudo pkill mysqld mysqld_safe 2>/dev/null
sleep 2

# 创建目录
sudo mkdir -p /var/run/mysqld
sudo chown mysql:mysql /var/run/mysqld
sudo chmod 755 /var/run/mysqld

# 以安全模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &
sleep 5

# 重置密码（方法1：如果 PASSWORD() 可用）
mysql -u root <<EOF
USE mysql;
UPDATE user SET plugin='mysql_native_password', authentication_string='' WHERE User='root' AND Host='localhost';
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Mqdqxygyqy!!!klklsys24678';
FLUSH PRIVILEGES;
exit;
EOF

# 如果方法1失败，使用方法2
# mysql -u root <<EOF
# USE mysql;
# UPDATE user SET authentication_string=PASSWORD('Mqdqxygyqy!!!klklsys24678') WHERE User='root' AND Host='localhost';
# FLUSH PRIVILEGES;
# exit;
# EOF

# 停止安全模式
sudo pkill mysqld mysqld_safe
sleep 2

# 正常启动
sudo systemctl start mysql

# 测试登录
sudo mysql -u root -pMqdqxygyqy!!!klklsys24678 -e "SELECT 1;"
```

## 🔄 如果方法1失败，使用备用方法

### 备用方法：使用 UPDATE 直接设置密码哈希

```bash
# 停止并启动安全模式
sudo pkill mysqld mysqld_safe
sleep 2
sudo mysqld_safe --skip-grant-tables --skip-networking &
sleep 5

# 方法：先清空密码，然后使用 ALTER USER
mysql -u root <<EOF
USE mysql;
UPDATE user SET plugin='mysql_native_password', authentication_string='' WHERE User='root';
FLUSH PRIVILEGES;
exit;
EOF

# 停止安全模式
sudo pkill mysqld mysqld_safe
sleep 2

# 正常启动
sudo systemctl start mysql

# 现在可以无密码登录，然后设置密码
sudo mysql -u root <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Mqdqxygyqy!!!klklsys24678';
FLUSH PRIVILEGES;
exit;
EOF
```

## 📋 创建远程用户

重置密码成功后，创建远程用户：

```bash
# 使用新密码登录
sudo mysql -u root -pMqdqxygyqy!!!klklsys24678 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW DATABASES;
EOF
```

## ✅ 验证

```bash
# 1. 检查 MySQL 状态
sudo systemctl status mysql

# 2. 检查监听地址
sudo netstat -tulpn | grep 3306

# 3. 测试 root 登录
sudo mysql -u root -pMqdqxygyqy!!!klklsys24678 -e "SELECT 1;"

# 4. 测试 newsapp 用户
mysql -h localhost -u newsapp -p98K6^7s8!9Z8*76p8 -e "SELECT 1;"
```

## 🔍 如果仍然失败

### 检查 MySQL 版本

```bash
# 查看 MySQL 版本
mysql --version
```

### 查看错误日志

```bash
# 查看详细错误
sudo tail -50 /var/log/mysql/error.log
```

### 使用 mysql_secure_installation

如果上述方法都失败，可以尝试：

```bash
# 停止 MySQL
sudo systemctl stop mysql

# 以安全模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &
sleep 5

# 清空 root 密码（注意：不要使用 exit;，直接结束 EOF）
mysql -u root <<EOF
USE mysql;
UPDATE user SET plugin='mysql_native_password', authentication_string='' WHERE User='root';
FLUSH PRIVILEGES;
EOF

# 停止并正常启动
sudo pkill mysqld mysqld_safe
sudo systemctl start mysql

# 使用 mysql_secure_installation 设置密码
sudo mysql_secure_installation
```

