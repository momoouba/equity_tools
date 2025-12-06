# 检查 Web 服务器配置

## ❌ 问题

Nginx 错误日志文件不存在，可能：
1. Nginx 未安装
2. 使用了其他 Web 服务器（如 Apache）
3. 应用直接暴露在公网，没有使用反向代理

## ✅ 排查步骤

### 步骤1：检查是否安装了 Nginx

```bash
# 检查 Nginx 是否安装
which nginx
nginx -v 2>&1

# 检查 Nginx 服务状态
sudo systemctl status nginx 2>/dev/null || echo "Nginx 未安装或未运行"
```

### 步骤2：检查是否安装了 Apache

```bash
# 检查 Apache 是否安装
which apache2
apache2 -v 2>&1

# 检查 Apache 服务状态
sudo systemctl status apache2 2>/dev/null || echo "Apache 未安装或未运行"
```

### 步骤3：检查端口监听情况

```bash
# 检查哪些进程在监听 80 和 443 端口
sudo netstat -tulpn | grep -E ":80|:443"

# 或者使用 ss 命令
sudo ss -tulpn | grep -E ":80|:443"
```

### 步骤4：检查域名解析

```bash
# 检查域名解析
nslookup news.gf-dsai.com
dig news.gf-dsai.com

# 检查本地 hosts 文件
cat /etc/hosts | grep news.gf-dsai.com
```

### 步骤5：检查应用是否直接暴露

```bash
# 检查应用是否监听在 0.0.0.0:3001（公网可访问）
sudo netstat -tulpn | grep 3001

# 如果显示 0.0.0.0:3001，说明应用直接暴露在公网
# 如果显示 127.0.0.1:3001，说明只监听本地，需要通过反向代理
```

## 🚀 一键排查

```bash
# 完整排查
echo "=== 1. 检查 Nginx ===" && \
which nginx && nginx -v 2>&1 || echo "Nginx 未安装" && \
echo -e "\n=== 2. 检查 Apache ===" && \
which apache2 && apache2 -v 2>&1 || echo "Apache 未安装" && \
echo -e "\n=== 3. 检查端口监听 ===" && \
sudo netstat -tulpn | grep -E ":80|:443|:3001" && \
echo -e "\n=== 4. 检查域名解析 ===" && \
nslookup news.gf-dsai.com 2>/dev/null | grep -A 2 "Name:" || dig news.gf-dsai.com +short
```

## 🔍 如果应用直接暴露在公网

如果应用直接监听在 `0.0.0.0:3001`，可能需要：

1. **检查防火墙**：
```bash
# 检查防火墙规则
sudo ufw status
sudo iptables -L -n | grep 3001
```

2. **检查云服务器安全组**：
   - 确保安全组开放了 3001 端口
   - 或者使用 80/443 端口通过反向代理

## 📋 如果使用 Nginx 反向代理

如果确认需要 Nginx，可以安装和配置：

```bash
# 安装 Nginx
sudo apt update
sudo apt install nginx -y

# 创建配置文件
sudo nano /etc/nginx/sites-available/news.gf-dsai.com
```

配置文件示例：
```nginx
server {
    listen 80;
    server_name news.gf-dsai.com;

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## ✅ 快速检查命令

```bash
# 检查 Web 服务器和端口
echo "=== Web 服务器检查 ===" && \
echo "Nginx:" && (which nginx && nginx -v 2>&1 || echo "未安装") && \
echo -e "\nApache:" && (which apache2 && apache2 -v 2>&1 || echo "未安装") && \
echo -e "\n端口监听:" && \
sudo netstat -tulpn | grep -E ":80|:443|:3001" | head -5
```

