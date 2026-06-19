#!/bin/bash

# 快速清理旧文件，只保留index.html引用的文件

set -e

VOLUME_PATH="/var/lib/docker/volumes/news_app_frontend/_data"

# 使用sudo检查路径是否存在
if ! sudo test -d "$VOLUME_PATH"; then
    echo "❌ 错误: volume路径不存在: $VOLUME_PATH"
    echo "尝试查找volume路径..."
    sudo docker volume ls | grep frontend
    exit 1
fi

echo "=========================================="
echo "清理旧文件"
echo "=========================================="
echo "Volume路径: $VOLUME_PATH"
echo ""

# 检查index.html（使用sudo test）
INDEX_HTML="$VOLUME_PATH/index.html"
if ! sudo test -f "$INDEX_HTML"; then
    echo "❌ 错误: index.html不存在: $INDEX_HTML"
    echo "当前目录中的文件:"
    sudo ls -la "$VOLUME_PATH"
    exit 1
fi

echo "✓ 找到index.html"

# 从index.html中提取文件名（先读取内容到临时文件，避免权限问题）
TEMP_HTML=$(mktemp)
sudo cat "$INDEX_HTML" > "$TEMP_HTML"

echo "读取index.html中引用的文件..."
JS_FILE=$(grep -oP 'src="/assets/\K[^"]+' "$TEMP_HTML" | head -1)
CSS_FILE=$(grep -oP 'href="/assets/\K[^"]+' "$TEMP_HTML" | head -1)

if [ -z "$JS_FILE" ]; then
    # 如果上面的正则不匹配，尝试另一种方式
    JS_FILE=$(grep -o 'assets/[^"]*\.js' "$TEMP_HTML" | cut -d'/' -f2 | head -1)
fi

if [ -z "$CSS_FILE" ]; then
    CSS_FILE=$(grep -o 'assets/[^"]*\.css' "$TEMP_HTML" | cut -d'/' -f2 | head -1)
fi

rm -f "$TEMP_HTML"

echo "  JS文件: $JS_FILE"
echo "  CSS文件: $CSS_FILE"
echo ""

if [ -z "$JS_FILE" ] || [ -z "$CSS_FILE" ]; then
    echo "❌ 错误: 无法从index.html中提取文件名"
    echo "index.html内容:"
    sudo cat "$INDEX_HTML"
    exit 1
fi

# 清理assets目录
ASSETS_DIR="$VOLUME_PATH/assets"
echo "清理assets目录: $ASSETS_DIR"

# 检查assets目录
if [ ! -d "$ASSETS_DIR" ]; then
    echo "❌ 错误: assets目录不存在: $ASSETS_DIR"
    exit 1
fi

# 创建临时目录保存需要的文件
TEMP_DIR=$(mktemp -d)
echo "临时目录: $TEMP_DIR"

# 复制需要的文件
if [ -f "$ASSETS_DIR/$JS_FILE" ]; then
    sudo cp "$ASSETS_DIR/$JS_FILE" "$TEMP_DIR/"
    echo "  ✓ 保存JS文件: $JS_FILE"
else
    echo "  ⚠ 警告: JS文件不存在: $ASSETS_DIR/$JS_FILE"
fi

if [ -f "$ASSETS_DIR/$CSS_FILE" ]; then
    sudo cp "$ASSETS_DIR/$CSS_FILE" "$TEMP_DIR/"
    echo "  ✓ 保存CSS文件: $CSS_FILE"
else
    echo "  ⚠ 警告: CSS文件不存在: $ASSETS_DIR/$CSS_FILE"
fi

# 复制其他可能存在的文件
for file in vite.svg favicon.ico; do
    if [ -f "$ASSETS_DIR/$file" ]; then
        sudo cp "$ASSETS_DIR/$file" "$TEMP_DIR/" 2>/dev/null || true
        echo "  ✓ 保存其他文件: $file"
    fi
done

# 清空assets目录
echo ""
echo "清空assets目录..."
sudo rm -rf "$ASSETS_DIR"/*

# 复制回需要的文件
echo "恢复需要的文件..."
sudo cp "$TEMP_DIR"/* "$ASSETS_DIR/" 2>/dev/null || true
sudo rm -rf "$TEMP_DIR"

# 设置权限
sudo chown -R root:root "$ASSETS_DIR"
sudo chmod -R 755 "$ASSETS_DIR"

echo "  ✓ 清理完成"
echo ""

# 验证
echo "验证文件..."
ASSET_COUNT=$(sudo ls -1 "$ASSETS_DIR" 2>/dev/null | wc -l)
echo "  assets目录中有 $ASSET_COUNT 个文件"
sudo ls -lh "$ASSETS_DIR"
echo ""

# 重启nginx
echo "重启nginx..."
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep nginx | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    sudo docker restart "$NGINX_CONTAINER"
    sleep 3
    echo "  ✓ Nginx已重启: $NGINX_CONTAINER"
else
    echo "  ⚠ 警告: 未找到nginx容器"
fi

echo ""
echo "=========================================="
echo "✅ 完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "2. 强制刷新页面（Ctrl+F5）"
echo "3. 或打开开发者工具(F12) -> Network -> 勾选 'Disable cache' -> 刷新"
echo ""

