#!/bin/bash
# 检查并修复 index.html
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查并修复index.html.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查并修复 index.html"
echo "=========================================="

echo ""
echo "步骤1: 检查 client/dist 目录..."
echo "----------------------------------------"
ls -la client/dist/ 2>/dev/null | head -10

echo ""
echo "步骤2: 检查 index.html..."
echo "----------------------------------------"
if [ -f "client/dist/index.html" ]; then
    SIZE=$(stat -c%s client/dist/index.html 2>/dev/null || echo "0")
    echo "index.html 存在，大小: $SIZE 字节"
    if [ "$SIZE" -ge 1000 ]; then
        echo "✓ index.html 大小正常"
        echo "文件内容预览："
        head -15 client/dist/index.html
    else
        echo "⚠ 警告: index.html 异常小，需要重新上传"
        echo "当前内容："
        cat client/dist/index.html
    fi
else
    echo "✗ index.html 不存在"
    echo ""
    echo "需要从本地上传 index.html 文件"
    echo ""
    echo "请执行以下步骤："
    echo "1. 在本地构建: cd client && npm run build"
    echo "2. 使用 WinSCP 将 client/dist/index.html 上传到服务器 /opt/newsapp/news/client/dist/"
    echo "3. 然后重新运行此脚本"
    exit 1
fi

echo ""
echo "步骤3: 检查 assets 目录..."
echo "----------------------------------------"
if [ -d "client/dist/assets" ]; then
    echo "✓ assets 目录存在"
    ASSETS_COUNT=$(find client/dist/assets -type f 2>/dev/null | wc -l)
    echo "assets 中有 $ASSETS_COUNT 个文件"
    ls -lh client/dist/assets/ | head -5
else
    echo "✗ assets 目录不存在"
fi

echo ""
echo "步骤4: 如果 index.html 正常，复制到 volume..."
echo "----------------------------------------"
if [ -f "client/dist/index.html" ]; then
    SIZE=$(stat -c%s client/dist/index.html 2>/dev/null || echo "0")
    if [ "$SIZE" -ge 1000 ]; then
        VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
        echo "Volume路径: $VOLUME_PATH"
        
        echo "清空volume并复制文件..."
        sudo rm -rf "$VOLUME_PATH"/*
        sudo cp -r client/dist/* "$VOLUME_PATH/"
        
        echo "验证..."
        VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
        echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"
        
        if [ "$VOLUME_SIZE" -ge 1000 ]; then
            echo "✓ 复制成功"
            
            echo "重启nginx..."
            docker compose restart nginx
            sleep 3
            
            echo "最终验证..."
            NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
            echo "Nginx中 index.html 大小: $NGINX_SIZE 字节"
            
            if [ "$NGINX_SIZE" -ge 1000 ]; then
                echo ""
                echo "=========================================="
                echo "✓ 修复成功！"
                echo "=========================================="
                echo "请清除浏览器缓存并刷新页面"
            else
                echo "✗ Nginx中的文件仍然异常小"
            fi
        else
            echo "✗ 复制失败"
        fi
    else
        echo "⚠ index.html 太小，需要重新上传"
    fi
fi
