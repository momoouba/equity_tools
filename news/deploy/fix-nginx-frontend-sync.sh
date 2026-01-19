#!/bin/bash

# 修复Nginx前端文件同步问题
# 问题：Nginx中的前端文件比容器内的旧

set -e

echo "=========================================="
echo "修复Nginx前端文件同步问题"
echo "================================--------"

cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查当前状态"
echo "----------------------------------------"
echo "容器内文件时间:"
sudo docker compose exec app stat /app/client/dist/index.html 2>/dev/null | grep Modify || echo "无法获取"

echo ""
echo "Nginx文件时间:"
sudo docker compose exec nginx stat /usr/share/nginx/html/index.html 2>/dev/null | grep Modify || echo "无法获取"

echo ""
echo "步骤 2: 检查volume配置"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "Volume名称: $VOLUME_NAME"

# 尝试多种方式获取volume名称
if [ -z "$VOLUME_NAME" ] || [ "$VOLUME_NAME" = "app_frontend" ]; then
    # 从docker-compose.yml直接读取
    VOLUME_NAME=$(grep -A 1 "app_frontend:" docker-compose.yml | grep "driver: local" -B 1 | head -1 | awk '{print $1}' | tr -d ':' || echo "")
    if [ -z "$VOLUME_NAME" ]; then
        # 使用默认名称
        VOLUME_NAME="news_app_frontend"
    fi
fi

echo "使用的Volume名称: $VOLUME_NAME"

# 检查volume是否存在
if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "✓ Volume存在"
    VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ]; then
        echo "Volume路径: $VOLUME_PATH"
        echo "Volume中的文件:"
        sudo ls -la "$VOLUME_PATH" 2>/dev/null | head -5 || echo "无法列出"
    fi
else
    echo "⚠ Volume不存在，将创建"
fi

echo ""
echo "步骤 3: 停止容器"
echo "----------------------------------------"
sudo docker compose down

echo ""
echo "步骤 4: 删除旧的volume（如果存在）"
echo "----------------------------------------"
if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "删除volume: $VOLUME_NAME"
    sudo docker volume rm "$VOLUME_NAME" 2>/dev/null || echo "删除失败，继续"
else
    echo "Volume不存在，跳过删除"
fi

echo ""
echo "步骤 5: 重新构建前端（如果需要）"
echo "----------------------------------------"
if [ ! -d "client/dist" ] || [ ! -f "client/dist/index.html" ]; then
    echo "前端未构建，开始构建..."
    cd client
    npm install --silent
    NODE_ENV=production npm run build
    cd ..
    echo "✓ 前端构建完成"
else
    echo "✓ 前端已构建"
fi

echo ""
echo "步骤 6: 重新构建Docker镜像"
echo "----------------------------------------"
echo "正在构建镜像..."
sudo docker compose build --no-cache app

echo ""
echo "步骤 7: 启动容器"
echo "----------------------------------------"
sudo docker compose up -d

echo ""
echo "步骤 8: 等待应用启动"
echo "----------------------------------------"
sleep 20

echo ""
echo "步骤 9: 验证文件同步"
echo "----------------------------------------"
echo "检查volume是否创建:"
if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "✓ Volume已创建"
    
    # 从镜像中复制文件到volume
    echo ""
    echo "步骤 10: 同步文件到volume"
    echo "----------------------------------------"
    
    # 创建临时容器来复制文件
    TEMP_CONTAINER_NAME="temp-sync-frontend-$(date +%s)"
    TEMP_CONTAINER=$(sudo docker run -d --name ${TEMP_CONTAINER_NAME} -v ${VOLUME_NAME}:/target alpine sleep 3600 2>/dev/null || echo "")
    
    if [ -n "$TEMP_CONTAINER" ]; then
        echo "使用临时容器同步文件..."
        # 从app容器复制文件到volume
        APP_CONTAINER_ID=$(sudo docker compose ps -q app 2>/dev/null || echo "")
        if [ -n "$APP_CONTAINER_ID" ]; then
            sudo docker cp ${APP_CONTAINER_ID}:/app/client/dist/. ${TEMP_CONTAINER}:/target/ 2>/dev/null || {
                echo "从容器复制失败，尝试直接复制..."
                # 如果docker cp失败，尝试其他方法
                VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
                if [ -n "$VOLUME_PATH" ] && [ -d "client/dist" ]; then
                    echo "直接复制本地文件到volume..."
                    sudo rm -rf "$VOLUME_PATH"/*
                    sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null || echo "复制失败"
                fi
            }
        else
            echo "⚠ 无法获取app容器ID，尝试直接复制..."
            VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
            if [ -n "$VOLUME_PATH" ] && [ -d "client/dist" ]; then
                echo "直接复制本地文件到volume..."
                sudo rm -rf "$VOLUME_PATH"/*
                sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null || echo "复制失败"
            fi
        fi
        
        # 清理临时容器
        if [ -n "$TEMP_CONTAINER" ]; then
            sudo docker rm -f ${TEMP_CONTAINER} 2>/dev/null || sudo docker rm -f ${TEMP_CONTAINER_NAME} 2>/dev/null || true
        fi
    else
        echo "⚠ 无法创建临时容器，尝试直接复制"
        VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
        if [ -n "$VOLUME_PATH" ] && [ -d "client/dist" ]; then
            echo "直接复制本地文件到volume..."
            sudo rm -rf "$VOLUME_PATH"/*
            sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null || echo "复制失败"
        fi
    fi
else
    echo "⚠ Volume未创建，将在启动时自动创建"
fi

echo ""
echo "步骤 11: 重启容器以确保同步"
echo "----------------------------------------"
sudo docker compose restart nginx
sleep 5

echo ""
echo "步骤 12: 验证同步结果"
echo "----------------------------------------"
echo "容器内文件时间:"
sudo docker compose exec app stat /app/client/dist/index.html 2>/dev/null | grep Modify || echo "无法获取"

echo ""
echo "Nginx文件时间:"
sudo docker compose exec nginx stat /usr/share/nginx/html/index.html 2>/dev/null | grep Modify || echo "无法获取"

echo ""
echo "检查文件内容是否一致:"
APP_HASH=$(sudo docker compose exec app md5sum /app/client/dist/index.html 2>/dev/null | awk '{print $1}' || echo "")
NGINX_HASH=$(sudo docker compose exec nginx md5sum /usr/share/nginx/html/index.html 2>/dev/null | awk '{print $1}' || echo "")

if [ -n "$APP_HASH" ] && [ -n "$NGINX_HASH" ]; then
    if [ "$APP_HASH" = "$NGINX_HASH" ]; then
        echo "✓ 文件内容一致"
    else
        echo "⚠ 文件内容不一致，需要重新同步"
    fi
fi

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存（Ctrl + Shift + Delete）"
echo "2. 硬刷新页面（Ctrl + F5）"
echo "3. 检查浏览器控制台是否还有错误"
echo ""
