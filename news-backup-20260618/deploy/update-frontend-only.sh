#!/bin/bash

# 快速更新前端（不重建镜像，直接复制文件到volume）
# 使用方法: ./deploy/update-frontend-only.sh

set -e

echo "=========================================="
echo "快速更新前端文件"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 重新构建前端"
echo "----------------------------------------"
cd client
echo "正在构建前端..."
npm run build
cd ..
echo "✓ 前端构建完成"

echo ""
echo "步骤 2: 查找前端volume的挂载位置"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':')
if [ -z "$VOLUME_NAME" ]; then
    VOLUME_NAME="news_app_frontend"
fi

echo "Volume名称: $VOLUME_NAME"

# 查找volume的实际路径
VOLUME_PATH=$(sudo docker volume inspect $VOLUME_NAME 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -z "$VOLUME_PATH" ]; then
    echo "⚠ 无法找到volume路径，尝试创建临时容器复制文件"
    
    echo ""
    echo "步骤 3: 使用临时容器复制前端文件"
    echo "----------------------------------------"
    
    # 创建临时容器并复制文件
    TEMP_CONTAINER=$(sudo docker run -d --name temp-frontend-copy -v ${VOLUME_NAME}:/target alpine sleep 3600)
    
    # 复制文件
    echo "正在复制前端文件到volume..."
    sudo docker cp client/dist/. ${TEMP_CONTAINER}:/target/
    
    # 清理临时容器
    sudo docker rm -f ${TEMP_CONTAINER}
    
    echo "✓ 前端文件已复制到volume"
else
    echo "Volume路径: $VOLUME_PATH"
    
    echo ""
    echo "步骤 3: 复制前端文件到volume"
    echo "----------------------------------------"
    echo "正在复制前端文件..."
    sudo cp -r client/dist/* "$VOLUME_PATH/"
    echo "✓ 前端文件已复制"
fi

echo ""
echo "步骤 4: 重启应用容器"
echo "----------------------------------------"
sudo docker compose restart app

echo ""
echo "步骤 5: 等待应用启动"
echo "----------------------------------------"
sleep 5

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "请清除浏览器缓存并刷新页面查看效果"
echo ""

