#!/bin/bash
# 检查 dist 目录内容
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查dist目录.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查 dist 目录"
echo "=========================================="

echo ""
echo "1. 检查 client/dist 目录是否存在..."
echo "----------------------------------------"
if [ -d "client/dist" ]; then
    echo "✓ client/dist 目录存在"
    echo ""
    echo "2. 列出目录内容..."
    echo "----------------------------------------"
    ls -la client/dist/
    echo ""
    echo "3. 检查是否有 index.html..."
    echo "----------------------------------------"
    if [ -f "client/dist/index.html" ]; then
        SIZE=$(stat -c%s client/dist/index.html 2>/dev/null || echo "0")
        echo "index.html 存在，大小: $SIZE 字节"
        if [ "$SIZE" -lt 1000 ]; then
            echo "⚠ 警告: 文件异常小"
            echo "文件内容："
            head -20 client/dist/index.html
        fi
    else
        echo "✗ index.html 不存在"
    fi
    echo ""
    echo "4. 检查 assets 目录..."
    echo "----------------------------------------"
    if [ -d "client/dist/assets" ]; then
        echo "✓ assets 目录存在"
        echo "文件列表："
        ls -lh client/dist/assets/ | head -10
    else
        echo "✗ assets 目录不存在"
    fi
else
    echo "✗ client/dist 目录不存在"
fi

echo ""
echo "=========================================="
echo "检查完成"
echo "=========================================="
echo ""
echo "如果 index.html 不存在或异常小，需要从本地上传新的构建文件"
