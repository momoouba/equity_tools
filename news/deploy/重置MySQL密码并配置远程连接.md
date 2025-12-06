# 重置 MySQL 密码并配置远程连接

## ✅ 当前状态

- MySQL 已监听 `0.0.0.0:3306`（可以远程连接）
- root 密码不正确，需要重置

## 🔧 重置 root 密码

### 步骤1：停止 MySQL

```bash
sudo systemctl stop mysql
```

### 步骤2：以安全模式启动 MySQL

```bash
# 以跳过权限检查模式启动
sudo mysqld_safe --skip-grant-tables --skip-networking &

# 等待 MySQL 启动
sleep 5
```

### 步骤3：登录并重置密码

```bash
# 登录 MySQL（不需要密码）
mysql -u root

# 在 MySQL 中执行
```

```sql
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的新密码';
FLUSH PRIVILEGES;
exit;
```

### 步骤4：停止安全模式并正常启动

```bash
# 停止安全模式的 MySQL
sudo pkill mysqld

# 正常启动 MySQL
sudo systemctl start mysql

# 检查状态
sudo systemctl status mysql
```

### 步骤5：使用新密码登录测试

```bash
# 使用新密码登录
sudo mysql -u root -p
# 输入刚才设置的密码
```

## 🚀 一键重置密码命令

```bash
# 重置 root 密码为 'RootPassword123'（请修改为你的密码）
sudo systemctl stop mysql && \
sudo mysqld_safe --skip-grant-tables --skip-networking & \
sleep 5 && \
mysql -u root <<EOF
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
FLUSH PRIVILEGES;
EOF
sudo pkill mysqld && \
sudo systemctl start mysql && \
sudo mysql -u root -pRootPassword123 -e "SELECT 1;"
```

## 📋 创建远程用户并配置

### 步骤1：使用 root 登录

```bash
# 使用重置后的密码登录
sudo mysql -u root -p你的密码
```

### 步骤2：创建远程用户和数据库

```sql
-- 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建允许远程连接的用户（使用 % 表示允许任何 IP）
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';

-- 授予权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证用户
SELECT user, host FROM mysql.user WHERE user='newsapp';

-- 退出
exit;
```

### 步骤3：配置防火墙

```bash
# 检查防火墙状态
sudo ufw status

# 开放 3306 端口
sudo ufw allow 3306/tcp

# 重新加载
sudo ufw reload
```

### 步骤4：验证远程连接

```bash
# 在服务器上测试（模拟远程连接）
mysql -h 119.3.127.211 -u newsapp -p98K6^7s8!9Z8*76p8 -e "SELECT 1;"
```

## 🔒 完整配置流程

### 一键配置（重置密码 + 创建远程用户）

```bash
# 1. 重置 root 密码
sudo systemctl stop mysql && \
sudo mysqld_safe --skip-grant-tables --skip-networking & \
sleep 5 && \
mysql -u root <<EOF
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
FLUSH PRIVILEGES;
EOF
sudo pkill mysqld && \
sudo systemctl start mysql && \

# 2. 创建数据库和远程用户
sudo mysql -u root -pRootPassword123 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW DATABASES;
EOF

# 3. 配置防火墙
sudo ufw allow 3306/tcp

# 4. 验证监听地址
sudo netstat -tulpn | grep 3306
```

**注意**：请将 `RootPassword123` 替换为你想要的 root 密码。

## 🔍 验证配置

### 检查 MySQL 监听

```bash
# 应该显示 0.0.0.0:3306
sudo netstat -tulpn | grep 3306
```

### 检查用户

```bash
# 查看用户
sudo mysql -u root -p你的密码 -e "SELECT user, host FROM mysql.user WHERE user='newsapp';"
```

### 测试远程连接

```bash
# 在服务器上测试（模拟远程）
mysql -h 119.3.127.211 -u newsapp -p98K6^7s8!9Z8*76p8 -e "USE investment_tools; SELECT 1;"
```

## ⚠️ 重要提示

1. **云服务器安全组**：如果使用云服务器，必须在云控制台配置安全组，开放 3306 端口
2. **密码安全**：确保使用强密码
3. **IP 限制**：如果可能，只允许特定 IP 连接（更安全）

## 📋 Navicat 连接配置

在 Navicat 中配置：
- **连接名**：news
- **主机**：119.3.127.211
- **端口**：3306
- **用户名**：newsapp
- **密码**：98K6^7s8!9Z8*76p8
- **数据库**：investment_tools

## ✅ 检查清单

配置完成后，确认：

- [ ] MySQL 监听 `0.0.0.0:3306`
- [ ] root 密码已重置并可以登录
- [ ] 用户 `newsapp@'%'` 已创建
- [ ] 数据库 `investment_tools` 已创建
- [ ] 防火墙已开放 3306 端口
- [ ] 云服务器安全组已配置（如果使用）
- [ ] 可以从 Navicat 连接

