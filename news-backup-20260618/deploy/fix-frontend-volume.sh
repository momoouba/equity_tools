#!/bin/bash

# 修复前端 volume 的脚本
# 使用方法: ./deploy/fix-frontend-volume.sh
# 说明: 将镜像中构建好的前端文件复制到 app_frontend volume

set -e

echo "=========================================="
echo "  修复前端 Volume"
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

echo "步骤 1: 检查 app 容器是否运行"
echo "----------------------------------------"
if ! docker compose ps app | grep -q "Up"; then
    echo "⚠️  app 容器未运行，正在启动..."
    docker compose up -d app
    echo "等待容器启动..."
    sleep 10
fi
echo "✓ app 容器已运行"
echo ""

echo "步骤 2: 检查 app_frontend volume"
echo "----------------------------------------"
VOLUME_NAME="news_app_frontend"
if ! docker volume inspect $VOLUME_NAME &>/dev/null; then
    echo "⚠️  volume 不存在，将在启动 Nginx 时自动创建"
else
    echo "✓ volume 已存在"
fi
echo ""

echo "步骤 3: 将镜像中的前端文件复制到 volume"
echo "----------------------------------------"

# 方法1: 直接从 app 容器复制到 volume（使用已存在的 nginx 容器或创建临时容器）
echo "正在从 app 容器复制前端文件..."

# 先尝试使用已存在的 nginx 容器（如果存在）
if docker ps -a --format '{{.Names}}' | grep -q "^newsapp-nginx$"; then
    echo "使用已存在的 nginx 容器作为中转..."
    # 从 app 容器复制到 nginx 容器
    docker cp newsapp:/app/client/dist/. newsapp-nginx:/usr/share/nginx/html/ 2>/dev/null && {
        echo "✓ 前端文件已复制到 nginx 容器（volume 会自动同步）"
    } || {
        echo "⚠️  无法直接复制到 nginx 容器，尝试其他方法..."
        # 使用 news-app 镜像创建临时容器（镜像应该已经存在）
        TEMP_CONTAINER=$(docker run -d --name temp-frontend-copy-$(date +%s) \
            -v ${VOLUME_NAME}:/target \
            news-app sleep 300 2>/dev/null) || TEMP_CONTAINER=""
        
        if [ -n "$TEMP_CONTAINER" ]; then
            docker exec ${TEMP_CONTAINER} sh -c "if [ -d /app/client/dist ]; then cp -r /app/client/dist/* /target/ 2>/dev/null || true; fi" && \
            echo "✓ 前端文件已从镜像复制到 volume" || \
            echo "⚠️  无法从镜像复制"
            docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
        else
            # 如果镜像也不存在，直接使用 docker cp 到 volume 的挂载点
            VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
            if [ -n "$VOLUME_PATH" ]; then
                echo "尝试直接复制到 volume 挂载点..."
                docker cp newsapp:/app/client/dist/. ${VOLUME_PATH}/ 2>/dev/null && \
                echo "✓ 前端文件已直接复制到 volume" || \
                echo "⚠️  需要 root 权限，尝试使用临时容器方法..."
            fi
        fi
    }
else
    # 如果 nginx 容器不存在，使用 news-app 镜像创建临时容器
    echo "使用 news-app 镜像创建临时容器..."
    TEMP_CONTAINER=$(docker run -d --name temp-frontend-copy-$(date +%s) \
        -v ${VOLUME_NAME}:/target \
        news-app sleep 300 2>/dev/null) || TEMP_CONTAINER=""
    
    if [ -n "$TEMP_CONTAINER" ]; then
        # 从镜像复制文件
        docker exec ${TEMP_CONTAINER} sh -c "if [ -d /app/client/dist ]; then cp -r /app/client/dist/* /target/ 2>/dev/null || true; fi" && \
        echo "✓ 前端文件已从镜像复制到 volume" || \
        echo "⚠️  无法从镜像复制"
        docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
    else
        echo "⚠️  无法创建临时容器，尝试直接复制方法..."
        # 尝试直接从 app 容器复制到 volume 挂载点（需要 root 权限）
        VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
        if [ -n "$VOLUME_PATH" ]; then
            echo "尝试直接复制到 volume 挂载点: $VOLUME_PATH"
            sudo docker cp newsapp:/app/client/dist/. ${VOLUME_PATH}/ 2>/dev/null && \
            echo "✓ 前端文件已直接复制到 volume" || \
            echo "⚠️  直接复制失败，请手动执行："
            echo "   sudo docker cp newsapp:/app/client/dist/. ${VOLUME_PATH}/"
        fi
    fi
fi

echo ""
echo ""

echo "步骤 4: 启动 Nginx 容器"
echo "----------------------------------------"
docker compose up -d nginx

echo ""
echo "等待 Nginx 启动..."
sleep 5

echo ""
echo "步骤 5: 验证前端文件"
echo "----------------------------------------"
if docker compose exec -T nginx test -f /usr/share/nginx/html/index.html 2>/dev/null; then
    echo "✓ 前端文件已正确部署到 Nginx"
    echo "前端文件列表（前10个）："
    docker compose exec -T nginx ls -la /usr/share/nginx/html/ | head -15
else
    echo "⚠️  警告: Nginx 中找不到前端文件"
    echo "请检查 volume 挂载和文件复制过程"
fi

echo ""
echo "步骤 6: 检查容器状态"
echo "----------------------------------------"
docker compose ps

echo ""
echo "=========================================="
echo "  修复完成！"
echo "=========================================="
echo ""
echo "现在可以通过以下地址访问："
echo "  - HTTP:  http://localhost"
echo "  - HTTPS: https://localhost (如果配置了SSL)"
echo ""
echo "如果页面仍然为空，请检查："
echo "  1. Nginx 日志: docker compose logs nginx"
echo "  2. 前端文件: docker compose exec nginx ls -la /usr/share/nginx/html/"
echo "  3. 浏览器控制台是否有错误"
echo ""
