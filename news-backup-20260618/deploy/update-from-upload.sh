#!/bin/bash

# 从手动上传的dist目录更新前端
# 使用方法：
#   1. 在本地构建前端: cd client && npm run build
#   2. 打包dist目录并上传到服务器
#   3. 在服务器上解压: unzip dist.zip
#   4. 执行此脚本: ./deploy/update-from-upload.sh

set -e

echo "=========================================="
echo "从上传文件更新前端"
echo "=========================================="

# 获取脚本所在目录的父目录（项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "项目根目录: $PROJECT_ROOT"
echo ""

# 检查dist目录是否存在
if [ ! -d "client/dist" ]; then
    echo "❌ 错误: client/dist 目录不存在"
    echo ""
    echo "请先："
    echo "  1. 在本地构建前端: cd client && npm run build"
    echo "  2. 打包dist目录: zip -r dist.zip dist"
    echo "  3. 上传dist.zip到服务器"
    echo "  4. 在服务器上解压: unzip dist.zip -d client/"
    echo ""
    exit 1
fi

echo "✓ 找到dist目录: client/dist"
echo ""

# 尝试查找volume名称
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
    "news_app_frontend"
    "app_frontend"
)

VOLUME_NAME=""
VOLUME_PATH=""
USE_CONTAINER_COPY=false
NGINX_CONTAINER_NAME=""

echo "查找Docker Volume..."

# 方法1: 尝试常见的volume名称
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

# 方法2: 从docker-compose.yml读取volume名称
if [ -z "$VOLUME_PATH" ] && [ -f "docker-compose.yml" ]; then
    echo "尝试从docker-compose.yml读取..."
    COMPOSE_VOLUME_NAME=$(grep -A 2 "app_frontend:" docker-compose.yml | grep "driver: local" -B 2 | head -1 | awk '{print $1}' | tr -d ':')
    if [ -n "$COMPOSE_VOLUME_NAME" ]; then
        VOLUME_INFO=$(sudo docker volume inspect "$COMPOSE_VOLUME_NAME" 2>/dev/null || echo "")
        if [ -n "$VOLUME_INFO" ]; then
            VOLUME_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
            if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
                VOLUME_NAME="$COMPOSE_VOLUME_NAME"
                echo "✓ 从docker-compose.yml找到volume: $VOLUME_NAME"
                echo "  Volume路径: $VOLUME_PATH"
            fi
        fi
    fi
fi

# 方法3: 从运行中的nginx容器查找volume挂载点
if [ -z "$VOLUME_PATH" ]; then
    echo "尝试从运行中的容器查找..."
    NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
    if [ -n "$NGINX_CONTAINER" ]; then
        echo "找到nginx容器: $NGINX_CONTAINER"
        # 检查容器的volume挂载点
        CONTAINER_MOUNT=$(sudo docker inspect "$NGINX_CONTAINER" 2>/dev/null | grep -A 10 "Mounts" | grep -i "source\|destination" | head -4)
        if echo "$CONTAINER_MOUNT" | grep -q "/usr/share/nginx/html\|app_frontend"; then
            # 尝试从容器挂载信息中提取路径
            VOLUME_NAME=$(sudo docker inspect "$NGINX_CONTAINER" 2>/dev/null | grep -B 5 "/usr/share/nginx/html" | grep -i "name" | head -1 | awk -F'"' '{print $4}' || echo "")
            if [ -n "$VOLUME_NAME" ]; then
                VOLUME_INFO=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null || echo "")
                VOLUME_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
                if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
                    echo "✓ 从容器挂载找到volume: $VOLUME_NAME"
                    echo "  Volume路径: $VOLUME_PATH"
                fi
            fi
        fi
    fi
fi

# 方法4: 使用运行中的nginx容器直接复制（如果找不到volume路径）
if [ -z "$VOLUME_PATH" ]; then
    NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
    if [ -n "$NGINX_CONTAINER" ]; then
        echo "⚠  无法找到volume路径，将使用运行中的nginx容器直接复制文件"
        USE_CONTAINER_COPY=true
        NGINX_CONTAINER_NAME="$NGINX_CONTAINER"
    else
        echo "❌ 错误: 无法找到volume路径，且没有运行中的nginx容器"
        echo ""
        echo "请手动执行以下命令查找volume路径："
        echo "  sudo docker volume ls | grep frontend"
        echo "  sudo docker volume inspect <volume名称>"
        exit 1
    fi
fi

echo ""

# 更新文件
echo "=========================================="
echo "更新前端文件（清空旧文件并复制新文件）"
echo "=========================================="

if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
    # 方式1: 直接操作volume路径（推荐）
    echo "方式: 直接操作volume路径"
    echo "正在清空旧文件..."
    sudo rm -rf "$VOLUME_PATH"/*
    sudo rm -rf "$VOLUME_PATH"/.[!.]* 2>/dev/null || true
    
    echo "正在复制新文件..."
    sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
    
    # 确保权限正确
    sudo chown -R root:root "$VOLUME_PATH" || true
    sudo chmod -R 755 "$VOLUME_PATH" || true
    
    echo "✓ 前端文件已更新"
elif [ "$USE_CONTAINER_COPY" = true ] && [ -n "$NGINX_CONTAINER_NAME" ]; then
    # 方式2: 使用运行中的nginx容器直接复制
    echo "方式: 使用运行中的nginx容器直接复制"
    echo "容器名称: $NGINX_CONTAINER_NAME"
    
    echo "正在清空旧文件..."
    sudo docker exec "$NGINX_CONTAINER_NAME" sh -c "rm -rf /usr/share/nginx/html/* /usr/share/nginx/html/.[!.]* 2>/dev/null || true"
    
    echo "正在复制新文件..."
    sudo docker cp "$PROJECT_ROOT/client/dist/." "$NGINX_CONTAINER_NAME:/usr/share/nginx/html/"
    
    echo "✓ 前端文件已更新"
else
    # 方式3: 尝试查找所有可能的volume
    echo "方式: 尝试查找所有volumes..."
    ALL_VOLUMES=$(sudo docker volume ls --format "{{.Name}}" | grep -i frontend || echo "")
    if [ -n "$ALL_VOLUMES" ]; then
        echo "找到以下frontend相关的volumes:"
        echo "$ALL_VOLUMES"
        for vol in $ALL_VOLUMES; do
            echo "尝试volume: $vol"
            VOLUME_INFO=$(sudo docker volume inspect "$vol" 2>/dev/null || echo "")
            if [ -n "$VOLUME_INFO" ]; then
                TEST_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
                if [ -n "$TEST_PATH" ] && [ -d "$TEST_PATH" ]; then
                    VOLUME_PATH="$TEST_PATH"
                    VOLUME_NAME="$vol"
                    echo "✓ 找到可用的volume: $VOLUME_NAME"
                    echo "  路径: $VOLUME_PATH"
                    
                    echo "正在清空旧文件..."
                    sudo rm -rf "$VOLUME_PATH"/*
                    sudo rm -rf "$VOLUME_PATH"/.[!.]* 2>/dev/null || true
                    
                    echo "正在复制新文件..."
                    sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
                    sudo chown -R root:root "$VOLUME_PATH" || true
                    sudo chmod -R 755 "$VOLUME_PATH" || true
                    
                    echo "✓ 前端文件已更新"
                    break
                fi
            fi
        done
    fi
    
    if [ -z "$VOLUME_PATH" ]; then
        echo "❌ 错误: 无法找到volume路径或运行中的容器"
        echo ""
        echo "请手动执行以下命令："
        echo "  1. 查找volume: sudo docker volume ls | grep frontend"
        echo "  2. 查看volume路径: sudo docker volume inspect <volume名称>"
        echo "  3. 手动复制文件到volume路径"
        exit 1
    fi
fi

echo ""

# 重启nginx
echo "=========================================="
echo "重启Nginx服务"
echo "=========================================="

if [ -f "docker-compose.yml" ]; then
    echo "使用docker compose重启..."
    sudo docker compose restart nginx || sudo docker restart newsapp-nginx
else
    echo "直接重启nginx容器..."
    sudo docker restart newsapp-nginx
fi

echo "✓ Nginx已重启"
echo ""

# 验证
echo "=========================================="
echo "验证更新"
echo "=========================================="

sleep 3

# 检查nginx容器状态
if sudo docker ps | grep -q "newsapp-nginx\|nginx"; then
    echo "✓ Nginx容器运行正常"
else
    echo "⚠  Nginx容器可能未运行，请检查"
    echo "   查看容器: sudo docker ps -a | grep nginx"
fi

# 检查文件
if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
    FILE_COUNT=$(sudo ls -1 "$VOLUME_PATH" | wc -l)
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo "✓ Volume中有 $FILE_COUNT 个文件/目录"
    else
        echo "⚠  Volume中似乎没有文件，请检查"
    fi
fi

echo ""
echo "=========================================="
echo "✅ 更新完成！"
echo "=========================================="
echo ""
echo "后续操作："
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  2. 强制刷新页面（Ctrl+F5）"
echo "  3. 检查浏览器控制台是否有错误"
echo ""
echo "查看日志："
echo "  sudo docker logs newsapp-nginx --tail 50"
echo ""

