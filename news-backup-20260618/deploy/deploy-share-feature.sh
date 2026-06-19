#!/bin/bash

# 舆情信息公共链接分享功能部署脚本
# 功能：部署分享链接功能的所有更新（前端+后端）
# 使用方法: ./deploy/deploy-share-feature.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}舆情信息公共链接分享功能部署${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目根目录
cd "$(dirname "$0")/.." || exit
PROJECT_ROOT=$(pwd)
echo "项目根目录: $PROJECT_ROOT"
echo ""

# 步骤 1: 检查必要文件
echo -e "${CYAN}=== 步骤 1: 检查必要文件 ===${NC}"

REQUIRED_FILES=(
    "server/routes/newsShare.js"
    "server/index.js"
    "client/src/pages/ShareNewsPage.jsx"
    "client/src/pages/ShareNewsPage.css"
    "client/src/pages/NewsInfo.jsx"
    "client/src/App.jsx"
    "client/src/utils/axios.js"
)

MISSING_FILES=()
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ 找到文件: $file${NC}"
    else
        echo -e "${RED}✗ 文件不存在: $file${NC}"
        MISSING_FILES+=("$file")
    fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    echo -e "${RED}错误: 以下文件缺失，请确保所有文件已更新${NC}"
    for file in "${MISSING_FILES[@]}"; do
        echo "  - $file"
    done
    exit 1
fi

echo ""

# 步骤 2: 备份当前代码
echo -e "${CYAN}=== 步骤 2: 备份当前代码 ===${NC}"
BACKUP_DIR="backups/share-feature-$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 备份后端文件
mkdir -p "$BACKUP_DIR/server/routes"
if [ -f "server/routes/newsShare.js" ]; then
    cp "server/routes/newsShare.js" "$BACKUP_DIR/server/routes/" 2>/dev/null || true
fi
if [ -f "server/index.js" ]; then
    cp "server/index.js" "$BACKUP_DIR/server/" 2>/dev/null || true
fi

# 备份前端文件
mkdir -p "$BACKUP_DIR/client/src/pages"
mkdir -p "$BACKUP_DIR/client/src/utils"
if [ -f "client/src/pages/ShareNewsPage.jsx" ]; then
    cp "client/src/pages/ShareNewsPage.jsx" "$BACKUP_DIR/client/src/pages/" 2>/dev/null || true
fi
if [ -f "client/src/pages/ShareNewsPage.css" ]; then
    cp "client/src/pages/ShareNewsPage.css" "$BACKUP_DIR/client/src/pages/" 2>/dev/null || true
fi
if [ -f "client/src/pages/NewsInfo.jsx" ]; then
    cp "client/src/pages/NewsInfo.jsx" "$BACKUP_DIR/client/src/pages/" 2>/dev/null || true
fi
if [ -f "client/src/App.jsx" ]; then
    cp "client/src/App.jsx" "$BACKUP_DIR/client/src/" 2>/dev/null || true
fi
if [ -f "client/src/utils/axios.js" ]; then
    cp "client/src/utils/axios.js" "$BACKUP_DIR/client/src/utils/" 2>/dev/null || true
fi

echo -e "${GREEN}✓ 备份完成: $BACKUP_DIR${NC}"
echo ""

# 步骤 3: 构建前端
echo -e "${CYAN}=== 步骤 3: 构建前端 ===${NC}"
cd "$PROJECT_ROOT/client"

# 检查node_modules和package.json
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ 错误: package.json 不存在${NC}"
    exit 1
fi

# 检查node_modules，如果不存在或@arco-design/web-react缺失，则安装依赖
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@arco-design/web-react" ]; then
    echo -e "${YELLOW}⚠  node_modules 不存在或依赖不完整，正在安装依赖...${NC}"
    echo "这可能需要几分钟时间，请耐心等待..."
    
    # 配置npm使用国内镜像源（如果在中国）
    npm config set registry https://registry.npmmirror.com || true
    npm config set fetch-timeout 300000 || true
    npm config set fetch-retries 5 || true
    
    # 安装依赖
    npm install
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ 错误: npm install 失败${NC}"
        echo "请检查网络连接和npm配置"
        exit 1
    fi
    
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
else
    echo -e "${GREEN}✓ node_modules 已存在${NC}"
fi

echo "正在构建前端..."
npm run build

if [ ! -d "dist" ]; then
    echo -e "${RED}❌ 错误: 构建失败，dist目录不存在${NC}"
    exit 1
fi

echo -e "${GREEN}✓ 前端构建完成${NC}"
echo ""

cd "$PROJECT_ROOT"

# 步骤 4: 更新前端文件到Docker volume
echo -e "${CYAN}=== 步骤 4: 更新前端文件到Docker volume ===${NC}"

# 查找volume名称
VOLUME_NAMES=(
    "$(basename $(pwd))_app_frontend"
    "newsapp_app_frontend"
    "news_app_frontend"
    "app_frontend"
)

VOLUME_NAME=""
VOLUME_PATH=""

for vol_name in "${VOLUME_NAMES[@]}"; do
    VOLUME_PATH=$(sudo docker volume inspect "$vol_name" 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$VOLUME_PATH" ]; then
        VOLUME_NAME="$vol_name"
        echo -e "${GREEN}✓ 找到volume: $VOLUME_NAME${NC}"
        echo "  Volume路径: $VOLUME_PATH"
        break
    fi
done

if [ -z "$VOLUME_NAME" ]; then
    # 从docker-compose.yml读取
    VOLUME_NAME=$(grep -A 1 "app_frontend:" docker-compose.yml | grep "driver: local" -B 1 | head -1 | awk '{print $1}' | tr -d ':' || echo "newsapp_app_frontend")
    echo -e "${YELLOW}⚠  使用默认volume名称: $VOLUME_NAME${NC}"
fi

# 使用临时容器更新文件
echo "正在创建临时容器更新前端文件..."
TEMP_CONTAINER="temp-frontend-update-$(date +%s)"

# 清理可能存在的旧容器
sudo docker rm -f "$TEMP_CONTAINER" 2>/dev/null || true

# 尝试拉取alpine镜像（如果不存在）
if ! sudo docker images | grep -q "alpine"; then
    echo "正在拉取alpine镜像..."
    # 尝试使用官方源
    sudo docker pull alpine:latest || {
        echo -e "${YELLOW}⚠  无法拉取alpine镜像，尝试直接操作volume路径...${NC}"
        # 备用方案：直接操作volume路径
        if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
            echo "使用直接路径方式更新文件..."
            sudo rm -rf "$VOLUME_PATH"/*
            sudo rm -rf "$VOLUME_PATH"/.[!.]* "$VOLUME_PATH"/..?* 2>/dev/null || true
            sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
            sudo chown -R root:root "$VOLUME_PATH" 2>/dev/null || true
            sudo chmod -R 755 "$VOLUME_PATH" 2>/dev/null || true
            echo -e "${GREEN}✓ 前端文件已更新到Docker volume（直接路径方式）${NC}"
            SKIP_CONTAINER_UPDATE=true
        else
            echo -e "${RED}❌ 错误: 无法访问volume路径${NC}"
            exit 1
        fi
    }
fi

if [ "$SKIP_CONTAINER_UPDATE" != "true" ]; then
    # 创建临时容器
    echo "正在创建临时容器..."
    sudo docker run -d --name "$TEMP_CONTAINER" -v "$VOLUME_NAME":/target alpine sleep 3600 || {
        echo -e "${YELLOW}⚠  创建临时容器失败，尝试直接操作volume路径...${NC}"
        # 备用方案：直接操作volume路径
        if [ -n "$VOLUME_PATH" ] && [ -d "$VOLUME_PATH" ]; then
            echo "使用直接路径方式更新文件..."
            sudo rm -rf "$VOLUME_PATH"/*
            sudo rm -rf "$VOLUME_PATH"/.[!.]* "$VOLUME_PATH"/..?* 2>/dev/null || true
            sudo cp -r "$PROJECT_ROOT/client/dist"/* "$VOLUME_PATH/"
            sudo chown -R root:root "$VOLUME_PATH" 2>/dev/null || true
            sudo chmod -R 755 "$VOLUME_PATH" 2>/dev/null || true
            echo -e "${GREEN}✓ 前端文件已更新到Docker volume（直接路径方式）${NC}"
            SKIP_CONTAINER_UPDATE=true
        else
            echo -e "${RED}❌ 错误: 无法访问volume路径${NC}"
            exit 1
        fi
    }
    
    if [ "$SKIP_CONTAINER_UPDATE" != "true" ]; then
        # 清空旧文件
        echo "正在清空旧文件..."
        sudo docker exec "$TEMP_CONTAINER" sh -c "rm -rf /target/* /target/.[!.]* /target/..?* 2>/dev/null || true"
        
        # 复制新文件
        echo "正在复制新文件..."
        sudo docker cp "$PROJECT_ROOT/client/dist/." "$TEMP_CONTAINER:/target/"
        
        # 清理临时容器
        echo "正在清理临时容器..."
        sudo docker rm -f "$TEMP_CONTAINER"
        
        echo -e "${GREEN}✓ 前端文件已更新到Docker volume${NC}"
    fi
fi
echo ""

# 步骤 5: 重启后端容器（加载新的后端代码）
echo -e "${CYAN}=== 步骤 5: 重启后端容器 ===${NC}"
echo "正在重启应用容器以加载新的后端代码..."

# 检查容器是否存在
if sudo docker ps -a | grep -q "newsapp"; then
    sudo docker compose restart app || sudo docker restart newsapp
    echo -e "${GREEN}✓ 应用容器已重启${NC}"
else
    echo -e "${YELLOW}⚠  应用容器不存在，将启动容器${NC}"
    sudo docker compose up -d app
fi

echo ""

# 步骤 6: 重启Nginx容器
echo -e "${CYAN}=== 步骤 6: 重启Nginx容器 ===${NC}"
if sudo docker ps -a | grep -q "newsapp-nginx"; then
    sudo docker compose restart nginx || sudo docker restart newsapp-nginx
    echo -e "${GREEN}✓ Nginx容器已重启${NC}"
else
    echo -e "${YELLOW}⚠  Nginx容器不存在，将启动容器${NC}"
    sudo docker compose up -d nginx
fi

echo ""

# 步骤 7: 等待服务启动
echo -e "${CYAN}=== 步骤 7: 等待服务启动 ===${NC}"
echo "等待服务启动（30秒）..."
for i in {1..6}; do
    sleep 5
    echo "  等待中... ($((i*5))/30 秒)"
done
echo ""

# 步骤 8: 验证部署
echo -e "${CYAN}=== 步骤 8: 验证部署 ===${NC}"

# 检查容器状态
echo "检查容器状态..."
if sudo docker ps | grep -q "newsapp"; then
    echo -e "${GREEN}✓ 应用容器运行正常${NC}"
else
    echo -e "${RED}✗ 应用容器未运行${NC}"
fi

if sudo docker ps | grep -q "newsapp-nginx"; then
    echo -e "${GREEN}✓ Nginx容器运行正常${NC}"
else
    echo -e "${RED}✗ Nginx容器未运行${NC}"
fi

echo ""

# 检查应用健康状态
echo "检查应用健康状态..."
APP_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$APP_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用健康检查正常${NC}"
else
    echo -e "${YELLOW}⚠  应用可能还在启动中${NC}"
    echo "  响应: $APP_RESPONSE"
fi

echo ""

# 检查分享链接API
echo "检查分享链接API..."
SHARE_API_RESPONSE=$(curl -s -X GET "http://localhost:3001/api/news-share/list" -H "x-user-id: test" 2>/dev/null || echo "")
if echo "$SHARE_API_RESPONSE" | grep -q "success\|401\|未登录"; then
    echo -e "${GREEN}✓ 分享链接API可访问${NC}"
else
    echo -e "${YELLOW}⚠  分享链接API可能有问题${NC}"
    echo "  响应: $SHARE_API_RESPONSE"
fi

echo ""

# 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ 部署完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}部署内容：${NC}"
echo "  ✓ 后端代码已更新（newsShare.js路由、SPA路由支持）"
echo "  ✓ 前端代码已更新（ShareNewsPage、NewsInfo、App、axios配置）"
echo "  ✓ 前端文件已部署到Docker volume"
echo "  ✓ 应用容器已重启"
echo "  ✓ Nginx容器已重启"
echo ""
echo -e "${CYAN}后续操作：${NC}"
echo "  1. 清除浏览器缓存（Ctrl+Shift+Delete）"
echo "  2. 刷新页面（Ctrl+F5 强制刷新）"
echo "  3. 测试分享链接功能："
echo "     - 登录系统"
echo "     - 进入舆情信息页面"
echo "     - 点击'发布'按钮"
echo "     - 创建分享链接并测试访问"
echo ""
echo -e "${CYAN}查看日志：${NC}"
echo "  应用日志: sudo docker compose logs app --tail 100"
echo "  Nginx日志: sudo docker compose logs nginx --tail 100"
echo "  实时日志: sudo docker compose logs -f"
echo ""
echo -e "${CYAN}备份位置：${NC}"
echo "  $BACKUP_DIR"
echo ""

