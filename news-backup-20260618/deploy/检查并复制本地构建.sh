#!/bin/bash
# 检查并复制本地构建文件到volume
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查并复制本地构建.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查并复制本地构建文件"
echo "=========================================="

echo ""
echo "步骤1: 查找构建文件..."
echo "----------------------------------------"

# 检查多个可能的位置
POSSIBLE_LOCATIONS=(
    "/tmp/dist"
    "/opt/newsapp/news/client/dist"
    "/opt/newsapp/news/dist"
    "/root/dist"
    "/home/guofang/dist"
)

FOUND_LOCATION=""
for loc in "${POSSIBLE_LOCATIONS[@]}"; do
    if [ -d "$loc" ] && [ -f "$loc/index.html" ]; then
        SIZE=$(stat -c%s "$loc/index.html" 2>/dev/null || echo "0")
        if [ "$SIZE" -ge 1000 ]; then
            FOUND_LOCATION="$loc"
            echo "✓ 找到构建文件: $loc"
            echo "  index.html 大小: $SIZE 字节"
            break
        fi
    fi
done

if [ -z "$FOUND_LOCATION" ]; then
    echo "✗ 未找到构建文件"
    echo ""
    echo "请先上传构建文件，可以使用以下方法："
    echo ""
    echo "方法1: 使用 WinSCP 上传"
    echo "  1. 在本地构建: cd client && npm run build"
    echo "  2. 使用 WinSCP 将 client/dist 目录上传到服务器 /tmp/dist"
    echo ""
    echo "方法2: 使用 scp（在本地 PowerShell）"
    echo "  scp -r E:\\USER\\SUREAL\\Desktop\\equity_news\\news\\client\\dist guofang@服务器IP:/tmp/dist"
    echo ""
    echo "方法3: 如果文件已经在服务器上，请告诉我路径"
    exit 1
fi

echo ""
echo "步骤2: 查找volume路径..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

echo ""
echo "步骤3: 清空volume并复制文件..."
echo "----------------------------------------"
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r "$FOUND_LOCATION"/* "$VOLUME_PATH/"

echo ""
echo "步骤4: 验证复制结果..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -lt 1000 ]; then
    echo "✗ 错误: Volume中的文件仍然异常小"
    echo "检查文件："
    sudo ls -la "$VOLUME_PATH" | head -10
    exit 1
fi

# 检查assets目录
if [ -d "$VOLUME_PATH/assets" ]; then
    ASSETS_COUNT=$(sudo find "$VOLUME_PATH/assets" -type f 2>/dev/null | wc -l)
    echo "✓ assets目录中有 $ASSETS_COUNT 个文件"
fi

echo ""
echo "步骤5: 重启nginx..."
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤6: 最终验证..."
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
    echo "  源文件:   $(stat -c%s "$FOUND_LOCATION/index.html" 2>/dev/null || echo "0") 字节"
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
