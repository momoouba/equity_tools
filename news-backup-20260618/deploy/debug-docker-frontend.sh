#!/bin/bash

# 调试Docker前端问题
# 检查构建产物、volume内容、容器状态等

set -e

echo "=========================================="
echo "Docker前端问题调试工具"
echo "=========================================="

cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 检查容器状态"
echo "----------------------------------------"
sudo docker compose ps

echo ""
echo "步骤 2: 检查容器内的前端文件"
echo "----------------------------------------"
echo "检查 /app/client/dist/index.html:"
if sudo docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 文件存在"
    echo ""
    echo "文件大小:"
    sudo docker compose exec app ls -lh /app/client/dist/index.html 2>/dev/null || echo "无法获取"
    echo ""
    echo "文件前20行:"
    sudo docker compose exec app head -20 /app/client/dist/index.html 2>/dev/null || echo "无法读取"
else
    echo "❌ 文件不存在！"
fi

echo ""
echo "检查 /app/client/dist/assets/ 目录:"
if sudo docker compose exec -T app test -d /app/client/dist/assets 2>/dev/null; then
    echo "✓ assets目录存在"
    echo "文件数量:"
    sudo docker compose exec app find /app/client/dist/assets -type f 2>/dev/null | wc -l || echo "0"
    echo ""
    echo "主要JS文件:"
    sudo docker compose exec app find /app/client/dist/assets -name "*.js" -type f 2>/dev/null | head -5 || echo "无"
    echo ""
    echo "主要CSS文件:"
    sudo docker compose exec app find /app/client/dist/assets -name "*.css" -type f 2>/dev/null | head -5 || echo "无"
else
    echo "❌ assets目录不存在！"
fi

echo ""
echo "步骤 3: 检查Docker volume内容"
echo "----------------------------------------"
VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver: local" -B 1 | head -1 | awk '{print $2}' | tr -d ':' || echo "news_app_frontend")
echo "Volume名称: $VOLUME_NAME"

if sudo docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ]; then
        echo "Volume路径: $VOLUME_PATH"
        echo ""
        echo "Volume中的文件:"
        sudo ls -la "$VOLUME_PATH" 2>/dev/null | head -10 || echo "无法列出"
        echo ""
        if [ -f "$VOLUME_PATH/index.html" ]; then
            echo "index.html 文件信息:"
            sudo stat "$VOLUME_PATH/index.html" 2>/dev/null | grep -E "Size|Modify" || echo "无法获取"
        fi
    fi
else
    echo "⚠ volume不存在"
fi

echo ""
echo "步骤 4: 检查Nginx配置的前端文件"
echo "----------------------------------------"
if sudo docker compose exec -T nginx test -f /usr/share/nginx/html/index.html 2>/dev/null; then
    echo "✓ Nginx前端文件存在"
    echo ""
    echo "文件大小:"
    sudo docker compose exec nginx ls -lh /usr/share/nginx/html/index.html 2>/dev/null || echo "无法获取"
    echo ""
    echo "主要文件列表:"
    sudo docker compose exec nginx ls -la /usr/share/nginx/html/ 2>/dev/null | head -10 || echo "无法列出"
else
    echo "❌ Nginx前端文件不存在！"
fi

echo ""
echo "步骤 5: 检查构建产物中的关键文件"
echo "----------------------------------------"
echo "检查index.html中是否包含React相关代码:"
if sudo docker compose exec -T app grep -q "react" /app/client/dist/index.html 2>/dev/null; then
    echo "✓ 包含React相关代码"
    echo ""
    echo "检查是否有NewsInfo相关的引用:"
    sudo docker compose exec app grep -i "newsinfo\|news-info" /app/client/dist/index.html 2>/dev/null | head -3 || echo "未找到"
else
    echo "⚠ 未找到React相关代码"
fi

echo ""
echo "步骤 6: 检查应用日志中的错误"
echo "----------------------------------------"
echo "最近50行日志:"
sudo docker compose logs --tail=50 app 2>&1 | grep -i "error\|warn\|fail" || echo "未找到错误"

echo ""
echo "步骤 7: 检查Nginx日志"
echo "----------------------------------------"
echo "最近20行Nginx访问日志:"
sudo docker compose logs --tail=20 nginx 2>&1 | grep -E "GET|POST|error" || echo "未找到相关日志"

echo ""
echo "步骤 8: 测试API健康检查"
echo "----------------------------------------"
if sudo docker compose exec -T app node -e "require('http').get('http://localhost:3001/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})" 2>/dev/null; then
    echo "✓ API健康检查通过"
else
    echo "❌ API健康检查失败"
fi

echo ""
echo "步骤 9: 检查浏览器可访问的文件"
echo "----------------------------------------"
echo "从容器内测试index.html内容:"
sudo docker compose exec app cat /app/client/dist/index.html 2>/dev/null | head -30 || echo "无法读取"

echo ""
echo "=========================================="
echo "调试信息收集完成"
echo "=========================================="
echo ""
echo "建议操作："
echo "1. 如果volume中的文件比镜像中的旧，删除volume并重新构建"
echo "2. 如果构建产物不完整，检查构建日志"
echo "3. 如果Nginx无法访问文件，检查volume挂载"
echo "4. 清除浏览器缓存并硬刷新（Ctrl + F5）"
echo ""
