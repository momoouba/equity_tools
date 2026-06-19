#!/bin/bash
# 快速修复前端 volume 的命令脚本
# 在服务器上直接执行以下命令，或使用此脚本

cd /opt/newsapp/news

# 1. 启动 Nginx（如果未启动）
docker compose up -d nginx

# 2. 将前端文件复制到 volume
VOLUME_NAME="news_app_frontend"
TEMP_CONTAINER=$(docker run -d --name temp-frontend-copy-$(date +%s) -v ${VOLUME_NAME}:/target alpine sleep 300)

# 从 app 容器复制文件
if docker cp newsapp:/app/client/dist/. ${TEMP_CONTAINER}:/target/ 2>/dev/null; then
    echo "✓ 前端文件已复制"
else
    # 如果容器中没有，从镜像复制
    docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
    TEMP_CONTAINER=$(docker run -d --name temp-frontend-copy-$(date +%s) -v ${VOLUME_NAME}:/target news-app sleep 300)
    docker exec ${TEMP_CONTAINER} sh -c "if [ -d /app/client/dist ]; then cp -r /app/client/dist/* /target/ 2>/dev/null || true; fi"
fi

# 清理临时容器
docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true

# 3. 重启 Nginx
docker compose restart nginx

# 4. 验证
echo "容器状态:"
docker compose ps

echo ""
echo "前端文件检查:"
docker compose exec nginx ls -la /usr/share/nginx/html/ | head -10
