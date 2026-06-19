# Docker构建优化方案

## 问题描述

Docker构建时，`apk add`步骤耗时超过2小时，这明显不正常。正常情况下应该在几分钟内完成。

## 可能原因

1. **网络问题**：访问Alpine Linux官方镜像源速度慢
2. **DNS解析慢**：DNS解析超时
3. **防火墙/代理**：网络策略限制
4. **镜像源问题**：默认镜像源访问不稳定

## 解决方案

### 方案1：使用国内镜像源（推荐）

已更新Dockerfile，使用阿里云镜像源加速：

```dockerfile
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories || true \
    && apk add --no-cache --timeout=300 \
    mysql-client \
    python3 \
    py3-pip \
    py3-setuptools \
    tzdata \
    ...
```

### 方案2：如果方案1仍然慢，尝试其他镜像源

可以尝试以下镜像源：

**清华大学镜像源**：
```dockerfile
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.tuna.tsinghua.edu.cn/g' /etc/apk/repositories || true
```

**中科大镜像源**：
```dockerfile
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.ustc.edu.cn/g' /etc/apk/repositories || true
```

### 方案3：分步安装，便于定位问题

如果仍然慢，可以分步安装，看哪一步卡住：

```dockerfile
# 先更新镜像源
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories || true

# 更新包索引
RUN apk update --timeout=300

# 分步安装
RUN apk add --no-cache --timeout=300 mysql-client
RUN apk add --no-cache --timeout=300 python3
RUN apk add --no-cache --timeout=300 py3-pip py3-setuptools
RUN apk add --no-cache --timeout=300 tzdata
```

## 当前建议操作

### 1. 取消当前构建

如果构建还在进行，可以按 `Ctrl+C` 取消，然后使用优化后的Dockerfile重新构建。

### 2. 使用优化后的Dockerfile重新构建

```bash
# 确保Dockerfile已更新（包含镜像源配置）
grep "mirrors.aliyun.com" Dockerfile

# 重新构建
sudo docker compose build --no-cache app
```

### 3. 如果仍然慢，检查网络

```bash
# 在服务器上测试网络连接
ping dl-cdn.alpinelinux.org
ping mirrors.aliyun.com

# 测试DNS解析
nslookup dl-cdn.alpinelinux.org
nslookup mirrors.aliyun.com
```

### 4. 使用代理（如果有）

如果有HTTP代理，可以在Dockerfile中添加：

```dockerfile
# 在apk add之前设置代理
ENV http_proxy=http://proxy.example.com:8080
ENV https_proxy=http://proxy.example.com:8080
```

## 预期构建时间

正常情况下：
- `apk add`步骤：**1-5分钟**
- `npm ci`步骤：**1-3分钟**
- `npm run build`步骤：**30秒-2分钟**
- `pip install`步骤：**1-3分钟**

**总构建时间应该在10-20分钟内完成**。

## 如果构建仍然很慢

1. **检查服务器网络**：
   ```bash
   curl -I https://mirrors.aliyun.com
   ```

2. **尝试不使用缓存构建**（已经使用了`--no-cache`）

3. **检查Docker守护进程**：
   ```bash
   sudo systemctl status docker
   ```

4. **查看详细构建日志**：
   ```bash
   sudo docker compose build app 2>&1 | tee build.log
   ```

5. **考虑使用预构建的基础镜像**：
   可以预先构建一个包含Python的基础镜像，然后基于这个镜像构建应用镜像。

## 临时解决方案

如果急需部署，可以：

1. **先不安装Python依赖**，只安装Python本身
2. **在容器启动后安装Python依赖**（不推荐，但可以快速验证功能）

修改Dockerfile，移除pip install步骤，在容器启动脚本中安装：

```dockerfile
# 移除这行
# RUN pip install --break-system-packages --no-cache-dir -r ./server/utils/requirements.txt
```

然后在应用启动时检查并安装（在server/index.js或启动脚本中）。

但**推荐使用镜像源优化方案**，这是最根本的解决方案。

