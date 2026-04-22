# 配置Docker镜像加速器解决网络超时

## 问题
```
failed to resolve source metadata for docker.io/library/node:18-slim: 
failed to do request: Head "https://registry-1.docker.io/...": dial tcp ...:443: i/o timeout
```

## 解决方案：配置Docker镜像加速器

### 步骤1：配置Docker镜像加速器

在服务器上执行以下命令：

```bash
# 创建 Docker 配置文件目录
sudo mkdir -p /etc/docker

# 配置镜像源（使用多个镜像源，按优先级尝试）
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://dockerproxy.com",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
EOF

# 重启 Docker 服务
sudo systemctl daemon-reload
sudo systemctl restart docker

# 验证配置
docker info | grep -A 10 "Registry Mirrors"
```

### 步骤2：测试镜像拉取

```bash
# 测试拉取 node:18-slim 镜像
docker pull node:18-slim

# 如果成功，应该能看到类似输出：
# 18-slim: Pulling from library/node
# ...
# Status: Downloaded newer image for node:18-slim:latest
```

### 步骤3：重新构建应用镜像

```bash
cd /opt/newsapp/news

# 重新构建镜像
sudo docker compose build app
```

## 如果镜像加速器仍然失败

### 方案A：使用阿里云镜像加速器（推荐，最稳定）

1. **注册阿里云账号并获取专属加速地址**
   - 访问：https://cr.console.aliyun.com/
   - 登录后进入"容器镜像服务" → "镜像加速器"
   - 复制你的专属加速地址（格式：`https://xxxxx.mirror.aliyuncs.com`）

2. **配置阿里云镜像加速器**

```bash
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://你的专属地址.mirror.aliyuncs.com"
  ]
}
EOF

sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 方案B：手动拉取镜像后构建

如果镜像加速器都不可用，可以尝试手动拉取：

```bash
# 尝试直接拉取（可能需要多次重试）
docker pull node:18-slim

# 如果还是失败，尝试使用完整地址
docker pull docker.io/library/node:18-slim

# 拉取成功后，再构建应用
cd /opt/newsapp/news
sudo docker compose build app
```

### 方案C：检查网络连接

```bash
# 测试DNS解析
ping -c 2 dockerproxy.com
ping -c 2 registry-1.docker.io

# 测试HTTPS连接
curl -I https://dockerproxy.com
curl -I https://registry-1.docker.io

# 如果DNS解析失败，配置备用DNS
sudo tee /etc/systemd/resolved.conf <<-'EOF'
[Resolve]
DNS=8.8.8.8 114.114.114.114
FallbackDNS=223.5.5.5
EOF

sudo systemctl restart systemd-resolved
```

## 验证配置成功

配置完成后，执行以下命令验证：

```bash
# 查看Docker信息，确认镜像源已配置
docker info | grep -A 10 "Registry Mirrors"

# 应该能看到类似输出：
# Registry Mirrors:
#  https://dockerproxy.com/
#  https://hub-mirror.c.163.com/
#  ...

# 测试拉取镜像
docker pull node:18-slim
```

## 注意事项

1. **镜像加速器可能不稳定**：如果某个镜像源失败，Docker会自动尝试下一个
2. **首次拉取较慢**：`node:18-slim` 镜像约200MB，首次下载需要一些时间
3. **网络环境**：确保服务器能访问外网，或使用内网镜像源

