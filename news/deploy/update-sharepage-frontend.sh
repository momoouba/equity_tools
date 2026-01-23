#!/bin/bash

# 更新 ShareNewsPage 前端文件到 Docker 环境
# 使用方法: ./deploy/update-sharepage-frontend.sh
# 说明: 此脚本用于在服务器上更新 ShareNewsPage.jsx 和 ShareNewsPage.css 后，重新构建并部署到 Docker

set -e

echo "=========================================="
echo "更新 ShareNewsPage 前端到 Docker 环境"
echo "=========================================="
echo ""

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ 错误: 请在项目根目录（news目录）执行此脚本"
    exit 1
fi

# 进入项目目录
cd "$(dirname "$0")/.." || exit

echo "步骤 1: 检查前端代码文件"
echo "----------------------------------------"
if [ ! -f "client/src/pages/ShareNewsPage.jsx" ] || [ ! -f "client/src/pages/ShareNewsPage.css" ]; then
    echo "❌ 错误: 找不到 ShareNewsPage.jsx 或 ShareNewsPage.css 文件"
    exit 1
fi
echo "✓ 找到前端代码文件"
echo "  - ShareNewsPage.jsx: $(ls -lh client/src/pages/ShareNewsPage.jsx | awk '{print $6, $7, $8}')"
echo "  - ShareNewsPage.css: $(ls -lh client/src/pages/ShareNewsPage.css | awk '{print $6, $7, $8}')"

echo ""
echo "步骤 2: 检查系统资源"
echo "----------------------------------------"
# 检查当前内存使用情况
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
AVAIL_MEM=$(free -m | awk '/^Mem:/{print $7}')
USED_MEM=$(free -m | awk '/^Mem:/{print $3}')
MEM_PERCENT=$((USED_MEM * 100 / TOTAL_MEM))

echo "系统内存: ${TOTAL_MEM}MB 总计, ${AVAIL_MEM}MB 可用, ${USED_MEM}MB 已用 (${MEM_PERCENT}%)"

# 如果内存使用超过80%，警告用户
if [ $MEM_PERCENT -gt 80 ]; then
    echo "⚠️  警告: 系统内存使用率较高 (${MEM_PERCENT}%)，建议清理后再构建"
    read -p "是否继续构建？(y/n，默认n): " continue_build
    if [ "$continue_build" != "y" ] && [ "$continue_build" != "Y" ]; then
        echo "构建已取消"
        exit 1
    fi
fi

# 检查是否有其他构建进程在运行
EXISTING_BUILD=$(ps aux | grep -E "vite build|npm run build" | grep -v grep | wc -l)
if [ $EXISTING_BUILD -gt 0 ]; then
    echo "⚠️  检测到其他构建进程正在运行，等待其完成..."
    # 等待最多60秒
    for i in {1..60}; do
        sleep 1
        EXISTING_BUILD=$(ps aux | grep -E "vite build|npm run build" | grep -v grep | wc -l)
        if [ $EXISTING_BUILD -eq 0 ]; then
            echo "✓ 其他构建进程已完成"
            break
        fi
        if [ $i -eq 60 ]; then
            echo "❌ 超时：其他构建进程仍在运行，请手动终止后再试"
            exit 1
        fi
    done
fi

echo ""
echo "步骤 3: 重新构建前端"
echo "----------------------------------------"
cd client

# 检查 node_modules 是否存在
if [ ! -d "node_modules" ]; then
    echo "⚠️  node_modules 不存在，正在安装依赖..."
    npm install
fi

# 清理旧的构建文件
if [ -d "dist" ]; then
    echo "清理旧的构建文件..."
    rm -rf dist
fi

# 清理缓存
echo "清理构建缓存..."
rm -rf node_modules/.vite 2>/dev/null || true

# 根据可用内存动态调整内存限制
if [ $AVAIL_MEM -lt 2048 ]; then
    MEMORY_LIMIT=1536
    BUILD_CMD="npm run build:low-memory"
    echo "⚠️  可用内存不足，使用低内存构建模式 (${MEMORY_LIMIT}MB)"
elif [ $AVAIL_MEM -lt 3072 ]; then
    MEMORY_LIMIT=2048
    BUILD_CMD="npm run build"
    echo "使用标准构建模式 (${MEMORY_LIMIT}MB)"
else
    MEMORY_LIMIT=2048
    BUILD_CMD="npm run build"
    echo "使用标准构建模式 (${MEMORY_LIMIT}MB)"
fi

echo "正在构建前端（内存限制: ${MEMORY_LIMIT}MB）..."
# 设置 Node.js 内存限制
export NODE_OPTIONS="--max-old-space-size=${MEMORY_LIMIT}"
# 限制 CPU 使用（通过 nice 降低优先级）
nice -n 10 $BUILD_CMD

if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败，请检查错误信息"
    echo "提示: 如果内存不足，可以尝试: npm run build:minimal"
    exit 1
fi

cd ..
echo "✓ 前端构建完成"

echo ""
echo "步骤 3: 查找并更新 Docker volume"
echo "----------------------------------------"
VOLUME_NAME="news_app_frontend"

# 查找volume的实际路径
VOLUME_PATH=$(docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -n "$VOLUME_PATH" ]; then
    echo "Volume路径: $VOLUME_PATH"
    echo "正在复制前端文件到volume..."
    
    # 复制文件（需要 sudo 权限）
    if sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null; then
        echo "✓ 文件已复制到volume"
    else
        echo "⚠️  直接复制失败，尝试使用临时容器..."
        USE_TEMP_CONTAINER=true
    fi
else
    echo "⚠️  无法找到volume路径，使用临时容器复制"
    USE_TEMP_CONTAINER=true
fi

# 如果直接复制失败，使用临时容器
if [ "${USE_TEMP_CONTAINER}" = "true" ]; then
    echo "使用临时容器复制文件..."
    
    # 尝试使用 news-app 镜像（如果存在）
    if docker images | grep -q "news-app"; then
        TEMP_CONTAINER=$(docker run -d --name temp-sharepage-update-$(date +%s) \
            -v ${VOLUME_NAME}:/target \
            news-app sleep 300 2>/dev/null) || TEMP_CONTAINER=""
    else
        # 如果 news-app 镜像不存在，尝试使用 alpine
        TEMP_CONTAINER=$(docker run -d --name temp-sharepage-update-$(date +%s) \
            -v ${VOLUME_NAME}:/target \
            alpine sleep 300 2>/dev/null) || TEMP_CONTAINER=""
    fi
    
    if [ -n "$TEMP_CONTAINER" ]; then
        docker cp client/dist/. ${TEMP_CONTAINER}:/target/ && \
        echo "✓ 文件已通过临时容器复制到volume" || \
        echo "❌ 复制失败"
        docker rm -f ${TEMP_CONTAINER} 2>/dev/null || true
    else
        echo "❌ 无法创建临时容器，请检查 Docker 环境"
        exit 1
    fi
fi

echo ""
echo "步骤 4: 重启 Nginx 服务"
echo "----------------------------------------"
if docker compose ps nginx | grep -q "Up"; then
    echo "正在重启 Nginx..."
    docker compose restart nginx
    echo "✓ Nginx 已重启"
else
    echo "⚠️  Nginx 容器未运行，正在启动..."
    docker compose up -d nginx
    sleep 3
    echo "✓ Nginx 已启动"
fi

echo ""
echo "步骤 5: 验证更新"
echo "----------------------------------------"
echo "检查 volume 中的文件修改时间:"
if docker compose exec -T nginx test -f /usr/share/nginx/html/index.html 2>/dev/null; then
    docker compose exec -T nginx ls -lh /usr/share/nginx/html/index.html | awk '{print "  index.html: " $6, $7, $8, $9}'
    echo "✓ 前端文件已部署到 Nginx"
else
    echo "⚠️  无法验证，请手动检查"
fi

echo ""
echo "=========================================="
echo "更新完成！"
echo "=========================================="
echo ""
echo "重要提示:"
echo "  1. 清除浏览器缓存（Ctrl+Shift+R 或 Cmd+Shift+R）"
echo "  2. 如果仍然看到旧页面，尝试无痕模式访问"
echo "  3. 检查关键词列是否垂直显示且不省略"
echo ""
echo "验证命令:"
echo "  docker compose exec nginx ls -lh /usr/share/nginx/html/assets/ | grep ShareNewsPage"
echo ""
