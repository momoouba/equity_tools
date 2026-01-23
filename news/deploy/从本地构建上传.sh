#!/bin/bash
# 从本地构建并上传到服务器
# 在本地 Windows PowerShell 中执行（需要先构建好 dist 目录）

echo "=========================================="
echo "从本地构建并上传到服务器"
echo "=========================================="

# 检查本地是否有 dist 目录
if [ ! -d "client/dist" ]; then
    echo "错误: 本地 client/dist 目录不存在"
    echo "请先在本地构建前端:"
    echo "  cd client"
    echo "  npm run build"
    exit 1
fi

echo ""
echo "步骤1: 检查本地构建文件..."
echo "----------------------------------------"
LOCAL_SIZE=$(stat -c%s client/dist/index.html 2>/dev/null || echo "0")
echo "本地 index.html 大小: $LOCAL_SIZE 字节"

if [ "$LOCAL_SIZE" -lt 1000 ]; then
    echo "⚠ 警告: 本地构建文件异常小，可能构建有问题"
fi

echo ""
echo "步骤2: 打包 dist 目录..."
echo "----------------------------------------"
cd client
tar -czf ../dist.tar.gz dist/
cd ..
echo "✓ 打包完成: dist.tar.gz"

echo ""
echo "=========================================="
echo "打包完成！"
echo "=========================================="
echo ""
echo "请执行以下步骤："
echo ""
echo "1. 将 dist.tar.gz 上传到服务器 /opt/newsapp/news/ 目录"
echo ""
echo "2. 在服务器上执行以下命令："
echo "   cd /opt/newsapp/news"
echo "   tar -xzf dist.tar.gz -C client/"
echo "   VOLUME_PATH=\$(docker volume inspect news_app_frontend | grep -i Mountpoint | awk '{print \$2}' | tr -d '\",')"
echo "   sudo rm -rf \"\$VOLUME_PATH\"/*"
echo "   sudo cp -r client/dist/* \"\$VOLUME_PATH/\""
echo "   docker compose restart nginx"
echo ""
