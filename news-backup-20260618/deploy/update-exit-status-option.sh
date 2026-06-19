#!/bin/bash

# 更新"不再观察"退出状态选项
# 使用方法: ./deploy/update-exit-status-option.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}更新退出状态选项（不再观察）${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    echo -e "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

echo "项目目录: $(pwd)"
echo ""

# 检查需要更新的文件
echo -e "${CYAN}=== 检查需要更新的文件 ===${NC}"
FILES_TO_UPDATE=(
    "client/src/pages/EnterpriseForm.jsx"
    "client/src/pages/BatchImportModal.jsx"
    "server/routes/enterprises.js"
)

MISSING_FILES=0
for file in "${FILES_TO_UPDATE[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ 找到文件: $file${NC}"
    else
        echo -e "${RED}✗ 文件不存在: $file${NC}"
        MISSING_FILES=1
    fi
done
echo ""

if [ $MISSING_FILES -eq 1 ]; then
    echo -e "${YELLOW}警告: 部分文件不存在，请确保文件已上传到服务器${NC}"
    read -p "是否继续? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}操作已取消${NC}"
        exit 0
    fi
fi

# 确认操作
read -p "是否继续更新并重启服务? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}操作已取消${NC}"
    exit 0
fi

# 备份当前代码（可选）
echo -e "${CYAN}=== 备份当前代码 ===${NC}"
BACKUP_DIR="backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
for file in "${FILES_TO_UPDATE[@]}"; do
    if [ -f "$file" ]; then
        mkdir -p "$BACKUP_DIR/$(dirname "$file")"
        cp "$file" "$BACKUP_DIR/$file"
        echo -e "${GREEN}✓ 已备份: $file${NC}"
    fi
done
echo "备份目录: $BACKUP_DIR"
echo ""

# 步骤1: 更新后端文件（server目录是挂载的，直接生效）
echo -e "${CYAN}=== 步骤1: 更新后端文件 ===${NC}"
if [ -f "server/routes/enterprises.js" ]; then
    echo -e "${GREEN}✓ 后端文件已更新（server目录是挂载的，重启容器后生效）${NC}"
else
    echo -e "${YELLOW}⚠️  后端文件不存在，跳过${NC}"
fi
echo ""

# 步骤2: 重新构建前端
echo -e "${CYAN}=== 步骤2: 重新构建前端 ===${NC}"
if [ -d "client" ]; then
    cd client
    
    # 检查是否有node_modules
    if [ ! -d "node_modules" ]; then
        echo "正在安装前端依赖..."
        npm install
    fi
    
    echo "正在构建前端..."
    npm run build
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ 前端构建成功${NC}"
    else
        echo -e "${RED}✗ 前端构建失败${NC}"
        exit 1
    fi
    
    cd ..
else
    echo -e "${RED}✗ client目录不存在${NC}"
    exit 1
fi
echo ""

# 步骤3: 复制前端文件到volume
echo -e "${CYAN}=== 步骤3: 复制前端文件到volume ===${NC}"

# 查找前端volume名称（尝试多种方式）
VOLUME_NAME=""
PROJECT_NAME=$(basename $(pwd) | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]_')

# 方法1: 从docker-compose.yml中提取
if [ -f "docker-compose.yml" ]; then
    VOLUME_NAME=$(grep -A 2 "app_frontend:" docker-compose.yml | grep "driver: local" -B 2 | head -1 | sed 's/^[[:space:]]*//' | cut -d: -f1 | tr -d '[:space:]' || echo "")
fi

# 方法2: 尝试常见的命名规则
if [ -z "$VOLUME_NAME" ]; then
    # 尝试项目名_app_frontend格式
    POSSIBLE_NAMES=(
        "${PROJECT_NAME}_app_frontend"
        "news_app_frontend"
        "equity_news_app_frontend"
        "app_frontend"
    )
    
    for name in "${POSSIBLE_NAMES[@]}"; do
        if sudo docker volume inspect "$name" >/dev/null 2>&1; then
            VOLUME_NAME="$name"
            echo "找到volume: $VOLUME_NAME"
            break
        fi
    done
fi

# 方法3: 从运行中的容器查找
if [ -z "$VOLUME_NAME" ]; then
    echo "正在从运行中的容器查找volume..."
    CONTAINER_VOLUMES=$(sudo docker inspect newsapp 2>/dev/null | grep -A 20 "Mounts" | grep "Name" | grep -i "frontend" | head -1 | awk '{print $2}' | tr -d '",' || echo "")
    if [ -n "$CONTAINER_VOLUMES" ]; then
        VOLUME_NAME="$CONTAINER_VOLUMES"
        echo "从容器中找到volume: $VOLUME_NAME"
    fi
fi

# 如果还是找不到，列出所有volume让用户选择
if [ -z "$VOLUME_NAME" ]; then
    echo -e "${YELLOW}⚠️  无法自动找到volume，列出所有volume:${NC}"
    sudo docker volume ls | grep -i frontend || sudo docker volume ls
    echo ""
    read -p "请输入volume名称（或按Enter使用默认名称 news_app_frontend）: " USER_VOLUME_NAME
    VOLUME_NAME="${USER_VOLUME_NAME:-news_app_frontend}"
fi

echo "使用volume名称: $VOLUME_NAME"

# 尝试获取volume路径
VOLUME_PATH=$(sudo docker volume inspect ${VOLUME_NAME} 2>/dev/null | grep -i "Mountpoint" | awk '{print $2}' | tr -d '",' || echo "")

if [ -n "$VOLUME_PATH" ]; then
    echo "Volume路径: $VOLUME_PATH"
    echo "正在复制前端文件..."
    if sudo cp -r client/dist/* "$VOLUME_PATH/" 2>/dev/null; then
        echo -e "${GREEN}✓ 前端文件已复制到volume${NC}"
    else
        echo -e "${YELLOW}⚠️  直接复制失败，使用临时容器方式${NC}"
        USE_TEMP_CONTAINER=1
    fi
else
    echo -e "${YELLOW}⚠️  无法找到volume路径，使用临时容器方式${NC}"
    USE_TEMP_CONTAINER=1
fi

# 使用临时容器方式
if [ "${USE_TEMP_CONTAINER:-0}" = "1" ]; then
    echo "正在创建临时容器..."
    TEMP_CONTAINER_NAME="temp-frontend-update-$$-$(date +%s)"
    
    # 清理可能存在的旧容器
    sudo docker rm -f temp-frontend-update-* 2>/dev/null || true
    
    # 先检查volume是否存在
    if ! sudo docker volume inspect ${VOLUME_NAME} >/dev/null 2>&1; then
        echo -e "${YELLOW}⚠️  Volume不存在，尝试创建: ${VOLUME_NAME}${NC}"
        if ! sudo docker volume create ${VOLUME_NAME} >/dev/null 2>&1; then
            echo -e "${RED}✗ 无法创建volume: ${VOLUME_NAME}${NC}"
            echo ""
            echo -e "${YELLOW}可用的volume列表:${NC}"
            sudo docker volume ls
            echo ""
            echo -e "${YELLOW}请手动创建volume或使用正确的volume名称${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓ Volume已创建: ${VOLUME_NAME}${NC}"
    fi
    
    # 创建临时容器
    echo "正在创建临时容器: ${TEMP_CONTAINER_NAME}"
    TEMP_CONTAINER_OUTPUT=$(sudo docker run -d --name ${TEMP_CONTAINER_NAME} -v ${VOLUME_NAME}:/target alpine sleep 3600 2>&1)
    TEMP_CONTAINER_ID=$(echo "$TEMP_CONTAINER_OUTPUT" | head -1 | grep -E '^[a-f0-9]+$' || echo "")
    
    # 等待容器启动
    sleep 2
    
    # 检查容器是否真的创建成功
    if sudo docker ps -a | grep -q ${TEMP_CONTAINER_NAME}; then
        echo -e "${GREEN}✓ 临时容器已创建: ${TEMP_CONTAINER_NAME}${NC}"
        echo "正在复制前端文件..."
        
        # 先清空目标目录
        echo "  清空目标目录..."
        sudo docker exec ${TEMP_CONTAINER_NAME} sh -c "rm -rf /target/* /target/.* 2>/dev/null || true" || true
        
        # 复制文件
        echo "  复制文件..."
        if sudo docker cp client/dist/. ${TEMP_CONTAINER_NAME}:/target/ 2>&1; then
            # 验证文件是否复制成功
            FILE_COUNT=$(sudo docker exec ${TEMP_CONTAINER_NAME} sh -c "ls -1 /target/ | wc -l" 2>/dev/null || echo "0")
            if [ "$FILE_COUNT" -gt "0" ]; then
                echo -e "${GREEN}✓ 前端文件已通过临时容器复制（${FILE_COUNT} 个文件/目录）${NC}"
            else
                echo -e "${YELLOW}⚠️  文件可能未正确复制，继续执行...${NC}"
            fi
        else
            echo -e "${RED}✗ 复制文件到临时容器失败${NC}"
            echo "错误详情:"
            sudo docker cp client/dist/. ${TEMP_CONTAINER_NAME}:/target/ 2>&1 | head -10 || true
            echo ""
            echo -e "${YELLOW}检查临时容器状态:${NC}"
            sudo docker ps -a | grep ${TEMP_CONTAINER_NAME} || true
            sudo docker logs ${TEMP_CONTAINER_NAME} 2>&1 | tail -5 || true
            sudo docker rm -f ${TEMP_CONTAINER_NAME} 2>/dev/null
            exit 1
        fi
        
        # 清理临时容器
        echo "  清理临时容器..."
        sudo docker rm -f ${TEMP_CONTAINER_NAME} 2>/dev/null
    else
        echo -e "${RED}✗ 临时容器创建失败${NC}"
        echo "错误输出: $TEMP_CONTAINER_OUTPUT"
        echo ""
        echo -e "${YELLOW}诊断信息:${NC}"
        echo "Volume名称: ${VOLUME_NAME}"
        echo "Volume是否存在: $(sudo docker volume inspect ${VOLUME_NAME} >/dev/null 2>&1 && echo '是' || echo '否')"
        echo ""
        echo -e "${YELLOW}可用的volume列表:${NC}"
        sudo docker volume ls | grep -i frontend || sudo docker volume ls | head -10
        echo ""
        echo -e "${YELLOW}请手动执行以下命令:${NC}"
        echo "  sudo docker volume create ${VOLUME_NAME}  # 如果volume不存在"
        echo "  sudo docker run -d --name temp-frontend-update -v ${VOLUME_NAME}:/target alpine sleep 3600"
        echo "  sudo docker cp client/dist/. temp-frontend-update:/target/"
        echo "  sudo docker rm -f temp-frontend-update"
        exit 1
    fi
fi
echo ""

# 步骤4: 重启应用容器
echo -e "${CYAN}=== 步骤4: 重启应用容器 ===${NC}"
echo "正在重启应用容器..."
sudo docker compose restart app
echo -e "${GREEN}✓ 应用容器已重启${NC}"
echo ""

# 步骤5: 等待应用启动
echo -e "${CYAN}=== 步骤5: 等待应用启动 ===${NC}"
echo "等待应用容器完全启动（30秒）..."
for i in {1..6}; do
    sleep 5
    echo "  等待中... ($((i*5))/30 秒)"
done
echo ""

# 步骤6: 检查容器状态
echo -e "${CYAN}=== 步骤6: 检查容器状态 ===${NC}"
sudo docker compose ps app
echo ""

# 步骤7: 检查应用健康状态
echo -e "${CYAN}=== 步骤7: 检查应用健康状态 ===${NC}"
APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
echo "应用容器健康状态: $APP_HEALTH"

if [ "$APP_HEALTH" == "healthy" ]; then
    echo -e "${GREEN}✓ 应用容器健康${NC}"
else
    echo -e "${YELLOW}⚠️  应用容器可能还在启动中，继续等待...${NC}"
    echo "等待应用容器完全就绪（最多60秒）..."
    for i in {1..12}; do
        sleep 5
        APP_HEALTH_CHECK=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
        if [ "$APP_HEALTH_CHECK" == "healthy" ]; then
            echo -e "${GREEN}✓ 应用容器已就绪（等待了 $((i*5)) 秒）${NC}"
            break
        fi
        echo "  等待中... ($((i*5))/60 秒)"
    done
fi
echo ""

# 步骤8: 测试应用健康检查
echo -e "${CYAN}=== 步骤8: 测试应用健康检查 ===${NC}"
APP_RESPONSE=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
if echo "$APP_RESPONSE" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}✓ 应用健康检查正常${NC}"
    echo "  响应: $APP_RESPONSE"
else
    echo -e "${YELLOW}⚠️  应用可能还在启动中${NC}"
    echo "  响应: $APP_RESPONSE"
    echo ""
    echo -e "${CYAN}查看应用日志（最后30行）...${NC}"
    sudo docker compose logs app --tail 30
fi
echo ""

# 完成
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}更新完成！${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${CYAN}后续操作:${NC}"
echo "  1. 清除浏览器缓存并强制刷新页面（Ctrl+F5）"
echo "  2. 测试退出状态下拉菜单，确认'不再观察'选项显示正常"
echo "  3. 查看应用日志: sudo docker compose logs app --tail 100"
echo "  4. 如果前端未更新，尝试清除浏览器缓存或使用无痕模式"
echo ""

