#!/bin/bash
# 检查构建问题 - 诊断为什么构建后的文件异常小
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/检查构建问题.sh

cd /opt/newsapp/news

echo "=========================================="
echo "检查构建问题"
echo "=========================================="

echo ""
echo "1. 检查应用容器中的构建文件..."
echo "----------------------------------------"
docker compose exec app ls -la /app/client/dist/ 2>/dev/null | head -15

echo ""
echo "2. 检查应用容器中index.html的内容..."
echo "----------------------------------------"
APP_SIZE=$(docker compose exec -T app stat -c%s /app/client/dist/index.html 2>/dev/null || echo "0")
echo "文件大小: $APP_SIZE 字节"
echo ""
echo "文件内容："
docker compose exec -T app cat /app/client/dist/index.html

echo ""
echo "3. 检查assets目录..."
echo "----------------------------------------"
docker compose exec app ls -la /app/client/dist/assets/ 2>/dev/null | head -10 || echo "assets目录不存在或为空"

echo ""
echo "4. 检查构建日志（如果有）..."
echo "----------------------------------------"
echo "检查最近的构建输出..."

echo ""
echo "5. 尝试在容器内重新构建前端..."
echo "----------------------------------------"
echo "进入应用容器并检查构建环境..."
docker compose exec app sh -c "cd /app/client && ls -la && echo '---' && cat package.json | grep -A 2 scripts"

echo ""
echo "=========================================="
echo "诊断完成"
echo "=========================================="
echo ""
echo "如果index.html内容看起来正常（包含script标签），"
echo "但文件大小只有487字节，可能是："
echo "1. 构建过程被截断"
echo "2. 文件被错误覆盖"
echo "3. 需要检查构建日志"
