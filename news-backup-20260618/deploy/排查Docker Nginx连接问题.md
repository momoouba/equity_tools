# 排查 Docker Nginx 连接问题

## ❌ 问题

修改配置后，登录仍然返回 500 错误。

## ✅ 排查步骤

### 步骤1：确认容器已重启并检查状态

```bash
# 检查容器状态
sudo docker ps | grep nginx

# 查看容器日志
sudo docker logs newsapp-nginx --tail 50
```

### 步骤2：测试容器内能否访问宿主机

```bash
# 测试容器内能否访问宿主机
sudo docker exec newsapp-nginx ping -c 2 172.17.0.1

# 测试容器内能否访问应用端口
sudo docker exec newsapp-nginx curl -s http://172.17.0.1:3001/api/system/basic-config

# 如果 172.17.0.1 不可用，尝试 host.docker.internal
sudo docker exec newsapp-nginx curl -s http://host.docker.internal:3001/api/system/basic-config
```

### 步骤3：检查容器内的实际配置

```bash
# 查看容器内的配置文件（确认修改已生效）
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/default.conf | grep -A 5 "upstream"

# 测试 Nginx 配置
sudo docker exec newsapp-nginx nginx -t
```

### 步骤4：查找实际的网关 IP

```bash
# 查看容器的网络信息
sudo docker inspect newsapp-nginx | grep -A 5 "Gateway"

# 查看 Docker 网络信息
sudo docker network inspect bridge | grep Gateway
```

## 🚀 一键排查

```bash
# 完整排查
echo "=== 1. 容器状态 ===" && \
sudo docker ps | grep nginx && \
echo -e "\n=== 2. 容器日志（最后20行）===" && \
sudo docker logs newsapp-nginx --tail 20 && \
echo -e "\n=== 3. 检查容器内配置 ===" && \
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/default.conf | grep -A 5 "upstream" && \
echo -e "\n=== 4. 测试容器访问宿主机 ===" && \
sudo docker exec newsapp-nginx curl -s http://172.17.0.1:3001/api/system/basic-config | head -3 || echo "172.17.0.1 不可用" && \
echo -e "\n=== 5. 查找网关 IP ===" && \
sudo docker inspect newsapp-nginx | grep -A 5 "Gateway"
```

## 🔧 如果 172.17.0.1 不可用

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

### 方法2：使用实际网关 IP

```bash
# 查找实际网关 IP
GATEWAY_IP=$(sudo docker inspect newsapp-nginx | grep -A 5 "Gateway" | grep "Gateway" | awk -F'"' '{print $4}')
echo "网关 IP: $GATEWAY_IP"

# 修改配置文件使用实际网关 IP
sudo sed -i "s/server 172.17.0.1:3001;/server $GATEWAY_IP:3001;/" /opt/newsapp/news/deploy/nginx-site.conf

# 重启容器
sudo docker restart newsapp-nginx
```

### 方法3：使用宿主机 IP

```bash
# 查找宿主机 IP（在 Docker 网络中）
HOST_IP=$(ip route | grep default | awk '{print $3}')
echo "宿主机 IP: $HOST_IP"

# 修改配置文件
sudo sed -i "s/server 172.17.0.1:3001;/server $HOST_IP:3001;/" /opt/newsapp/news/deploy/nginx-site.conf

# 重启容器
sudo docker restart newsapp-nginx
```

## ✅ 验证修复

```bash
# 重启容器
sudo docker restart newsapp-nginx

# 等待
sleep 5

# 测试配置
sudo docker exec newsapp-nginx nginx -t

# 重新加载
sudo docker exec newsapp-nginx nginx -s reload

# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config
```

