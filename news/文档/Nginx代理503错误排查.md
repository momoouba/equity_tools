# Nginx 代理 503 错误排查指南

## ✅ 当前状态

- ✅ 应用容器正常运行（healthy）
- ✅ 数据库连接正常
- ✅ 健康检查通过：`http://localhost:3001/api/health` 返回正常
- ❌ 通过域名访问返回 503 错误

**结论：问题在 Nginx 代理配置**

## 🔍 立即执行以下诊断命令

### 1. 检查 Nginx 日志

```bash
cd /opt/newsapp/news

# 查看 Nginx 错误日志
sudo docker compose logs nginx --tail 50 | grep -i "error\|503\|upstream"

# 查看 Nginx 访问日志
sudo docker compose logs nginx --tail 50
```

### 2. 测试 Nginx 能否访问应用容器

```bash
# 从 Nginx 容器内测试应用容器
sudo docker compose exec nginx wget -q -O - http://app:3001/api/health

# 应该返回：{"status":"ok","message":"服务器运行正常","database":"connected"}
```

### 3. 检查 Nginx 配置

```bash
# 检查 Nginx 配置语法
sudo docker compose exec nginx nginx -t

# 查看 Nginx 配置中的 upstream
sudo docker compose exec nginx cat /etc/nginx/conf.d/default.conf | grep -A 10 "upstream"
```

### 4. 检查容器网络

```bash
# 检查容器是否在同一网络
sudo docker network inspect newsapp_newsapp-network | grep -A 5 "Containers"
```

### 5. 重启 Nginx 容器

```bash
# 重启 Nginx（应用容器已更新，Nginx 可能需要重新连接）
sudo docker compose restart nginx

# 等待 5 秒
sleep 5

# 再次测试
curl -v http://localhost/api/health
```

## 🚀 快速修复方案

### 方案1：重启 Nginx（最简单）

```bash
cd /opt/newsapp/news
sudo docker compose restart nginx
sleep 5
curl http://localhost/api/health
```

### 方案2：完全重启所有服务

```bash
cd /opt/newsapp/news
sudo docker compose restart
sleep 10
curl http://localhost/api/health
```

### 方案3：检查并修复 Nginx 配置

如果 Nginx 配置有问题：

```bash
# 查看 Nginx 配置文件
cat deploy/nginx-site.conf | grep -A 10 "upstream"

# 应该看到类似：
# upstream app {
#     server app:3001;
# }

# 如果配置有问题，修复后重启 Nginx
sudo docker compose restart nginx
```

## 📋 请提供以下信息

执行上述命令后，请提供：

1. **Nginx 错误日志**：`sudo docker compose logs nginx --tail 50 | grep -i error`
2. **Nginx 访问应用测试**：`sudo docker compose exec nginx wget -q -O - http://app:3001/api/health`
3. **Nginx 配置检查**：`sudo docker compose exec nginx nginx -t`
4. **重启 Nginx 后的测试结果**：`curl -v http://localhost/api/health`

