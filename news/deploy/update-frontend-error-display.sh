#!/bin/bash

# 更新前端错误信息显示
# 使用方法: ./deploy/update-frontend-error-display.sh

set -e

echo "=========================================="
echo "更新前端错误信息显示"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo ""
echo "步骤 1: 重新构建前端"
echo "----------------------------------------"
cd client
echo "正在构建前端..."
npm run build
cd ..
echo "✓ 前端构建完成"

echo ""
echo "步骤 2: 更新前端文件到 Docker Volume"
echo "----------------------------------------"

# 查找volume名称 - 从docker-compose.yml中获取
VOLUME_NAME=$(grep -A 1 "app_frontend:" docker-compose.yml 2>/dev/null | grep -v "app_frontend:" | head -1 | awk '{print $1}' | tr -d ':' || echo "")

# 如果没找到，尝试常见的volume名称
if [ -z "$VOLUME_NAME" ]; then
  for name in "newsapp_app_frontend" "news_app_frontend" "app_frontend"; do
    if sudo docker volume inspect "$name" >/dev/null 2>&1; then
      VOLUME_NAME="$name"
      break
    fi
  done
fi

if [ -z "$VOLUME_NAME" ]; then
  # 从docker compose config中获取
  VOLUME_NAME=$(sudo docker compose config 2>/dev/null | grep -A 1 "app_frontend:" | grep "driver:" | head -1 | awk '{print $1}' | tr -d ':' || echo "newsapp_app_frontend")
fi

echo "Volume名称: $VOLUME_NAME"

# 方法1：尝试直接查找volume路径并复制（不需要拉取镜像）
VOLUME_PATH=$(sudo docker volume inspect "$VOLUME_NAME" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -n "$VOLUME_PATH" ]; then
  echo "Volume路径: $VOLUME_PATH"
  echo "正在复制前端文件到volume..."
  sudo rm -rf "$VOLUME_PATH"/*
  sudo cp -r client/dist/* "$VOLUME_PATH/"
  echo "✓ 前端文件已复制到volume"
else
  echo "⚠ 无法找到volume路径，尝试使用docker cp直接覆盖文件"
  
  # 方法2：使用docker cp直接覆盖文件到app容器（app容器有读写权限）
  if sudo docker ps | grep -q "newsapp"; then
    echo "使用docker cp直接覆盖app容器中的文件..."
    # app容器中/app/client/dist是挂载的volume，有读写权限
    sudo docker cp client/dist/. newsapp:/app/client/dist/
    echo "✓ 前端文件已复制到app容器（会自动同步到nginx）"
  elif sudo docker ps | grep -q "newsapp-nginx"; then
    echo "使用docker cp直接覆盖nginx容器中的文件..."
    # nginx容器是只读挂载，但docker cp可以覆盖文件（不需要先删除）
    sudo docker cp client/dist/. newsapp-nginx:/usr/share/nginx/html/
    echo "✓ 前端文件已复制到nginx容器"
  else
    echo "❌ 错误: 无法找到volume路径，且容器未运行"
    echo ""
    echo "请尝试以下方法："
    echo "1. 手动查找volume路径:"
    echo "   sudo docker volume ls"
    echo "   sudo docker volume inspect newsapp_app_frontend"
    echo ""
    echo "2. 如果找到路径，手动复制:"
    echo "   VOLUME_PATH=\$(sudo docker volume inspect newsapp_app_frontend | grep Mountpoint | awk '{print \$2}' | tr -d '\",')"
    echo "   sudo rm -rf \"\$VOLUME_PATH\"/*"
    echo "   sudo cp -r client/dist/* \"\$VOLUME_PATH/\""
    echo ""
    echo "3. 重新构建镜像:"
    echo "   sudo docker compose build app"
    echo "   sudo docker compose up -d"
    exit 1
  fi
fi

echo ""
echo "步骤 3: 重启Nginx容器（前端由Nginx服务）"
echo "----------------------------------------"
sudo docker compose restart nginx

echo ""
echo "步骤 4: 等待服务启动"
echo "----------------------------------------"
sleep 3

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "重要提示："
echo "1. 请在浏览器中按 Ctrl+Shift+Delete 清除缓存"
echo "2. 或者按 Ctrl+F5 强制刷新页面"
echo "3. 或者在开发者工具中右键刷新按钮，选择'清空缓存并硬性重新加载'"
echo ""
echo "验证步骤："
echo "1. 打开定时任务管理页面"
echo "2. 点击某个新闻接口配置的'日志'按钮"
echo "3. 点击'接口详情'按钮"
echo "4. 在'错误数量'下面应该能看到详细的错误信息列表"
echo ""

