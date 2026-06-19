#!/bin/bash
# 在服务器上构建前端并部署
# 在服务器上执行: cd /opt/newsapp/news && bash deploy/在服务器上构建前端.sh

set -e

cd /opt/newsapp/news

echo "=========================================="
echo "在服务器上构建前端"
echo "=========================================="

echo ""
echo "步骤1: 检查 Node.js 环境..."
echo "----------------------------------------"
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)
    echo "✓ Node.js 已安装: $NODE_VERSION"
    echo "✓ npm 已安装: $NPM_VERSION"
else
    echo "✗ Node.js 未安装"
    echo ""
    echo "需要安装 Node.js，可以使用以下方法："
    echo ""
    echo "方法1: 使用 nvm 安装（推荐）"
    echo "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
    echo "  source ~/.bashrc"
    echo "  nvm install 18"
    echo "  nvm use 18"
    echo ""
    echo "方法2: 使用 apt 安装"
    echo "  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    echo ""
    echo "方法3: 在应用容器内构建（如果服务器没有 Node.js）"
    echo "  使用 deploy/在容器内构建前端.sh 脚本"
    exit 1
fi

echo ""
echo "步骤2: 检查前端源代码..."
echo "----------------------------------------"
if [ ! -d "client" ]; then
    echo "✗ client 目录不存在"
    exit 1
fi

if [ ! -f "client/package.json" ]; then
    echo "✗ client/package.json 不存在"
    exit 1
fi

echo "✓ 前端源代码存在"

echo ""
echo "步骤3: 安装前端依赖..."
echo "----------------------------------------"
cd client

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "安装依赖（首次构建）..."
    npm install
else
    echo "依赖已存在，跳过安装"
fi

echo ""
echo "步骤4: 构建前端..."
echo "----------------------------------------"
echo "开始构建（这可能需要几分钟）..."
npm run build

echo ""
echo "步骤5: 检查构建结果..."
echo "----------------------------------------"
if [ ! -d "dist" ]; then
    echo "✗ 构建失败，dist 目录不存在"
    exit 1
fi

if [ ! -f "dist/index.html" ]; then
    echo "✗ 构建失败，index.html 不存在"
    exit 1
fi

INDEX_SIZE=$(stat -c%s dist/index.html 2>/dev/null || echo "0")
echo "✓ 构建成功"
echo "  index.html 大小: $INDEX_SIZE 字节"

if [ ! -d "dist/assets" ]; then
    echo "⚠ 警告: assets 目录不存在"
else
    ASSETS_COUNT=$(find dist/assets -type f 2>/dev/null | wc -l)
    echo "  assets 目录中有 $ASSETS_COUNT 个文件"
    ls -lh dist/assets/ | head -5
fi

cd ..

echo ""
echo "步骤6: 复制构建文件到 volume..."
echo "----------------------------------------"
VOLUME_PATH=$(docker volume inspect news_app_frontend | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",')
echo "Volume路径: $VOLUME_PATH"

echo "清空volume并复制文件..."
sudo rm -rf "$VOLUME_PATH"/*
sudo cp -r client/dist/* "$VOLUME_PATH/"

echo ""
echo "步骤7: 验证复制结果..."
echo "----------------------------------------"
VOLUME_SIZE=$(sudo stat -c%s "$VOLUME_PATH/index.html" 2>/dev/null || echo "0")
echo "Volume中 index.html 大小: $VOLUME_SIZE 字节"

if [ "$VOLUME_SIZE" -lt 1000 ]; then
    echo "⚠ 警告: index.html 异常小"
fi

if [ -d "$VOLUME_PATH/assets" ]; then
    ASSETS_COUNT=$(sudo find "$VOLUME_PATH/assets" -type f 2>/dev/null | wc -l)
    echo "✓ assets目录中有 $ASSETS_COUNT 个文件"
    sudo ls -lh "$VOLUME_PATH/assets" | head -5
fi

echo ""
echo "步骤8: 重启 nginx..."
echo "----------------------------------------"
docker compose restart nginx
sleep 3

echo ""
echo "步骤9: 最终验证..."
echo "----------------------------------------"
NGINX_SIZE=$(docker compose exec -T nginx stat -c%s /usr/share/nginx/html/index.html 2>/dev/null || echo "0")
echo "Nginx容器中 index.html 大小: $NGINX_SIZE 字节"

if [ "$NGINX_SIZE" -ge 1000 ]; then
    echo ""
    echo "=========================================="
    echo "✓ 构建和部署成功！"
    echo "=========================================="
    echo ""
    echo "文件大小对比："
    echo "  本地构建: $INDEX_SIZE 字节"
    echo "  Volume:   $VOLUME_SIZE 字节"
    echo "  Nginx:    $NGINX_SIZE 字节"
    echo ""
    echo "请清除浏览器缓存并刷新页面"
else
    echo ""
    echo "=========================================="
    echo "⚠ 警告: Nginx中的文件仍然异常小"
    echo "=========================================="
    echo "请检查文件是否正确复制"
fi
