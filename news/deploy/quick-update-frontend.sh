#!/bin/bash

# 快速更新前端文件到Docker volume
# 使用方法: ./deploy/quick-update-frontend.sh

set -e

echo "=========================================="
echo "快速更新前端文件到Docker环境"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

VOLUME_NAME="news_app_frontend"

echo "步骤 1: 检查前端构建文件"
echo "----------------------------------------"
if [ ! -d "client/dist" ]; then
    echo "⚠️  前端构建文件不存在，需要先构建前端"
    echo "正在构建前端..."
    cd client
    npm run build
    cd ..
    echo "✓ 前端构建完成"
else
    echo "✓ 前端构建文件已存在"
    echo "构建文件修改时间:"
    ls -lh client/dist/index.html 2>/dev/null || echo "无法获取文件信息"
fi

echo ""
echo "步骤 2: 查找并更新Docker volume"
echo "----------------------------------------"

# 方法1: 尝试从运行中的容器复制
if docker ps | grep -q newsapp; then
    echo "检测到 newsapp 容器正在运行，尝试直接复制..."
    
    # 先检查容器中是否有新构建的文件
    if docker exec newsapp test -d /app/client/dist 2>/dev/null; then
        echo "从容器复制前端文件到volume..."
        
        # 创建临时容器来复制文件
        TEMP_CONTAINER=$(docker run -d --name temp-frontend-update-$(date +%s) \
            -v ${VOLUME_NAME}:/target \
            news-app sleep 300 2>/dev/null) || TEMP_CONTAINER=""
        
        if [ -n "$TEMP_CONTAINER" ]; then
            # 从运行中的容器复制到临时容器，再复制到volume
            docker cp newsapp:/app/client/dist/. ${TEMP_CONTAINER}:/target/ 2>/dev/null && \
            echo "✓ 已从容器复制前端文件" || \
            echo "⚠️  从容器复制失败，尝试其他方法..."
            docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
        fi
    fi
fi

# 方法2: 如果本地有构建文件，直接复制到volume
if [ -d "client/dist" ]; then
    echo "使用本地构建文件更新volume..."
    
    # 查找volume路径
    VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    
    if [ -n "$VOLUME_PATH" ]; then
        echo "Volume路径: $VOLUME_PATH"
        echo "正在复制文件..."
        sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null && \
        echo "✓ 文件已复制到volume" || \
        echo "⚠️  复制失败，尝试使用临时容器..."
    fi
    
    # 方法3: 使用临时容器复制
    if [ -z "$VOLUME_PATH" ] || [ ! -d "$VOLUME_PATH" ]; then
        echo "使用临时容器复制文件..."
        TEMP_CONTAINER=$(docker run -d --name temp-frontend-update-$(date +%s) \
            -v ${VOLUME_NAME}:/target \
            alpine sleep 300 2>/dev/null) || TEMP_CONTAINER=""
        
        if [ -n "$TEMP_CONTAINER" ]; then
            # 将本地文件复制到临时容器
            docker cp client/dist/. ${TEMP_CONTAINER}:/target/ && \
            echo "✓ 文件已通过临时容器复制到volume" || \
            echo "⚠️  复制失败"
            docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
        else
            echo "⚠️  无法创建临时容器"
        fi
    fi
fi

echo ""
echo "步骤 3: 重启Nginx服务"
echo "----------------------------------------"
echo "正在重启Nginx以加载新文件..."
docker compose restart nginx 2>/dev/null || echo "⚠️  Nginx重启失败，请手动重启: docker compose restart nginx"

echo ""
echo "步骤 4: 验证更新"
echo "----------------------------------------"
echo "检查volume中的文件:"
docker compose exec nginx ls -lh /usr/share/nginx/html/index.html 2>/dev/null || \
docker compose exec app ls -lh /app/client/dist/index.html 2>/dev/null || \
echo "⚠️  无法验证，请手动检查"

echo ""
echo "=========================================="
echo "前端更新完成！"
echo "=========================================="
echo ""
echo "重要提示:"
echo "  1. 清除浏览器缓存（Ctrl+Shift+R 或 Cmd+Shift+R）"
echo "  2. 如果仍然看到旧页面，可能是浏览器缓存，尝试无痕模式"
echo "  3. 检查文件修改时间确认是否更新成功"
echo ""
echo "验证命令:"
echo "  docker compose exec nginx ls -lh /usr/share/nginx/html/index.html"
echo "  docker compose exec app ls -lh /app/client/dist/index.html"
echo ""
