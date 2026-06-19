# 解决 MySQL 访问被拒绝问题

## ❌ 错误信息

```
ERROR 1045 (28000): Access denied for user 'root'@'localhost' (using password: NO)
```

这说明 MySQL root 用户需要密码，但命令中没有提供密码。

## ✅ 解决方法

### 方法1：使用密码登录（如果已设置密码）

```bash
# 使用密码登录
sudo mysql -u root -p
# 然后输入密码

# 或直接在命令中提供密码（不推荐，密码会显示在历史中）
sudo mysql -u root -p你的密码
```

### 方法2：重置 root 密码（如果忘记密码）

```bash
# 1. 停止 MySQL
sudo systemctl stop mysql

# 2. 以安全模式启动 MySQL（跳过权限检查）
sudo mysqld_safe --skip-grant-tables --skip-networking &

# 3. 等待几秒让 MySQL 启动
sleep 5

# 4. 登录 MySQL（不需要密码）
mysql -u root

# 5. 在 MySQL 中重置密码
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的新密码';
FLUSH PRIVILEGES;
exit;

# 6. 停止安全模式的 MySQL
sudo pkill mysqld

# 7. 正常启动 MySQL
sudo systemctl start mysql

# 8. 使用新密码登录测试
mysql -u root -p
# 输入新密码
```

### 方法3：使用 mysql_secure_installation 设置密码

```bash
# 运行安全配置脚本
sudo mysql_secure_installation
```

按提示操作：
1. 输入当前 root 密码：如果未设置，直接按回车
2. 设置新密码：Y，然后输入新密码
3. 移除匿名用户：Y
4. 禁止 root 远程登录：Y
5. 移除测试数据库：Y
6. 重新加载权限表：Y

## 🚀 完整操作流程

### 步骤1：尝试无密码登录

```bash
# 尝试直接登录（如果 MySQL 刚安装可能无密码）
sudo mysql -u root
```

### 步骤2A：如果可以直接登录（无密码）

```sql
-- 在 MySQL 中执行
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的密码';
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
exit;
```

### 步骤2B：如果需要密码但不知道密码

```bash
# 重置密码
sudo systemctl stop mysql
sudo mysqld_safe --skip-grant-tables --skip-networking &
sleep 5
mysql -u root <<EOF
USE mysql;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的新密码';
FLUSH PRIVILEGES;
EOF
sudo pkill mysqld
sudo systemctl start mysql
```

### 步骤3：使用密码登录并创建用户和数据库

```bash
# 使用密码登录（将 '你的密码' 替换为实际密码）
sudo mysql -u root -p你的密码 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
EOF
```

### 步骤4：测试连接

```bash
# 测试 newsapp 用户连接
mysql -h localhost -u newsapp -p98K6^7s8!9Z8*76p8 -e "SELECT 1;"

# 或交互式测试
mysql -h localhost -u newsapp -p
# 输入密码：98K6^7s8!9Z8*76p8
```

### 步骤5：更新 .env 文件

```bash
cd /opt/newsapp/news
nano .env
```

配置为：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=98K6^7s8!9Z8*76p8
DB_NAME=investment_tools
```

### 步骤6：重启应用

```bash
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## 🔧 快速修复命令

### 如果 root 无密码

```bash
# 直接登录并创建用户和数据库
sudo mysql <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 如果 root 有密码但不知道

```bash
# 重置密码
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
sudo mysql -u root -pRootPassword123 <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '98K6^7s8!9Z8*76p8';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
EOF
```

## 📋 手动操作步骤

### 步骤1：尝试登录 MySQL

```bash
# 尝试无密码登录
sudo mysql -u root

# 如果失败，尝试交互式输入密码
sudo mysql -u root -p
# 然后输入密码（如果有）
```

### 步骤2：如果登录成功，执行 SQL

```sql
-- 设置 root 密码（如果还没有）
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'RootPassword123';

-- 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 创建 newsapp 用户
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '98K6^7s8!9Z8*76p8';

-- 授予权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证
SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user='newsapp';

-- 退出
exit;
```

### 步骤3：测试连接

```bash
# 测试 newsapp 用户
mysql -h localhost -u newsapp -p98K6^7s8!9Z8*76p8 -e "USE investment_tools; SELECT 1;"
```

### 步骤4：更新 .env

```bash
cd /opt/newsapp/news
cat > .env <<'EOF'
DB_HOST=localhost
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=98K6^7s8!9Z8*76p8
DB_NAME=investment_tools
EOF

# 或编辑现有文件
nano .env
```

### 步骤5：重启应用

```bash
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## ⚠️ 注意事项

1. **密码安全**：密码 `98K6^7s8!9Z8*76p8` 包含特殊字符，在命令行中使用时可能需要引号
2. **root 密码**：如果 root 有密码，需要先知道密码或重置密码
3. **用户权限**：确保 newsapp 用户有足够权限访问数据库

## ✅ 验证清单

完成后，确认：

- [ ] 可以登录 MySQL：`sudo mysql -u root` 或 `mysql -u newsapp -p`
- [ ] 数据库已创建：`SHOW DATABASES;` 显示 `investment_tools`
- [ ] 用户已创建：`SELECT user, host FROM mysql.user WHERE user='newsapp';`
- [ ] `.env` 文件配置正确
- [ ] 可以手动连接：`mysql -h localhost -u newsapp -p98K6^7s8!9Z8*76p8 investment_tools`
- [ ] `pm2 logs newsapp` 没有数据库连接错误

