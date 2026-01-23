#!/bin/bash
# 可靠修复空白页面 - 使用tar确保文件完整性
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/fix-blank-page-reliable.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "修复空白页面问题（可靠版本）"
echo "=========================================="

# 检查容器
if ! docker compose ps | grep -q "newsapp.*Up"; then
    echo "错误: 应用容器未运行"
    exit 1
fi

echo ""
echo "步骤1: 检查应用容器中的前端文件..."
APP_INDEX_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
echo "应用容器中 index.html 大小: $APP_INDEX_SIZE 字节"

if [ "$APP_INDEX_SIZE" -lt 1000 ]; then
    echo "⚠ 警告: 应用容器中的index.html异常小，可能构建有问题"
    echo "检查应用容器中的文件列表："
    docker compose exec app ls -la /app/client/dist/ | head -10
fi

echo ""
echo "步骤2: 查找volume路径..."
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

if [ -z "$VOLUME_PATH" ]; then
    echo "错误: 无法找到volume"
    exit 1
fi

echo "Volume路径: $VOLUME_PATH"

echo ""
echo "步骤3: 使用tar方式从应用容器复制文件到volume..."
# 使用tar方式确保文件完整性和权限
docker compose exec -T app tar -czf - -C /app/client/dist . | sudo tar -xzf - -C "$VOLUME_PATH"

echo ""
echo "步骤4: 验证文件..."
if [ -f "$VOLUME_PATH/index.html" ]; then
    FILE_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
    echo "✓ Volume中 index.html 大小: $FILE_SIZE 字节"
    
    if [ "$FILE_SIZE" -lt 1000 ]; then
        echo "✗ 错误: 文件大小异常小，复制可能失败"
        echo "尝试检查文件内容："
        sudo head -20 "$VOLUME_PATH/index.html"
        exit 1
    fi
    
    # 检查assets目录
    if [ -d "$VOLUME_PATH/assets" ]; then
        ASSETS_COUNT=$(sudo find "$VOLUME_PATH/assets" -type f | wc -l)
        echo "✓ assets目录中有 $ASSETS_COUNT 个文件"
    else
        echo "⚠ 警告: assets目录不存在"
    fi
else
    echo "✗ 错误: index.html不存在"
    exit 1
fi

echo ""
echo "步骤5: 检查nginx容器中的文件..."
sleep 2
NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "Nginx容器中 index.html 大小: $NGINX_SIZE 字节"

if [ "$NGINX_SIZE" -lt 1000 ]; then
    echo "⚠ 警告: Nginx中的文件仍然很小，可能需要重启"
fi

echo ""
echo "步骤6: 重启nginx..."
docker compose restart nginx
sleep 3

echo ""
echo "步骤7: 最终验证..."
FINAL_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "最终 index.html 大小: $FINAL_SIZE 字节"

if [ "$FINAL_SIZE" -ge 1000 ]; then
    echo ""
    echo "=========================================="
    echo "✓ 修复成功！"
    echo "=========================================="
    echo "请清除浏览器缓存并刷新页面"
    echo ""
    echo "验证命令："
    echo "  docker compose exec nginx ls -la /usr/share/nginx/html/ | head -10"
else
    echo ""
    echo "=========================================="
    echo "✗ 修复失败，文件大小仍然异常"
    echo "=========================================="
    echo "请检查："
    echo "1. 应用容器中的文件是否正确构建"
    echo "2. Volume权限是否正确"
    echo "3. Nginx配置是否正确"
    exit 1
fi
