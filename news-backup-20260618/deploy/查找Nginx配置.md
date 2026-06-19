# 查找 Nginx 配置

## ✅ 已确认

- 浏览器请求通过 80 端口到达
- Response Headers 显示 `Server: nginx/1.29.3`
- Nginx 正在运行，但返回 500 错误

## 🔍 查找 Nginx

### 步骤1：查找 Nginx 进程

```bash
# 查找 Nginx 进程
ps aux | grep nginx

# 查找 Nginx 可执行文件
which nginx
find /usr -name nginx 2>/dev/null
find /opt -name nginx 2>/dev/null
```

### 步骤2：查找 Nginx 配置文件

```bash
# 查找 Nginx 配置文件
find /etc -name "*nginx*" 2>/dev/null
find /opt -name "*nginx*" 2>/dev/null
find /usr -name "*nginx*" 2>/dev/null

# 查找可能包含 news.gf-dsai.com 的配置文件
grep -r "news.gf-dsai.com" /etc/nginx/ 2>/dev/null
grep -r "news.gf-dsai.com" /opt/ 2>/dev/null
```

### 步骤3：查找 Nginx 日志

```bash
# 查找 Nginx 日志文件
find /var/log -name "*nginx*" 2>/dev/null
find /opt -name "*nginx*" -type f 2>/dev/null

# 或者检查常见的日志位置
ls -la /var/log/nginx/ 2>/dev/null
ls -la /opt/nginx/logs/ 2>/dev/null
```

### 步骤4：检查 Docker 容器

```bash
# 检查是否有 Nginx Docker 容器
docker ps | grep nginx
docker ps -a | grep nginx

# 检查容器内的配置
docker exec <container_id> nginx -t
```

## 🚀 一键查找

```bash
# 完整查找
echo "=== 1. 查找 Nginx 进程 ===" && \
ps aux | grep nginx | grep -v grep && \
echo -e "\n=== 2. 查找 Nginx 可执行文件 ===" && \
which nginx || find /usr /opt -name nginx 2>/dev/null | head -5 && \
echo -e "\n=== 3. 查找 Nginx 配置文件 ===" && \
find /etc -name "*nginx*" -type d 2>/dev/null && \
echo -e "\n=== 4. 查找包含 news.gf-dsai.com 的配置 ===" && \
grep -r "news.gf-dsai.com" /etc/nginx/ /opt/ 2>/dev/null | head -10 && \
echo -e "\n=== 5. 查找 Nginx 日志 ===" && \
find /var/log /opt -name "*nginx*" -type f 2>/dev/null | head -5 && \
echo -e "\n=== 6. 检查 Docker 容器 ===" && \
docker ps | grep nginx || echo "没有 Nginx Docker 容器"
```

## 🔧 如果找到 Nginx

### 查看配置文件

```bash
# 查看主配置文件
cat /etc/nginx/nginx.conf

# 查看站点配置
ls -la /etc/nginx/sites-enabled/
cat /etc/nginx/sites-enabled/news.gf-dsai.com
```

### 查看错误日志

```bash
# 查看错误日志
tail -50 /var/log/nginx/error.log
# 或者
tail -50 /opt/nginx/logs/error.log
```

### 检查代理配置

```bash
# 检查 proxy_pass 配置
grep -r "proxy_pass" /etc/nginx/sites-enabled/
# 应该指向 http://localhost:3001
```

## 📋 修复 Nginx 配置

如果找到配置文件，检查 `proxy_pass` 是否正确：

```nginx
location /api {
    proxy_pass http://localhost:3001;
    # 确保端口正确
}
```

## ✅ 快速检查

```bash
# 快速查找
ps aux | grep nginx | grep -v grep
find /etc -name "*nginx*" 2>/dev/null | head -5
grep -r "news.gf-dsai.com" /etc/nginx/ 2>/dev/null
```

