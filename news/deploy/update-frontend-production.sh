#!/bin/bash

# 生产环境前端更新脚本
# 功能：只更新前端文件，完全替换旧文件（不保留）
# 使用方法: ./deploy/update-frontend-production.sh
#
# 说明：
# - 此脚本会完全清空旧的前端文件，然后复制新的文件
# - 适用于生产环境部署
# - 不会重建Docker镜像，只更新前端静态文件

set -e

echo "=========================================="
echo "生产环境前端更新"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目根目录
cd "$(dirname "$0")/.." || exit
PROJECT_ROOT=$(pwd)

echo "项目根目录: $PROJECT_ROOT"
echo ""

# 步骤 1: 构建前端
echo "=========================================="
echo "步骤 1: 构建前端"
echo "=========================================="
cd "$PROJECT_ROOT/client"

# 检查node_modules是否存在
if [ ! -d "node_modules" ]; then
    echo "⚠  node_modules 不存在，正在安装依赖..."
    npm install
fi

echo "正在构建前端..."
npm run build

if [ ! -d "dist" ]; then
    echo "❌ 错误: 构建失败，dist目录不存在"
    exit 1
fi

echo "✓ 前端构建完成"
echo ""

cd "$PROJECT_ROOT"

# 步骤 2: 查找Docker volume
echo "=========================================="
echo "步骤 2: 查找前端Volume"
echo "=========================================="

# 尝试多个可能的volume名称
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
    "news_app_frontend"
    "app_frontend"
)

VOLUME_NAME=""
VOLUME_PATH=""

for vol_name in "${VOLUME_NAMES[@]}"; do
    echo "尝试查找volume: $vol_name"
    VOLUME_PATH=$(sudo docker volume inspect "$vol_name" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ]; then
        VOLUME_NAME="$vol_name"
        echo "✓ 找到volume: $VOLUME_NAME"
        echo "  Volume路径: $VOLUME_PATH"
        break
    fi
done

if [ -z "$VOLUME_PATH" ]; then
    echo "⚠  无法直接找到volume路径，将使用临时容器方式"
fi

echo ""

# 步骤 3: 更新前端文件
echo "=========================================="
echo "步骤 3: 更新前端文件（清空旧文件并复制新文件）"
echo "=========================================="

if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
    # 方式1: 直接操作volume路径（需要root权限）
    echo "方式: 直接操作volume路径"
    echo "正在清空旧文件..."
    sudo rm -rf "$VOLUME_PATH"/*
    sudo rm -rf "$VOLUME_PATH"/.* 2>/dev/null || true
    
    echo "正在复制新文件..."
    sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
    
    # 确保权限正确
    sudo chown -R root:root "$VOLUME_PATH" || true
    sudo chmod -R 755 "$VOLUME_PATH" || true
    
    echo "✓ 前端文件已更新（旧文件已完全清除）"
else
    # 方式2: 使用临时容器
    echo "方式: 使用临时容器更新"
    
    if [ -z "$VOLUME_NAME" ]; then
        # 从docker-compose.yml中读取volume名称
        VOLUME_NAME=$(grep -A 1 "app_frontend:" docker-compose.yml | grep "driver: local" -B 1 | head -1 | awk '{print $1}' | tr -d ':')
        if [ -z "$VOLUME_NAME" ]; then
            VOLUME_NAME="newsapp_app_frontend"
        fi
    fi
    
    echo "Volume名称: $VOLUME_NAME"
    
    # 创建临时容器
    echo "正在创建临时容器..."
    TEMP_CONTAINER="temp-frontend-update-$(date +%s)"
    sudo docker run -d --name "$TEMP_CONTAINER" -v "$VOLUME_NAME":/target alpine sleep 3600 || {
        echo "⚠  临时容器已存在，正在清理..."
        sudo docker rm -f "$TEMP_CONTAINER" 2>/dev/null || true
        sudo docker run -d --name "$TEMP_CONTAINER" -v "$VOLUME_NAME":/target alpine sleep 3600
    }
    
    echo "正在清空旧文件..."
    sudo docker exec "$TEMP_CONTAINER" sh -c "rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null || true"
    
    echo "正在复制新文件..."
    sudo docker cp "$PROJECT_ROOT/client/dist/." "$TEMP_CONTAINER:/target/"
    
    echo "正在清理临时容器..."
    sudo docker rm -f "$TEMP_CONTAINER"
    
    echo "✓ 前端文件已更新（旧文件已完全清除）"
fi

echo ""

# 步骤 4: 重启服务
echo "=========================================="
echo "步骤 4: 重启服务"
echo "=========================================="

# 只重启nginx（前端由nginx提供服务）
echo "正在重启nginx容器..."
sudo docker compose restart nginx || sudo docker restart newsapp-nginx

# 可选：重启app容器（如果需要）
# echo "正在重启app容器..."
# sudo docker compose restart app || sudo docker restart newsapp

echo "✓ 服务已重启"
echo ""

# 步骤 5: 验证
echo "=========================================="
echo "步骤 5: 验证更新"
echo "=========================================="

sleep 3

# 检查nginx容器状态
if sudo docker ps | grep -q "newsapp-nginx"; then
    echo "✓ Nginx容器运行正常"
else
    echo "⚠  Nginx容器可能未运行，请检查"
fi

echo ""
echo "=========================================="
echo "✅ 前端更新完成！"
echo "=========================================="
echo ""
echo "更新内容："
echo "  - 旧的前端文件已完全清除"
echo "  - 新的前端文件已部署"
echo "  - Nginx服务已重启"
echo ""
echo "后续操作："
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  2. 刷新页面（Ctrl+F5 强制刷新）"
echo "  3. 如果仍有问题，请检查nginx日志: sudo docker logs newsapp-nginx"
echo ""
echo "查看nginx日志: sudo docker logs newsapp-nginx"
echo "查看应用日志: sudo docker logs newsapp"
echo ""

