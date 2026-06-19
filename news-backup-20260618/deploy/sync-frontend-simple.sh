#!/bin/bash

# 简单的前端文件同步脚本
# 将容器内的前端文件同步到volume，供Nginx使用

set -e

echo "=========================================="
echo "同步前端文件到Volume"
echo "=========================================="

cd "$(dirname "$0")/.." || exit

# 获取volume名称
VOLUME_NAME="news_app_frontend"

echo "Volume名称: $VOLUME_NAME"

# 检查volume是否存在
if ! sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    echo "⚠ Volume不存在，将在启动时自动创建"
    echo "请先运行: sudo docker compose up -d"
    exit 1
fi

# 获取volume路径
VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -z "$VOLUME_PATH" ]; then
    echo "❌ 无法获取volume路径"
    exit 1
fi

echo "Volume路径: $VOLUME_PATH"

# 方法1: 从app容器复制文件到volume
echo ""
echo "方法1: 从app容器复制文件..."
APP_CONTAINER_ID=$(sudo docker compose ps -q app 2>/dev/null || echo "")

if [ -n "$APP_CONTAINER_ID" ]; then
    echo "App容器ID: $APP_CONTAINER_ID"
    
    # 创建临时容器来复制文件
    TEMP_CONTAINER_NAME="temp-sync-$(date +%s)"
    echo "创建临时容器: $TEMP_CONTAINER_NAME"
    
    if sudo docker run -d --name ${TEMP_CONTAINER_NAME} -v ${VOLUME_NAME}:/target alpine sleep 3600 >/dev/null 2>&1; then
        echo "✓ 临时容器已创建"
        
        # 从app容器复制文件到临时容器（volume）
        echo "正在复制文件..."
        if sudo docker cp ${APP_CONTAINER_ID}:/app/client/dist/. ${TEMP_CONTAINER_NAME}:/target/ 2>/dev/null; then
            echo "✓ 文件复制成功"
        else
            echo "⚠ 从容器复制失败，尝试方法2..."
            # 清理临时容器
            sudo docker rm -f ${TEMP_CONTAINER_NAME} 2>/dev/null || true
            
            # 方法2: 直接复制本地文件
            if [ -d "client/dist" ]; then
                echo ""
                echo "方法2: 从本地dist目录复制..."
                echo "清空volume..."
                sudo rm -rf "$VOLUME_PATH"/*
                echo "复制文件..."
                if sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null; then
                    echo "✓ 文件复制成功"
                else
                    echo "❌ 文件复制失败"
                    exit 1
                fi
            else
                echo "❌ 本地dist目录不存在"
                exit 1
            fi
        fi
        
        # 清理临时容器
        echo "清理临时容器..."
        sudo docker rm -f ${TEMP_CONTAINER_NAME} 2>/dev/null || true
    else
        echo "⚠ 无法创建临时容器，使用方法2..."
        # 方法2: 直接复制本地文件
        if [ -d "client/dist" ]; then
            echo ""
            echo "方法2: 从本地dist目录复制..."
            echo "清空volume..."
            sudo rm -rf "$VOLUME_PATH"/*
            echo "复制文件..."
            if sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null; then
                echo "✓ 文件复制成功"
            else
                echo "❌ 文件复制失败"
                exit 1
            fi
        else
            echo "❌ 本地dist目录不存在"
            exit 1
        fi
    fi
else
    echo "⚠ App容器未运行，使用方法2..."
    # 方法2: 直接复制本地文件
    if [ -d "client/dist" ]; then
        echo ""
        echo "方法2: 从本地dist目录复制..."
        echo "清空volume..."
        sudo rm -rf "$VOLUME_PATH"/*
        echo "复制文件..."
        if sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null; then
            echo "✓ 文件复制成功"
        else
            echo "❌ 文件复制失败"
            exit 1
        fi
    else
        echo "❌ 本地dist目录不存在，请先构建前端"
        exit 1
    fi
fi

echo ""
echo "步骤 2: 重启Nginx以确保使用新文件"
echo "----------------------------------------"
sudo docker compose restart nginx
sleep 3

echo ""
echo "步骤 3: 验证同步结果"
echo "----------------------------------------"
echo "Volume中的文件数量:"
FILE_COUNT=$(sudo ls -1 "$VOLUME_PATH" 2>/dev/null | wc -l || echo "0")
echo "$FILE_COUNT"

if [ -f "$VOLUME_PATH/index.html" ]; then
    echo "✓ index.html存在"
    echo "文件大小: $(sudo du -sh "$VOLUME_PATH/index.html" 2>/dev/null | awk '{print $1}')"
    echo "文件时间: $(sudo stat "$VOLUME_PATH/index.html" 2>/dev/null | grep Modify | awk '{print $2, $3}')"
else
    echo "❌ index.html不存在"
fi

echo ""
echo "Nginx中的文件时间:"
sudo docker compose exec nginx stat /usr/share/nginx/html/index.html 2>/dev/null | grep Modify || echo "无法获取"

echo ""
echo "=========================================="
echo "同步完成！"
echo "=========================================="
echo ""
echo "请清除浏览器缓存并硬刷新页面（Ctrl + F5）"
echo ""
