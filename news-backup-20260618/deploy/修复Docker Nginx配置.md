# 修复 Docker Nginx 配置

## ✅ 已确认

- Nginx 通过 Docker 运行：容器名 `newsapp-nginx`
- 容器状态：`unhealthy`（不健康）
- 配置文件：`/opt/newsapp/news/deploy/nginx-site.conf` 和 `/opt/newsapp/news/deploy/nginx-docker.conf`
- 端口映射：`0.0.0.0:80->80/tcp`

## ✅ 解决步骤

### 步骤1：查看 Docker 容器内的配置

```bash
# 查看容器内的 Nginx 配置
sudo docker exec newsapp-nginx cat /etc/nginx/nginx.conf

# 查看容器内的站点配置
sudo docker exec newsapp-nginx ls -la /etc/nginx/conf.d/
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/*.conf
```

### 步骤2：查看 Docker 容器的挂载信息

```bash
# 查看容器的挂载点
sudo docker inspect newsapp-nginx | grep -A 10 "Mounts"

# 或者查看完整配置
sudo docker inspect newsapp-nginx | grep -A 20 "Mounts"
```

### 步骤3：修改配置文件

根据挂载信息，修改对应的配置文件：

```bash
# 查看 nginx-site.conf（可能是实际使用的配置）
cat /opt/newsapp/news/deploy/nginx-site.conf | grep -A 5 "upstream"

# 修改 upstream 配置
sudo nano /opt/newsapp/news/deploy/nginx-site.conf

# 将 upstream app_backend 中的 server app:3001; 改为 server 127.0.0.1:3001;
# 或者改为 host.docker.internal:3001（如果容器需要访问宿主机）
```

### 步骤4：重启 Docker 容器

```bash
# 重启 Nginx 容器
sudo docker restart newsapp-nginx

# 查看容器状态
sudo docker ps | grep nginx

# 查看容器日志
sudo docker logs newsapp-nginx --tail 50
```

## 🚀 一键修复

```bash
# 完整排查和修复
echo "=== 1. 查看容器挂载信息 ===" && \
sudo docker inspect newsapp-nginx | grep -A 20 "Mounts" && \
echo -e "\n=== 2. 查看容器内的配置 ===" && \
sudo docker exec newsapp-nginx cat /etc/nginx/conf.d/*.conf 2>/dev/null | grep -A 10 "upstream\|server_name" && \
echo -e "\n=== 3. 查看本地配置文件 ===" && \
cat /opt/newsapp/news/deploy/nginx-site.conf | grep -A 5 "upstream" && \
echo -e "\n=== 4. 修改配置（需要手动）===" && \
echo "请编辑配置文件，将 upstream app_backend 中的 server app:3001; 改为 server host.docker.internal:3001; 或 172.17.0.1:3001;"
```

## 🔧 修复配置

### 方法1：修改 nginx-site.conf（如果被挂载）

```bash
# 编辑配置文件
sudo nano /opt/newsapp/news/deploy/nginx-site.conf

# 修改 upstream 部分：
upstream app_backend {
    server host.docker.internal:3001;  # Docker 容器访问宿主机的方式
    # 或者
    # server 172.17.0.1:3001;  # Docker 默认网关 IP
}

# 重启容器
sudo docker restart newsapp-nginx
```

### 方法2：直接在容器内修改（临时）

```bash
# 进入容器
sudo docker exec -it newsapp-nginx sh

# 编辑配置文件
vi /etc/nginx/conf.d/default.conf
# 或
vi /etc/nginx/nginx.conf

# 修改 upstream 后，重新加载
nginx -s reload
```

## 📋 检查 Docker 网络

```bash
# 查看 Docker 网络
sudo docker network ls

# 查看容器网络信息
sudo docker inspect newsapp-nginx | grep -A 10 "Networks"

# 测试容器内能否访问宿主机
sudo docker exec newsapp-nginx ping -c 2 host.docker.internal
sudo docker exec newsapp-nginx ping -c 2 172.17.0.1
```

## ✅ 验证修复

```bash
# 重启容器
sudo docker restart newsapp-nginx

# 等待几秒
sleep 5

# 查看容器状态（应该变为 healthy）
sudo docker ps | grep nginx

# 查看容器日志
sudo docker logs newsapp-nginx --tail 20

# 测试 API
curl http://news.gf-dsai.com/api/system/basic-config
```

