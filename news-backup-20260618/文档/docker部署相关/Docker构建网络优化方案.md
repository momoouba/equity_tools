# Docker构建网络优化方案

## 问题分析

虽然服务器网络连接正常（curl测试很快），但Docker构建时`apk add`步骤耗时超过2小时，可能原因：

1. **Docker构建时的网络环境不同**：Docker构建可能使用不同的网络命名空间
2. **DNS解析慢**：Docker构建时DNS解析可能有问题
3. **包下载超时重试**：某些包下载失败后不断重试
4. **镜像源配置未生效**：sed命令可能在某些情况下失败

## 优化方案

### 已更新的Dockerfile优化点

1. **添加DNS配置**：使用Google DNS（8.8.8.8）确保DNS解析快速
2. **先更新包索引**：使用`apk update`确保包索引是最新的
3. **添加超时设置**：`--timeout=300`（5分钟超时）
4. **使用阿里云镜像源**：加速包下载

### 如果仍然慢，尝试以下方案

#### 方案1：使用清华大学镜像源

```dockerfile
RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf || true \
    && sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories || true \
    && apk update --no-cache --timeout=300 \
    && apk add --no-cache --timeout=300 \
    mysql-client python3 py3-pip py3-setuptools tzdata \
    ...
```

#### 方案2：分步安装，便于定位问题

```dockerfile
# 配置DNS和镜像源
RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf || true \
    && sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories || true

# 更新包索引
RUN apk update --no-cache --timeout=300

# 分步安装（可以看到哪一步慢）
RUN apk add --no-cache --timeout=300 mysql-client
RUN apk add --no-cache --timeout=300 python3
RUN apk add --no-cache --timeout=300 py3-pip py3-setuptools
RUN apk add --no-cache --timeout=300 tzdata
```

#### 方案3：使用Docker构建参数传递DNS

在构建时指定DNS：

```bash
sudo docker compose build --build-arg DNS_SERVER=8.8.8.8 app
```

然后在Dockerfile中使用：
```dockerfile
ARG DNS_SERVER=8.8.8.8
RUN echo "nameserver $DNS_SERVER" > /etc/resolv.conf || true
```

## 当前建议操作

### 1. 取消当前构建（如果还在运行）

按 `Ctrl+C` 取消

### 2. 使用优化后的Dockerfile重新构建

```bash
# 确保Dockerfile已更新
grep "nameserver 8.8.8.8" Dockerfile
grep "apk update" Dockerfile

# 重新构建
sudo docker compose build --no-cache app
```

### 3. 如果还是慢，尝试分步构建

修改Dockerfile，使用分步安装，可以看到具体哪一步慢。

### 4. 检查Docker网络配置

```bash
# 检查Docker DNS配置
sudo cat /etc/docker/daemon.json

# 如果文件不存在或没有DNS配置，可以添加：
sudo tee /etc/docker/daemon.json <<EOF
{
  "dns": ["8.8.8.8", "114.114.114.114"]
}
EOF

# 重启Docker服务
sudo systemctl restart docker
```

### 5. 使用代理（如果有）

如果有HTTP代理，可以在构建时设置：

```bash
sudo docker compose build \
  --build-arg http_proxy=http://proxy.example.com:8080 \
  --build-arg https_proxy=http://proxy.example.com:8080 \
  app
```

## 预期时间

使用优化后的配置：
- `apk update`：30秒-2分钟
- `apk add`：1-3分钟
- **总时间应该在5-10分钟内完成**

## 如果仍然超过10分钟

1. **检查Docker日志**：
   ```bash
   sudo journalctl -u docker -n 100
   ```

2. **尝试使用官方镜像源**（如果国内镜像源有问题）：
   ```dockerfile
   # 移除sed命令，使用官方源
   RUN apk update --no-cache --timeout=300 \
       && apk add --no-cache --timeout=300 \
       ...
   ```

3. **考虑使用预构建的基础镜像**：
   可以先手动构建一个包含Python的基础镜像，然后基于这个镜像构建应用。

4. **联系服务器管理员**：
   检查是否有防火墙、代理或网络策略限制Docker容器的网络访问。

