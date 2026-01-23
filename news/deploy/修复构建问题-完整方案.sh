#!/bin/bash
# 完整修复构建问题 - 在容器内重新构建前端
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/修复构建问题-完整方案.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "完整修复构建问题"
echo "=========================================="

echo ""
echo "步骤1: 检查当前构建文件..."
echo "----------------------------------------"
if docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    APP_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
    echo "当前 index.html 大小: $APP_SIZE 字节"
    echo "文件内容："
    docker compose exec -T app head -20 /app/client/dist/index.html
fi

echo ""
echo "步骤2: 在应用容器内重新构建前端..."
echo "----------------------------------------"
echo "这可能需要几分钟..."

# 在容器内重新构建
docker compose exec app sh -c "
    cd /app/client && \
    echo '清理旧的构建文件...' && \
    rm -rf dist && \
    echo '重新安装依赖（如果需要）...' && \
    npm ci --silent && \
    echo '开始构建...' && \
    NODE_OPTIONS='--max-old-space-size=4096' npm run build && \
    echo '构建完成！' && \
    ls -lh dist/ | head -10
"

echo ""
echo "步骤3: 检查新构建的文件..."
echo "----------------------------------------"
NEW_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
echo "新构建的 index.html 大小: $NEW_SIZE 字节"

if [ "$NEW_SIZE" -lt 1000 ]; then
    echo "✗ 错误: 重新构建后文件仍然异常小"
    echo "检查文件内容："
    docker compose exec -T app cat /app/client/dist/index.html
    echo ""
    echo "检查构建输出："
    docker compose exec app sh -c "cd /app/client && ls -la dist/"
    exit 1
fi

echo "✓ 构建成功！文件内容预览："
docker compose exec -T app head -10 /app/client/dist/index.html

echo ""
echo "步骤4: 检查assets目录..."
echo "----------------------------------------"
ASSETS_COUNT=$(docker compose exec -T app find /app/client/dist/assets -type f 2>/dev/null | wc -l || echo "0")
echo "assets目录中有 $ASSETS_COUNT 个文件"

echo ""
echo "步骤5: 复制文件到volume..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

sudo rm -rf "$VOLUME_PATH"/*
docker compose exec -T app tar -czf - -C /app/client/dist . | sudo tar -xzf - -C "$VOLUME_PATH" 2>&1 | grep -v "file changed as we read it" || true

echo ""
echo "步骤6: 验证复制结果..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -lt 1000 ]; then
    echo "✗ 错误: Volume中的文件仍然异常小"
    exit 1
fi

echo ""
echo "步骤7: 重启nginx..."
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤8: 最终验证..."
echo "----------------------------------------"
NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "Nginx容器中 index.html 大小: $NGINX_SIZE 字节"

if [ "$NGINX_SIZE" -ge 1000 ]; then
    echo ""
    echo "=========================================="
    echo "✓ 修复成功！"
    echo "=========================================="
    echo "请清除浏览器缓存并刷新页面"
else
    echo ""
    echo "=========================================="
    echo "✗ 修复失败"
    echo "=========================================="
    exit 1
fi
