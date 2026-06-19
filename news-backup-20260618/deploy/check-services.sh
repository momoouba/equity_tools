#!/bin/bash

echo "=== 检查服务状态 ==="
echo ""

echo "1. 检查 Docker 容器状态..."
echo "----------------------------------------"
cd /opt/newsapp/news
sudo docker compose ps

echo ""
echo "2. 检查端口监听情况..."
echo "----------------------------------------"
echo "端口 3307 (MySQL):"
sudo netstat -tulpn | grep 3307 || sudo ss -tulpn | grep 3307 || echo "端口 3307 未监听"

echo ""
echo "端口 3001 (应用):"
sudo netstat -tulpn | grep 3001 || sudo ss -tulpn | grep 3001 || echo "端口 3001 未监听"

echo ""
echo "端口 80 (HTTP):"
sudo netstat -tulpn | grep ":80 " || sudo ss -tulpn | grep ":80 " || echo "端口 80 未监听"

echo ""
echo "3. 检查容器日志（最后10行）..."
echo "----------------------------------------"
echo "MySQL 容器:"
sudo docker compose logs mysql --tail 10

echo ""
echo "应用容器:"
sudo docker compose logs app --tail 10

echo ""
echo "Nginx 容器:"
sudo docker compose logs nginx --tail 10

echo ""
echo "4. 检查防火墙状态..."
echo "----------------------------------------"
if command -v ufw &> /dev/null; then
    sudo ufw status
elif command -v firewall-cmd &> /dev/null; then
    sudo firewall-cmd --list-all
else
    echo "未检测到防火墙管理工具"
fi

echo ""
echo "=== 检查完成 ==="

