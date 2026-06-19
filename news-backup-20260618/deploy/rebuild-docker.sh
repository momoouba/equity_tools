#!/bin/bash

# Docker 重新构建脚本
# 使用方法: ./deploy/rebuild-docker.sh
# 说明: 重新构建前后端Docker镜像并重启服务

set -e

echo "=========================================="
echo "  重新构建 Docker 前后端"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    exit 1
fi

echo "✓ Docker 和 Docker Compose 已安装"
echo ""

# 步骤1: 停止现有容器（可选，避免端口冲突）
echo "步骤 1: 停止现有应用容器"
echo "----------------------------------------"
read -p "是否停止现有容器？(y/n，默认y): " stop_containers
if [ "$stop_containers" != "n" ] && [ "$stop_containers" != "N" ]; then
    echo "正在停止应用容器..."
    docker compose stop app nginx || echo "⚠️  容器可能未运行"
    echo "✓ 容器已停止"
else
    echo "跳过停止容器"
fi

echo ""

# 步骤2: 重新构建应用镜像（包含前后端）
echo "步骤 2: 重新构建应用镜像（前后端）"
echo "----------------------------------------"
echo "正在构建 Docker 镜像（这可能需要几分钟）..."
docker compose build --no-cache app

echo ""
echo "✓ 镜像构建完成"
echo ""

# 步骤3: 删除旧的frontend volume（确保使用新构建的前端文件）
echo "步骤 3: 清理旧的frontend volume"
echo "----------------------------------------"
echo "正在停止容器..."
docker compose down

echo "正在删除旧的frontend volume（如果存在）..."
docker volume rm news_app_frontend 2>/dev/null || echo "⚠️  volume不存在或已被删除，继续..."

echo "✓ volume清理完成"
echo ""

# 步骤4: 启动服务（先启动 app，再复制前端文件，最后启动 nginx）
echo "步骤 4: 启动应用服务"
echo "----------------------------------------"
echo "正在启动应用服务..."
docker compose up -d app mysql

echo ""
echo "等待应用启动..."
sleep 15

echo ""
echo "步骤 4.5: 将前端文件复制到 volume"
echo "----------------------------------------"
VOLUME_NAME="news_app_frontend"
echo "正在将镜像中的前端文件复制到 volume..."

# 方法1: 直接从 app 容器复制（最简单）
echo "尝试从 app 容器直接复制..."
if docker cp newsapp:/app/client/dist/. $(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')/ 2>/dev/null; then
    echo "✓ 前端文件已直接复制到 volume（需要 root 权限）"
else
    # 方法2: 使用已存在的 news-app 镜像创建临时容器
    echo "使用 news-app 镜像创建临时容器..."
    TEMP_CONTAINER=$(docker run -d --name temp-frontend-copy-$(date +%s) \
        -v ${VOLUME_NAME}:/target \
        news-app sleep 300 2>/dev/null) || TEMP_CONTAINER=""
    
    if [ -n "$TEMP_CONTAINER" ]; then
        # 从镜像复制文件
        docker exec ${TEMP_CONTAINER} sh -c "if [ -d /app/client/dist ]; then cp -r /app/client/dist/* /target/ 2>/dev/null || true; fi" && \
        echo "✓ 前端文件已从镜像复制到 volume" || \
        echo "⚠️  警告: 无法复制前端文件"
        docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
    else
        echo "⚠️  无法创建临时容器，请手动执行："
        VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
        if [ -n "$VOLUME_PATH" ]; then
            echo "  sudo docker cp newsapp:/app/client/dist/. ${VOLUME_PATH}/"
        fi
    fi
fi

echo ""
echo "步骤 4.6: 启动 Nginx 服务"
echo "----------------------------------------"
echo "正在启动 Nginx 服务..."
docker compose up -d nginx

echo ""
echo "✓ 所有服务已启动"
echo ""

# 步骤5: 等待服务启动
echo "步骤 5: 等待服务启动"
echo "----------------------------------------"
echo "等待30秒让服务完全启动..."
sleep 30

# 步骤6: 检查服务状态
echo ""
echo "步骤 6: 检查服务状态"
echo "----------------------------------------"
echo "容器状态:"
docker compose ps

echo ""
echo "检查应用健康状态..."
if docker compose exec -T app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" 2>/dev/null; then
    echo "✓ 应用健康检查通过"
else
    echo "⚠️  应用可能还在启动中，请稍后检查日志"
fi

echo ""
echo "步骤 7: 验证前端文件"
echo "----------------------------------------"
echo "检查前端文件是否存在..."
if docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 前端文件已正确部署"
    echo "前端文件修改时间:"
    docker compose exec -T app stat -c "%y" /app/client/dist/index.html 2>/dev/null || echo "无法获取文件时间"
else
    echo "⚠️  警告: 前端文件不存在，请检查构建过程"
fi

echo ""
echo "步骤 8: 查看应用日志（最近30行）"
echo "----------------------------------------"
docker compose logs app --tail 30

echo ""
echo "=========================================="
echo "  重新构建完成！"
echo "=========================================="
echo ""
echo "后续操作:"
echo "  - 查看完整日志: docker compose logs -f app"
echo "  - 查看所有服务日志: docker compose logs -f"
echo "  - 重启服务: docker compose restart app"
echo "  - 停止服务: docker compose down"
echo "  - 查看服务状态: docker compose ps"
echo ""
echo "服务访问地址:"
echo "  - HTTP:  http://localhost"
echo "  - API:   http://localhost/api"
echo "  - 健康检查: http://localhost/api/health"
echo ""
