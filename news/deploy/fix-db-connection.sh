#!/bin/bash

echo "=== 修复数据库连接问题 ==="
echo ""

# 1. 检查 .env 文件
echo "1. 检查 .env 文件..."
if [ -f /opt/newsapp/news/.env ]; then
    echo "✓ .env 文件存在"
    echo "当前配置："
    grep -E "DB_|MYSQL_" /opt/newsapp/news/.env | sed 's/PASSWORD=.*/PASSWORD=***隐藏***/'
else
    echo "✗ .env 文件不存在"
fi

echo ""
echo "2. 检查 MySQL 容器中的用户..."
sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD:-RootPassword123!} -e "SELECT User, Host FROM mysql.user WHERE User='newsapp';" 2>/dev/null || echo "无法连接到 MySQL 容器"

echo ""
echo "3. 解决方案："
echo ""
echo "方案A：确保 .env 文件配置正确（推荐）"
echo "在 /opt/newsapp/news/.env 文件中设置："
echo "  DB_HOST=mysql"
echo "  DB_PORT=3306"
echo "  DB_USER=newsapp"
echo "  DB_PASSWORD=NewsApp@2024"
echo "  DB_NAME=investment_tools"
echo ""
echo "方案B：删除 .env 文件，使用 docker-compose.yml 的默认配置"
echo "  rm /opt/newsapp/news/.env"
echo ""
echo "方案C：重新创建 MySQL 容器（如果用户创建失败）"
echo "  sudo docker compose down"
echo "  sudo docker volume rm news_mysql_data  # 警告：会删除所有数据！"
echo "  sudo docker compose up -d mysql"
echo "  sleep 30"
echo "  sudo docker compose up -d app"

