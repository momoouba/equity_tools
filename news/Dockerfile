# 多阶段构建 Dockerfile
# 阶段1: 构建前端
FROM node:18-slim AS frontend-builder

WORKDIR /app/client

# 复制前端依赖文件
COPY client/package*.json ./

# 配置npm使用国内镜像源并安装前端依赖
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set fetch-timeout 300000 \
    && npm config set fetch-retries 5 \
    && npm ci

# 复制前端源代码
COPY client/ ./

# 构建前端（增加Node.js内存限制，避免构建时内存不足）
# 支持通过构建参数传递内存限制，默认4GB
ARG NODE_OPTIONS="--max-old-space-size=4096"
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN npm run build

# 阶段2: 构建后端并运行
FROM node:18-slim

WORKDIR /app

# 构建阶段拉取 Playwright 浏览器可走代理：docker compose build --build-arg HTTP_PROXY=http://host:port app
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=${HTTP_PROXY} HTTPS_PROXY=${HTTPS_PROXY} NO_PROXY=${NO_PROXY}

# 安装系统依赖（MySQL客户端、Python3、pip等）
# 使用Debian包管理器（配置国内镜像源加速）
RUN { \
        echo "deb http://mirrors.aliyun.com/debian bookworm main"; \
        echo "deb http://mirrors.aliyun.com/debian bookworm-updates main"; \
        echo "deb http://mirrors.aliyun.com/debian-security bookworm-security main"; \
        echo "deb http://mirrors.aliyun.com/debian bullseye main"; \
    } > /etc/apt/sources.list \
    && apt-get update && \
    apt-get install -y --no-install-recommends \
    default-mysql-client \
    python3 \
    python3-pip \
    python3-setuptools \
    tzdata \
    # 编译工具（用于编译 bcrypt 等原生模块）
    build-essential \
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
    libxshmfence1 \
    # iFinD SDK 需要的依赖
    libstdc++6 \
    zlib1g \
    libidn11 \
    libgssapi-krb5-2 \
    libldap-2.5-0 \
    && rm -rf /var/lib/apt/lists/* \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone \
    && ln -sf /usr/bin/python3 /usr/bin/python

# 复制后端依赖文件
COPY package*.json ./

# 配置npm使用国内镜像源并安装后端依赖
RUN npm config set registry https://registry.npmmirror.com \
    && npm config set fetch-timeout 300000 \
    && npm config set fetch-retries 5 \
    && npm ci --omit=dev \
    && apt-get purge -y build-essential \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# 复制Python依赖文件并安装（在创建非root用户之前，使用root安装）
COPY server/utils/requirements.txt ./server/utils/

# Playwright 浏览器：与 Python playwright 包版本严格匹配，勿用系统 apt chromium（易 crashpad 不兼容）
# 默认走官方 CDN（npmmirror 常滞后，新版 Chromium 易 404）。
# 国内可尝试加速：docker compose build --build-arg PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright app
# 若镜像无该版本，下方脚本会自动去掉镜像改走官方。
# 构建机 HTTP 代理：--build-arg HTTP_PROXY=http://host:port
ARG PLAYWRIGHT_DOWNLOAD_HOST=
ENV PLAYWRIGHT_DOWNLOAD_HOST=${PLAYWRIGHT_DOWNLOAD_HOST}
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT=600000

# 配置 pip + 一次性安装依赖（Debian PEP668 需 --break-system-packages）
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip config set global.timeout 300 \
    && pip config set global.retries 5 \
    && pip install --break-system-packages --upgrade pip \
    && pip install --break-system-packages --no-cache-dir -r ./server/utils/requirements.txt \
    && mkdir -p /ms-playwright \
    && sh -c 'set -e; \
      pw_install() { python3 -m playwright install chromium; }; \
      if [ -n "$PLAYWRIGHT_DOWNLOAD_HOST" ]; then \
        pw_install || { echo "[playwright] mirror failed or 404, falling back to official CDN..."; unset PLAYWRIGHT_DOWNLOAD_HOST; export PLAYWRIGHT_DOWNLOAD_HOST=; \
          for j in 1 2 3 4 5; do pw_install && break || sleep 30; done; }; \
      else \
        for j in 1 2 3 4 5; do pw_install && break || sleep 30; done; \
      fi' \
    && python3 -c "from pathlib import Path; p=Path('/ms-playwright'); assert any(p.glob('chromium*')), 'Playwright Chromium 未安装到 /ms-playwright'"

# 安装同花顺 iFinD SDK（港股上市申请数据源）
# 1. 复制整个 SDK 到临时目录
COPY deploy/ths_sdk /opt/ths_sdk

# 2. 安装 iFinD SDK（运行安装脚本，会在 site-packages 创建 iFinDPy.pth 指向 bin64）
RUN python3 /opt/ths_sdk/bin64/installiFinDPy.py /opt/ths_sdk

# 3. 验证安装
RUN python3 -c "import iFinDPy; print('iFinDPy installed successfully')"

# 复制后端源代码
COPY server/ ./server/

# 复制构建好的前端文件到 Nginx 可访问的位置
COPY --from=frontend-builder /app/client/dist ./client/dist

# 复制环境变量模板文件（如果存在）
# 注意：生产环境应该使用 .env 文件，这个文件在运行时挂载
# COPY deploy/env.production.template .env.example

# 创建必要的目录
RUN mkdir -p uploads logs

# 创建非root用户（在Python依赖安装之后）
RUN groupadd -r nodejs && \
    useradd -r -g nodejs nodejs && \
    chown -R nodejs:nodejs /app /ms-playwright

USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server/index.js"]

