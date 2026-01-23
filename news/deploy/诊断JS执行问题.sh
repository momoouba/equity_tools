#!/bin/bash
# 诊断 JS 执行问题
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/诊断JS执行问题.sh

cd /opt/newsapp/news

echo "=========================================="
echo "诊断 JS 执行问题"
echo "=========================================="

echo ""
echo "步骤1: 检查 JS 文件大小和内容..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')

# 从 index.html 提取 JS 文件名
JS_FILE=$(grep -oP 'src="/assets/\K[^"]+' client/dist/index.html | head -1)
echo "JS文件名: $JS_FILE"

if [ -n "$JS_FILE" ]; then
    JS_SIZE=$(sudo stat -c%s "$VOLUME_PATH/assets/$JS_FILE" 2>/dev/null || echo "0")
    echo "JS文件大小: $JS_SIZE 字节"
    
    if [ "$JS_SIZE" -lt 1000 ]; then
        echo "⚠ 警告: JS文件异常小（应该至少几KB）"
    fi
    
    echo ""
    echo "JS文件前50行内容："
    sudo head -50 "$VOLUME_PATH/assets/$JS_FILE" 2>/dev/null || echo "无法读取文件"
    
    echo ""
    echo "JS文件后20行内容："
    sudo tail -20 "$VOLUME_PATH/assets/$JS_FILE" 2>/dev/null || echo "无法读取文件"
fi

echo ""
echo "步骤2: 检查 vendor 文件..."
echo "----------------------------------------"
echo "检查是否有空的 vendor 文件："
sudo ls -lh "$VOLUME_PATH/assets/" | grep -E "(vendor|chunk)"

echo ""
echo "步骤3: 检查构建配置..."
echo "----------------------------------------"
echo "查看 vite.config.js 中的构建配置："
grep -A 10 "manualChunks" client/vite.config.js 2>/dev/null || echo "无法读取配置"

echo ""
echo "步骤4: 检查是否有构建警告..."
echo "----------------------------------------"
echo "重新构建并查看完整输出："
cd client
echo "执行构建（查看详细输出）..."
npm run build 2>&1 | tail -30
cd ..

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "如果 JS 文件异常小（< 1KB），可能是构建配置问题"
echo "需要检查 vite.config.js 中的 manualChunks 配置"
