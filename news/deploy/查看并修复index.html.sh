#!/bin/bash
# 查看并修复 index.html
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/查看并修复index.html.sh

cd /opt/newsapp/news

echo "=========================================="
echo "查看并修复 index.html"
echo "=========================================="

echo ""
echo "步骤1: 查看当前 index.html 内容..."
echo "----------------------------------------"
cat client/dist/index.html

echo ""
echo "步骤2: 检查 assets 目录中的文件..."
echo "----------------------------------------"
ls -lh client/dist/assets/ | head -5

echo ""
echo "=========================================="
echo "问题分析"
echo "=========================================="
echo "当前 index.html 只有 487 字节，这是异常的。"
echo "正常的构建后的 index.html 应该包含对 assets 目录中文件的引用，"
echo "应该至少有 1KB 以上。"
echo ""
echo "需要从本地上传正确的 index.html 文件。"
echo ""
echo "请执行以下步骤："
echo "1. 在本地构建: cd client && npm run build"
echo "2. 使用 WinSCP 将 client/dist/index.html 上传到服务器 /opt/newsapp/news/client/dist/"
echo "3. 然后运行以下命令复制到 volume："
echo ""
echo "   VOLUME_PATH=\$(docker volume inspect news_app_frontend | grep -i Mountpoint | awk '{print \$2}' | tr -d '\",')"
echo "   sudo cp client/dist/index.html \"\$VOLUME_PATH/\""
echo "   docker compose restart nginx"
