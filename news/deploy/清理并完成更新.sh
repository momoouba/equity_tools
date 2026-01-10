#!/bin/bash

# 清理旧文件并确保只保留最新文件

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "清理旧文件并完成更新"
echo "=========================================="

# 查找volume路径
echo "查找volume路径..."
VOLUME_NAMES=(
    "news_app_frontend"
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
)

VOLUME_PATH=""
for vol_name in "${VOLUME_NAMES[@]}"; do
    VOLUME_INFO=$(sudo docker volume inspect "$vol_name" 2>/dev/null || echo "")
    if [ -n "$VOLUME_INFO" ]; then
        TEST_PATH=$(echo "$VOLUME_INFO" | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
        if [ -n "$TEST_PATH" ] && [ -d "$TEST_PATH" ]; then
            VOLUME_PATH="$TEST_PATH"
            echo "✓ 找到volume路径: $VOLUME_PATH"
            break
        fi
    fi
done

if [ -z "$VOLUME_PATH" ] || [ ! -d "$VOLUME_PATH" ]; then
    echo "❌ 错误: 无法找到volume路径"
    echo "尝试查找所有volumes:"
    sudo docker volume ls | grep frontend
    exit 1
fi

# 1. 读取index.html中引用的文件名
echo ""
echo "1. 读取index.html中引用的文件..."
INDEX_HTML="$VOLUME_PATH/index.html"
if [ ! -f "$INDEX_HTML" ]; then
    echo "❌ 错误: index.html不存在于 $INDEX_HTML"
    echo "请检查volume路径是否正确"
    exit 1
fi

# 提取JS和CSS文件名
JS_FILE=$(sudo grep -oP 'src="/assets/\K[^"]+' "$INDEX_HTML" | head -1)
CSS_FILE=$(sudo grep -oP 'href="/assets/\K[^"]+' "$INDEX_HTML" | head -1)

echo "   JS文件: $JS_FILE"
echo "   CSS文件: $CSS_FILE"
echo ""

if [ -z "$JS_FILE" ] || [ -z "$CSS_FILE" ]; then
    echo "❌ 错误: 无法从index.html中提取文件名"
    exit 1
fi

# 2. 备份当前文件列表
echo "2. 备份当前文件列表..."
sudo ls -lah "$VOLUME_PATH/assets" > /tmp/assets_backup.txt 2>/dev/null || true
echo "   ✓ 备份完成"
echo ""

# 3. 清理assets目录，只保留index.html中引用的文件
echo "3. 清理assets目录，只保留必要文件..."
ASSETS_DIR="$VOLUME_PATH/assets"

# 创建临时目录
TEMP_DIR="/tmp/assets_cleanup_$$"
sudo mkdir -p "$TEMP_DIR"

# 复制需要的文件到临时目录
if [ -f "$ASSETS_DIR/$JS_FILE" ]; then
    sudo cp "$ASSETS_DIR/$JS_FILE" "$TEMP_DIR/"
    echo "   ✓ 保留JS文件: $JS_FILE"
fi

if [ -f "$ASSETS_DIR/$CSS_FILE" ]; then
    sudo cp "$ASSETS_DIR/$CSS_FILE" "$TEMP_DIR/"
    echo "   ✓ 保留CSS文件: $CSS_FILE"
fi

# 复制其他可能需要的文件（如vite.svg等）
for file in vite.svg favicon.ico; do
    if [ -f "$ASSETS_DIR/$file" ]; then
        sudo cp "$ASSETS_DIR/$file" "$TEMP_DIR/" 2>/dev/null || true
    fi
done

# 清空assets目录并复制回需要的文件
sudo rm -rf "$ASSETS_DIR"/*
sudo cp "$TEMP_DIR"/* "$ASSETS_DIR/" 2>/dev/null || true
sudo rm -rf "$TEMP_DIR"

# 设置权限
sudo chown -R root:root "$ASSETS_DIR"
sudo chmod -R 755 "$ASSETS_DIR"

echo "   ✓ 清理完成"
echo ""

# 4. 验证文件
echo "4. 验证文件..."
FINAL_JS="$ASSETS_DIR/$JS_FILE"
FINAL_CSS="$ASSETS_DIR/$CSS_FILE"

if sudo test -f "$FINAL_JS" && sudo test -f "$FINAL_CSS"; then
    JS_SIZE=$(sudo stat -c%s "$FINAL_JS" 2>/dev/null || echo "0")
    CSS_SIZE=$(sudo stat -c%s "$FINAL_CSS" 2>/dev/null || echo "0")
    echo "   ✓ JS文件存在: $JS_FILE ($JS_SIZE 字节)"
    echo "   ✓ CSS文件存在: $CSS_FILE ($CSS_SIZE 字节)"
else
    echo "   ❌ 错误: 必要文件不存在"
    exit 1
fi

ASSET_COUNT=$(sudo ls -1 "$ASSETS_DIR" | wc -l)
echo "   assets目录中现在有 $ASSET_COUNT 个文件"
echo ""

# 5. 重启nginx以清除缓存
echo "5. 重启nginx以清除缓存..."
NGINX_CONTAINER=$(sudo docker ps --format "{{.Names}}" | grep -E "nginx|newsapp-nginx" | head -1)
if [ -n "$NGINX_CONTAINER" ]; then
    echo "   正在重启: $NGINX_CONTAINER"
    sudo docker restart "$NGINX_CONTAINER"
    sleep 3
    
    # 验证nginx是否正常运行
    if sudo docker ps | grep -q "$NGINX_CONTAINER"; then
        echo "   ✓ Nginx已重启并正常运行"
    else
        echo "   ⚠ 警告: Nginx可能未正常运行"
    fi
else
    echo "   ⚠ 警告: 未找到nginx容器"
fi
echo ""

# 6. 最终验证
echo "=========================================="
echo "最终验证"
echo "=========================================="

# 通过nginx容器验证
if [ -n "$NGINX_CONTAINER" ]; then
    if sudo docker exec "$NGINX_CONTAINER" test -f "/usr/share/nginx/html/index.html" 2>/dev/null; then
        echo "✓ Nginx可以访问index.html"
    fi
    
    if sudo docker exec "$NGINX_CONTAINER" test -f "/usr/share/nginx/html/assets/$JS_FILE" 2>/dev/null; then
        echo "✓ Nginx可以访问JS文件"
    fi
    
    if sudo docker exec "$NGINX_CONTAINER" test -f "/usr/share/nginx/html/assets/$CSS_FILE" 2>/dev/null; then
        echo "✓ Nginx可以访问CSS文件"
    fi
fi

echo ""
echo "=========================================="
echo "✅ 清理和更新完成！"
echo "=========================================="
echo ""
echo "重要提示："
echo "1. 请清除浏览器缓存："
echo "   - 按 Ctrl+Shift+Delete (Windows/Linux) 或 Cmd+Shift+Delete (Mac)"
echo "   - 或打开开发者工具(F12) -> Application -> Clear storage -> Clear site data"
echo ""
echo "2. 强制刷新页面："
echo "   - Windows/Linux: Ctrl+F5 或 Ctrl+Shift+R"
echo "   - Mac: Cmd+Shift+R"
echo ""
echo "3. 或者在开发者工具中："
echo "   - 打开 Network 标签"
echo "   - 勾选 'Disable cache'"
echo "   - 刷新页面"
echo ""
echo "如果仍然没有生效，请检查："
echo "  - 浏览器控制台(F12)是否有错误"
echo "  - Network标签中请求的文件是否正确（应该是 $JS_FILE 和 $CSS_FILE）"
echo ""

