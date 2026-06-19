# 查找 Nginx 实际配置

## ❌ 问题

`/etc/nginx/sites-enabled/` 目录不存在，需要找到 Nginx 的实际配置文件位置。

## ✅ 排查步骤

### 步骤1：检查 Nginx 主配置文件

```bash
# 查看 Nginx 主配置文件
sudo cat /etc/nginx/nginx.conf

# 检查 include 指令，看配置文件在哪里
sudo grep -r "include" /etc/nginx/nginx.conf
```

### 步骤2：检查 conf.d 目录

```bash
# 检查 conf.d 目录
ls -la /etc/nginx/conf.d/

# 查看所有配置文件
sudo cat /etc/nginx/conf.d/*.conf 2>/dev/null
```

### 步骤3：检查 Nginx 进程使用的配置文件

```bash
# 查看 Nginx 进程的完整命令
ps aux | grep nginx | grep -v grep

# 查看 Nginx 主进程打开的文件
sudo lsof -p $(pgrep -f "nginx: master" | head -1) | grep conf

# 或者查看 Nginx 配置测试输出
sudo nginx -T 2>&1 | head -50
```

### 步骤4：检查 Docker 容器

```bash
# 检查是否有 Nginx Docker 容器
sudo docker ps | grep nginx

# 如果存在，查看容器内的配置
sudo docker exec <container_id> cat /etc/nginx/nginx.conf
```

## 🚀 一键排查

```bash
# 完整排查
echo "=== 1. Nginx 主配置文件 ===" && \
sudo cat /etc/nginx/nginx.conf 2>/dev/null | head -30 && \
echo -e "\n=== 2. conf.d 目录 ===" && \
ls -la /etc/nginx/conf.d/ 2>/dev/null && \
echo -e "\n=== 3. conf.d 中的配置文件 ===" && \
sudo cat /etc/nginx/conf.d/*.conf 2>/dev/null | grep -A 10 "server_name\|upstream" && \
echo -e "\n=== 4. Nginx 进程信息 ===" && \
ps aux | grep nginx | grep -v grep && \
echo -e "\n=== 5. Nginx 配置测试（完整输出）===" && \
sudo nginx -T 2>&1 | grep -A 10 "server_name news.gf-dsai.com\|upstream" | head -40
```

## 🔍 如果找到配置文件

修改 upstream 配置：

```bash
# 编辑找到的配置文件
sudo nano /etc/nginx/conf.d/news.conf
# 或实际找到的文件路径

# 修改 upstream 部分：
# upstream app_backend {
#     server 127.0.0.1:3001;  # 改为本地地址
# }

# 测试并重新加载
sudo nginx -t
sudo systemctl reload nginx
```

