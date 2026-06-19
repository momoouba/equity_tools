#!/bin/bash
# 诊断空白页面问题
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/诊断空白页面.sh

echo "=========================================="
echo "诊断空白页面问题"
echo "=========================================="

echo ""
echo "1. 检查应用容器中的文件..."
echo "----------------------------------------"
docker compose exec app ls -la /app/client/dist/ | head -15

echo ""
echo "2. 检查应用容器中index.html的大小和内容..."
echo "----------------------------------------"
APP_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
echo "文件大小: $APP_SIZE 字节"

if [ "$APP_SIZE" -gt 0 ]; then
    echo ""
    echo "文件前20行："
    docker compose exec -T app head -20 /app/client/dist/index.html
fi

echo ""
echo "3. 检查volume中的文件..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"
sudo ls -la "$VOLUME_PATH" | head -15

echo ""
echo "4. 检查volume中index.html的大小和内容..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "文件大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -gt 0 ]; then
    echo ""
    echo "文件前20行："
    sudo head -20 "$VOLUME_PATH/index.html"
fi

echo ""
echo "5. 检查nginx容器中的文件..."
echo "----------------------------------------"
docker compose exec nginx ls -la /usr/share/nginx/html/ | head -15

echo ""
echo "6. 检查nginx中index.html的大小..."
echo "----------------------------------------"
NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "文件大小: $NGINX_SIZE 字节"

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "如果应用容器中的文件正常但volume中的文件异常小，"
echo "请使用以下命令修复："
echo ""
echo "  docker compose exec -T app tar -czf - -C /app/client/dist . | sudo tar -xzf - -C \"$VOLUME_PATH\""
echo "  docker compose restart nginx"
