#!/bin/bash

# 修复 Nginx 连接问题脚本
# 使用方法: ./deploy/fix-nginx-connection.sh

set -e

echo "=========================================="
echo "修复 Nginx 连接问题"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo "步骤 1: 检查 Docker 服务状态"
echo "----------------------------------------"
if ! docker ps > /dev/null 2>&1; then
    echo "❌ Docker 服务未运行，请先启动 Docker"
    exit 1
fi
echo "✓ Docker 服务正在运行"

echo ""
echo "步骤 2: 检查容器状态"
echo "----------------------------------------"
docker compose ps

echo ""
echo "步骤 3: 检查 Nginx 容器"
echo "----------------------------------------"
NGINX_STATUS=$(docker compose ps nginx 2>/dev/null | grep -q "Up" && echo "running" || echo "stopped")

if [ "$NGINX_STATUS" = "stopped" ]; then
    echo "⚠️  Nginx 容器未运行，正在启动..."
    docker compose up -d nginx
    
    echo "等待 Nginx 启动..."
    sleep 5
    
    # 检查是否启动成功
    if docker compose ps nginx | grep -q "Up"; then
        echo "✓ Nginx 容器已启动"
    else
        echo "❌ Nginx 容器启动失败，查看日志:"
        docker compose logs nginx | tail -20
        exit 1
    fi
else
    echo "✓ Nginx 容器正在运行"
fi

echo ""
echo "步骤 4: 检查前端文件"
echo "----------------------------------------"
VOLUME_NAME="news_app_frontend"

# 检查 volume 是否存在
if ! docker volume inspect ${VOLUME_NAME} > /dev/null 2>&1; then
    echo "⚠️  前端 volume 不存在，正在创建..."
    docker volume create ${VOLUME_NAME}
fi

# 检查 volume 中是否有文件
VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
if [ -n "$VOLUME_PATH" ]; then
    FILE_COUNT=$(sudo ls -A "$VOLUME_PATH" 2>/dev/null | wc -l || echo "0")
    echo "Volume 路径: $VOLUME_PATH"
    echo "文件数量: $FILE_COUNT"
    
    if [ "$FILE_COUNT" -eq 0 ]; then
        echo "⚠️  Volume 中没有文件，需要复制前端文件"
        
        # 检查本地是否有构建文件
        if [ -d "client/dist" ] && [ "$(ls -A client/dist 2>/dev/null | wc -l)" -gt 0 ]; then
            echo "发现本地构建文件，正在复制..."
            sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null && \
            echo "✓ 文件已复制" || \
            echo "⚠️  复制失败，尝试使用容器方法..."
            
            # 如果直接复制失败，使用临时容器
            if [ "$(sudo ls -A "$VOLUME_PATH" 2>/dev/null | wc -l)" -eq 0 ]; then
                echo "使用临时容器复制文件..."
                TEMP_CONTAINER=$(docker run -d --name temp-nginx-fix-$(date +%s) \
                    -v ${VOLUME_NAME}:/target \
                    alpine sleep 300 2>/dev/null) || TEMP_CONTAINER=""
                
                if [ -n "$TEMP_CONTAINER" ]; then
                    docker cp client/dist/. ${TEMP_CONTAINER}:/target/ && \
                    echo "✓ 文件已通过容器复制" || \
                    echo "❌ 复制失败"
                    docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
                fi
            fi
        else
            echo "❌ 本地没有构建文件，需要先构建前端"
            echo "执行: cd client && npm run build && cd .."
            exit 1
        fi
    else
        echo "✓ Volume 中有文件"
    fi
fi

echo ""
echo "步骤 5: 检查 Nginx 配置"
echo "----------------------------------------"
# 检查 Nginx 容器内的文件
if docker compose exec -T nginx test -d /usr/share/nginx/html 2>/dev/null; then
    HTML_FILES=$(docker compose exec -T nginx ls -A /usr/share/nginx/html 2>/dev/null | wc -l || echo "0")
    echo "Nginx HTML 目录文件数: $HTML_FILES"
    
    if [ "$HTML_FILES" -eq 0 ]; then
        echo "⚠️  Nginx HTML 目录为空，需要重新挂载 volume"
        echo "重启 Nginx 容器以重新挂载..."
        docker compose restart nginx
        sleep 3
    fi
else
    echo "⚠️  Nginx HTML 目录不存在"
fi

echo ""
echo "步骤 6: 重启 Nginx 服务"
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤 7: 检查 Nginx 日志"
echo "----------------------------------------"
echo "最近的 Nginx 日志:"
docker compose logs nginx | tail -10

echo ""
echo "步骤 8: 检查端口监听"
echo "----------------------------------------"
# 检查 80 和 443 端口
if netstat -tuln 2>/dev/null | grep -q ":80 "; then
    echo "✓ 端口 80 正在监听"
else
    echo "⚠️  端口 80 未监听"
fi

if netstat -tuln 2>/dev/null | grep -q ":443 "; then
    echo "✓ 端口 443 正在监听"
else
    echo "⚠️  端口 443 未监听（如果未配置 SSL，这是正常的）"
fi

echo ""
echo "步骤 9: 测试 Nginx 响应"
echo "----------------------------------------"
# 测试本地连接
if curl -s -o /dev/null -w "%{http_code}" http://localhost > /dev/null 2>&1; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost)
    echo "✓ Nginx 响应 HTTP 状态码: $HTTP_CODE"
else
    echo "⚠️  无法连接到 Nginx（可能是防火墙或网络配置问题）"
fi

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "如果仍然无法访问，请检查:"
echo "  1. 防火墙设置: sudo ufw status"
echo "  2. Nginx 日志: docker compose logs nginx"
echo "  3. 容器状态: docker compose ps"
echo "  4. 端口映射: docker compose ps nginx"
echo ""
echo "手动重启所有服务:"
echo "  docker compose down && docker compose up -d"
echo ""
