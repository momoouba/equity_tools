#!/bin/bash
# 诊断构建失败问题
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/诊断构建失败.sh

cd /opt/newsapp/news

echo "=========================================="
echo "诊断构建失败问题"
echo "=========================================="

echo ""
echo "1. 检查容器内是否有源代码..."
echo "----------------------------------------"
docker compose exec app sh -c "ls -la /app/client/ | head -15"

echo ""
echo "2. 检查package.json是否存在..."
echo "----------------------------------------"
docker compose exec app test -f /app/client/package.json && echo "✓ package.json存在" || echo "✗ package.json不存在"

echo ""
echo "3. 尝试手动执行构建步骤（显示详细输出）..."
echo "----------------------------------------"
docker compose exec app sh -c "
    cd /app/client && \
    echo '=== 创建临时目录 ===' && \
    rm -rf /tmp/client-build && \
    mkdir -p /tmp/client-build && \
    echo '=== 复制文件 ===' && \
    ls -la | grep -E '(src|index.html|vite.config|package)' && \
    cp -r src /tmp/client-build/ && \
    cp index.html vite.config.js package.json package-lock.json /tmp/client-build/ 2>&1 && \
    echo '=== 检查复制的文件 ===' && \
    ls -la /tmp/client-build/ | head -10 && \
    cd /tmp/client-build && \
    echo '=== 安装依赖 ===' && \
    npm ci 2>&1 | tail -20 && \
    echo '=== 开始构建 ===' && \
    NODE_OPTIONS='--max-old-space-size=4096' npm run build 2>&1
"

echo ""
echo "4. 检查构建结果..."
echo "----------------------------------------"
if docker compose exec -T app test -d /tmp/client-build/dist 2>/dev/null; then
    echo "dist目录存在"
    docker compose exec app ls -la /tmp/client-build/dist/ | head -10
    if docker compose exec -T app test -f /tmp/client-build/dist/index.html 2>/dev/null; then
        SIZE=$(docker compose exec -T app stat -c%s /tmp/client-build/dist/index.html 2>/dev/null || echo "0")
        echo "index.html大小: $SIZE 字节"
        echo "文件内容："
        docker compose exec -T app head -20 /tmp/client-build/dist/index.html
    else
        echo "✗ index.html不存在"
    fi
else
    echo "✗ dist目录不存在，构建失败"
fi
