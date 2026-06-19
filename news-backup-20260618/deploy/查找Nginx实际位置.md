# 查找 Nginx 实际位置

## ❌ 问题

`/etc/nginx/nginx.conf` 不存在，需要找到 Nginx 的实际安装位置和配置文件。

## ✅ 排查步骤

### 步骤1：查找 Nginx 进程的完整路径

```bash
# 查看 Nginx 进程的完整命令和路径
ps aux | grep nginx | grep -v grep

# 查看 Nginx 主进程的详细信息
ps -ef | grep nginx | grep master

# 查看进程的工作目录
sudo ls -la /proc/$(pgrep -f "nginx: master" | head -1)/cwd
```

### 步骤2：查找 Nginx 可执行文件

```bash
# 查找 nginx 可执行文件
which nginx
find /usr -name nginx 2>/dev/null
find /opt -name nginx 2>/dev/null

# 查看 Nginx 版本和配置测试路径
nginx -V 2>&1 | grep -i "configure\|prefix\|conf-path"
```

### 步骤3：检查 Docker 容器

```bash
# 检查是否有 Nginx Docker 容器
sudo docker ps -a | grep nginx

# 如果存在，查看容器信息
sudo docker inspect <container_id> | grep -i "config\|mount"
```

### 步骤4：查找配置文件

```bash
# 查找所有 nginx.conf 文件
find /etc /opt /usr -name "nginx.conf" 2>/dev/null

# 查找包含 news.gf-dsai.com 的配置文件
find /etc /opt /usr -type f -exec grep -l "news.gf-dsai.com" {} \; 2>/dev/null

# 查找包含 upstream app_backend 的配置文件
find /etc /opt /usr -type f -exec grep -l "upstream app_backend\|app:3001" {} \; 2>/dev/null
```

### 步骤5：查看 Nginx 进程打开的文件

```bash
# 查看 Nginx 主进程打开的所有文件
sudo lsof -p $(pgrep -f "nginx: master" | head -1) | grep -E "conf|log"

# 或者查看所有 Nginx 进程打开的文件
sudo lsof -p $(pgrep nginx | head -1) | grep conf
```

## 🚀 一键排查

```bash
# 完整排查
echo "=== 1. Nginx 进程信息 ===" && \
ps aux | grep nginx | grep -v grep && \
echo -e "\n=== 2. Nginx 可执行文件 ===" && \
which nginx || find /usr /opt -name nginx 2>/dev/null | head -5 && \
echo -e "\n=== 3. Nginx 版本和配置路径 ===" && \
nginx -V 2>&1 | grep -E "configure|prefix|conf-path" && \
echo -e "\n=== 4. 查找配置文件 ===" && \
find /etc /opt /usr -name "nginx.conf" 2>/dev/null && \
echo -e "\n=== 5. 查找包含 news.gf-dsai.com 的配置 ===" && \
find /etc /opt /usr -type f -exec grep -l "news.gf-dsai.com" {} \; 2>/dev/null | head -5 && \
echo -e "\n=== 6. 检查 Docker ===" && \
sudo docker ps -a | grep nginx || echo "没有 Nginx Docker 容器" && \
echo -e "\n=== 7. 查看 Nginx 进程打开的文件 ===" && \
sudo lsof -p $(pgrep -f "nginx: master" | head -1) 2>/dev/null | grep -E "conf|log" | head -10
```

## 🔍 如果找到配置文件

修改 upstream 配置：

```bash
# 编辑找到的配置文件
sudo nano <找到的配置文件路径>

# 修改 upstream 部分：
# upstream app_backend {
#     server 127.0.0.1:3001;  # 改为本地地址
# }

# 测试并重新加载
nginx -t
# 如果 nginx 命令不可用，使用完整路径
sudo systemctl reload nginx
# 或者重启 Nginx 进程
```

