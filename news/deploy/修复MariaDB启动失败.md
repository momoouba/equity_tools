# 修复 MariaDB 启动失败

## ❌ 错误信息

```
Job for mariadb.service failed because the control process exited with error code.
ERROR 2002 (HY000): Can't connect to local server through socket '/run/mysqld/mysqld.sock' (2)
```

## 🔍 诊断步骤

### 步骤1：查看详细错误信息

```bash
# 查看服务状态
sudo systemctl status mariadb.service

# 查看详细日志
sudo journalctl -xeu mariadb.service -n 50

# 查看 MariaDB 错误日志
sudo tail -50 /var/log/mysql/error.log
# 或
sudo tail -50 /var/log/mariadb/mariadb.log
```

### 步骤2：检查常见问题

```bash
# 检查数据目录权限
ls -la /var/lib/mysql

# 检查 socket 文件目录
ls -la /run/mysqld/

# 检查端口占用
sudo netstat -tulpn | grep 3306

# 检查进程
ps aux | grep mysql
ps aux | grep mariadb
```

## ✅ 解决方法

### 方法1：修复数据目录权限（最常见）

```bash
# 停止服务
sudo systemctl stop mariadb

# 修复权限
sudo chown -R mysql:mysql /var/lib/mysql
sudo chmod 755 /var/lib/mysql

# 创建 socket 目录
sudo mkdir -p /run/mysqld
sudo chown mysql:mysql /run/mysqld

# 启动服务
sudo systemctl start mariadb
```

### 方法2：清理并重新初始化（如果权限修复不行）

```bash
# 1. 停止服务
sudo systemctl stop mariadb

# 2. 备份并删除数据目录
sudo mv /var/lib/mysql /var/lib/mysql.backup.$(date +%Y%m%d_%H%M%S)

# 3. 重新初始化
sudo mysql_install_db --user=mysql --datadir=/var/lib/mysql
# 或对于新版本
sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql

# 4. 修复权限
sudo chown -R mysql:mysql /var/lib/mysql

# 5. 启动服务
sudo systemctl start mariadb
```

### 方法3：完全清理并重新安装

```bash
# 1. 完全卸载
sudo systemctl stop mariadb
sudo apt remove --purge mariadb-server mariadb-common -y
sudo apt autoremove -y

# 2. 删除所有残留文件
sudo rm -rf /var/lib/mysql
sudo rm -rf /var/log/mysql
sudo rm -rf /etc/mysql
sudo rm -rf /run/mysqld

# 3. 修复包管理器
sudo apt --fix-broken install

# 4. 重新安装
sudo apt update
sudo apt install mariadb-server -y

# 5. 启动服务
sudo systemctl start mariadb
sudo systemctl enable mariadb
```

## 🚀 完整修复流程

### 步骤1：查看错误日志

```bash
# 查看详细错误
sudo journalctl -xeu mariadb.service -n 100

# 查看错误日志文件
sudo tail -100 /var/log/mysql/error.log 2>/dev/null || \
sudo tail -100 /var/log/mariadb/mariadb.log 2>/dev/null || \
echo "错误日志文件不存在"
```

### 步骤2：根据错误信息修复

#### 如果是权限问题

```bash
sudo systemctl stop mariadb
sudo chown -R mysql:mysql /var/lib/mysql
sudo chmod 755 /var/lib/mysql
sudo mkdir -p /run/mysqld
sudo chown mysql:mysql /run/mysqld
sudo systemctl start mariadb
```

#### 如果是数据目录损坏

```bash
sudo systemctl stop mariadb
sudo mv /var/lib/mysql /var/lib/mysql.backup
sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql
sudo chown -R mysql:mysql /var/lib/mysql
sudo systemctl start mariadb
```

#### 如果是端口被占用

```bash
# 查找占用端口的进程
sudo lsof -i :3306
# 或
sudo netstat -tulpn | grep 3306

# 停止占用进程
sudo kill <进程ID>

# 启动 MariaDB
sudo systemctl start mariadb
```

### 步骤3：验证修复

```bash
# 检查服务状态
sudo systemctl status mariadb

# 测试连接
sudo mysql -u root -e "SELECT 1;"

# 检查端口
sudo netstat -tulpn | grep 3306
```

### 步骤4：创建数据库

```bash
# 创建应用数据库
sudo mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SHOW DATABASES;
EOF
```

### 步骤5：重启应用

```bash
cd /opt/newsapp/news
pm2 restart newsapp
pm2 logs newsapp --lines 50
```

## 🔧 一键修复命令（权限问题）

```bash
sudo systemctl stop mariadb && \
sudo chown -R mysql:mysql /var/lib/mysql && \
sudo chmod 755 /var/lib/mysql && \
sudo mkdir -p /run/mysqld && \
sudo chown mysql:mysql /run/mysqld && \
sudo systemctl start mariadb && \
sudo systemctl status mariadb
```

## 🔧 一键修复命令（重新初始化）

```bash
sudo systemctl stop mariadb && \
sudo mv /var/lib/mysql /var/lib/mysql.backup.$(date +%Y%m%d_%H%M%S) && \
sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql && \
sudo chown -R mysql:mysql /var/lib/mysql && \
sudo systemctl start mariadb && \
sudo mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS investment_tools DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
EOF
```

## 📋 常见错误及解决方法

### 错误1：权限被拒绝

```
Permission denied: '/var/lib/mysql'
```

**解决方法**：
```bash
sudo chown -R mysql:mysql /var/lib/mysql
```

### 错误2：数据目录不存在

```
Can't find data directory
```

**解决方法**：
```bash
sudo mkdir -p /var/lib/mysql
sudo chown mysql:mysql /var/lib/mysql
sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql
```

### 错误3：Socket 文件不存在

```
Can't connect to local server through socket '/run/mysqld/mysqld.sock'
```

**解决方法**：
```bash
sudo mkdir -p /run/mysqld
sudo chown mysql:mysql /run/mysqld
sudo systemctl start mariadb
```

### 错误4：端口被占用

```
Address already in use
```

**解决方法**：
```bash
sudo lsof -i :3306
sudo kill <进程ID>
sudo systemctl start mariadb
```

## ✅ 验证清单

修复后，确认：

- [ ] `sudo systemctl status mariadb` 显示 `active (running)`
- [ ] `sudo mysql -u root -e "SELECT 1;"` 成功
- [ ] `sudo netstat -tulpn | grep 3306` 显示端口监听
- [ ] 数据库 `investment_tools` 已创建
- [ ] `pm2 restart newsapp` 后应用正常启动
- [ ] `pm2 logs newsapp` 没有数据库连接错误

