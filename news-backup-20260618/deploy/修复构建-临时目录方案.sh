#!/bin/bash
# 修复构建问题 - 使用临时目录构建（因为dist被volume挂载）
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/修复构建-临时目录方案.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "修复构建问题（临时目录方案）"
echo "=========================================="

echo ""
echo "步骤1: 在临时目录构建前端..."
echo "----------------------------------------"
echo "这可能需要几分钟..."

# 在容器内的临时目录构建
docker compose exec app sh -c "
    cd /app/client && \
    echo '清理临时构建目录...' && \
    rm -rf /tmp/client-build && \
    mkdir -p /tmp/client-build && \
    echo '复制源代码到临时目录...' && \
    cp -r src index.html vite.config.js package*.json /tmp/client-build/ 2>/dev/null || \
    (cp -r src index.html vite.config.js package.json package-lock.json /tmp/client-build/ 2>/dev/null || true) && \
    cd /tmp/client-build && \
    echo '安装依赖...' && \
    npm ci --silent && \
    echo '开始构建...' && \
    NODE_OPTIONS='--max-old-space-size=4096' npm run build && \
    echo '构建完成！' && \
    ls -lh dist/ | head -10
"

echo ""
echo "步骤2: 检查构建结果..."
echo "----------------------------------------"
NEW_SIZE=$(docker compose exec -T app stat -c%s /tmp/client-build/dist/index.html 2>/dev/null || echo "0")
echo "新构建的 index.html 大小: $NEW_SIZE 字节"

if [ "$NEW_SIZE" -lt 1000 ]; then
    echo "✗ 错误: 构建后文件仍然异常小"
    echo "检查文件内容："
    docker compose exec -T app cat /tmp/client-build/dist/index.html
    echo ""
    echo "检查构建输出："
    docker compose exec app sh -c "cd /tmp/client-build && ls -la dist/"
    exit 1
fi

echo "✓ 构建成功！文件内容预览："
docker compose exec -T app head -10 /tmp/client-build/dist/index.html

echo ""
echo "步骤3: 检查assets目录..."
echo "----------------------------------------"
ASSETS_COUNT=$(docker compose exec -T app find /tmp/client-build/dist/assets -type f 2>/dev/null | wc -l || echo "0")
echo "assets目录中有 $ASSETS_COUNT 个文件"

echo ""
echo "步骤4: 复制构建文件到volume..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

# 清空volume
sudo rm -rf "$VOLUME_PATH"/*

# 从临时目录复制到volume
docker compose exec -T app tar -czf - -C /tmp/client-build/dist . | sudo tar -xzf - -C "$VOLUME_PATH" 2>&1 | grep -v "file changed as we read it" || true

echo ""
echo "步骤5: 验证复制结果..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -lt 1000 ]; then
    echo "✗ 错误: Volume中的文件仍然异常小"
    echo "检查文件："
    sudo ls -la "$VOLUME_PATH" | head -10
    exit 1
fi

echo ""
echo "步骤6: 同时复制到容器内的dist目录（如果可能）..."
echo "----------------------------------------"
# 尝试复制到容器内的dist（虽然被挂载，但可以覆盖文件）
docker compose exec -T app sh -c "rm -rf /app/client/dist/* && cp -r /tmp/client-build/dist/* /app/client/dist/" 2>/dev/null || echo "无法复制到容器内dist（被volume占用），但volume已更新"

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
    echo ""
    echo "文件大小对比："
    echo "  临时构建: $NEW_SIZE 字节"
    echo "  Volume:   $VOLUME_SIZE 字节"
    echo "  Nginx:    $NGINX_SIZE 字节"
    echo ""
    echo "请清除浏览器缓存并刷新页面"
else
    echo ""
    echo "=========================================="
    echo "✗ 修复失败"
    echo "=========================================="
    echo "Nginx中的文件仍然异常小"
    exit 1
fi
