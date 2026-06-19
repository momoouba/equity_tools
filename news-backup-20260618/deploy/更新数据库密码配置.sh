#!/bin/bash

# 更新数据库密码配置脚本

# 应用目录
APP_DIR="/opt/newsapp/news"
ENV_FILE="${APP_DIR}/.env"

# 新的数据库密码
NEW_PASSWORD="Mqdqxygyqy!!!klklsys24678"

echo "=== 更新数据库密码配置 ==="

# 检查 .env 文件是否存在
if [ ! -f "$ENV_FILE" ]; then
    echo "错误: .env 文件不存在: $ENV_FILE"
    echo "正在创建 .env 文件..."
    
    # 创建 .env 文件
    cat > "$ENV_FILE" <<EOF
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=${NEW_PASSWORD}
DB_NAME=investment_tools
EOF
    echo "✓ 已创建 .env 文件"
else
    echo "✓ 找到 .env 文件: $ENV_FILE"
    
    # 备份原文件
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    echo "✓ 已备份原文件"
    
    # 显示当前配置
    echo ""
    echo "当前数据库配置:"
    grep "^DB_" "$ENV_FILE" || echo "未找到 DB_ 开头的配置"
    
    # 更新密码
    if grep -q "^DB_PASSWORD=" "$ENV_FILE"; then
        # 如果存在 DB_PASSWORD，更新它
        sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=${NEW_PASSWORD}|" "$ENV_FILE"
        echo "✓ 已更新 DB_PASSWORD"
    else
        # 如果不存在，添加它
        if grep -q "^DB_USER=" "$ENV_FILE"; then
            # 在 DB_USER 后面添加 DB_PASSWORD
            sed -i "/^DB_USER=/a DB_PASSWORD=${NEW_PASSWORD}" "$ENV_FILE"
        else
            # 如果 DB_USER 也不存在，添加到文件末尾
            echo "DB_PASSWORD=${NEW_PASSWORD}" >> "$ENV_FILE"
        fi
        echo "✓ 已添加 DB_PASSWORD"
    fi
    
    # 确保其他必要的配置存在
    if ! grep -q "^DB_HOST=" "$ENV_FILE"; then
        sed -i "1i DB_HOST=localhost" "$ENV_FILE"
        echo "✓ 已添加 DB_HOST"
    fi
    
    if ! grep -q "^DB_PORT=" "$ENV_FILE"; then
        sed -i "/^DB_HOST=/a DB_PORT=3306" "$ENV_FILE"
        echo "✓ 已添加 DB_PORT"
    fi
    
    if ! grep -q "^DB_USER=" "$ENV_FILE"; then
        sed -i "/^DB_PORT=/a DB_USER=root" "$ENV_FILE"
        echo "✓ 已添加 DB_USER"
    fi
    
    if ! grep -q "^DB_NAME=" "$ENV_FILE"; then
        sed -i "/^DB_PASSWORD=/a DB_NAME=investment_tools" "$ENV_FILE"
        echo "✓ 已添加 DB_NAME"
    fi
fi

# 显示更新后的配置
echo ""
echo "=== 更新后的数据库配置 ==="
grep "^DB_" "$ENV_FILE"

# 验证配置
echo ""
echo "=== 验证配置 ==="
if grep -q "DB_PASSWORD=${NEW_PASSWORD}" "$ENV_FILE"; then
    echo "✓ 密码配置正确"
else
    echo "✗ 警告: 密码配置可能不正确"
fi

echo ""
echo "=== 完成 ==="
echo "请执行以下命令重启应用:"
echo "  pm2 restart newsapp"
echo ""
echo "或者查看日志:"
echo "  pm2 logs newsapp --lines 20"

