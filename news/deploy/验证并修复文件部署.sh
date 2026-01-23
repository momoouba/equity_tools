#!/bin/bash
# 验证并修复文件部署
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/验证并修复文件部署.sh

cd /opt/newsapp/news

echo "=========================================="
echo "验证并修复文件部署"
echo "=========================================="

echo ""
echo "步骤1: 检查 index.html 引用的文件..."
echo "----------------------------------------"
INDEX_HTML=$(cat client/dist/index.html)
JS_FILE=$(echo "$INDEX_HTML" | grep -oP 'src="/assets/\K[^"]+' | head -1)
CSS_FILE=$(echo "$INDEX_HTML" | grep -oP 'href="/assets/\K[^"]+' | head -1)

echo "index.html 引用的文件："
echo "  JS:   $JS_FILE"
echo "  CSS:  $CSS_FILE"

echo ""
echo "步骤2: 检查这些文件是否存在..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

if [ -n "$JS_FILE" ]; then
    if sudo test -f "$VOLUME_PATH/assets/$JS_FILE"; then
        JS_SIZE=$(sudo stat -c%s "$VOLUME_PATH/assets/$JS_FILE" 2>/dev/null || echo "0")
        echo "✓ JS文件存在: $JS_FILE ($JS_SIZE 字节)"
    else
        echo "✗ JS文件不存在: $JS_FILE"
    fi
fi

if [ -n "$CSS_FILE" ]; then
    if sudo test -f "$VOLUME_PATH/assets/$CSS_FILE"; then
        CSS_SIZE=$(sudo stat -c%s "$VOLUME_PATH/assets/$CSS_FILE" 2>/dev/null || echo "0")
        echo "✓ CSS文件存在: $CSS_FILE ($CSS_SIZE 字节)"
    else
        echo "✗ CSS文件不存在: $CSS_FILE"
    fi
fi

echo ""
echo "步骤3: 检查 nginx 中的文件..."
echo "----------------------------------------"
if [ -n "$JS_FILE" ]; then
    NGINX_JS_SIZE=$(docker compose exec -T nginx stat -c%s "/usr/share/nginx/html/assets/$JS_FILE" 2>/dev/null || echo "0")
    if [ "$NGINX_JS_SIZE" -gt 0 ]; then
        echo "✓ Nginx中JS文件存在: $JS_FILE ($NGINX_JS_SIZE 字节)"
    else
        echo "✗ Nginx中JS文件不存在: $JS_FILE"
    fi
fi

if [ -n "$CSS_FILE" ]; then
    NGINX_CSS_SIZE=$(docker compose exec -T nginx stat -c%s "/usr/share/nginx/html/assets/$CSS_FILE" 2>/dev/null || echo "0")
    if [ "$NGINX_CSS_SIZE" -gt 0 ]; then
        echo "✓ Nginx中CSS文件存在: $CSS_FILE ($NGINX_CSS_SIZE 字节)"
    else
        echo "✗ Nginx中CSS文件不存在: $CSS_FILE"
    fi
fi

echo ""
echo "步骤4: 清理旧的 assets 文件（如果存在）..."
echo "----------------------------------------"
# 只保留 index.html 引用的文件
sudo find "$VOLUME_PATH/assets" -type f ! -name "$JS_FILE" ! -name "$CSS_FILE" ! -name "*.js" ! -name "*.css" -delete 2>/dev/null || true

# 或者更安全的方法：只删除明显是旧版本的文件
echo "当前 assets 目录中的文件："
sudo ls -lh "$VOLUME_PATH/assets/"

echo ""
echo "步骤5: 重新加载 nginx（如果文件已更新）..."
echo "----------------------------------------"
docker compose exec nginx nginx -s reload 2>/dev/null || docker compose restart nginx

echo ""
echo "=========================================="
echo "验证完成"
echo "=========================================="
echo ""
echo "如果文件都存在但仍然 404，可能是浏览器缓存问题："
echo "1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "2. 硬刷新页面（Ctrl+F5）"
echo "3. 或使用无痕模式访问"
