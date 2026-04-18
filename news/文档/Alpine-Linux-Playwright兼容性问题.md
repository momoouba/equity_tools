# Alpine Linux Playwright兼容性问题

## 问题确认

**Playwright不支持Alpine Linux（musl libc）**

错误信息：
```
ERROR: Could not find a version that satisfies the requirement playwright (from versions: none)
ERROR: No matching distribution found for playwright
```

**原因**：Playwright的预编译包主要针对glibc环境，而Alpine Linux使用musl libc，导致不兼容。

## 解决方案

### 方案1：切换到Debian基础镜像（推荐）

将Dockerfile中的基础镜像从 `node:18-alpine` 改为 `node:18-slim`（基于Debian）。

**优点**：
- Playwright完全支持
- 更好的兼容性
- 更多软件包可用

**缺点**：
- 镜像体积稍大（约100-200MB）

**修改步骤**：

1. 修改 `Dockerfile`：
```dockerfile
# 将这行
FROM node:18-alpine

# 改为
FROM node:18-slim
```

2. 更新系统包安装命令：
```dockerfile
# 将apk命令改为apt-get
RUN apt-get update && \
    apt-get install -y \
    mysql-client \
    python3 \
    python3-pip \
    tzdata \
    # Playwright所需的系统依赖
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*
```

3. 重新构建镜像：
```bash
cd /opt/newsapp/news
sudo docker compose build app
sudo docker compose up -d app
```

### 方案2：接受限制，使用降级处理

保持Alpine Linux，但不使用Playwright。当检测到反爬页面时：
1. 返回明确的错误信息
2. 标记为需要人工处理
3. 在日志中记录详细信息

**优点**：
- 不需要修改基础镜像
- 镜像体积小

**缺点**：
- 无法自动处理反爬页面
- 需要人工处理或使用其他方案

### 方案3：使用第三方API服务

使用支持微信公众号文章提取的第三方服务API。

## 推荐方案

**建议使用方案1**：切换到Debian基础镜像，这样可以：
1. 支持Playwright
2. 更好的兼容性
3. 更多软件包可用

虽然镜像体积会稍大，但对于生产环境来说，稳定性和功能更重要。

## 当前状态

代码已经添加了Playwright支持，但会在Alpine Linux上失败并给出明确提示。系统会：
1. 尝试使用HTTP请求
2. 检测到反爬页面时，尝试Playwright（会失败并提示）
3. 返回错误信息，提示需要切换到Debian镜像

## 下一步

请选择：
1. **切换到Debian基础镜像**（推荐）- 我可以帮您修改Dockerfile
2. **保持Alpine，接受限制** - 系统会返回明确的错误提示
3. **使用其他方案** - 如第三方API服务

