#!/bin/bash

echo "=== 检查端口占用情况 ==="

# 检查 3306 端口
echo "检查端口 3306 (MySQL):"
sudo lsof -i :3306 || sudo netstat -tulpn | grep 3306 || sudo ss -tulpn | grep 3306

echo ""
echo "检查 3001 端口 (应用):"
sudo lsof -i :3001 || sudo netstat -tulpn | grep 3001 || sudo ss -tulpn | grep 3001

echo ""
echo "=== 检查 Docker 容器状态 ==="
sudo docker ps -a | grep -E "newsapp|mysql|nginx"

echo ""
echo "=== 解决方案 ==="
echo "如果端口被占用，可以选择："
echo "1. 停止占用端口的服务"
echo "2. 修改 docker-compose.yml 使用不同端口"
echo ""
echo "执行以下命令停止所有相关容器："
echo "sudo docker compose down"
echo ""
echo "如果系统 MySQL 在运行，可以停止它："
echo "sudo systemctl stop mysql"
echo "或"
echo "sudo systemctl stop mariadb"

