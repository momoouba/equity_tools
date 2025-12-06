# 多阶段构建 Dockerfile
# 阶段1: 构建前端
FROM node:18-alpine AS frontend-builder

WORKDIR /app/client

# 复制前端依赖文件
COPY client/package*.json ./

# 安装前端依赖
RUN npm ci

# 复制前端源代码
COPY client/ ./

# 构建前端
RUN npm run build

# 阶段2: 构建后端并运行
FROM node:18-alpine

WORKDIR /app

# 安装系统依赖（MySQL客户端等）
RUN apk add --no-cache \
    mysql-client \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 复制后端依赖文件
COPY package*.json ./

# 安装后端依赖
RUN npm ci --only=production

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
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server/index.js"]

