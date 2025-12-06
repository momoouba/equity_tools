# 修复 MySQL 远程连接权限

## ❌ 错误信息

```
1130 - Host '120.229.19.72' is not allowed to connect to this MySQL server
```

## ✅ 问题分析

这个错误说明：
- MySQL 服务器可以接收连接（网络正常）
- 但是用户 `newsapp` 没有权限从 IP `120.229.19.72` 连接
- 需要检查并修复用户权限

## 🔧 解决步骤

### 步骤1：检查当前用户权限

```bash
# 使用 root 登录（使用单引号包裹密码）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF
```

### 步骤2：如果用户不存在或 host 不对，重新创建

```bash
# 删除旧用户（如果存在）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'localhost';
DROP USER IF EXISTS 'newsapp'@'%';
FLUSH PRIVILEGES;
EOF

# 重新创建用户（允许从任何 IP 连接）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF
```

### 步骤3：验证用户权限

```bash
# 检查用户和权限
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF
```

### 步骤4：测试本地连接

```bash
# 在服务器上测试 newsapp 用户连接
mysql -h localhost -u newsapp -p'98K6^7s8!9Z8*76p8' -e "SELECT 1;"
```

## 🚀 一键修复命令

```bash
# 删除并重新创建 newsapp 用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'localhost';
DROP USER IF EXISTS 'newsapp'@'%';
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'newsapp'@'%' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF

# 验证监听地址
sudo netstat -tulpn | grep 3306

# 测试本地连接
mysql -h localhost -u newsapp -p'98K6^7s8!9Z8*76p8' -e "SELECT 1;"
```

## 🔍 如果仍然失败，检查其他可能原因

### 检查 MySQL 配置

```bash
# 检查 bind-address（应该监听 0.0.0.0）
sudo grep bind-address /etc/mysql/mysql.conf.d/mysqld.cnf
sudo grep bind-address /etc/mysql/my.cnf

# 如果显示 127.0.0.1，需要修改为 0.0.0.0
sudo sed -i 's/bind-address.*=.*127.0.0.1/bind-address = 0.0.0.0/' /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl restart mysql
```

### 检查防火墙

```bash
# 检查防火墙状态
sudo ufw status

# 确保 3306 端口开放
sudo ufw allow 3306/tcp
sudo ufw reload
```

### 检查云服务器安全组

如果使用云服务器（阿里云、腾讯云等），确保在云控制台配置：
1. 登录云服务器控制台
2. 找到服务器实例
3. 进入安全组配置
4. 添加入站规则：
   - 端口：3306
   - 协议：TCP
   - 源：0.0.0.0/0 或你的客户端 IP（120.229.19.72）

## 📋 详细诊断步骤

### 1. 检查用户是否存在

```bash
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT user, host FROM mysql.user;"
```

### 2. 检查用户权限

```bash
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SHOW GRANTS FOR 'newsapp'@'%';"
```

### 3. 检查 MySQL 监听地址

```bash
sudo netstat -tulpn | grep 3306
# 应该显示 0.0.0.0:3306
```

### 4. 检查 MySQL 错误日志

```bash
# 查看最近的错误日志
sudo tail -50 /var/log/mysql/error.log | grep -i "access denied\|host"
```

## ✅ 验证清单

配置完成后，确认：

- [ ] 用户 `newsapp@'%'` 已创建
- [ ] 用户有正确的权限（GRANT ALL PRIVILEGES）
- [ ] MySQL 监听 `0.0.0.0:3306`
- [ ] 防火墙已开放 3306 端口
- [ ] 云服务器安全组已配置（如果使用）
- [ ] 可以从 Navicat 连接

## 🔒 安全建议

如果只想允许特定 IP 连接（更安全）：

```bash
# 只允许你的 IP 连接
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'%';
CREATE USER 'newsapp'@'120.229.19.72' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'120.229.19.72';
FLUSH PRIVILEGES;
EOF
```

## 📋 Navicat 连接配置

在 Navicat 中配置：
- **连接名**：news
- **主机**：119.3.127.211
- **端口**：3306
- **用户名**：newsapp
- **密码**：98K6^7s8!9Z8*76p8
- **数据库**：investment_tools

