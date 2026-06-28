# 创建 newsapp@localhost 用户

## ❌ 问题

`.env` 文件已配置：
- `DB_USER=newsapp`
- `DB_PASSWORD=NewsApp@123456`

但日志显示：`Access denied for user 'newsapp'@'localhost'`

## ✅ 解决方法

### 步骤1：检查 newsapp 用户是否存在

```bash
# 检查 newsapp 用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT user, host FROM mysql.user WHERE user='newsapp';"
```

### 步骤2：创建或更新 newsapp@localhost 用户

```bash
# 创建 newsapp@localhost 用户（如果不存在）
# 或者更新密码（如果已存在）
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'localhost';
CREATE USER 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@123456';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'localhost';
EOF
```

### 步骤3：测试连接

```bash
# 测试 newsapp 用户连接
mysql -u newsapp -p'NewsApp@123456' -e "USE investment_tools; SELECT 1;"
```

### 步骤4：重启应用

```bash
# 重启应用
pm2 restart newsapp

# 查看启动日志
pm2 logs newsapp --lines 20
```

## 🚀 一键修复

```bash
# 创建/更新 newsapp@localhost 用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' <<EOF
DROP USER IF EXISTS 'newsapp'@'localhost';
CREATE USER 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@123456';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
SHOW GRANTS FOR 'newsapp'@'localhost';
EOF

# 测试连接
echo "=== 测试数据库连接 ===" && \
mysql -u newsapp -p'NewsApp@123456' -e "USE investment_tools; SELECT 1;" && \
echo "✓ 数据库连接正常" && \
echo -e "\n=== 重启应用 ===" && \
pm2 restart newsapp && \
sleep 5 && \
echo -e "\n=== 查看最新日志 ===" && \
pm2 logs newsapp --err --lines 10 --nostream
```

## 📋 验证配置

### 检查 .env 文件

```bash
# 确认 .env 文件配置
cd /opt/newsapp/news
cat .env | grep DB_
```

应该显示：
```
DB_HOST=localhost
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=NewsApp@123456
DB_NAME=investment_tools
```

### 检查用户权限

```bash
# 查看 newsapp 用户
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SELECT user, host FROM mysql.user WHERE user='newsapp';"

# 查看权限
sudo mysql -u root -p'Mqdqxygyqy!!!klklsys24678' -e "SHOW GRANTS FOR 'newsapp'@'localhost';"
```

## ✅ 验证修复

修复后，检查：

```bash
# 1. 检查应用状态
pm2 status

# 2. 查看日志（应该没有数据库连接错误）
pm2 logs newsapp --err --lines 20 --nostream

# 3. 测试登录
# 刷新浏览器，尝试登录
```

