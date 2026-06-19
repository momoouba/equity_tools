#!/bin/bash
# 修复循环依赖并重新构建
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/修复循环依赖并重新构建.sh

cd /opt/newsapp/news

echo "=========================================="
echo "修复循环依赖并重新构建"
echo "=========================================="

echo ""
echo "步骤1: 清理旧的构建文件..."
echo "----------------------------------------"
cd client
rm -rf dist node_modules/.vite
cd ..

echo ""
echo "步骤2: 重新构建前端..."
echo "----------------------------------------"
cd client
npm run build
cd ..

echo ""
echo "步骤3: 检查构建输出..."
echo "----------------------------------------"
echo "构建的文件："
ls -lh client/dist/assets/

echo ""
echo "检查是否有循环依赖警告..."
if ls client/dist/assets/*.js 1> /dev/null 2>&1; then
    echo "✓ JS 文件已生成"
    for file in client/dist/assets/*.js; do
        size=$(stat -c%s "$file" 2>/dev/null || echo "0")
        echo "  $(basename $file): $size 字节"
    done
else
    echo "✗ 没有生成 JS 文件"
fi

echo ""
echo "步骤4: 检查 index.html..."
echo "----------------------------------------"
cat client/dist/index.html

echo ""
echo "步骤5: 部署到 Docker volume..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "清空 volume..."
sudo rm -rf "$VOLUME_PATH"/*
echo "复制新构建的文件..."
sudo cp -r client/dist/* "$VOLUME_PATH/"
echo "验证文件..."
sudo ls -lh "$VOLUME_PATH/assets/"

echo ""
echo "步骤6: 重启 nginx..."
echo "----------------------------------------"
docker compose restart nginx

echo ""
echo "步骤7: 验证部署..."
echo "----------------------------------------"
echo "检查 nginx 中的文件："
docker compose exec nginx ls -lh /usr/share/nginx/html/assets/

echo ""
echo "检查 nginx 中的 index.html："
docker compose exec nginx cat /usr/share/nginx/html/index.html

echo ""
echo "=========================================="
echo "完成！"
echo "=========================================="
echo ""
echo "请执行以下操作："
echo "1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "2. 硬刷新页面（Ctrl+F5）"
echo "3. 检查浏览器控制台是否还有错误"
echo ""
echo "如果还有问题，请检查："
echo "- 浏览器控制台的错误信息"
echo "- Network 标签页中的文件加载顺序"
echo "- 确保 react-vendor.js 在 vendor.js 之前加载"
