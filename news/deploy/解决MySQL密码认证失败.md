# 解决 MySQL 密码认证失败 (1045)

## ❌ 错误信息

```
1045 - Access denied for user 'newsapp'@'120.229.19.72' (using password: YES)
```

## ✅ 问题分析

这个错误说明：
- 网络连接正常（能到达 MySQL 服务器）
- 用户权限正常（host 允许连接）
- **但是密码认证失败**

可能的原因：
1. 密码不正确
2. 密码中的特殊字符在 Navicat 中需要特殊处理
3. 用户密码没有正确设置

## 🔧 解决步骤

### 步骤1：验证当前密码

```bash
# 在服务器上测试 newsapp 用户密码
mysql -h localhost -u newsapp -p'98K6^7s8!9Z8*76p8' -e "SELECT 1;"
```

### 步骤2：重新设置密码（使用简单密码测试）

```bash
# 使用 root 登录，重新设置 newsapp 密码
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
ALTER USER 'newsapp'@'%' IDENTIFIED BY 'NewsApp123456';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
EOF

# 测试新密码
mysql -h localhost -u newsapp -p'NewsApp123456' -e "SELECT 1;"
```

### 步骤3：如果仍然失败，完全重建用户

```bash
# 删除并重新创建用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'%';
DROP USER IF EXISTS 'newsapp'@'localhost';
CREATE USER 'newsapp'@'%' IDENTIFIED BY 'NewsApp123456';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF

# 测试连接
mysql -h localhost -u newsapp -p'NewsApp123456' -e "SELECT 1;"
```

## 🚀 一键修复命令（使用简单密码）

```bash
# 删除并重新创建用户，使用简单密码
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'%';
DROP USER IF EXISTS 'newsapp'@'localhost';
CREATE USER 'newsapp'@'%' IDENTIFIED BY 'NewsApp123456';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF

# 测试本地连接
mysql -h localhost -u newsapp -p'NewsApp123456' -e "SELECT 1;"
```

## 📋 Navicat 连接配置（使用新密码）

在 Navicat 中配置：
- **连接名**：news
- **主机**：119.3.127.211
- **端口**：3306
- **用户名**：newsapp
- **密码**：NewsApp123456（新密码，不包含特殊字符）
- **数据库**：investment_tools

## 🔍 如果仍然失败，检查其他可能原因

### 检查用户认证插件

```bash
# 检查用户使用的认证插件
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT user, host, plugin FROM mysql.user WHERE user='newsapp';"
```

### 如果使用 caching_sha2_password，改为 mysql_native_password

```bash
# 修改认证插件
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
ALTER USER 'newsapp'@'%' IDENTIFIED WITH mysql_native_password BY 'NewsApp123456';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user='newsapp';
EOF
```

## 🔄 完整修复流程（推荐）

```bash
# 1. 删除旧用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'%';
DROP USER IF EXISTS 'newsapp'@'localhost';
FLUSH PRIVILEGES;
EOF

# 2. 创建新用户（使用 mysql_native_password 插件）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
CREATE USER 'newsapp'@'%' IDENTIFIED WITH mysql_native_password BY 'NewsApp123456';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'%';
FLUSH PRIVILEGES;
SELECT user, host, plugin FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'%';
EOF

# 3. 测试本地连接
mysql -h localhost -u newsapp -p'NewsApp123456' -e "SELECT 1;"

# 4. 验证监听地址
sudo netstat -tulpn | grep 3306
```

## ✅ 验证清单

配置完成后，确认：

- [ ] 用户 `newsapp@'%'` 已创建
- [ ] 用户使用 `mysql_native_password` 认证插件
- [ ] 密码已正确设置（使用简单密码测试）
- [ ] 本地连接测试成功
- [ ] MySQL 监听 `0.0.0.0:3306`
- [ ] 可以从 Navicat 连接

## 🔒 安全建议

1. **测试成功后，可以改回复杂密码**：
```bash
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
ALTER USER 'newsapp'@'%' IDENTIFIED BY '你的复杂密码';
FLUSH PRIVILEGES;
EOF
```

2. **如果使用复杂密码，确保 Navicat 中正确输入**：
   - 密码中的特殊字符可能需要转义
   - 建议先在 Navicat 中使用简单密码测试，确认连接正常后再改回复杂密码

