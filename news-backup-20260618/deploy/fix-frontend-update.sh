#!/bin/bash

# 修复前端更新问题 - 正确更新Docker volume中的前端文件
# 使用方法: ./deploy/fix-frontend-update.sh

set -e

echo "=========================================="
echo "修复前端更新 - 正确更新Docker Volume"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查前端构建文件"
echo "----------------------------------------"
if [ ! -d "client/dist" ]; then
    echo "❌ 错误: client/dist 目录不存在"
    echo "请先执行: cd client && npm run build"
    exit 1
fi

if [ ! -f "client/dist/index.html" ]; then
    echo "❌ 错误: client/dist/index.html 不存在"
    echo "请先执行: cd client && npm run build"
    exit 1
fi

echo "✓ 前端构建文件存在"
FILE_SIZE=$(stat -c%s client/dist/index.html 2>/dev/null || echo "0")
echo "  index.html 大小: $FILE_SIZE 字节"

echo ""
echo "步骤 2: 查找前端volume"
echo "----------------------------------------"

# 尝试多种可能的volume名称
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "news_app_frontend"
    "newsapp_app_frontend"
    "app_frontend"
)

VOLUME_NAME=""
VOLUME_PATH=""

for vol_name in "${VOLUME_NAMES[@]}"; do
    VOLUME_INFO=$(sudo docker volume inspect "$vol_name" 2>/dev/null || echo "")
    if [ -n "$VOLUME_INFO" ]; then
        VOLUME_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
        if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
            VOLUME_NAME="$vol_name"
            echo "✓ 找到volume: $VOLUME_NAME"
            echo "  Volume路径: $VOLUME_PATH"
            break
        fi
    fi
done

if [ -z "$VOLUME_NAME" ]; then
    echo "⚠ 无法找到volume，尝试从docker-compose.yml获取..."
    # 从docker-compose.yml获取项目名
    PROJECT_NAME=$(basename $(pwd))
    VOLUME_NAME="${PROJECT_NAME}_app_frontend"
    echo "尝试volume名称: $VOLUME_NAME"
    
    # 尝试创建volume（如果不存在）
    sudo docker volume create "$VOLUME_NAME" 2>/dev/null || true
    
    VOLUME_INFO=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null || echo "")
    if [ -n "$VOLUME_INFO" ]; then
        VOLUME_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
        if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
            echo "✓ 找到/创建volume: $VOLUME_NAME"
            echo "  Volume路径: $VOLUME_PATH"
        fi
    fi
fi

if [ -z "$VOLUME_PATH" ]; then
    echo "❌ 错误: 无法找到或创建volume"
    echo ""
    echo "请手动执行以下命令查找volume："
    echo "  sudo docker volume ls | grep frontend"
    echo "  sudo docker volume inspect <volume名称>"
    exit 1
fi

echo ""
echo "步骤 3: 清空volume中的旧文件"
echo "----------------------------------------"
echo "正在清空旧文件..."
sudo rm -rf "$VOLUME_PATH"/*
sudo rm -rf "$VOLUME_PATH"/.[!.]* 2>/dev/null || true
echo "✓ 旧文件已清空"

echo ""
echo "步骤 4: 复制新文件到volume"
echo "----------------------------------------"
echo "正在复制前端文件..."
sudo cp -r client/dist/* "$VOLUME_PATH/"
echo "✓ 文件复制完成"

# 设置权限
echo "正在设置文件权限..."
sudo chown -R root:root "$VOLUME_PATH" || true
sudo chmod -R 755 "$VOLUME_PATH" || true
echo "✓ 权限设置完成"

echo ""
echo "步骤 5: 验证文件已更新"
echo "----------------------------------------"
if [ -f "$VOLUME_PATH/index.html" ]; then
    TARGET_SIZE=$(stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    echo "✓ volume中的index.html存在"
    echo "  文件大小: $TARGET_SIZE 字节"
    
    if [ "$TARGET_SIZE" -lt 100 ]; then
        echo "⚠ 警告: 文件大小异常小，可能复制不完整"
    fi
else
    echo "❌ 错误: volume中未找到index.html"
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
sleep 3

echo ""
echo "步骤 8: 验证nginx容器中的文件"
echo "----------------------------------------"
if sudo docker compose exec -T nginx test -f /usr/share/nginx/html/index.html; then
    NGINX_SIZE=$(sudo docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
    echo "✓ nginx容器中存在index.html"
    echo "  文件大小: $NGINX_SIZE 字节"
else
    echo "⚠ 警告: nginx容器中未找到index.html"
fi

echo ""
echo "=========================================="
echo "✅ 前端更新完成！"
echo "=========================================="
echo ""
echo "后续操作："
echo "1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "2. 强制刷新页面（Ctrl+F5 或 Ctrl+Shift+R）"
echo "3. 如果仍然看不到更新，检查浏览器控制台"
echo ""
echo "验证命令："
echo "  # 查看volume中的文件"
echo "  sudo ls -la $VOLUME_PATH | head -10"
echo ""
echo "  # 查看nginx容器中的文件"
echo "  sudo docker compose exec nginx ls -la /usr/share/nginx/html/ | head -10"
echo ""
