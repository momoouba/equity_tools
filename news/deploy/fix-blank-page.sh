#!/bin/bash

# 修复空白页面问题 - 将前端文件从应用容器复制到nginx卷
# 使用方法: ./deploy/fix-blank-page.sh

set -e

echo "=========================================="
echo "修复空白页面问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查容器状态"
echo "----------------------------------------"
if ! sudo docker compose ps | grep -q "newsapp.*Up"; then
    echo "错误: 应用容器未运行，请先启动容器"
    echo "执行: sudo docker compose up -d"
    exit 1
fi
echo "✓ 容器运行正常"

echo ""
echo "步骤 2: 检查应用容器中的前端文件"
echo "----------------------------------------"
if ! sudo docker compose exec -T app test -f /app/client/dist/index.html; then
    echo "⚠ 警告: 应用容器中未找到前端文件"
    echo "正在重新构建镜像..."
    sudo docker compose build app
    sudo docker compose up -d app
    echo "等待容器启动..."
    sleep 10
fi

# 检查文件是否存在
if sudo docker compose exec -T app test -f /app/client/dist/index.html; then
    echo "✓ 应用容器中存在前端文件"
    FILE_SIZE=$(sudo docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
    echo "  index.html 大小: $FILE_SIZE 字节"
else
    echo "✗ 错误: 应用容器中仍然没有前端文件"
    echo "请检查 Dockerfile 构建过程"
    exit 1
fi

echo ""
echo "步骤 3: 查找前端volume"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")

# 尝试从docker-compose.yml直接获取
if [ -z "$VOLUME_NAME" ] || [ "$VOLUME_NAME" = "app_frontend" ]; then
    VOLUME_NAME="news_app_frontend"
fi

echo "Volume名称: $VOLUME_NAME"

# 检查volume是否存在
if ! sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "⚠ Volume不存在，将在复制文件时自动创建"
fi

echo ""
echo "步骤 4: 从应用容器复制文件到volume"
echo "----------------------------------------"

# 方法1: 使用临时容器复制文件
echo "正在创建临时容器复制文件..."

# 清理可能存在的临时容器
sudo docker rm -f temp-frontend-fix 2>/dev/null || true

# 创建临时容器，挂载volume
TEMP_CONTAINER=$(sudo docker run -d --name temp-frontend-fix \
    -v "${VOLUME_NAME}:/target" \
    alpine sleep 3600)

# 从应用容器复制文件到临时容器
echo "正在复制文件..."
sudo docker cp newsapp:/app/client/dist/. "${TEMP_CONTAINER}:/target/"

# 验证复制结果
if sudo docker exec "${TEMP_CONTAINER}" test -f /target/index.html; then
    TARGET_SIZE=$(sudo docker exec "${TEMP_CONTAINER}" stat -c%s /target/index.html 2>/dev/null || echo "0")
    echo "✓ 文件复制成功"
    echo "  target/index.html 大小: $TARGET_SIZE 字节"
    
    if [ "$TARGET_SIZE" -lt 1000 ]; then
        echo "⚠ 警告: 文件大小异常小，可能复制不完整"
    fi
else
    echo "✗ 错误: 文件复制失败"
    sudo docker rm -f "${TEMP_CONTAINER}"
    exit 1
fi

# 清理临时容器
sudo docker rm -f "${TEMP_CONTAINER}"
echo "✓ 临时容器已清理"

echo ""
echo "步骤 5: 验证nginx容器中的文件"
echo "----------------------------------------"
sleep 2

if sudo docker compose exec -T nginx test -f /usr/share/nginx/html/index.html; then
    NGINX_SIZE=$(sudo docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
    echo "✓ nginx容器中存在index.html"
    echo "  文件大小: $NGINX_SIZE 字节"
    
    if [ "$NGINX_SIZE" -lt 1000 ]; then
        echo "⚠ 警告: nginx中的文件大小异常小"
    fi
else
    echo "✗ 错误: nginx容器中未找到index.html"
    exit 1
fi

echo ""
echo "步骤 6: 重启nginx容器"
echo "----------------------------------------"
sudo docker compose restart nginx
echo "✓ nginx已重启"

echo ""
echo "步骤 7: 等待服务就绪"
echo "----------------------------------------"
sleep 5

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存 (Ctrl+Shift+Delete)"
echo "2. 硬刷新页面 (Ctrl+F5 或 Ctrl+Shift+R)"
echo "3. 如果仍然空白，检查浏览器控制台和网络请求"
echo ""
echo "验证命令："
echo "  # 查看volume中的文件"
echo "  sudo docker volume inspect ${VOLUME_NAME}"
echo ""
echo "  # 查看nginx容器中的文件列表"
echo "  sudo docker compose exec nginx ls -la /usr/share/nginx/html/ | head -20"
echo ""
