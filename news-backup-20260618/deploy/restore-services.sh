#!/bin/bash
# 文件名：restore-services.sh
# 用途：系统重启后恢复所有服务
# 使用方法：chmod +x restore-services.sh && ./restore-services.sh

set -e  # 遇到错误立即退出

echo "=========================================="
echo "系统重启后服务恢复脚本"
echo "=========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 1. 启动Docker服务（如果使用Docker）
echo "步骤 1: 检查Docker服务"
echo "----------------------------------------"
if systemctl is-active --quiet docker; then
    log_info "Docker服务已运行"
else
    log_warn "启动Docker服务..."
    sudo systemctl start docker
    sudo systemctl enable docker
    sleep 2
    if systemctl is-active --quiet docker; then
        log_info "Docker服务启动成功"
    else
        log_error "Docker服务启动失败"
        exit 1
    fi
fi

# 2. 启动MySQL服务
echo ""
echo "步骤 2: 检查MySQL服务"
echo "----------------------------------------"
if systemctl is-active --quiet mysql; then
    log_info "MySQL服务已运行"
else
    log_warn "启动MySQL服务..."
    sudo systemctl start mysql
    sudo systemctl enable mysql
    sleep 5  # 等待MySQL完全启动
    
    # 检查MySQL是否真的启动成功
    for i in {1..30}; do
        if sudo systemctl is-active --quiet mysql; then
            if mysqladmin ping -h localhost -u root -p$(grep MYSQL_ROOT_PASSWORD /opt/newsapp/news/.env 2>/dev/null | cut -d'=' -f2) --silent 2>/dev/null || \
               mysqladmin ping -h localhost -u root --silent 2>/dev/null; then
                log_info "MySQL服务启动成功并可以连接"
                break
            fi
        fi
        if [ $i -eq 30 ]; then
            log_error "MySQL服务启动超时"
            exit 1
        fi
        sleep 1
    done
fi

# 3. 启动Nginx服务
echo ""
echo "步骤 3: 检查Nginx服务"
echo "----------------------------------------"
if systemctl is-active --quiet nginx; then
    log_info "Nginx服务已运行"
else
    log_warn "启动Nginx服务..."
    sudo systemctl start nginx
    sudo systemctl enable nginx
    sleep 2
    if systemctl is-active --quiet nginx; then
        log_info "Nginx服务启动成功"
    else
        log_error "Nginx服务启动失败"
    fi
fi

# 4. 启动Docker容器（如果使用Docker）
echo ""
echo "步骤 4: 检查Docker容器"
echo "----------------------------------------"
if command -v docker &> /dev/null && [ -f "/opt/newsapp/news/docker-compose.yml" ]; then
    cd /opt/newsapp/news
    
    # 检查MySQL容器
    if sudo docker ps -a | grep -q "newsapp-mysql"; then
        if sudo docker ps | grep -q "newsapp-mysql"; then
            log_info "MySQL容器已运行"
        else
            log_warn "启动MySQL容器..."
            sudo docker start newsapp-mysql
            sleep 10  # 等待MySQL容器完全启动
            
            # 等待MySQL容器健康检查通过
            for i in {1..60}; do
                if sudo docker inspect newsapp-mysql --format='{{.State.Health.Status}}' 2>/dev/null | grep -q "healthy"; then
                    log_info "MySQL容器健康检查通过"
                    break
                fi
                if [ $i -eq 60 ]; then
                    log_warn "MySQL容器健康检查超时，但继续执行"
                fi
                sleep 1
            done
        fi
    fi
    
    # 等待MySQL完全就绪后再启动应用容器
    log_info "等待MySQL完全就绪..."
    sleep 5
    
    # 检查应用容器
    if sudo docker ps -a | grep -q "newsapp$"; then
        if sudo docker ps | grep -q "newsapp$"; then
            log_info "应用容器已运行"
        else
            log_warn "启动应用容器..."
            sudo docker start newsapp
            sleep 10  # 等待应用启动
        fi
    else
        log_warn "应用容器不存在，使用docker compose启动..."
        sudo docker compose up -d mysql
        sleep 10
        sudo docker compose up -d app
        sleep 10
    fi
    
    # 检查Nginx容器
    if sudo docker ps -a | grep -q "newsapp-nginx"; then
        if sudo docker ps | grep -q "newsapp-nginx"; then
            log_info "Nginx容器已运行"
        else
            log_warn "启动Nginx容器..."
            sudo docker start newsapp-nginx
            sleep 5
        fi
    fi
    
    # 显示容器状态
    echo ""
    log_info "Docker容器状态："
    sudo docker compose ps
fi

# 5. 恢复PM2进程（如果使用PM2）
echo ""
echo "步骤 5: 检查PM2进程"
echo "----------------------------------------"
if command -v pm2 &> /dev/null; then
    # 检查PM2是否已配置开机自启
    if [ ! -f ~/.pm2/dump.pm2 ]; then
        log_warn "PM2配置不存在，需要手动配置"
    fi
    
    if pm2 list | grep -q "newsapp"; then
        log_info "PM2进程已存在"
        pm2 status
    else
        log_warn "启动PM2进程..."
        if [ -f "/opt/newsapp/news/deploy/ecosystem.config.js" ]; then
            cd /opt/newsapp/news
            pm2 start deploy/ecosystem.config.js
            pm2 save
            sleep 5
        else
            log_warn "PM2配置文件不存在，尝试直接启动..."
            cd /opt/newsapp/news
            pm2 start server/index.js --name newsapp \
              --cwd /opt/newsapp/news \
              --log /var/log/newsapp/combined.log \
              --out /var/log/newsapp/out.log \
              --error /var/log/newsapp/error.log
            pm2 save
            sleep 5
        fi
    fi
    
    # 配置PM2开机自启（如果未配置）
    if ! pm2 startup | grep -q "already setup"; then
        log_warn "配置PM2开机自启..."
        STARTUP_CMD=$(pm2 startup | grep "sudo")
        if [ ! -z "$STARTUP_CMD" ]; then
            log_info "执行PM2开机自启配置命令..."
            eval "$STARTUP_CMD"
            pm2 save
        fi
    fi
fi

# 6. 验证服务状态
echo ""
echo "步骤 6: 验证服务状态"
echo "----------------------------------------"

# 检查端口
echo ""
log_info "端口检查："
PORTS_CHECKED=0
if netstat -tulpn 2>/dev/null | grep -q ":80 "; then
    log_info "  ✓ 端口 80 (HTTP) 正在监听"
    PORTS_CHECKED=$((PORTS_CHECKED+1))
else
    log_warn "  ⚠ 端口 80 (HTTP) 未监听"
fi

if netstat -tulpn 2>/dev/null | grep -q ":3001 "; then
    log_info "  ✓ 端口 3001 (应用) 正在监听"
    PORTS_CHECKED=$((PORTS_CHECKED+1))
else
    log_warn "  ⚠ 端口 3001 (应用) 未监听"
fi

if netstat -tulpn 2>/dev/null | grep -q ":3306 "; then
    log_info "  ✓ 端口 3306 (MySQL) 正在监听"
    PORTS_CHECKED=$((PORTS_CHECKED+1))
else
    log_warn "  ⚠ 端口 3306 (MySQL) 未监听"
fi

# 检查应用健康
echo ""
log_info "应用健康检查："
HEALTH_CHECK_PASSED=0

# 等待应用完全启动
sleep 5

# 检查本地健康检查
if curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
    log_info "  ✓ 应用健康检查通过 (localhost:3001)"
    HEALTH_CHECK_PASSED=1
else
    log_warn "  ⚠ 应用健康检查失败 (localhost:3001)"
    
    # 如果使用Docker，检查容器内的健康检查
    if command -v docker &> /dev/null && sudo docker ps | grep -q "newsapp"; then
        if sudo docker exec newsapp curl -f -s http://localhost:3001/api/health > /dev/null 2>&1; then
            log_info "  ✓ 应用容器内健康检查通过"
            HEALTH_CHECK_PASSED=1
        else
            log_warn "  ⚠ 应用容器内健康检查也失败"
        fi
    fi
fi

# 7. 显示服务状态摘要
echo ""
echo "=========================================="
echo "服务状态摘要"
echo "=========================================="
echo ""

# 系统服务
echo "系统服务："
systemctl is-active --quiet nginx && echo "  ✓ Nginx: 运行中" || echo "  ✗ Nginx: 未运行"
systemctl is-active --quiet mysql && echo "  ✓ MySQL: 运行中" || echo "  ✗ MySQL: 未运行"
systemctl is-active --quiet docker && echo "  ✓ Docker: 运行中" || echo "  ✗ Docker: 未运行"

echo ""
echo "应用服务："
if command -v pm2 &> /dev/null && pm2 list | grep -q "newsapp"; then
    echo "  ✓ PM2: 进程存在"
    pm2 list | grep newsapp
else
    echo "  ⚠ PM2: 进程不存在"
fi

if command -v docker &> /dev/null && sudo docker ps | grep -q "newsapp"; then
    echo "  ✓ Docker: 容器运行中"
    sudo docker ps --format "table {{.Names}}\t{{.Status}}" | grep newsapp
else
    echo "  ⚠ Docker: 容器未运行"
fi

echo ""
echo "端口监听："
echo "  已检查端口数: $PORTS_CHECKED/3"
echo "  应用健康检查: $([ $HEALTH_CHECK_PASSED -eq 1 ] && echo '通过' || echo '失败')"

echo ""
echo "=========================================="
if [ $HEALTH_CHECK_PASSED -eq 1 ] && [ $PORTS_CHECKED -ge 2 ]; then
    log_info "恢复完成！所有关键服务已启动"
    echo ""
    echo "后续操作："
    echo "  1. 查看PM2日志: pm2 logs newsapp"
    echo "  2. 查看Docker日志: sudo docker compose logs app"
    echo "  3. 测试应用: curl http://localhost:3001/api/health"
    echo "  4. 访问前端: http://your-domain.com"
    exit 0
else
    log_warn "恢复完成，但部分服务可能未正常启动"
    echo ""
    echo "故障排查："
    echo "  1. 查看PM2日志: pm2 logs newsapp --err"
    echo "  2. 查看Docker日志: sudo docker compose logs app"
    echo "  3. 查看系统日志: sudo journalctl -u mysql -n 50"
    echo "  4. 检查数据库连接: mysql -u root -p"
    exit 1
fi

