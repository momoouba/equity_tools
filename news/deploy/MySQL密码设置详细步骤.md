# MySQL 密码设置详细步骤

## ❌ 当前错误

```
× 数据库连接失败: Access denied for user 'newsapp'@'localhost' (using password: YES)
```

这说明数据库用户或密码配置不正确。

## ✅ 解决方案

### 方案1：使用 root 用户（简单）

### 方案2：创建 newsapp 用户（推荐，更安全）

---

## 🔧 方案1：使用 root 用户

### 步骤1：登录 MySQL（如果未设置密码）

```bash
# 如果 MySQL 刚安装，root 可能没有密码，可以直接登录
sudo mysql -u root
```

### 步骤2：设置 root 密码

在 MySQL 命令行中执行：

```sql
-- 设置 root 密码
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的密码';
FLUSH PRIVILEGES;

-- 验证
SELECT user, host FROM mysql.user WHERE user='root';
exit;
```

### 步骤3：测试连接

```bash
# 使用新密码测试
mysql -h localhost -u root -p
# 输入刚才设置的密码
```

### 步骤4：创建应用数据库

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

### 步骤5：更新 .env 文件

```bash
cd /opt/newsapp/news
nano .env
```

确保配置为：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你刚才设置的root密码
DB_NAME=investment_tools
```

### 步骤6：重启应用

```bash
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

---

## 🔧 方案2：创建 newsapp 用户（推荐）

### 步骤1：登录 MySQL

```bash
# 如果 root 有密码
sudo mysql -u root -p

# 如果 root 没有密码
sudo mysql -u root
```

### 步骤2：创建 newsapp 用户并设置密码

在 MySQL 命令行中执行：

```sql
-- 创建用户并设置密码
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY '你的密码';

-- 授予权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证用户
SELECT user, host FROM mysql.user WHERE user='newsapp';

-- 退出
exit;
```

### 步骤3：创建应用数据库

```bash
# 使用 root 登录创建数据库
sudo mysql -u root -p

# 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

# 退出
exit;
```

### 步骤4：测试 newsapp 用户连接

```bash
# 使用 newsapp 用户测试连接
mysql -h localhost -u newsapp -p
# 输入刚才设置的密码

# 如果连接成功，测试数据库访问
USE investment_tools;
SHOW TABLES;
exit;
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
DB_PASSWORD=你刚才设置的newsapp用户密码
DB_NAME=investment_tools
```

### 步骤6：重启应用

```bash
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

---

## 🚀 快速设置命令（使用 root）

### 一键设置 root 密码并创建数据库

```bash
# 设置 root 密码为 'YourPassword123'（请修改为你的密码）
sudo mysql <<EOF
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'YourPassword123';
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
FLUSH PRIVILEGES;
SHOW DATABASES;
EOF

# 更新 .env 文件
cd /opt/newsapp/news
sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=YourPassword123/" .env
sed -i "s/DB_USER=.*/DB_USER=root/" .env

# 重启应用
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

**注意**：请将 `YourPassword123` 替换为你想要的密码。

---

## 🚀 快速设置命令（创建 newsapp 用户）

### 一键创建用户和数据库

```bash
# 设置 newsapp 用户密码为 'NewsApp@2024'（请修改为你的密码）
sudo mysql <<EOF
CREATE USER IF NOT EXISTS 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@2024';
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
SHOW DATABASES;
SELECT user, host FROM mysql.user WHERE user='newsapp';
EOF

# 更新 .env 文件
cd /opt/newsapp/news
sed -i "s/DB_PASSWORD=.*/DB_PASSWORD=NewsApp@2024/" .env
sed -i "s/DB_USER=.*/DB_USER=newsapp/" .env

# 测试连接
mysql -h localhost -u newsapp -pNewsApp@2024 -e "SELECT 1;"

# 重启应用
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

**注意**：请将 `NewsApp@2024` 替换为你想要的密码。

---

## 📋 详细步骤（手动操作）

### 步骤1：登录 MySQL

```bash
# 尝试无密码登录
sudo mysql -u root

# 如果提示需要密码，使用
sudo mysql -u root -p
# 然后输入密码（如果有）
```

### 步骤2：查看当前用户

```sql
-- 查看所有用户
SELECT user, host FROM mysql.user;

-- 查看 root 用户
SELECT user, host, plugin FROM mysql.user WHERE user='root';
```

### 步骤3：设置 root 密码

```sql
-- 方法1：使用 mysql_native_password（推荐）
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '你的密码';

-- 方法2：如果方法1不行，使用这个
SET PASSWORD FOR 'root'@'localhost' = PASSWORD('你的密码');

-- 刷新权限
FLUSH PRIVILEGES;
```

### 步骤4：创建 newsapp 用户（可选，但推荐）

```sql
-- 创建用户
CREATE USER 'newsapp'@'localhost' IDENTIFIED BY '你的密码';

-- 授予权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证
SELECT user, host FROM mysql.user WHERE user='newsapp';
```

### 步骤5：创建数据库

```sql
-- 创建数据库
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 查看数据库
SHOW DATABASES;

-- 退出
exit;
```

### 步骤6：测试连接

```bash
# 测试 root 用户
mysql -h localhost -u root -p
# 输入密码

# 或测试 newsapp 用户
mysql -h localhost -u newsapp -p
# 输入密码
```

### 步骤7：更新 .env 文件

```bash
cd /opt/newsapp/news

# 编辑 .env 文件
nano .env
```

**如果使用 root 用户**：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=你设置的root密码
DB_NAME=investment_tools
```

**如果使用 newsapp 用户**：
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=newsapp
DB_PASSWORD=你设置的newsapp密码
DB_NAME=investment_tools
```

### 步骤8：验证配置

```bash
# 检查 .env 配置
cat .env | grep DB_

# 测试连接（使用 .env 中的配置）
cd /opt/newsapp/news
source .env 2>/dev/null || true
mysql -h $DB_HOST -u $DB_USER -p$DB_PASSWORD $DB_NAME -e "SELECT 1;"
```

### 步骤9：重启应用

```bash
# 重启应用
pm2 restart newsapp

# 查看日志
pm2 logs newsapp --lines 50

# 检查错误
pm2 logs newsapp --err --lines 20
```

---

## 🔍 故障排查

### 问题1：无法登录 MySQL

```bash
# 如果 root 无密码，直接登录
sudo mysql -u root

# 如果提示需要密码但不知道密码，重置密码
sudo systemctl stop mysql
sudo mysqld_safe --skip-grant-tables &
mysql -u root
ALTER USER 'root'@'localhost' IDENTIFIED BY '新密码';
FLUSH PRIVILEGES;
exit;
sudo systemctl restart mysql
```

### 问题2：用户不存在

```bash
# 登录 MySQL
sudo mysql -u root -p

# 查看用户
SELECT user, host FROM mysql.user;

# 如果 newsapp 用户不存在，创建它
CREATE USER 'newsapp'@'localhost' IDENTIFIED BY '你的密码';
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;
```

### 问题3：密码错误

```bash
# 重置密码
sudo mysql -u root -p

# 重置 newsapp 用户密码
ALTER USER 'newsapp'@'localhost' IDENTIFIED BY '新密码';
FLUSH PRIVILEGES;

# 或重置 root 密码
ALTER USER 'root'@'localhost' IDENTIFIED BY '新密码';
FLUSH PRIVILEGES;
```

### 问题4：权限不足

```bash
# 登录 MySQL
sudo mysql -u root -p

# 授予所有权限
GRANT ALL PRIVILEGES ON investment_tools.* TO 'newsapp'@'localhost';
FLUSH PRIVILEGES;

# 验证权限
SHOW GRANTS FOR 'newsapp'@'localhost';
```

---

## ✅ 验证清单

设置完成后，确认：

- [ ] 可以登录 MySQL：`mysql -h localhost -u root -p` 或 `mysql -h localhost -u newsapp -p`
- [ ] 数据库 `investment_tools` 已创建：`SHOW DATABASES;`
- [ ] `.env` 文件中 `DB_USER` 和 `DB_PASSWORD` 正确
- [ ] 可以手动连接：`mysql -h localhost -u <DB_USER> -p<DB_PASSWORD> investment_tools`
- [ ] `pm2 restart newsapp` 后应用正常启动
- [ ] `pm2 logs newsapp` 没有数据库连接错误

