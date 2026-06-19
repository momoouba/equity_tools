#!/bin/bash

# 验证前端更新是否成功

set -e

VOLUME_PATH="/var/lib/docker/volumes/news_app_frontend/_data"

echo "=========================================="
echo "验证前端文件更新"
echo "=========================================="

# 1. 检查文件列表
echo "1. 检查文件列表："
sudo ls -lah "$VOLUME_PATH"
echo ""

# 2. 检查index.html内容
echo "2. 检查index.html内容："
if sudo test -f "$VOLUME_PATH/index.html"; then
    FILE_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || sudo stat -f%z "$VOLUME_PATH/index.html" 2>/dev/null || echo "unknown")
    echo "   文件大小: $FILE_SIZE 字节"
    echo "   前20行内容："
    sudo head -20 "$VOLUME_PATH/index.html"
    echo ""
    
    # 检查是否包含关键内容
    if sudo grep -q "root" "$VOLUME_PATH/index.html" 2>/dev/null; then
        echo "   ✓ 包含 root div（正常）"
    else
        echo "   ⚠ 警告: 可能缺少关键内容"
    fi
else
    echo "   ❌ index.html 不存在"
fi
echo ""

# 3. 检查assets目录
echo "3. 检查assets目录："
if sudo test -d "$VOLUME_PATH/assets"; then
    ASSET_COUNT=$(sudo ls -1 "$VOLUME_PATH/assets" 2>/dev/null | wc -l)
    echo "   assets目录中有 $ASSET_COUNT 个文件"
    sudo ls -lh "$VOLUME_PATH/assets" | head -10
    echo ""
else
    echo "   ⚠ 警告: assets目录不存在"
    echo ""
fi

# 4. 通过nginx容器验证
echo "4. 通过nginx容器验证："
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    echo "   Nginx容器: $NGINX_CONTAINER"
    
    if sudo docker exec "$NGINX_CONTAINER" test -f /usr/share/nginx/html/index.html 2>/dev/null; then
        echo "   ✓ Nginx容器可以访问到index.html"
        
        # 检查nginx容器中的文件大小
        NGINX_FILE_SIZE=$(sudo docker exec "$NGINX_CONTAINER" stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "unknown")
        echo "   Nginx容器中的index.html大小: $NGINX_FILE_SIZE 字节"
        
        # 检查assets目录
        if sudo docker exec "$NGINX_CONTAINER" test -d /usr/share/nginx/html/assets 2>/dev/null; then
            NGINX_ASSET_COUNT=$(sudo docker exec "$NGINX_CONTAINER" ls -1 /usr/share/nginx/html/assets 2>/dev/null | wc -l)
            echo "   ✓ Nginx容器可以访问到assets目录（$NGINX_ASSET_COUNT 个文件）"
        else
            echo "   ⚠ 警告: Nginx容器无法访问assets目录"
        fi
    else
        echo "   ❌ Nginx容器无法访问index.html"
    fi
else
    echo "   ⚠ 警告: 未找到运行中的nginx容器"
fi
echo ""

# 5. 检查nginx服务状态
echo "5. 检查nginx服务状态："
if [ -n "$NGINX_CONTAINER" ]; then
    NGINX_STATUS=$(sudo docker inspect "$NGINX_CONTAINER" --format='{{.State.Status}}' 2>/dev/null || echo "unknown")
    echo "   Nginx容器状态: $NGINX_STATUS"
    
    if [ "$NGINX_STATUS" = "running" ]; then
        # 检查nginx配置是否正确加载
        if sudo docker exec "$NGINX_CONTAINER" nginx -t 2>&1 | grep -q "successful"; then
            echo "   ✓ Nginx配置正确"
        else
            echo "   ⚠ 警告: Nginx配置可能有问题"
        fi
    fi
fi
echo ""

# 6. 建议
echo "=========================================="
echo "验证结果和建议"
echo "=========================================="
echo ""
echo "如果所有检查都通过，请执行以下操作："
echo ""
echo "1. 清除浏览器缓存："
echo "   - Chrome/Edge: Ctrl+Shift+Delete"
echo "   - 或打开开发者工具(F12) -> Network -> 勾选 'Disable cache'"
echo ""
echo "2. 强制刷新页面："
echo "   - Windows/Linux: Ctrl+F5 或 Ctrl+Shift+R"
echo "   - Mac: Cmd+Shift+R"
echo ""
echo "3. 如果页面仍未更新，可以重启nginx（通常不需要）："
if [ -n "$NGINX_CONTAINER" ]; then
    echo "   sudo docker restart $NGINX_CONTAINER"
fi
echo ""
echo "4. 查看nginx日志："
if [ -n "$NGINX_CONTAINER" ]; then
    echo "   sudo docker logs $NGINX_CONTAINER --tail 50"
fi
echo ""

