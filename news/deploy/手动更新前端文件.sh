#!/bin/bash

# 手动更新前端文件到Docker volume
# 使用方法: ./deploy/手动更新前端文件.sh

set -e

echo "=========================================="
echo "手动更新前端文件到Docker volume"
echo "=========================================="
echo ""

# 设置volume名称
VOLUME_NAME="news_app_frontend"

echo "使用volume名称: $VOLUME_NAME"
echo ""

# 检查volume是否存在
if ! sudo docker volume inspect ${VOLUME_NAME} >/dev/null 2>&1; then
    echo "Volume不存在，正在创建..."
    sudo docker volume create ${VOLUME_NAME}
    echo "✓ Volume已创建"
else
    echo "✓ Volume已存在"
fi
echo ""

# 检查前端构建产物
if [ ! -d "client/dist" ]; then
    echo "错误: client/dist 目录不存在，请先构建前端"
    echo "执行: cd client && npm run build && cd .."
    exit 1
fi

echo "前端构建产物检查:"
ls -lh client/dist/ | head -5
echo ""

# 清理可能存在的旧容器
echo "清理旧容器..."
sudo docker rm -f temp-frontend-update 2>/dev/null || true
echo ""

# 创建临时容器
echo "创建临时容器..."
TEMP_CONTAINER=$(sudo docker run -d --name temp-frontend-update -v ${VOLUME_NAME}:/target alpine sleep 3600)
echo "✓ 临时容器已创建: $TEMP_CONTAINER"
echo ""

# 等待容器启动
sleep 2

# 检查容器是否运行
if ! sudo docker ps | grep -q temp-frontend-update; then
    echo "错误: 临时容器未运行"
    sudo docker ps -a | grep temp-frontend-update
    exit 1
fi

# 清空目标目录
echo "清空目标目录..."
sudo docker exec temp-frontend-update sh -c "rm -rf /target/* /target/.* 2>/dev/null || true"
echo "✓ 目标目录已清空"
echo ""

# 复制文件
echo "复制前端文件..."
if sudo docker cp client/dist/. temp-frontend-update:/target/; then
    echo "✓ 文件复制成功"
else
    echo "✗ 文件复制失败"
    sudo docker rm -f temp-frontend-update
    exit 1
fi
echo ""

# 验证文件
echo "验证文件..."
FILE_COUNT=$(sudo docker exec temp-frontend-update sh -c "ls -1 /target/ | wc -l" 2>/dev/null || echo "0")
echo "目标目录中的文件/目录数: $FILE_COUNT"

if [ "$FILE_COUNT" -gt "0" ]; then
    echo "✓ 文件验证成功"
    echo ""
    echo "前5个文件/目录:"
    sudo docker exec temp-frontend-update sh -c "ls -lh /target/ | head -6"
else
    echo "⚠️  警告: 目标目录为空"
fi
echo ""

# 清理临时容器
echo "清理临时容器..."
sudo docker rm -f temp-frontend-update
echo "✓ 临时容器已清理"
echo ""

# 重启应用
echo "重启应用容器..."
sudo docker compose restart app
echo "✓ 应用容器已重启"
echo ""

echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "请等待30秒后："
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  2. 强制刷新页面（Ctrl+F5）"
echo "  3. 测试退出状态下拉菜单"
echo ""

