#!/bin/bash

# 快速修复503错误脚本
# 使用方法: ./deploy/fix-503-error.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}503错误快速诊断和修复工具${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 检测部署方式
DEPLOY_TYPE="unknown"
if [ -f "docker-compose.yml" ] && command -v docker &> /dev/null; then
    if sudo docker compose ps 2>/dev/null | grep -q "newsapp"; then
        DEPLOY_TYPE="docker"
    fi
fi

if command -v pm2 &> /dev/null; then
    if pm2 list 2>/dev/null | grep -q "newsapp"; then
        if [ "$DEPLOY_TYPE" == "unknown" ]; then
            DEPLOY_TYPE="pm2"
        fi
    fi
fi

echo -e "${CYAN}检测到的部署方式: ${DEPLOY_TYPE}${NC}"
echo ""

# 诊断函数
diagnose() {
    echo -e "${CYAN}=== 开始诊断 ===${NC}"
    echo ""
    
    # 1. 检查Docker容器状态
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        echo -e "${CYAN}1. 检查Docker容器状态...${NC}"
        cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.."
        echo ""
        echo "容器状态:"
        sudo docker compose ps
        echo ""
        
        # 检查容器是否运行
        APP_STATUS=$(sudo docker compose ps app 2>/dev/null | grep -v "NAME" | awk '{print $4}' || echo "not_running")
        if [ "$APP_STATUS" != "Up" ]; then
            echo -e "${RED}✗ 应用容器未运行${NC}"
            return 1
        else
            echo -e "${GREEN}✓ 应用容器正在运行${NC}"
        fi
        echo ""
        
        # 检查Nginx容器
        NGINX_STATUS=$(sudo docker compose ps nginx 2>/dev/null | grep -v "NAME" | awk '{print $4}' || echo "not_running")
        if [ "$NGINX_STATUS" != "Up" ]; then
            echo -e "${RED}✗ Nginx容器未运行${NC}"
            return 1
        else
            echo -e "${GREEN}✓ Nginx容器正在运行${NC}"
        fi
        echo ""
        
        # 查看应用日志
        echo -e "${CYAN}2. 查看应用容器日志（最后20行）...${NC}"
        sudo docker compose logs app --tail 20
        echo ""
        
        # 查看Nginx日志
        echo -e "${CYAN}3. 查看Nginx容器日志（最后20行）...${NC}"
        sudo docker compose logs nginx --tail 20
        echo ""
        
    # 2. 检查PM2进程状态
    elif [ "$DEPLOY_TYPE" == "pm2" ]; then
        echo -e "${CYAN}1. 检查PM2进程状态...${NC}"
        pm2 status
        echo ""
        
        # 检查应用是否运行
        if pm2 list | grep -q "newsapp.*online"; then
            echo -e "${GREEN}✓ PM2应用正在运行${NC}"
        else
            echo -e "${RED}✗ PM2应用未运行或状态异常${NC}"
            return 1
        fi
        echo ""
        
        # 查看应用日志
        echo -e "${CYAN}2. 查看应用日志（最后20行）...${NC}"
        pm2 logs newsapp --lines 20 --nostream
        echo ""
        
        # 检查端口监听
        echo -e "${CYAN}3. 检查端口监听情况...${NC}"
        if netstat -tulpn 2>/dev/null | grep -q ":3001 " || ss -tulpn 2>/dev/null | grep -q ":3001 "; then
            echo -e "${GREEN}✓ 端口3001正在监听${NC}"
        else
            echo -e "${RED}✗ 端口3001未监听${NC}"
            return 1
        fi
        echo ""
        
        # 检查Nginx状态
        echo -e "${CYAN}4. 检查Nginx服务状态...${NC}"
        if systemctl is-active --quiet nginx 2>/dev/null; then
            echo -e "${GREEN}✓ Nginx服务正在运行${NC}"
        else
            echo -e "${RED}✗ Nginx服务未运行${NC}"
            return 1
        fi
        echo ""
    else
        echo -e "${RED}无法确定部署方式，请手动检查${NC}"
        return 1
    fi
    
    # 3. 检查端口监听
    echo -e "${CYAN}检查端口监听情况...${NC}"
    echo "端口80 (HTTP):"
    if netstat -tulpn 2>/dev/null | grep -q ":80 " || ss -tulpn 2>/dev/null | grep -q ":80 "; then
        echo -e "${GREEN}✓ 端口80正在监听${NC}"
    else
        echo -e "${RED}✗ 端口80未监听${NC}"
    fi
    
    echo "端口3001 (应用):"
    if netstat -tulpn 2>/dev/null | grep -q ":3001 " || ss -tulpn 2>/dev/null | grep -q ":3001 "; then
        echo -e "${GREEN}✓ 端口3001正在监听${NC}"
    else
        echo -e "${RED}✗ 端口3001未监听${NC}"
    fi
    echo ""
    
    # 4. 测试应用健康检查
    echo -e "${CYAN}测试应用健康检查...${NC}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" == "200" ]; then
        echo -e "${GREEN}✓ 应用健康检查通过 (HTTP $HTTP_CODE)${NC}"
    else
        echo -e "${RED}✗ 应用健康检查失败 (HTTP $HTTP_CODE)${NC}"
        return 1
    fi
    echo ""
    
    return 0
}

# 修复函数
fix() {
    echo -e "${CYAN}=== 开始修复 ===${NC}"
    echo ""
    
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        echo -e "${CYAN}使用Docker方式修复...${NC}"
        cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.."
        
        # 1. 重启所有容器
        echo "1. 重启所有容器..."
        sudo docker compose restart
        echo -e "${GREEN}✓ 容器已重启${NC}"
        echo ""
        
        # 2. 等待服务启动
        echo "2. 等待服务启动（10秒）..."
        sleep 10
        echo ""
        
        # 3. 检查容器状态
        echo "3. 检查容器状态..."
        sudo docker compose ps
        echo ""
        
        # 4. 如果容器未启动，尝试重新创建
        APP_STATUS=$(sudo docker compose ps app 2>/dev/null | grep -v "NAME" | awk '{print $4}' || echo "not_running")
        if [ "$APP_STATUS" != "Up" ]; then
            echo -e "${YELLOW}应用容器未启动，尝试重新创建...${NC}"
            sudo docker compose up -d app
            sleep 5
        fi
        
        NGINX_STATUS=$(sudo docker compose ps nginx 2>/dev/null | grep -v "NAME" | awk '{print $4}' || echo "not_running")
        if [ "$NGINX_STATUS" != "Up" ]; then
            echo -e "${YELLOW}Nginx容器未启动，尝试重新创建...${NC}"
            sudo docker compose up -d nginx
            sleep 5
        fi
        
    elif [ "$DEPLOY_TYPE" == "pm2" ]; then
        echo -e "${CYAN}使用PM2方式修复...${NC}"
        cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.."
        
        # 1. 重启PM2应用
        echo "1. 重启PM2应用..."
        pm2 restart newsapp
        echo -e "${GREEN}✓ PM2应用已重启${NC}"
        echo ""
        
        # 2. 等待服务启动
        echo "2. 等待服务启动（5秒）..."
        sleep 5
        echo ""
        
        # 3. 检查PM2状态
        echo "3. 检查PM2状态..."
        pm2 status
        echo ""
        
        # 4. 如果PM2应用未运行，尝试启动
        if ! pm2 list | grep -q "newsapp.*online"; then
            echo -e "${YELLOW}PM2应用未运行，尝试启动...${NC}"
            if [ -f "deploy/ecosystem.config.js" ]; then
                pm2 start deploy/ecosystem.config.js
            else
                pm2 start server/index.js --name newsapp
            fi
            sleep 5
        fi
        
        # 5. 重启Nginx
        echo "4. 重启Nginx服务..."
        if systemctl is-active --quiet nginx 2>/dev/null; then
            sudo systemctl restart nginx
            echo -e "${GREEN}✓ Nginx已重启${NC}"
        else
            echo -e "${YELLOW}启动Nginx服务...${NC}"
            sudo systemctl start nginx
        fi
        echo ""
    else
        echo -e "${RED}无法确定部署方式，无法自动修复${NC}"
        echo ""
        echo "请手动执行以下操作："
        echo ""
        echo "如果是Docker部署："
        echo "  cd /opt/newsapp/news"
        echo "  sudo docker compose restart"
        echo ""
        echo "如果是PM2部署："
        echo "  cd /opt/newsapp/news"
        echo "  pm2 restart newsapp"
        echo "  sudo systemctl restart nginx"
        return 1
    fi
    
    return 0
}

# 主函数
main() {
    # 进入项目目录
    cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
        echo -e "${RED}错误: 无法找到项目目录${NC}"
        exit 1
    }
    
    # 诊断问题
    if diagnose; then
        echo -e "${GREEN}✓ 诊断完成，服务状态正常${NC}"
        echo ""
        echo -e "${CYAN}如果仍然无法访问，请检查：${NC}"
        echo "1. 防火墙设置"
        echo "2. Nginx配置"
        echo "3. 域名DNS配置"
        echo ""
    else
        echo -e "${YELLOW}检测到问题，开始修复...${NC}"
        echo ""
        
        # 询问是否自动修复
        read -p "是否自动修复？(y/n，默认y): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            if fix; then
                echo ""
                echo -e "${GREEN}✓ 修复完成${NC}"
                echo ""
                echo "等待5秒后重新诊断..."
                sleep 5
                echo ""
                diagnose
            else
                echo -e "${RED}✗ 修复失败，请查看日志手动处理${NC}"
                exit 1
            fi
        else
            echo -e "${YELLOW}跳过自动修复，请手动处理${NC}"
        fi
    fi
    
    echo ""
    echo -e "${CYAN}=== 诊断和修复完成 ===${NC}"
    echo ""
    echo "后续操作："
    echo "1. 查看详细日志:"
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        echo "   sudo docker compose logs app -f"
        echo "   sudo docker compose logs nginx -f"
    else
        echo "   pm2 logs newsapp"
    fi
    echo ""
    echo "2. 测试访问:"
    echo "   curl http://localhost:3001/api/health"
    echo ""
}

# 运行主函数
main "$@"

