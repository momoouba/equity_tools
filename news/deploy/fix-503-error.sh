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
        
        # 检查容器是否运行（使用更可靠的方法）
        # docker compose ps的输出格式可能不同，使用docker ps检查更可靠
        APP_CONTAINER=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
        if [ -z "$APP_CONTAINER" ]; then
            echo -e "${RED}✗ 应用容器未运行${NC}"
            # 检查容器是否存在但未运行
            APP_EXISTS=$(sudo docker ps -a --filter "name=newsapp" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
            if [ -n "$APP_EXISTS" ]; then
                APP_STATUS=$(sudo docker ps -a --filter "name=newsapp" --format "{{.Status}}" 2>/dev/null | head -1 || echo "")
                echo -e "${YELLOW}  容器状态: $APP_STATUS${NC}"
            fi
            return 1
        else
            echo -e "${GREEN}✓ 应用容器正在运行${NC}"
            # 显示容器状态详情
            APP_STATUS=$(sudo docker ps --filter "name=newsapp" --format "{{.Status}}" 2>/dev/null | head -1 || echo "")
            if [ -n "$APP_STATUS" ]; then
                echo -e "${CYAN}  状态详情: $APP_STATUS${NC}"
            fi
        fi
        echo ""
        
        # 检查Nginx容器
        NGINX_CONTAINER=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
        if [ -z "$NGINX_CONTAINER" ]; then
            echo -e "${RED}✗ Nginx容器未运行${NC}"
            # 检查容器是否存在但未运行
            NGINX_EXISTS=$(sudo docker ps -a --filter "name=newsapp-nginx" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
            if [ -n "$NGINX_EXISTS" ]; then
                NGINX_STATUS=$(sudo docker ps -a --filter "name=newsapp-nginx" --format "{{.Status}}" 2>/dev/null | head -1 || echo "")
                echo -e "${YELLOW}  容器状态: $NGINX_STATUS${NC}"
            fi
            return 1
        else
            echo -e "${GREEN}✓ Nginx容器正在运行${NC}"
            # 显示容器状态详情
            NGINX_STATUS=$(sudo docker ps --filter "name=newsapp-nginx" --format "{{.Status}}" 2>/dev/null | head -1 || echo "")
            if [ -n "$NGINX_STATUS" ]; then
                echo -e "${CYAN}  状态详情: $NGINX_STATUS${NC}"
            fi
        fi
        echo ""
        
        # 查看应用日志
        echo -e "${CYAN}2. 查看应用容器日志（最后50行）...${NC}"
        sudo docker compose logs app --tail 50
        echo ""
        
        # 检查服务器是否就绪
        echo -e "${CYAN}2.1 检查服务器初始化状态...${NC}"
        SERVER_READY_LOG=$(sudo docker compose logs app 2>&1 | grep -i "服务器核心功能已就绪\|server.*ready\|服务器运行正常" | tail -1 || echo "")
        if [ -n "$SERVER_READY_LOG" ]; then
            echo -e "${GREEN}✓ 服务器已就绪${NC}"
            echo "  $SERVER_READY_LOG"
        else
            echo -e "${YELLOW}⚠️  服务器可能还在初始化中${NC}"
            INIT_ERRORS=$(sudo docker compose logs app 2>&1 | grep -i "error\|fail\|exception" | tail -5 || echo "")
            if [ -n "$INIT_ERRORS" ]; then
                echo -e "${RED}检测到初始化错误:${NC}"
                echo "$INIT_ERRORS" | sed 's/^/   /'
            fi
        fi
        echo ""
        
        # 查看Nginx日志
        echo -e "${CYAN}3. 查看Nginx容器日志（最后20行）...${NC}"
        sudo docker compose logs nginx --tail 20
        echo ""
        
        # 检查Nginx配置中的upstream问题
        echo -e "${CYAN}4. 检查Nginx配置...${NC}"
        NGINX_CONFIG_ERROR=$(sudo docker compose logs nginx 2>&1 | grep -i "host not found in upstream\|upstream.*not found" | head -1 || echo "")
        if [ -n "$NGINX_CONFIG_ERROR" ]; then
            echo -e "${YELLOW}⚠️  检测到Nginx upstream配置问题:${NC}"
            echo "   $NGINX_CONFIG_ERROR"
            echo ""
            echo -e "${CYAN}检查容器网络连接...${NC}"
            # 检查容器是否在同一网络
            APP_NETWORK=$(sudo docker inspect newsapp --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
            NGINX_NETWORK=$(sudo docker inspect newsapp-nginx --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
            if [ "$APP_NETWORK" == "$NGINX_NETWORK" ] && [ -n "$APP_NETWORK" ]; then
                echo -e "${GREEN}✓ 容器在同一网络: $APP_NETWORK${NC}"
            else
                echo -e "${RED}✗ 容器不在同一网络${NC}"
                echo "  App网络: $APP_NETWORK"
                echo "  Nginx网络: $NGINX_NETWORK"
            fi
            echo ""
        fi
        
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
    
    # 4. 测试应用健康检查（从宿主机）
    echo -e "${CYAN}测试应用健康检查（从宿主机）...${NC}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" == "200" ]; then
        echo -e "${GREEN}✓ 应用健康检查通过 (HTTP $HTTP_CODE)${NC}"
    else
        echo -e "${RED}✗ 应用健康检查失败 (HTTP $HTTP_CODE)${NC}"
        echo ""
        echo -e "${CYAN}尝试从容器内部测试...${NC}"
        CONTAINER_HEALTH=$(sudo docker exec newsapp wget -q -O - http://localhost:3001/api/health 2>/dev/null | head -1 || echo "")
        if echo "$CONTAINER_HEALTH" | grep -q "ok"; then
            echo -e "${GREEN}✓ 容器内部健康检查正常${NC}"
            echo -e "${YELLOW}⚠️  问题可能是端口映射或Nginx代理配置${NC}"
        else
            echo -e "${RED}✗ 容器内部健康检查也失败${NC}"
            echo "  响应: $CONTAINER_HEALTH"
        fi
        return 1
    fi
    echo ""
    
    # 5. 测试Nginx代理（如果使用Docker）
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        echo -e "${CYAN}测试Nginx代理到应用...${NC}"
        NGINX_PROXY_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health 2>/dev/null || echo "000")
        if [ "$NGINX_PROXY_CODE" == "200" ]; then
            echo -e "${GREEN}✓ Nginx代理正常 (HTTP $NGINX_PROXY_CODE)${NC}"
        else
            echo -e "${RED}✗ Nginx代理失败 (HTTP $NGINX_PROXY_CODE)${NC}"
            echo ""
            echo -e "${CYAN}检查Nginx容器内能否访问应用容器...${NC}"
            NGINX_TO_APP=$(sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null | head -1 || echo "")
            if echo "$NGINX_TO_APP" | grep -q "ok"; then
                echo -e "${GREEN}✓ Nginx容器可以访问应用容器${NC}"
                echo -e "${YELLOW}⚠️  问题可能是Nginx配置或路由问题${NC}"
            else
                echo -e "${RED}✗ Nginx容器无法访问应用容器${NC}"
                echo "  响应: $NGINX_TO_APP"
                echo ""
                echo -e "${CYAN}检查容器网络连接...${NC}"
                sudo docker exec newsapp-nginx ping -c 2 app 2>&1 | head -5
            fi
            return 1
        fi
        echo ""
    fi
    
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
        
        # 4. 检查应用容器日志中的语法错误
        echo "4. 检查应用容器日志中的错误..."
        APP_ERRORS=$(sudo docker compose logs app 2>&1 | grep -i "Unexpected token\|SyntaxError\|语法错误" | head -3 || echo "")
        if [ -n "$APP_ERRORS" ]; then
            echo -e "${RED}✗ 检测到应用代码语法错误:${NC}"
            echo "$APP_ERRORS" | sed 's/^/   /'
            echo ""
            echo -e "${YELLOW}请检查并修复以下文件:${NC}"
            echo "  - server/utils/initPrompts.js"
            echo "  - 其他相关文件"
            echo ""
            echo -e "${CYAN}建议: 检查文件中的 try-catch 块是否正确闭合${NC}"
            echo ""
        fi
        
        # 5. 检查Nginx配置问题
        echo "5. 检查Nginx配置..."
        NGINX_CONFIG_ERROR=$(sudo docker compose logs nginx 2>&1 | grep -i "host not found in upstream\|upstream.*not found" | head -1 || echo "")
        if [ -n "$NGINX_CONFIG_ERROR" ]; then
            echo -e "${YELLOW}⚠️  检测到Nginx upstream配置问题${NC}"
            echo "   错误信息: $NGINX_CONFIG_ERROR"
            echo ""
            
            # 检查Nginx配置文件
            echo -e "${CYAN}检查Nginx配置文件...${NC}"
            if [ -f "deploy/nginx-site.conf" ]; then
                UPSTREAM_LINE=$(grep -n "server app" deploy/nginx-site.conf | head -1 || echo "")
                if [ -n "$UPSTREAM_LINE" ]; then
                    echo "找到upstream配置: $UPSTREAM_LINE"
                    # 检查是否有空格问题
                    if echo "$UPSTREAM_LINE" | grep -q "app: 3001"; then
                        echo -e "${RED}✗ 发现配置问题：upstream中有空格（app: 3001）${NC}"
                        echo -e "${CYAN}修复配置文件...${NC}"
                        sed -i 's/app: 3001/app:3001/g' deploy/nginx-site.conf
                        echo -e "${GREEN}✓ 已修复配置文件${NC}"
                        echo ""
                        echo -e "${CYAN}重启Nginx容器以应用修复...${NC}"
                        sudo docker compose restart nginx
                        sleep 5
                    else
                        echo -e "${GREEN}✓ 配置文件格式正确${NC}"
                    fi
                fi
            fi
            echo ""
            
            echo -e "${CYAN}检查容器网络...${NC}"
            # 检查容器是否在同一网络
            APP_NETWORK=$(sudo docker inspect newsapp --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
            NGINX_NETWORK=$(sudo docker inspect newsapp-nginx --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
            if [ "$APP_NETWORK" == "$NGINX_NETWORK" ] && [ -n "$APP_NETWORK" ]; then
                echo -e "${GREEN}✓ 容器在同一网络: $APP_NETWORK${NC}"
                echo ""
                echo -e "${CYAN}测试容器间网络连接...${NC}"
                # 测试从nginx容器能否访问app容器
                if sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null | grep -q "ok"; then
                    echo -e "${GREEN}✓ Nginx可以访问App容器${NC}"
                    echo ""
                    echo -e "${CYAN}网络正常，但Nginx启动时可能应用容器还未就绪${NC}"
                    echo -e "${CYAN}尝试重新加载Nginx配置...${NC}"
                    # 先检查Nginx配置语法
                    if sudo docker exec newsapp-nginx nginx -t 2>&1 | grep -q "successful"; then
                        echo -e "${GREEN}✓ Nginx配置语法正确${NC}"
                        echo -e "${CYAN}重新加载Nginx配置...${NC}"
                        sudo docker exec newsapp-nginx nginx -s reload 2>&1 || sudo docker compose restart nginx
                        sleep 3
                    else
                        echo -e "${YELLOW}⚠️  Nginx配置语法有误，重启容器...${NC}"
                        sudo docker compose restart nginx
                        sleep 5
                    fi
                else
                    echo -e "${YELLOW}⚠️  Nginx无法访问App容器${NC}"
                    echo ""
                    echo -e "${CYAN}检查App容器是否正常运行...${NC}"
                    APP_HEALTH=$(sudo docker inspect newsapp --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
                    if [ "$APP_HEALTH" == "healthy" ]; then
                        echo -e "${GREEN}✓ App容器健康状态: $APP_HEALTH${NC}"
                        echo ""
                        echo -e "${CYAN}等待App容器完全启动后重启Nginx...${NC}"
                        sleep 5
                        sudo docker compose restart nginx
                        sleep 5
                    else
                        echo -e "${RED}✗ App容器健康状态: $APP_HEALTH${NC}"
                        echo ""
                        echo -e "${CYAN}等待App容器完全启动...${NC}"
                        sleep 10
                        sudo docker compose restart nginx
                        sleep 5
                    fi
                fi
            else
                echo -e "${RED}✗ 容器不在同一网络${NC}"
                echo "  App网络: $APP_NETWORK"
                echo "  Nginx网络: $NGINX_NETWORK"
                echo ""
                echo -e "${CYAN}尝试重新创建容器以修复网络问题...${NC}"
                sudo docker compose down
                sleep 2
                sudo docker compose up -d
                sleep 15
                echo ""
                echo -e "${CYAN}等待服务完全启动...${NC}"
                sleep 10
            fi
            echo ""
        fi
        
        # 6. 如果容器未启动，尝试重新创建
        APP_CONTAINER=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
        if [ -z "$APP_CONTAINER" ]; then
            echo -e "${YELLOW}应用容器未启动，尝试重新创建...${NC}"
            sudo docker compose up -d app
            sleep 5
            # 再次检查
            APP_CONTAINER=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
            if [ -z "$APP_CONTAINER" ]; then
                echo -e "${RED}✗ 应用容器启动失败，请查看日志${NC}"
                sudo docker compose logs app --tail 50
                echo ""
                echo -e "${YELLOW}常见问题:${NC}"
                echo "  1. 代码语法错误（检查 initPrompts.js）"
                echo "  2. 数据库连接失败"
                echo "  3. 端口被占用"
            else
                echo -e "${GREEN}✓ 应用容器已启动${NC}"
            fi
        fi
        
        NGINX_CONTAINER=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
        if [ -z "$NGINX_CONTAINER" ]; then
            echo -e "${YELLOW}Nginx容器未启动，尝试重新创建...${NC}"
            sudo docker compose up -d nginx
            sleep 5
            # 再次检查
            NGINX_CONTAINER=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
            if [ -z "$NGINX_CONTAINER" ]; then
                echo -e "${RED}✗ Nginx容器启动失败，请查看日志${NC}"
                sudo docker compose logs nginx --tail 50
                echo ""
                echo -e "${YELLOW}常见问题:${NC}"
                echo "  1. Nginx配置文件语法错误"
                echo "  2. upstream配置问题（app:3001无法解析）"
                echo "  3. 端口被占用"
            else
                echo -e "${GREEN}✓ Nginx容器已启动${NC}"
            fi
        else
            # Nginx容器在运行，验证代理是否正常
            echo -e "${CYAN}7. 验证Nginx代理是否正常...${NC}"
            sleep 2
            NGINX_PROXY_TEST=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
            if echo "$NGINX_PROXY_TEST" | grep -q "ok"; then
                echo -e "${GREEN}✓ Nginx代理正常${NC}"
            else
                echo -e "${YELLOW}⚠️  Nginx代理异常${NC}"
                echo "  响应: $NGINX_PROXY_TEST"
                echo ""
                echo -e "${CYAN}检查Nginx配置和日志...${NC}"
                # 检查Nginx配置
                sudo docker exec newsapp-nginx nginx -t 2>&1 | head -5
                echo ""
                # 检查Nginx错误日志
                sudo docker compose logs nginx --tail 20 | grep -i "error\|fail" | head -5 || echo "  未发现明显错误"
                echo ""
                echo -e "${CYAN}尝试重启Nginx容器...${NC}"
                sudo docker compose restart nginx
                sleep 5
            fi
        fi
        
        # 8. 最终验证
        echo ""
        echo -e "${CYAN}8. 最终验证...${NC}"
        FINAL_APP_TEST=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
        FINAL_NGINX_TEST=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
        
        if echo "$FINAL_APP_TEST" | grep -q "ok"; then
            echo -e "${GREEN}✓ 应用直接访问正常${NC}"
        else
            echo -e "${RED}✗ 应用直接访问失败${NC}"
        fi
        
        if echo "$FINAL_NGINX_TEST" | grep -q "ok"; then
            echo -e "${GREEN}✓ Nginx代理访问正常${NC}"
        else
            echo -e "${RED}✗ Nginx代理访问失败${NC}"
            echo ""
            echo -e "${YELLOW}如果应用直接访问正常但Nginx代理失败，请检查:${NC}"
            echo "  1. Nginx配置文件: deploy/nginx-site.conf"
            echo "  2. upstream配置是否正确"
            echo "  3. 容器网络连接"
        fi
        echo ""
        
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

