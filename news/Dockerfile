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

# 构建前端
RUN npm run build

# 阶段2: 构建后端并运行
FROM node:18-slim

WORKDIR /app

# 安装系统依赖（MySQL客户端、Python3、pip等）
# 使用Debian包管理器
RUN apt-get update && \
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

# 复制Python依赖文件并安装
COPY server/utils/requirements.txt ./server/utils/
RUN pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple \
    && pip config set global.timeout 300 \
    && pip config set global.retries 5 \
    && pip install --upgrade pip \
    && pip install --break-system-packages --no-cache-dir -r ./server/utils/requirements.txt \
    && playwright install chromium || echo "Playwright安装失败，将在运行时提示安装"

# 复制后端源代码
COPY server/ ./server/

# 复制构建好的前端文件到 Nginx 可访问的位置
COPY --from=frontend-builder /app/client/dist ./client/dist

# 复制环境变量模板文件（如果存在）
# 注意：生产环境应该使用 .env 文件，这个文件在运行时挂载
# COPY deploy/env.production.template .env.example

# 创建必要的目录
RUN mkdir -p uploads logs

# 创建非root用户
RUN groupadd -r nodejs && \
    useradd -r -g nodejs nodejs && \
    chown -R nodejs:nodejs /app

USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server/index.js"]

