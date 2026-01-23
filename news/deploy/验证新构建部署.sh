#!/bin/bash
# 验证新构建部署
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/验证新构建部署.sh

cd /opt/newsapp/news

echo "=========================================="
echo "验证新构建部署"
echo "=========================================="

echo ""
echo "步骤1: 检查 index.html 引用的文件..."
echo "----------------------------------------"
cat client/dist/index.html

echo ""
echo "步骤2: 提取引用的文件名..."
echo "----------------------------------------"
JS_FILE=$(grep -oP 'src="/assets/\K[^"]+' client/dist/index.html | head -1)
CSS_FILE=$(grep -oP 'href="/assets/\K[^"]+' client/dist/index.html | head -1)
echo "JS文件: $JS_FILE"
echo "CSS文件: $CSS_FILE"

echo ""
echo "步骤3: 检查这些文件是否存在..."
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
echo "步骤4: 清理旧的 assets 文件..."
echo "----------------------------------------"
echo "当前 assets 目录中的所有文件："
sudo ls -lh "$VOLUME_PATH/assets/"

echo ""
echo "保留新构建的文件，删除旧文件..."
# 获取所有新构建的文件名
NEW_FILES=$(ls client/dist/assets/ | xargs -I {} basename {})
echo "新构建的文件："
echo "$NEW_FILES"

# 删除不在新构建列表中的文件
for file in $(sudo ls "$VOLUME_PATH/assets/"); do
    if ! echo "$NEW_FILES" | grep -q "$file"; then
        echo "删除旧文件: $file"
        sudo rm -f "$VOLUME_PATH/assets/$file"
    fi
done

echo ""
echo "清理后的文件："
sudo ls -lh "$VOLUME_PATH/assets/"

echo ""
echo "步骤5: 验证 nginx 中的文件..."
echo "----------------------------------------"
docker compose exec nginx ls -lh /usr/share/nginx/html/assets/ | head -10

echo ""
echo "步骤6: 检查 index.html..."
echo "----------------------------------------"
docker compose exec nginx cat /usr/share/nginx/html/index.html

echo ""
echo "=========================================="
echo "验证完成"
echo "=========================================="
echo ""
echo "如果所有文件都存在且大小正常，请："
echo "1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "2. 硬刷新页面（Ctrl+F5）"
echo "3. 检查浏览器控制台是否有错误"
