#!/bin/bash
# 检查 JS 文件内容
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查JS文件内容.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查 JS 文件内容"
echo "=========================================="

VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
JS_FILE=$(grep -oP 'src="/assets/\K[^"]+' client/dist/index.html | head -1)

echo "JS文件: $JS_FILE"
echo ""

if [ -n "$JS_FILE" ] && [ -f "$VOLUME_PATH/assets/$JS_FILE" ]; then
    JS_SIZE=$(sudo stat -c%s "$VOLUME_PATH/assets/$JS_FILE" 2>/dev/null || echo "0")
    echo "文件大小: $JS_SIZE 字节"
    echo ""
    echo "文件内容（前100行）："
    sudo head -100 "$VOLUME_PATH/assets/$JS_FILE"
    echo ""
    echo "文件内容（后20行）："
    sudo tail -20 "$VOLUME_PATH/assets/$JS_FILE"
else
    echo "文件不存在"
fi
