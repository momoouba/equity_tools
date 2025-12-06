#!/bin/bash

echo "=== 检查应用容器的数据库配置 ==="
echo ""

# 检查应用容器是否运行
if ! sudo docker ps | grep -q newsapp; then
    echo "✗ 应用容器未运行"
    exit 1
fi

echo "1. 检查应用容器的环境变量..."
echo "----------------------------------------"
sudo docker exec newsapp env | grep -E "DB_|MYSQL_" | sort

echo ""
echo "2. 检查应用容器中是否有 .env 文件..."
echo "----------------------------------------"
if sudo docker exec newsapp test -f /app/.env; then
    echo "✓ .env 文件存在"
    echo "内容："
    sudo docker exec newsapp cat /app/.env | grep -E "DB_|MYSQL_" | head -10
else
    echo "✗ .env 文件不存在（这是正常的，如果使用 docker-compose.yml 的环境变量）"
fi

echo ""
echo "3. 检查 docker-compose.yml 中的配置..."
echo "----------------------------------------"
cd /opt/newsapp/news
grep -A 10 "app:" docker-compose.yml | grep -E "DB_|MYSQL_|environment:"

echo ""
echo "4. 对比配置..."
echo "----------------------------------------"
echo "MySQL 容器中的用户密码："
echo "  用户: newsapp"
echo "  密码: NewsApp@2024 (刚重置的)"
echo ""
echo "应用容器应该使用的配置："
echo "  DB_HOST=mysql"
echo "  DB_USER=newsapp"
echo "  DB_PASSWORD=NewsApp@2024"
echo "  DB_NAME=investment_tools"

echo ""
echo "5. 如果配置不一致，需要："
echo "  - 确保 docker-compose.yml 中 DB_PASSWORD=NewsApp@2024"
echo "  - 或者删除/修改 .env 文件"
echo "  - 重新创建应用容器：sudo docker compose up -d --force-recreate app"

