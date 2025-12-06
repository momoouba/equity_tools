#!/bin/bash

echo "=== 创建 MySQL 用户并修复权限 ==="
echo ""

# MySQL 容器配置
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-RootPassword123!}
DB_USER=${DB_USER:-newsapp}
DB_PASSWORD=${DB_PASSWORD:-NewsApp@2024}
DB_NAME=${DB_NAME:-investment_tools}

echo "配置信息："
echo "  MySQL Root Password: ${MYSQL_ROOT_PASSWORD}"
echo "  DB User: ${DB_USER}"
echo "  DB Password: ${DB_PASSWORD}"
echo "  DB Name: ${DB_NAME}"
echo ""

# 检查 MySQL 容器是否运行
if ! sudo docker ps | grep -q newsapp-mysql; then
    echo "错误：MySQL 容器未运行"
    echo "请先启动 MySQL 容器："
    echo "  sudo docker compose up -d mysql"
    exit 1
fi

echo "1. 连接到 MySQL 容器并创建用户..."
sudo docker exec -i newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} <<EOF
-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 删除已存在的用户（如果存在）
DROP USER IF EXISTS '${DB_USER}'@'%';
DROP USER IF EXISTS '${DB_USER}'@'localhost';

-- 创建新用户（允许从任何主机连接）
CREATE USER '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
CREATE USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';

-- 授予权限
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 显示用户信息
SELECT User, Host FROM mysql.user WHERE User='${DB_USER}';

-- 测试连接
SELECT 'User created successfully!' AS Status;
EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ MySQL 用户创建成功！"
    echo ""
    echo "2. 测试连接..."
    sudo docker exec newsapp-mysql mysql -u ${DB_USER} -p${DB_PASSWORD} -e "SELECT 1;" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "✓ 连接测试成功！"
    else
        echo "✗ 连接测试失败"
    fi
else
    echo ""
    echo "✗ 用户创建失败，请检查 MySQL 容器日志："
    echo "  sudo docker logs newsapp-mysql"
fi

echo ""
echo "3. 重启应用容器..."
sudo docker compose restart app

echo ""
echo "4. 查看应用日志..."
echo "执行以下命令查看日志："
echo "  sudo docker compose logs -f app"

