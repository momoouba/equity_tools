#!/bin/bash

# 简单修复空白页面 - 从应用容器复制文件到nginx卷
# 在服务器上执行: cd /opt/newsapp/news && sudo bash deploy/fix-blank-page-simple.sh

set -e

echo "修复空白页面问题..."

# 检查容器
if ! docker compose ps | grep -q "newsapp.*Up"; then
    echo "错误: 应用容器未运行"
    exit 1
fi

# 查找volume名称
VOLUME_NAME="news_app_frontend"

# 查找volume的实际路径
echo "正在查找volume路径..."
VOLUME_PATH=$(docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -n "$VOLUME_PATH" ]; then
    echo "找到volume路径: $VOLUME_PATH"
    echo "正在从应用容器复制文件到volume..."
    
    # 方法1: 使用docker cp直接复制到volume路径（需要root权限）
    # 先创建一个临时tar文件
    docker cp newsapp:/app/client/dist/. - | tar -x -C "$VOLUME_PATH" 2>/dev/null || {
        # 如果tar方法失败，使用临时容器方法
        echo "使用临时容器方法复制文件..."
        # 使用已有的nginx镜像创建临时容器
        docker rm -f temp-frontend-fix 2>/dev/null || true
        TEMP_CONTAINER=$(docker run -d --name temp-frontend-fix \
            -v "${VOLUME_NAME}:/target" \
            nginx:alpine sleep 3600 2>/dev/null || docker run -d --name temp-frontend-fix \
            -v "${VOLUME_NAME}:/target" \
            newsapp-nginx sleep 3600)
        
        if [ -n "$TEMP_CONTAINER" ]; then
            docker cp newsapp:/app/client/dist/. "${TEMP_CONTAINER}:/target/"
            docker rm -f "${TEMP_CONTAINER}"
        else
            echo "错误: 无法创建临时容器，请手动执行以下命令："
            echo "  docker cp newsapp:/app/client/dist/. - | sudo tar -x -C \"$VOLUME_PATH\""
            exit 1
        fi
    }
else
    echo "无法找到volume路径，使用临时容器方法..."
    docker rm -f temp-frontend-fix 2>/dev/null || true
    
    # 尝试使用已有的镜像
    if docker images | grep -q "nginx"; then
        NGINX_IMAGE=$(docker images | grep nginx | head -1 | awk '{print $1":"$2}')
        echo "使用镜像: $NGINX_IMAGE"
        TEMP_CONTAINER=$(docker run -d --name temp-frontend-fix \
            -v "${VOLUME_NAME}:/target" \
            "$NGINX_IMAGE" sleep 3600)
    else
        echo "错误: 无法找到可用的镜像来创建临时容器"
        echo "请手动执行以下命令："
        echo "  VOLUME_PATH=\$(docker volume inspect news_app_frontend | grep Mountpoint | awk '{print \$2}' | tr -d '\",')"
        echo "  docker cp newsapp:/app/client/dist/. - | sudo tar -x -C \"\$VOLUME_PATH\""
        exit 1
    fi
    
    docker cp newsapp:/app/client/dist/. "${TEMP_CONTAINER}:/target/"
    docker rm -f "${TEMP_CONTAINER}"
fi

# 重启nginx
echo "重启nginx..."
docker compose restart nginx

echo "完成！请清除浏览器缓存并刷新页面"
