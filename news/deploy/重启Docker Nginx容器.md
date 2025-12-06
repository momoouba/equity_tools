# 重启 Docker Nginx 容器

## ✅ 已完成的修改

已修改 `/opt/newsapp/news/deploy/nginx-site.conf`：
- 将 `server app:3001;` 改为 `server 172.17.0.1:3001;`
- `172.17.0.1` 是 Docker 默认网关 IP，容器可以通过它访问宿主机

## ✅ 重启步骤

### 步骤1：重启 Docker 容器

```bash
# 重启 Nginx 容器
sudo docker restart newsapp-nginx

# 等待几秒
sleep 5
```

### 步骤2：检查容器状态

```bash
# 查看容器状态（应该变为 healthy）
sudo docker ps | grep nginx

# 查看容器日志
sudo docker logs newsapp-nginx --tail 30
```

### 步骤3：测试配置

```bash
# 测试容器内的 Nginx 配置
sudo docker exec newsapp-nginx nginx -t

# 如果配置正确，重新加载（不需要重启容器）
sudo docker exec newsapp-nginx nginx -s reload
```

### 步骤4：验证修复

```bash
# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config

# 测试登录 API
curl -X POST http://news.gf-dsai.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"admin","password":"wenchao"}'
```

## 🚀 一键重启和验证

```bash
# 重启容器
sudo docker restart newsapp-nginx && \
sleep 5 && \
echo "=== 容器状态 ===" && \
sudo docker ps | grep nginx && \
echo -e "\n=== 测试 Nginx 配置 ===" && \
sudo docker exec newsapp-nginx nginx -t && \
echo -e "\n=== 重新加载配置 ===" && \
sudo docker exec newsapp-nginx nginx -s reload && \
echo -e "\n=== 测试 API ===" && \
curl -s http://news.gf-dsai.com/api/system/basic-config | head -3
```

## 🔍 如果 172.17.0.1 不可用

如果 `172.17.0.1` 不可用，可以尝试：

### 方法1：使用 host.docker.internal

```bash
# 修改配置文件
sudo nano /opt/newsapp/news/deploy/nginx-site.conf

# 改为：
# upstream app_backend {
#     server host.docker.internal:3001;
# }

# 重启容器
sudo docker restart newsapp-nginx
```

### 方法2：查找实际的网关 IP

```bash
# 查看容器的网络信息
sudo docker inspect newsapp-nginx | grep -A 10 "Gateway"

# 或者查看 Docker 网络
sudo docker network inspect bridge | grep Gateway
```

## ✅ 验证清单

修复后，确认：

- [ ] 容器状态为 `healthy`（不再是 `unhealthy`）
- [ ] Nginx 配置测试通过
- [ ] API 请求成功（不再返回 500）
- [ ] 登录功能正常

## 📋 如果仍然失败

查看容器日志：

```bash
# 查看详细日志
sudo docker logs newsapp-nginx --tail 50

# 实时查看日志
sudo docker logs -f newsapp-nginx
```

