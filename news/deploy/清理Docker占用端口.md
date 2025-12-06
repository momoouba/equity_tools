# 清理 Docker 占用端口 3306

## 🔍 问题确认

端口 3306 被 Docker 进程占用：
- 进程ID: 1492369 (docker-prox)
- 进程ID: 1492376 (docker-prox)

## ✅ 解决方法

### 方法1：查找并停止占用端口的 Docker 容器

```bash
# 1. 查找使用 3306 端口的 Docker 容器
sudo docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" | grep 3306

# 或查看所有容器
sudo docker ps -a

# 2. 停止占用端口的容器
# 如果找到容器，停止它
sudo docker stop <容器ID或容器名>

# 或停止所有 MySQL/MariaDB 相关容器
sudo docker ps -a | grep -E "mysql|mariadb" | awk '{print $1}' | xargs -r sudo docker stop
```

### 方法2：直接停止 docker-prox 进程

```bash
# 停止 docker-prox 进程
sudo kill -9 1492369
sudo kill -9 1492376

# 或使用 pkill
sudo pkill -9 docker-prox
```

### 方法3：停止所有 Docker 容器（如果不需要）

```bash
# 停止所有运行中的容器
sudo docker stop $(sudo docker ps -q)

# 或停止特定容器
sudo docker ps | grep -E "mysql|mariadb|3306" | awk '{print $1}' | xargs -r sudo docker stop
```

## 🚀 完整清理流程

### 步骤1：查找 Docker 容器

```bash
# 查看所有运行中的容器
sudo docker ps

# 查看所有容器（包括停止的）
sudo docker ps -a

# 查找使用 3306 端口的容器
sudo docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}" | grep 3306
```

### 步骤2：停止相关容器

```bash
# 方法A：如果知道容器名或ID
sudo docker stop <容器ID或容器名>

# 方法B：停止所有 MySQL/MariaDB 相关容器
sudo docker ps -a --format "{{.ID}} {{.Names}} {{.Image}}" | grep -E "mysql|mariadb" | awk '{print $1}' | xargs -r sudo docker stop

# 方法C：停止所有容器（谨慎使用）
sudo docker stop $(sudo docker ps -q)
```

### 步骤3：停止 docker-prox 进程

```bash
# 停止 docker-prox 进程
sudo kill -9 1492369 1492376

# 或使用 pkill
sudo pkill -9 docker-prox

# 等待进程停止
sleep 3
```

### 步骤4：确认端口已释放

```bash
# 检查端口
sudo netstat -tulpn | grep 3306

# 应该没有输出，说明端口已释放
```

### 步骤5：启动 MariaDB

```bash
# 启动 MariaDB
sudo systemctl start mariadb

# 检查状态
sudo systemctl status mariadb

# 测试连接
sudo mysql -u root -e "SELECT 1;"
```

## 🔧 一键清理命令

```bash
# 查找并停止 Docker 容器
echo "=== 查找使用 3306 端口的容器 ===" && \
sudo docker ps --format "table {{.ID}}\t{{.Names}}\t{{.Ports}}" | grep 3306 && \
echo -e "\n=== 停止相关容器 ===" && \
sudo docker ps -a --format "{{.ID}} {{.Names}} {{.Image}}" | grep -E "mysql|mariadb|3306" | awk '{print $1}' | xargs -r sudo docker stop && \
echo -e "\n=== 停止 docker-prox 进程 ===" && \
sudo kill -9 1492369 1492376 2>/dev/null && \
sudo pkill -9 docker-prox 2>/dev/null && \
sleep 3 && \
echo -e "\n=== 确认端口已释放 ===" && \
sudo netstat -tulpn | grep 3306 || echo "✓ 端口 3306 已释放" && \
echo -e "\n=== 启动 MariaDB ===" && \
sudo systemctl start mariadb && \
sudo systemctl status mariadb --no-pager -l | head -20
```

## 📋 详细操作步骤

### 1. 查看 Docker 容器

```bash
# 查看所有容器
sudo docker ps -a

# 查找 MySQL/MariaDB 容器
sudo docker ps -a | grep -E "mysql|mariadb"
```

### 2. 停止容器

```bash
# 如果看到容器，停止它
# 例如：如果容器ID是 abc123
sudo docker stop abc123

# 或停止所有相关容器
sudo docker ps -a --format "{{.ID}} {{.Names}}" | grep -E "mysql|mariadb" | awk '{print $1}' | xargs -r sudo docker stop
```

### 3. 停止 docker-prox 进程

```bash
# 停止进程
sudo kill -9 1492369 1492376

# 确认进程已停止
ps aux | grep docker-prox | grep -v grep
```

### 4. 确认并启动

```bash
# 确认端口已释放
sudo netstat -tulpn | grep 3306

# 启动 MariaDB
sudo systemctl start mariadb

# 检查状态
sudo systemctl status mariadb
```

## ⚠️ 注意事项

1. **Docker 容器数据**：如果容器中有重要数据，先备份再停止
2. **容器用途**：确认容器不是生产环境的重要服务
3. **永久删除**：如果不需要容器，可以删除：`sudo docker rm <容器ID>`

## ✅ 验证修复

修复后，确认：

- [ ] `sudo netstat -tulpn | grep 3306` 显示 MariaDB（不是 docker-prox）
- [ ] `sudo systemctl status mariadb` 显示 `active (running)`
- [ ] `sudo mysql -u root -e "SELECT 1;"` 成功
- [ ] 数据库 `investment_tools` 已创建
- [ ] `pm2 restart newsapp` 后应用正常启动

