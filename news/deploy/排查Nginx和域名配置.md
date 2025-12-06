# 排查 Nginx 和域名配置

## ✅ 已确认

- 本地 API 测试成功：`curl http://localhost:3001/api/auth/login` 返回成功
- 数据库连接正常
- 应用运行正常

## ❌ 问题

浏览器访问 `http://news.gf-dsai.com` 时返回 500 错误，但本地 API 正常。

## 🔍 排查步骤

### 步骤1：检查 Nginx 配置

```bash
# 查找 Nginx 配置文件
sudo find /etc -name "*news*" -o -name "*gf-dsai*" 2>/dev/null

# 或者检查所有站点配置
ls -la /etc/nginx/sites-enabled/
ls -la /etc/nginx/conf.d/

# 查看 Nginx 配置
sudo cat /etc/nginx/sites-enabled/news.gf-dsai.com
# 或
sudo cat /etc/nginx/conf.d/news.conf
```

### 步骤2：检查 Nginx 错误日志

```bash
# 查看 Nginx 错误日志
sudo tail -50 /var/log/nginx/error.log

# 或者查看特定站点的错误日志
sudo tail -50 /var/log/nginx/news.gf-dsai.com-error.log
```

### 步骤3：检查 Nginx 状态

```bash
# 检查 Nginx 是否运行
sudo systemctl status nginx

# 测试 Nginx 配置
sudo nginx -t

# 重新加载 Nginx
sudo systemctl reload nginx
```

### 步骤4：检查代理配置

```bash
# 查看 Nginx 配置中的 proxy_pass 设置
sudo grep -r "proxy_pass" /etc/nginx/sites-enabled/
sudo grep -r "proxy_pass" /etc/nginx/conf.d/

# 应该指向 http://localhost:3001 或 http://127.0.0.1:3001
```

## 🚀 一键排查

```bash
# 完整排查
echo "=== 1. 检查 Nginx 状态 ===" && \
sudo systemctl status nginx --no-pager -l | head -10 && \
echo -e "\n=== 2. 测试 Nginx 配置 ===" && \
sudo nginx -t && \
echo -e "\n=== 3. 查找 Nginx 配置文件 ===" && \
sudo find /etc/nginx -name "*news*" -o -name "*gf-dsai*" 2>/dev/null && \
echo -e "\n=== 4. 查看 Nginx 错误日志 ===" && \
sudo tail -30 /var/log/nginx/error.log && \
echo -e "\n=== 5. 检查代理配置 ===" && \
sudo grep -r "proxy_pass\|news.gf-dsai.com" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | head -10
```

## 🔧 常见问题修复

### 问题1：Nginx 代理配置错误

**检查**：
```bash
# 查看代理配置
sudo cat /etc/nginx/sites-enabled/news.gf-dsai.com | grep -A 5 "proxy_pass"
```

**应该类似**：
```nginx
location /api {
    proxy_pass http://localhost:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

### 问题2：Nginx 未运行

**修复**：
```bash
sudo systemctl start nginx
sudo systemctl enable nginx
```

### 问题3：Nginx 配置语法错误

**修复**：
```bash
# 测试配置
sudo nginx -t

# 如果有错误，修复后重新加载
sudo systemctl reload nginx
```

## 📋 检查前端请求

在浏览器中检查：
1. 打开浏览器开发者工具（F12）
2. 查看 Network 标签
3. 尝试登录，查看请求的 URL
4. 检查请求是否到达服务器

## ✅ 验证修复

修复后：
```bash
# 重新加载 Nginx
sudo systemctl reload nginx

# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config

# 或者在浏览器中刷新页面
```

