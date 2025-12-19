# 修复npm网络超时问题

## 问题描述

Docker构建时，`npm ci`步骤出现网络超时错误：
```
npm error code ETIMEDOUT
npm error network read ETIMEDOUT
npm error network This is a problem related to network connectivity.
```

## 解决方案

已在Dockerfile中为npm配置了：
1. **国内镜像源**：使用淘宝npm镜像（registry.npmmirror.com）
2. **超时设置**：300秒（5分钟）
3. **重试次数**：5次

## 已更新的Dockerfile配置

### 前端构建阶段
```dockerfile
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set fetch-timeout 300000 \
    && npm config set fetch-retries 5 \
    && npm ci
```

### 后端构建阶段
```dockerfile
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set fetch-timeout 300000 \
    && npm config set fetch-retries 5 \
    && npm ci --only=production
```

## 其他npm镜像源选项

如果淘宝镜像仍然慢，可以尝试：

### 腾讯云镜像
```dockerfile
npm config set registry https://mirrors.cloud.tencent.com/npm/
```

### 华为云镜像
```dockerfile
npm config set registry https://repo.huaweicloud.com/repository/npm/
```

### 中科大镜像
```dockerfile
npm config set registry https://npmreg.proxy.ustclug.org/
```

## 重新构建步骤

```bash
# 确保Dockerfile已更新
grep "registry.npmmirror.com" Dockerfile

# 重新构建
sudo docker compose build --no-cache app
```

## 预期时间

使用国内镜像源后：
- `npm ci`（前端）：2-5分钟
- `npm ci --only=production`（后端）：1-3分钟
- 总构建时间：15-25分钟

## 如果仍然超时

1. **检查网络连接**：
   ```bash
   curl -I https://registry.npmmirror.com
   ```

2. **尝试其他镜像源**（修改Dockerfile中的registry地址）

3. **增加超时时间**（修改fetch-timeout为更大的值，单位毫秒）

4. **检查Docker网络配置**：
   ```bash
   sudo docker network inspect bridge
   ```

5. **使用代理**（如果有）：
   ```dockerfile
   ENV http_proxy=http://proxy.example.com:8080
   ENV https_proxy=http://proxy.example.com:8080
   ```

