#!/bin/bash

# 快速更新前端文件（使用已存在的镜像）
# 使用方法: ./deploy/快速更新前端.sh

set -e

VOLUME_NAME="news_app_frontend"

echo "=========================================="
echo "快速更新前端文件"
echo "=========================================="
echo ""

# 检查前端构建产物
if [ ! -d "client/dist" ]; then
    echo "错误: client/dist 目录不存在"
    exit 1
fi

echo "✓ 前端构建产物检查通过"
echo ""

# 清理旧容器
echo "清理旧容器..."
sudo docker rm -f temp-frontend-update 2>/dev/null || true
echo "✓ 旧容器已清理"
echo ""

# 选择镜像（优先使用nginx:alpine，因为通常已存在）
if sudo docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^nginx:alpine$"; then
    IMAGE="nginx:alpine"
    echo "使用镜像: nginx:alpine（已存在）"
elif sudo docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^alpine:latest$"; then
    IMAGE="alpine:latest"
    echo "使用镜像: alpine:latest（已存在）"
else
    IMAGE="alpine:latest"
    echo "使用镜像: alpine:latest（需要下载，请稍候）..."
fi
echo ""

# 创建临时容器
echo "创建临时容器..."
TEMP_CONTAINER_OUTPUT=$(sudo docker run -d --name temp-frontend-update -v ${VOLUME_NAME}:/target ${IMAGE} sleep 3600 2>&1)
TEMP_CONTAINER_ID=$(echo "$TEMP_CONTAINER_OUTPUT" | tail -1 | grep -oE '^[a-f0-9]{12,64}$' || echo "")

# 等待容器启动
sleep 3

# 检查容器是否运行
if sudo docker ps | grep -q temp-frontend-update; then
    echo "✓ 临时容器已创建并运行"
    TEMP_CONTAINER_ID=$(sudo docker ps | grep temp-frontend-update | awk '{print $1}')
    echo "  容器ID: $TEMP_CONTAINER_ID"
else
    echo "✗ 容器创建失败或未运行"
    echo "错误输出: $TEMP_CONTAINER_OUTPUT"
    echo ""
    echo "检查容器状态:"
    sudo docker ps -a | grep temp-frontend-update || echo "容器不存在"
    exit 1
fi
echo ""

# 清空目标目录
echo "清空目标目录..."
if sudo docker exec temp-frontend-update sh -c "rm -rf /target/* /target/.* 2>/dev/null || true"; then
    echo "✓ 目标目录已清空"
else
    echo "⚠️  清空目录时出现警告（可能目录为空）"
fi
echo ""

# 复制文件
echo "复制前端文件..."
if sudo docker cp client/dist/. temp-frontend-update:/target/ 2>&1; then
    echo "✓ 文件复制命令执行成功"
else
    echo "✗ 文件复制失败"
    sudo docker rm -f temp-frontend-update
    exit 1
fi
echo ""

# 验证
echo "验证文件..."
FILE_COUNT=$(sudo docker exec temp-frontend-update sh -c "ls -1 /target/ 2>/dev/null | wc -l" 2>/dev/null || echo "0")
if [ "$FILE_COUNT" -gt "0" ]; then
    echo "✓ 已复制 $FILE_COUNT 个文件/目录"
    echo ""
    echo "前5个文件/目录:"
    sudo docker exec temp-frontend-update sh -c "ls -lh /target/ 2>/dev/null | head -6" || true
else
    echo "⚠️  警告: 目标目录为空，但继续执行..."
fi
echo ""

# 清理
echo "清理临时容器..."
if sudo docker rm -f temp-frontend-update 2>&1; then
    echo "✓ 临时容器已清理"
else
    echo "⚠️  清理容器时出现警告"
fi
echo ""

# 重启应用
echo "重启应用容器..."
if sudo docker compose restart app 2>&1; then
    echo "✓ 应用容器重启命令已执行"
else
    echo "✗ 应用容器重启失败"
    exit 1
fi
echo ""

echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "后续操作:"
echo "  1. 等待30秒让应用完全启动"
echo "  2. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  3. 强制刷新页面（Ctrl+F5）"
echo "  4. 测试退出状态下拉菜单，确认'不再观察'选项显示"
echo ""
echo "检查应用状态:"
echo "  sudo docker compose ps app"
echo "  curl http://localhost:3001/api/health"
echo ""

