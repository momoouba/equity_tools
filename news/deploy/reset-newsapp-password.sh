#!/bin/bash

echo "=== 重置 newsapp 用户密码 ==="
echo ""

# MySQL root 密码
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD:-RootPassword123!}

# 新密码（与应用配置一致）
NEW_PASSWORD="NewsApp@2024"

echo "正在重置 newsapp 用户密码为: ${NEW_PASSWORD}"
echo ""

# 重置密码
sudo docker exec -i newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} <<EOF
-- 重置 newsapp@% 的密码
ALTER USER 'newsapp'@'%' IDENTIFIED BY '${NEW_PASSWORD}';

-- 重置 newsapp@localhost 的密码
ALTER USER 'newsapp'@'localhost' IDENTIFIED BY '${NEW_PASSWORD}';

-- 刷新权限
FLUSH PRIVILEGES;

-- 验证密码
SELECT 'Password reset successful!' AS Status;
EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ 密码重置成功！"
    echo ""
    echo "测试连接..."
    sudo docker exec newsapp-mysql mysql -u newsapp -p${NEW_PASSWORD} -e "SELECT 'Connection successful!' AS Status, USER() AS CurrentUser;" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✓ 连接测试成功！"
        echo ""
        echo "现在可以重启应用容器："
        echo "  sudo docker compose restart app"
        echo "  sudo docker compose logs -f app"
    else
        echo "✗ 连接测试失败，请检查密码"
    fi
else
    echo ""
    echo "✗ 密码重置失败"
    echo "请检查 MySQL root 密码是否正确"
fi

