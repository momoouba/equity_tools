#!/bin/bash
# 修复空白页面 - 直接执行命令版本
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/fix-blank-page-commands.sh

cd /opt/newsapp/news

echo "步骤1: 查找volume路径..."
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

if [ -z "$VOLUME_PATH" ]; then
    echo "错误: 无法找到volume"
    exit 1
fi

echo "Volume路径: $VOLUME_PATH"

echo "步骤2: 从应用容器复制文件..."
TEMP_DIR=$(mktemp -d)
docker cp newsapp:/app/client/dist/. "$TEMP_DIR/"

echo "步骤3: 复制到volume..."
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r "$TEMP_DIR"/* "$VOLUME_PATH/"

echo "步骤4: 清理临时文件..."
rm -rf "$TEMP_DIR"

echo "步骤5: 验证文件..."
if [ -f "$VOLUME_PATH/index.html" ]; then
    FILE_SIZE=$(stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    echo "✓ 成功！index.html大小: $FILE_SIZE 字节"
else
    echo "✗ 错误: 文件复制失败"
    exit 1
fi

echo "步骤6: 重启nginx..."
docker compose restart nginx

echo ""
echo "=========================================="
echo "修复完成！"
echo "=========================================="
echo "请清除浏览器缓存并刷新页面"
