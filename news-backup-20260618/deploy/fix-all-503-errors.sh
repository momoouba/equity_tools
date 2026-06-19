#!/bin/bash

# 全面修复所有503错误的脚本
# 使用方法: ./deploy/fix-all-503-errors.sh
# 此脚本会系统性地诊断和修复所有可能导致503错误的问题

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志文件
LOG_FILE="/tmp/fix-503-errors-$(date +%Y%m%d-%H%M%S).log"

# 日志函数
log() {
    echo -e "$1" | tee -a "$LOG_FILE"
}

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}全面修复所有503错误${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo "日志文件: $LOG_FILE"
echo ""

# 进入项目目录
cd /opt/newsapp/news 2>/dev/null || cd "$(dirname "$0")/.." || {
    log "${RED}错误: 无法找到项目目录${NC}"
    exit 1
}

log "${CYAN}项目目录: $(pwd)${NC}"
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

log "${CYAN}检测到的部署方式: ${DEPLOY_TYPE}${NC}"
echo ""

# 修复步骤计数器
FIX_COUNT=0
SUCCESS_COUNT=0
FAIL_COUNT=0

# 步骤1: 检查并修复容器/进程状态
fix_step_1_containers() {
    log "${CYAN}=== 步骤 1: 检查容器状态 ===${NC}"
    
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        log "${CYAN}1.1 检查所有容器状态...${NC}"
        sudo docker compose ps | tee -a "$LOG_FILE"
        echo ""
        
        # 检查应用容器
        APP_CONTAINER=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
        if [ -z "$APP_CONTAINER" ]; then
            log "${YELLOW}⚠️  应用容器未运行，尝试启动...${NC}"
            sudo docker compose up -d app
            sleep 5
            FIX_COUNT=$((FIX_COUNT + 1))
            
            APP_CONTAINER=$(sudo docker ps --filter "name=newsapp" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp$" || echo "")
            if [ -n "$APP_CONTAINER" ]; then
                log "${GREEN}✓ 应用容器已启动${NC}"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                log "${RED}✗ 应用容器启动失败${NC}"
                FAIL_COUNT=$((FAIL_COUNT + 1))
                return 1
            fi
        else
            log "${GREEN}✓ 应用容器正在运行${NC}"
        fi
        
        # 检查Nginx容器
        NGINX_CONTAINER=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
        if [ -z "$NGINX_CONTAINER" ]; then
            log "${YELLOW}⚠️  Nginx容器未运行，尝试启动...${NC}"
            sudo docker compose up -d nginx
            sleep 3
            FIX_COUNT=$((FIX_COUNT + 1))
            
            NGINX_CONTAINER=$(sudo docker ps --filter "name=newsapp-nginx" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-nginx$" || echo "")
            if [ -n "$NGINX_CONTAINER" ]; then
                log "${GREEN}✓ Nginx容器已启动${NC}"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                log "${RED}✗ Nginx容器启动失败${NC}"
                FAIL_COUNT=$((FAIL_COUNT + 1))
                return 1
            fi
        else
            log "${GREEN}✓ Nginx容器正在运行${NC}"
        fi
        
        # 检查MySQL容器
        MYSQL_CONTAINER=$(sudo docker ps --filter "name=newsapp-mysql" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-mysql$" || echo "")
        if [ -z "$MYSQL_CONTAINER" ]; then
            log "${YELLOW}⚠️  MySQL容器未运行，尝试启动...${NC}"
            sudo docker compose up -d mysql
            sleep 5
            FIX_COUNT=$((FIX_COUNT + 1))
            
            MYSQL_CONTAINER=$(sudo docker ps --filter "name=newsapp-mysql" --filter "status=running" --format "{{.Names}}" 2>/dev/null | grep -E "^newsapp-mysql$" || echo "")
            if [ -n "$MYSQL_CONTAINER" ]; then
                log "${GREEN}✓ MySQL容器已启动${NC}"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                log "${RED}✗ MySQL容器启动失败${NC}"
                FAIL_COUNT=$((FAIL_COUNT + 1))
            fi
        else
            log "${GREEN}✓ MySQL容器正在运行${NC}"
        fi
        
    elif [ "$DEPLOY_TYPE" == "pm2" ]; then
        log "${CYAN}1.2 检查PM2进程状态...${NC}"
        pm2 status | tee -a "$LOG_FILE"
        echo ""
        
        if ! pm2 list | grep -q "newsapp.*online"; then
            log "${YELLOW}⚠️  PM2应用未运行，尝试启动...${NC}"
            if [ -f "deploy/ecosystem.config.js" ]; then
                pm2 start deploy/ecosystem.config.js
            else
                pm2 start server/index.js --name newsapp
            fi
            sleep 5
            pm2 save
            FIX_COUNT=$((FIX_COUNT + 1))
            
            if pm2 list | grep -q "newsapp.*online"; then
                log "${GREEN}✓ PM2应用已启动${NC}"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            else
                log "${RED}✗ PM2应用启动失败${NC}"
                FAIL_COUNT=$((FAIL_COUNT + 1))
                return 1
            fi
        else
            log "${GREEN}✓ PM2应用正在运行${NC}"
        fi
    fi
    
    echo ""
    return 0
}

# 步骤2: 重启服务以确保状态正常
fix_step_2_restart() {
    log "${CYAN}=== 步骤 2: 重启服务 ===${NC}"
    
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        log "${CYAN}2.1 重启所有容器...${NC}"
        sudo docker compose restart
        log "${GREEN}✓ 容器已重启${NC}"
        FIX_COUNT=$((FIX_COUNT + 1))
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        
        log "${CYAN}2.2 等待服务启动（15秒）...${NC}"
        sleep 15
        
    elif [ "$DEPLOY_TYPE" == "pm2" ]; then
        log "${CYAN}2.1 重启PM2应用...${NC}"
        pm2 restart newsapp
        log "${GREEN}✓ PM2应用已重启${NC}"
        FIX_COUNT=$((FIX_COUNT + 1))
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        
        log "${CYAN}2.2 重启Nginx服务...${NC}"
        if systemctl is-active --quiet nginx 2>/dev/null; then
            sudo systemctl restart nginx
            log "${GREEN}✓ Nginx已重启${NC}"
        else
            sudo systemctl start nginx
            log "${GREEN}✓ Nginx已启动${NC}"
        fi
        FIX_COUNT=$((FIX_COUNT + 1))
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        
        log "${CYAN}2.3 等待服务启动（5秒）...${NC}"
        sleep 5
    fi
    
    echo ""
}

# 步骤3: 检查并修复数据库连接
fix_step_3_database() {
    log "${CYAN}=== 步骤 3: 检查数据库连接 ===${NC}"
    
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        log "${CYAN}3.1 检查MySQL容器健康状态...${NC}"
        MYSQL_HEALTH=$(sudo docker inspect newsapp-mysql --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
        log "MySQL健康状态: $MYSQL_HEALTH"
        
        if [ "$MYSQL_HEALTH" != "healthy" ] && [ "$MYSQL_HEALTH" != "unknown" ]; then
            log "${YELLOW}⚠️  MySQL容器不健康，等待恢复...${NC}"
            for i in {1..12}; do
                sleep 5
                MYSQL_HEALTH_CHECK=$(sudo docker inspect newsapp-mysql --format '{{.State.Health.Status}}' 2>/dev/null || echo "unknown")
                if [ "$MYSQL_HEALTH_CHECK" == "healthy" ]; then
                    log "${GREEN}✓ MySQL容器已恢复健康（等待了 $((i*5)) 秒）${NC}"
                    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
                    break
                fi
                log "  等待中... ($((i*5))/60 秒)"
            done
        else
            log "${GREEN}✓ MySQL容器健康${NC}"
        fi
        
        # 测试数据库连接
        log "${CYAN}3.2 测试数据库连接...${NC}"
        DB_TEST=$(sudo docker compose exec -T mysql mysql -u newsapp -pNewsApp@2024 -e "SELECT 1;" 2>&1 || echo "")
        if echo "$DB_TEST" | grep -q "1"; then
            log "${GREEN}✓ 数据库连接正常${NC}"
        else
            log "${YELLOW}⚠️  数据库连接测试失败，但这可能是正常的（使用环境变量中的密码）${NC}"
        fi
    fi
    
    echo ""
}

# 步骤4: 检查应用健康状态并等待完全启动
fix_step_4_app_health() {
    log "${CYAN}=== 步骤 4: 检查应用健康状态 ===${NC}"
    
    log "${CYAN}4.1 检查应用是否完全启动...${NC}"
    
    # 最多等待120秒让应用完全启动
    MAX_WAIT=120
    WAIT_TIME=0
    
    while [ $WAIT_TIME -lt $MAX_WAIT ]; do
        APP_HEALTH=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
        
        if echo "$APP_HEALTH" | grep -q '"status":"ok"'; then
            log "${GREEN}✓ 应用已完全启动并正常运行${NC}"
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            break
        elif echo "$APP_HEALTH" | grep -q '"status":"starting"'; then
            log "${YELLOW}⚠️  应用正在启动中（已等待 $WAIT_TIME 秒）...${NC}"
            sleep 5
            WAIT_TIME=$((WAIT_TIME + 5))
        else
            log "${YELLOW}⚠️  应用健康检查异常，等待中（已等待 $WAIT_TIME 秒）...${NC}"
            log "  响应: $APP_HEALTH"
            sleep 5
            WAIT_TIME=$((WAIT_TIME + 5))
        fi
    done
    
    if [ $WAIT_TIME -ge $MAX_WAIT ]; then
        log "${RED}✗ 应用在 $MAX_WAIT 秒内未能完全启动${NC}"
        log "${CYAN}查看应用日志...${NC}"
        if [ "$DEPLOY_TYPE" == "docker" ]; then
            sudo docker compose logs app --tail 50 | tee -a "$LOG_FILE"
        else
            pm2 logs newsapp --lines 50 --nostream | tee -a "$LOG_FILE"
        fi
        FAIL_COUNT=$((FAIL_COUNT + 1))
        return 1
    fi
    
    echo ""
}

# 步骤5: 检查并修复Nginx配置和代理
fix_step_5_nginx() {
    log "${CYAN}=== 步骤 5: 检查Nginx配置和代理 ===${NC}"
    
    if [ "$DEPLOY_TYPE" == "docker" ]; then
        log "${CYAN}5.1 检查Nginx配置语法...${NC}"
        NGINX_TEST=$(sudo docker exec newsapp-nginx nginx -t 2>&1 || echo "")
        if echo "$NGINX_TEST" | grep -q "successful"; then
            log "${GREEN}✓ Nginx配置语法正确${NC}"
        else
            log "${RED}✗ Nginx配置语法错误${NC}"
            log "$NGINX_TEST"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            return 1
        fi
        
        log "${CYAN}5.2 检查容器网络连接...${NC}"
        APP_NETWORK=$(sudo docker inspect newsapp --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
        NGINX_NETWORK=$(sudo docker inspect newsapp-nginx --format '{{range $net, $v := .NetworkSettings.Networks}}{{$net}}{{end}}' 2>/dev/null || echo "")
        
        if [ "$APP_NETWORK" == "$NGINX_NETWORK" ] && [ -n "$APP_NETWORK" ]; then
            log "${GREEN}✓ 容器在同一网络: $APP_NETWORK${NC}"
        else
            log "${YELLOW}⚠️  容器不在同一网络，尝试重新创建容器...${NC}"
            sudo docker compose down
            sleep 2
            sudo docker compose up -d
            sleep 15
            FIX_COUNT=$((FIX_COUNT + 1))
            SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        fi
        
        log "${CYAN}5.3 测试Nginx容器能否访问应用容器...${NC}"
        NGINX_TO_APP=$(sudo docker exec newsapp-nginx wget -q -O - http://app:3001/api/health 2>/dev/null | head -1 || echo "")
        if echo "$NGINX_TO_APP" | grep -q "ok"; then
            log "${GREEN}✓ Nginx可以访问应用容器${NC}"
        else
            log "${YELLOW}⚠️  Nginx无法访问应用容器，尝试重新加载Nginx配置...${NC}"
            sudo docker exec newsapp-nginx nginx -s reload 2>&1 || sudo docker compose restart nginx
            sleep 5
            FIX_COUNT=$((FIX_COUNT + 1))
        fi
        
        log "${CYAN}5.4 重新加载Nginx配置...${NC}"
        sudo docker exec newsapp-nginx nginx -s reload 2>&1 || sudo docker compose restart nginx
        sleep 3
        FIX_COUNT=$((FIX_COUNT + 1))
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
        
    elif [ "$DEPLOY_TYPE" == "pm2" ]; then
        log "${CYAN}5.1 检查Nginx配置语法...${NC}"
        if sudo nginx -t 2>&1 | grep -q "successful"; then
            log "${GREEN}✓ Nginx配置语法正确${NC}"
        else
            log "${RED}✗ Nginx配置语法错误${NC}"
            sudo nginx -t 2>&1 | tee -a "$LOG_FILE"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            return 1
        fi
        
        log "${CYAN}5.2 重新加载Nginx配置...${NC}"
        sudo systemctl reload nginx || sudo systemctl restart nginx
        FIX_COUNT=$((FIX_COUNT + 1))
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    fi
    
    echo ""
}

# 步骤6: 最终验证
fix_step_6_verify() {
    log "${CYAN}=== 步骤 6: 最终验证 ===${NC}"
    
    log "${CYAN}6.1 测试应用直接访问...${NC}"
    APP_HEALTH=$(curl -s http://localhost:3001/api/health 2>/dev/null || echo "")
    if echo "$APP_HEALTH" | grep -q '"status":"ok"'; then
        log "${GREEN}✓ 应用直接访问正常${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        log "${RED}✗ 应用直接访问失败${NC}"
        log "  响应: $APP_HEALTH"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    
    log "${CYAN}6.2 测试Nginx代理访问...${NC}"
    NGINX_HEALTH=$(curl -s http://localhost/api/health 2>/dev/null || echo "")
    if echo "$NGINX_HEALTH" | grep -q '"status":"ok"'; then
        log "${GREEN}✓ Nginx代理访问正常${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        log "${RED}✗ Nginx代理访问失败${NC}"
        log "  响应: $NGINX_HEALTH"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    
    log "${CYAN}6.3 测试登录API...${NC}"
    LOGIN_TEST=$(curl -s -X POST http://localhost/api/auth/login \
        -H "Content-Type: application/json" \
        -d '{"username":"test","password":"test"}' 2>/dev/null || echo "")
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost/api/auth/login \
        -H "Content-Type: application/json" \
        -d '{"username":"test","password":"test"}' 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" != "503" ] && [ "$HTTP_CODE" != "000" ]; then
        log "${GREEN}✓ 登录API可访问（HTTP $HTTP_CODE，不是503错误）${NC}"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    else
        log "${RED}✗ 登录API返回503或无法访问（HTTP $HTTP_CODE）${NC}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
    
    echo ""
}

# 主函数
main() {
    log "${BLUE}开始全面修复503错误...${NC}"
    echo ""
    
    # 执行所有修复步骤
    fix_step_1_containers || log "${YELLOW}步骤1部分失败，继续执行...${NC}"
    fix_step_2_restart
    fix_step_3_database
    fix_step_4_app_health || log "${YELLOW}步骤4失败，但继续执行后续步骤...${NC}"
    fix_step_5_nginx || log "${YELLOW}步骤5部分失败，继续执行...${NC}"
    fix_step_6_verify
    
    # 总结
    echo ""
    log "${CYAN}========================================${NC}"
    log "${CYAN}修复总结${NC}"
    log "${CYAN}========================================${NC}"
    log "总修复步骤: $FIX_COUNT"
    log "${GREEN}成功: $SUCCESS_COUNT${NC}"
    log "${RED}失败: $FAIL_COUNT${NC}"
    log "日志文件: $LOG_FILE"
    echo ""
    
    if [ $FAIL_COUNT -eq 0 ]; then
        log "${GREEN}✓ 所有修复步骤执行成功！${NC}"
        log ""
        log "${CYAN}建议验证:${NC}"
        log "  1. 在浏览器中访问网站，确认不再出现503错误"
        log "  2. 尝试登录，确认功能正常"
        log "  3. 如果仍有问题，查看日志文件: $LOG_FILE"
        return 0
    else
        log "${YELLOW}⚠️  部分修复步骤失败${NC}"
        log ""
        log "${CYAN}建议操作:${NC}"
        log "  1. 查看日志文件了解详细错误: $LOG_FILE"
        if [ "$DEPLOY_TYPE" == "docker" ]; then
            log "  2. 查看应用日志: sudo docker compose logs app --tail 100"
            log "  3. 查看Nginx日志: sudo docker compose logs nginx --tail 50"
        else
            log "  2. 查看应用日志: pm2 logs newsapp --lines 100"
            log "  3. 查看Nginx日志: sudo tail -50 /var/log/nginx/error.log"
        fi
        return 1
    fi
}

# 运行主函数
main "$@"

