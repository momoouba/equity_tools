#!/bin/bash
# 完整修复空白页面 - 强制重新构建前端
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/fix-blank-page-complete.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "完整修复空白页面问题"
echo "=========================================="

echo ""
echo "步骤1: 检查应用容器中的文件..."
echo "----------------------------------------"
if docker compose exec -T app test -f /app/client/dist/index.html 2>/dev/null; then
    APP_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
    echo "当前应用容器中 index.html 大小: $APP_SIZE 字节"
    
    if [ "$APP_SIZE" -lt 1000 ]; then
        echo "⚠ 警告: 应用容器中的文件异常小，需要重新构建"
    else
        echo "✓ 应用容器中的文件看起来正常"
    fi
else
    echo "✗ 应用容器中没有找到 index.html"
fi

echo ""
echo "步骤2: 强制重新构建前端（不使用缓存）..."
echo "----------------------------------------"
echo "这可能需要几分钟时间..."
docker compose build --no-cache frontend-builder 2>/dev/null || docker compose build --no-cache app

echo ""
echo "步骤3: 重新构建应用镜像..."
echo "----------------------------------------"
docker compose build --no-cache app

echo ""
echo "步骤4: 重启应用容器..."
echo "----------------------------------------"
docker compose restart app

echo ""
echo "步骤5: 等待应用容器启动..."
echo "----------------------------------------"
sleep 10

echo ""
echo "步骤6: 检查新构建的文件..."
echo "----------------------------------------"
NEW_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
echo "新构建的 index.html 大小: $NEW_SIZE 字节"

if [ "$NEW_SIZE" -lt 1000 ]; then
    echo "✗ 错误: 重新构建后文件仍然异常小"
    echo "检查文件内容："
    docker compose exec -T app head -20 /app/client/dist/index.html
    echo ""
    echo "检查文件列表："
    docker compose exec app ls -la /app/client/dist/ | head -10
    exit 1
fi

echo ""
echo "步骤7: 查找volume路径..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

echo ""
echo "步骤8: 清空volume并复制新文件..."
echo "----------------------------------------"
sudo rm -rf "$VOLUME_PATH"/*

# 使用tar方式复制，确保完整性
echo "正在复制文件（使用tar方式）..."
docker compose exec -T app tar -czf - -C /app/client/dist . 2>/dev/null | sudo tar -xzf - -C "$VOLUME_PATH" 2>&1 | grep -v "file changed as we read it" || true

echo ""
echo "步骤9: 验证复制结果..."
echo "----------------------------------------"
if [ -f "$VOLUME_PATH/index.html" ]; then
    VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"
    
    if [ "$VOLUME_SIZE" -lt 1000 ]; then
        echo "✗ 错误: Volume中的文件仍然异常小"
        echo "尝试直接查看文件："
        sudo head -20 "$VOLUME_PATH/index.html"
        exit 1
    fi
    
    # 检查assets目录
    if [ -d "$VOLUME_PATH/assets" ]; then
        ASSETS_COUNT=$(sudo find "$VOLUME_PATH/assets" -type f 2>/dev/null | wc -l)
        echo "✓ assets目录中有 $ASSETS_COUNT 个文件"
    fi
else
    echo "✗ 错误: Volume中没有找到 index.html"
    exit 1
fi

echo ""
echo "步骤10: 重启nginx..."
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤11: 最终验证..."
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
    echo "  应用容器: $NEW_SIZE 字节"
    echo "  Volume:   $VOLUME_SIZE 字节"
    echo "  Nginx:    $NGINX_SIZE 字节"
    echo ""
    echo "请执行以下操作："
    echo "1. 清除浏览器缓存 (Ctrl+Shift+Delete)"
    echo "2. 硬刷新页面 (Ctrl+F5)"
    echo "3. 如果仍然空白，检查浏览器控制台"
    echo ""
    echo "验证命令："
    echo "  docker compose exec nginx ls -la /usr/share/nginx/html/ | head -10"
else
    echo ""
    echo "=========================================="
    echo "✗ 修复失败"
    echo "=========================================="
    echo "Nginx中的文件仍然异常小，请检查："
    echo "1. Volume挂载是否正确"
    echo "2. Nginx配置是否正确"
    echo "3. 文件权限是否正确"
    exit 1
fi
