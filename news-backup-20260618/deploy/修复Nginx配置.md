# 修复 Nginx 配置

## ❌ 问题

Nginx 配置中的 upstream 指向 `app:3001`（Docker 容器），但应用实际运行在 `localhost:3001`，导致连接失败。

错误日志显示：
```
connect() failed (111: Connection refused) while connecting to upstream, upstream: "http://172.18.0.3:3001/api/health"
```

## ✅ 解决步骤

### 步骤1：查找实际使用的 Nginx 配置文件

```bash
# 查找实际使用的配置文件
sudo nginx -T 2>/dev/null | grep -A 5 "server_name news.gf-dsai.com"

# 或者检查 Nginx 主配置文件
sudo cat /etc/nginx/nginx.conf | grep include

# 检查 sites-enabled
ls -la /etc/nginx/sites-enabled/
cat /etc/nginx/sites-enabled/* | grep -A 10 "server_name news.gf-dsai.com"
```

### 步骤2：修改 upstream 配置

找到配置文件后，将 `app:3001` 或 `172.18.0.3:3001` 改为 `127.0.0.1:3001`：

```nginx
upstream app_backend {
    server 127.0.0.1:3001;  # 改为本地地址
    # 或者
    # server localhost:3001;
}
```

### 步骤3：测试并重新加载 Nginx

```bash
# 测试配置
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx

# 或者重启
sudo systemctl restart nginx
```

## 🚀 一键修复

```bash
# 查找并修复配置
echo "=== 1. 查找实际使用的配置文件 ===" && \
sudo nginx -T 2>/dev/null | grep -B 5 -A 10 "server_name news.gf-dsai.com" | head -20 && \
echo -e "\n=== 2. 检查 upstream 配置 ===" && \
sudo grep -r "app:3001\|172.18.0.3:3001" /etc/nginx/ 2>/dev/null && \
echo -e "\n=== 3. 修改配置（需要手动编辑）===" && \
echo "找到配置文件后，将 upstream 中的地址改为 127.0.0.1:3001"
```

## 📋 手动修复步骤

### 方法1：如果使用 /etc/nginx/sites-enabled/

```bash
# 查找配置文件
sudo find /etc/nginx -name "*news*" -o -name "*gf-dsai*"

# 编辑配置文件
sudo nano /etc/nginx/sites-enabled/news.gf-dsai.com
# 或
sudo nano /etc/nginx/conf.d/news.conf

# 修改 upstream
# 将 server app:3001; 改为 server 127.0.0.1:3001;

# 测试并重新加载
sudo nginx -t
sudo systemctl reload nginx
```

### 方法2：如果使用 /opt/newsapp/news/deploy/nginx-site.conf

```bash
# 检查这个文件是否被使用
sudo grep -r "nginx-site.conf" /etc/nginx/

# 如果被使用，修改它
sudo nano /opt/newsapp/news/deploy/nginx-site.conf

# 修改 upstream
# 将 server app:3001; 改为 server 127.0.0.1:3001;

# 重新加载 Nginx
sudo nginx -t
sudo systemctl reload nginx
```

## ✅ 验证修复

```bash
# 测试配置
sudo nginx -t

# 重新加载
sudo systemctl reload nginx

# 查看错误日志（应该没有连接错误）
sudo tail -20 /var/log/nginx/error.log

# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config
```

## 🔍 如果仍然失败

查看最新的错误日志：

```bash
# 实时查看错误日志
sudo tail -f /var/log/nginx/error.log

# 然后在浏览器中尝试登录，观察日志输出
```

