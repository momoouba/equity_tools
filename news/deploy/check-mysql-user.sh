#!/bin/bash

echo "=== 检查 MySQL 容器中的用户 ==="
echo ""

# 检查 MySQL 容器是否运行
if ! sudo docker ps | grep -q newsapp-mysql; then
    echo "✗ MySQL 容器未运行"
    echo "请先启动 MySQL 容器："
    echo "  sudo docker compose up -d mysql"
    exit 1
fi

echo "✓ MySQL 容器正在运行"
echo ""

# MySQL root 密码（从环境变量或使用默认值）
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-RootPassword123!}

echo "1. 检查所有 MySQL 用户..."
echo "----------------------------------------"
sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SELECT User, Host FROM mysql.user ORDER BY User, Host;" 2>/dev/null

if [ $? -ne 0 ]; then
    echo "✗ 无法连接到 MySQL，请检查 root 密码"
    echo "尝试使用默认密码 RootPassword123!"
    echo ""
    echo "如果密码不同，请设置环境变量："
    echo "  export MYSQL_ROOT_PASSWORD=你的密码"
    exit 1
fi

echo ""
echo "2. 检查 newsapp 用户是否存在..."
echo "----------------------------------------"
sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SELECT User, Host FROM mysql.user WHERE User='newsapp';" 2>/dev/null

USER_EXISTS=$(sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SELECT COUNT(*) FROM mysql.user WHERE User='newsapp';" -s -N 2>/dev/null)

if [ "$USER_EXISTS" -gt 0 ]; then
    echo ""
    echo "✓ newsapp 用户存在"
    echo ""
    echo "3. 检查 newsapp 用户的权限..."
    echo "----------------------------------------"
    sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SHOW GRANTS FOR 'newsapp'@'%';" 2>/dev/null
    echo ""
    sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SHOW GRANTS FOR 'newsapp'@'localhost';" 2>/dev/null
    
    echo ""
    echo "4. 测试 newsapp 用户连接..."
    echo "----------------------------------------"
    sudo docker exec newsapp-mysql mysql -u newsapp -pNewsApp@2024 -e "SELECT 'Connection successful!' AS Status, USER() AS CurrentUser, DATABASE() AS CurrentDatabase;" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ newsapp 用户可以正常连接"
    else
        echo "✗ newsapp 用户无法连接，可能是密码错误"
    fi
    
    echo ""
    echo "5. 检查数据库是否存在..."
    echo "----------------------------------------"
    sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "SHOW DATABASES LIKE 'investment_tools';" 2>/dev/null
    
else
    echo ""
    echo "✗ newsapp 用户不存在！"
    echo ""
    echo "需要创建用户，执行以下命令："
    echo "  chmod +x deploy/create-mysql-user.sh"
    echo "  ./deploy/create-mysql-user.sh"
    echo ""
    echo "或者手动创建："
    echo "  sudo docker exec -i newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} <<'EOF'"
    echo "  CREATE USER 'newsapp'@'%' IDENTIFIED BY 'NewsApp@2024';"
    echo "  CREATE USER 'newsapp'@'localhost' IDENTIFIED BY 'NewsApp@2024';"
    echo "  GRANT ALL PRIVILEGES ON \`investment_tools\`.* TO 'newsapp'@'%';"
    echo "  GRANT ALL PRIVILEGES ON \`investment_tools\`.* TO 'newsapp'@'localhost';"
    echo "  FLUSH PRIVILEGES;"
    echo "  EOF"
fi

echo ""
echo "=== 检查完成 ==="

