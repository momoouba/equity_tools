# 诊断 MariaDB 启动失败

## 🔍 查看详细错误信息

### 步骤1：查看服务状态和错误

```bash
# 查看服务状态（包含错误信息）
sudo systemctl status mariadb.service -l --no-pager

# 查看详细日志
sudo journalctl -xeu mariadb.service -n 100 --no-pager

# 查看错误日志文件
sudo tail -100 /var/log/mysql/error.log 2>/dev/null || \
sudo tail -100 /var/log/mariadb/mariadb.log 2>/dev/null || \
sudo tail -100 /var/log/mysql/mysql.log 2>/dev/null || \
echo "错误日志文件不存在，查看系统日志"
```

### 步骤2：检查常见问题

```bash
# 检查数据目录
ls -la /var/lib/mysql

# 检查权限
sudo ls -la /var/lib/mysql | head -10

# 检查 socket 目录
ls -la /run/mysqld/ 2>/dev/null || echo "socket 目录不存在"

# 检查配置文件
ls -la /etc/mysql/

# 检查端口
sudo netstat -tulpn | grep 3306
```

## ✅ 根据错误信息修复

### 错误类型1：权限问题

**错误信息**：`Permission denied` 或 `Access denied`

**解决方法**：
```bash
sudo systemctl stop mariadb
sudo chown -R mysql:mysql /var/lib/mysql
sudo chmod 755 /var/lib/mysql
sudo mkdir -p /run/mysqld
sudo chown mysql:mysql /run/mysqld
sudo systemctl start mariadb
```

### 错误类型2：数据目录损坏

**错误信息**：`Corrupted` 或 `InnoDB` 相关错误

**解决方法**：
```bash
sudo systemctl stop mariadb
sudo mv /var/lib/mysql /var/lib/mysql.backup.$(date +%Y%m%d_%H%M%S)
sudo mariadb-install-db --user=mysql --datadir=/var/lib/mysql
sudo chown -R mysql:mysql /var/lib/mysql
sudo systemctl start mariadb
```

### 错误类型3：配置文件错误

**错误信息**：`Configuration file` 或 `my.cnf` 相关错误

**解决方法**：
```bash
sudo systemctl stop mariadb
sudo mv /etc/mysql/my.cnf /etc/mysql/my.cnf.backup
sudo systemctl start mariadb
```

### 错误类型4：端口仍然被占用

**错误信息**：`Address already in use` 或 `port 3306`

**解决方法**：
```bash
# 查找并强制停止
sudo lsof -i :3306
sudo fuser -k 3306/tcp
sudo pkill -9 mysql mysqld mariadb mariadbd
sleep 3
sudo systemctl start mariadb
```

## 🚀 完整诊断和修复流程

### 一键诊断命令

```bash
echo "=== 1. 服务状态 ===" && \
sudo systemctl status mariadb.service -l --no-pager | head -20 && \
echo -e "\n=== 2. 最近错误日志 ===" && \
sudo journalctl -xeu mariadb.service -n 50 --no-pager && \
echo -e "\n=== 3. 数据目录 ===" && \
sudo ls -la /var/lib/mysql | head -5 && \
echo -e "\n=== 4. 端口占用 ===" && \
sudo netstat -tulpn | grep 3306
```

### 通用修复命令

```bash
# 停止服务
sudo systemctl stop mariadb

# 修复权限
sudo chown -R mysql:mysql /var/lib/mysql 2>/dev/null
sudo chmod 755 /var/lib/mysql 2>/dev/null
sudo mkdir -p /run/mysqld
sudo chown mysql:mysql /run/mysqld

# 清理端口占用
sudo pkill -9 mysql mysqld mariadb mariadbd 2>/dev/null
sudo fuser -k 3306/tcp 2>/dev/null
sleep 2

# 启动服务
sudo systemctl start mariadb

# 查看结果
sudo systemctl status mariadb --no-pager -l | head -20
```

## 🔧 如果仍然失败：完全重新安装

如果以上方法都不行，完全清理并重新安装：

```bash
# 1. 停止所有相关进程
sudo systemctl stop mariadb mysql mysqld 2>/dev/null
sudo pkill -9 mysql mysqld mariadb mariadbd 2>/dev/null

# 2. 完全卸载
sudo apt remove --purge mariadb-server mariadb-common mariadb-client -y
sudo apt autoremove -y

# 3. 删除所有残留
sudo rm -rf /var/lib/mysql
sudo rm -rf /var/log/mysql
sudo rm -rf /var/log/mariadb
sudo rm -rf /etc/mysql
sudo rm -rf /run/mysqld

# 4. 修复包管理器
sudo apt --fix-broken install

# 5. 重新安装
sudo apt update
sudo apt install mariadb-server -y

# 6. 启动服务
sudo systemctl start mariadb
sudo systemctl enable mariadb

# 7. 检查状态
sudo systemctl status mariadb
```

## 📋 请执行诊断命令

请先执行以下命令，把输出结果发给我：

```bash
# 查看详细错误
sudo journalctl -xeu mariadb.service -n 100 --no-pager
```

这样我可以根据具体的错误信息提供更精确的修复方案。

