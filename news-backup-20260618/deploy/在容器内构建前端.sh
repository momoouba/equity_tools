#!/bin/bash
# 在应用容器内构建前端（如果服务器没有 Node.js）
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/在容器内构建前端.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "在容器内构建前端"
echo "=========================================="

echo ""
echo "步骤1: 检查容器状态..."
echo "----------------------------------------"
if ! docker compose ps | grep -q "newsapp.*Up"; then
    echo "错误: 应用容器未运行"
    exit 1
fi
echo "✓ 容器运行正常"

echo ""
echo "步骤2: 检查容器内是否有源代码..."
echo "----------------------------------------"
if ! docker compose exec -T app test -d /app/client/src 2>/dev/null; then
    echo "⚠ 警告: 容器内没有源代码"
    echo "需要将 client 目录挂载到容器，或使用其他方法"
    echo ""
    echo "检查 docker-compose.yml 中的挂载配置..."
    exit 1
fi

echo ""
echo "步骤3: 在容器内安装依赖（如果需要）..."
echo "----------------------------------------"
docker compose exec app sh -c "
    cd /app/client && \
    if [ ! -d node_modules ]; then
        echo '安装依赖...' && \
        npm install
    else
        echo '依赖已存在'
    fi
"

echo ""
echo "步骤4: 在容器内构建前端..."
echo "----------------------------------------"
echo "开始构建（这可能需要几分钟）..."

# 在临时目录构建（因为 dist 被 volume 挂载）
docker compose exec app sh -c "
    cd /app/client && \
    echo '创建临时构建目录...' && \
    rm -rf /tmp/client-build && \
    mkdir -p /tmp/client-build && \
    echo '复制源代码...' && \
    cp -r src /tmp/client-build/ && \
    cp index.html vite.config.js package.json package-lock.json /tmp/client-build/ && \
    cd /tmp/client-build && \
    echo '安装依赖...' && \
    npm ci --silent && \
    echo '开始构建...' && \
    NODE_OPTIONS='--max-old-space-size=4096' npm run build && \
    echo '构建完成！' && \
    ls -lh dist/ | head -10
"

echo ""
echo "步骤5: 检查构建结果..."
echo "----------------------------------------"
NEW_SIZE=$(docker compose exec -T app stat -c%s /tmp/client-build/dist/index.html 2>/dev/null || echo "0")
echo "构建的 index.html 大小: $NEW_SIZE 字节"

if [ "$NEW_SIZE" -lt 1000 ]; then
    echo "✗ 错误: 构建后文件仍然异常小"
    echo "检查构建输出："
    docker compose exec app sh -c "cd /tmp/client-build && cat dist/index.html"
    exit 1
fi

echo "✓ 构建成功"

echo ""
echo "步骤6: 复制构建文件到 volume..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

echo "清空volume并复制文件..."
sudo rm -rf "$VOLUME_PATH"/*
docker compose exec -T app tar -czf - -C /tmp/client-build/dist . | sudo tar -xzf - -C "$VOLUME_PATH" 2>&1 | grep -v "file changed as we read it" || true

echo ""
echo "步骤7: 验证复制结果..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -lt 1000 ]; then
    echo "✗ 错误: Volume中的文件仍然异常小"
    exit 1
fi

if [ -d "$VOLUME_PATH/assets" ]; then
    ASSETS_COUNT=$(sudo find "$VOLUME_PATH/assets" -type f 2>/dev/null | wc -l)
    echo "✓ assets目录中有 $ASSETS_COUNT 个文件"
fi

echo ""
echo "步骤8: 重启 nginx..."
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤9: 最终验证..."
echo "----------------------------------------"
NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "Nginx容器中 index.html 大小: $NGINX_SIZE 字节"

if [ "$NGINX_SIZE" -ge 1000 ]; then
    echo ""
    echo "=========================================="
    echo "✓ 构建和部署成功！"
    echo "=========================================="
    echo "请清除浏览器缓存并刷新页面"
else
    echo ""
    echo "=========================================="
    echo "✗ 部署失败"
    echo "=========================================="
    exit 1
fi
