#!/bin/bash

# 创建应用管理用户脚本
# 用于创建非root用户来管理应用

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# 配置变量
NEW_USER="${1:-guofang}"
APP_DIR="/opt/newsapp"
LOG_DIR="/var/log/newsapp"
APP_NAME="newsapp"

# 检查是否为root用户
if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}错误: 此脚本需要root权限运行${NC}"
    echo "请使用: sudo $0 [用户名]"
    exit 1
fi

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  创建应用管理用户: $NEW_USER${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 检查用户是否已存在
if id "$NEW_USER" &>/dev/null; then
    echo -e "${YELLOW}警告: 用户 $NEW_USER 已存在${NC}"
    read -p "是否继续配置此用户？(y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    # 创建用户
    echo -e "${BLUE}正在创建用户 $NEW_USER...${NC}"
    adduser --gecos "" "$NEW_USER"
    echo -e "${GREEN}✓ 用户创建成功${NC}"
    echo ""
    echo -e "${CYAN}用户密码已设置（在创建过程中输入）${NC}"
fi

# 添加到sudo组
echo ""
echo -e "${BLUE}配置sudo权限...${NC}"
if groups "$NEW_USER" | grep -q "\bsudo\b"; then
    echo -e "${GREEN}✓ 用户已在sudo组中${NC}"
else
    usermod -aG sudo "$NEW_USER"
    echo -e "${GREEN}✓ 已添加到sudo组${NC}"
fi

# 配置sudo免密码（可选，用于自动化脚本）
echo ""
read -p "是否配置sudo免密码？（用于自动化脚本，可选）(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    SUDOERS_FILE="/etc/sudoers.d/$NEW_USER"
    echo "$NEW_USER ALL=(ALL) NOPASSWD: ALL" > "$SUDOERS_FILE"
    chmod 0440 "$SUDOERS_FILE"
    echo -e "${GREEN}✓ 已配置sudo免密码${NC}"
fi

# 创建应用目录（如果不存在）
echo ""
echo -e "${BLUE}配置应用目录权限...${NC}"
if [[ ! -d "$APP_DIR" ]]; then
    mkdir -p "$APP_DIR"
    echo -e "${GREEN}✓ 创建应用目录: $APP_DIR${NC}"
fi

# 设置应用目录所有者
chown -R "$NEW_USER:$NEW_USER" "$APP_DIR"
echo -e "${GREEN}✓ 设置应用目录所有者: $NEW_USER${NC}"

# 创建日志目录（如果不存在）
if [[ ! -d "$LOG_DIR" ]]; then
    mkdir -p "$LOG_DIR"
    echo -e "${GREEN}✓ 创建日志目录: $LOG_DIR${NC}"
fi

# 设置日志目录所有者
chown -R "$NEW_USER:$NEW_USER" "$LOG_DIR"
echo -e "${GREEN}✓ 设置日志目录所有者: $NEW_USER${NC}"

# 设置或修改用户密码
echo ""
if id "$NEW_USER" &>/dev/null; then
    read -p "是否修改用户 $NEW_USER 的密码？(y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}请设置用户 $NEW_USER 的密码：${NC}"
        echo -e "${YELLOW}提示：密码输入时不会显示字符，请仔细输入${NC}"
        echo ""
        
        # 循环直到密码设置成功
        while true; do
            if passwd "$NEW_USER"; then
                echo -e "${GREEN}✓ 密码已更新${NC}"
                break
            else
                echo -e "${RED}✗ 密码设置失败${NC}"
                echo ""
                read -p "是否重试？(y/n) " -n 1 -r
                echo ""
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    echo -e "${YELLOW}跳过密码设置${NC}"
                    break
                fi
            fi
        done
    fi
fi

# 配置SSH密钥（可选）
echo ""
read -p "是否配置SSH密钥登录？（推荐）(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    SSH_DIR="/home/$NEW_USER/.ssh"
    mkdir -p "$SSH_DIR"
    chmod 700 "$SSH_DIR"
    
    echo -e "${CYAN}请选择配置方式：${NC}"
    echo "1. 从本地公钥文件复制（推荐）"
    echo "2. 手动输入公钥"
    echo "3. 跳过（稍后手动配置）"
    read -p "请选择 (1/2/3): " choice
    
    case $choice in
        1)
            read -p "请输入本地公钥文件路径（如 ~/.ssh/id_rsa.pub）: " pubkey_path
            if [[ -f "$pubkey_path" ]]; then
                cat "$pubkey_path" >> "$SSH_DIR/authorized_keys"
                chmod 600 "$SSH_DIR/authorized_keys"
                chown -R "$NEW_USER:$NEW_USER" "$SSH_DIR"
                echo -e "${GREEN}✓ SSH公钥已添加${NC}"
            else
                echo -e "${RED}✗ 文件不存在: $pubkey_path${NC}"
            fi
            ;;
        2)
            echo -e "${CYAN}请粘贴SSH公钥（以空行结束）：${NC}"
            while IFS= read -r line; do
                [[ -z "$line" ]] && break
                echo "$line" >> "$SSH_DIR/authorized_keys"
            done
            chmod 600 "$SSH_DIR/authorized_keys"
            chown -R "$NEW_USER:$NEW_USER" "$SSH_DIR"
            echo -e "${GREEN}✓ SSH公钥已添加${NC}"
            ;;
        3)
            echo -e "${YELLOW}跳过SSH密钥配置${NC}"
            ;;
    esac
fi

# 安装Node.js和PM2（如果未安装）
echo ""
read -p "是否为用户安装Node.js和PM2？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}检查Node.js安装...${NC}"
    if ! command -v node &> /dev/null; then
        echo "安装Node.js 18.x..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
        apt-get install -y nodejs
        echo -e "${GREEN}✓ Node.js安装完成${NC}"
    else
        echo -e "${GREEN}✓ Node.js已安装: $(node --version)${NC}"
    fi
    
    echo -e "${BLUE}检查PM2安装...${NC}"
    if ! command -v pm2 &> /dev/null; then
        echo "安装PM2..."
        npm install -g pm2
        echo -e "${GREEN}✓ PM2安装完成${NC}"
    else
        echo -e "${GREEN}✓ PM2已安装: $(pm2 --version)${NC}"
    fi
fi

# 配置PM2开机自启（以新用户身份）
echo ""
read -p "是否配置PM2开机自启？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}配置PM2开机自启...${NC}"
    sudo -u "$NEW_USER" pm2 startup systemd -u "$NEW_USER" --hp "/home/$NEW_USER"
    echo -e "${GREEN}✓ PM2开机自启已配置${NC}"
    echo -e "${YELLOW}注意: 请按照上面的提示执行命令${NC}"
fi

# 创建用户使用说明文件
echo ""
echo -e "${BLUE}创建用户使用说明...${NC}"
cat > "/home/$NEW_USER/README_USER.md" <<EOF
# 用户 $NEW_USER 使用说明

## 基本信息

- 用户名: $NEW_USER
- 应用目录: $APP_DIR
- 日志目录: $LOG_DIR

## 常用命令

### 切换到应用目录
\`\`\`bash
cd $APP_DIR
\`\`\`

### 使用PM2管理应用
\`\`\`bash
# 启动应用
pm2 start deploy/ecosystem.config.js

# 查看日志
pm2 logs $APP_NAME

# 重启应用
pm2 restart $APP_NAME

# 停止应用
pm2 stop $APP_NAME

# 查看状态
pm2 status

# 保存配置
pm2 save
\`\`\`

### 查看日志
\`\`\`bash
# 使用脚本查看
cd $APP_DIR
./deploy/view-logs.sh --pm2

# 或直接使用PM2
pm2 logs $APP_NAME
\`\`\`

### 使用sudo
\`\`\`bash
# 需要root权限的操作
sudo systemctl restart nginx
sudo systemctl restart mysql
\`\`\`

## SSH登录

如果配置了SSH密钥，可以使用：
\`\`\`bash
ssh $NEW_USER@服务器IP
\`\`\`

## 注意事项

1. 不要使用root用户运行应用
2. 应用文件已设置为 $NEW_USER 所有
3. 日志文件在 $LOG_DIR 目录
4. 使用PM2管理应用进程

EOF

chown "$NEW_USER:$NEW_USER" "/home/$NEW_USER/README_USER.md"
echo -e "${GREEN}✓ 使用说明已创建: /home/$NEW_USER/README_USER.md${NC}"

# 完成
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}用户配置完成！${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${CYAN}用户信息：${NC}"
echo "  用户名: $NEW_USER"
echo "  主目录: /home/$NEW_USER"
echo "  应用目录: $APP_DIR"
echo "  日志目录: $LOG_DIR"
echo ""
echo -e "${CYAN}下一步：${NC}"
echo "1. 切换到新用户:"
echo "   su - $NEW_USER"
echo ""
echo "2. 或使用SSH登录:"
echo "   ssh $NEW_USER@服务器IP"
echo ""
echo "3. 查看使用说明:"
echo "   cat /home/$NEW_USER/README_USER.md"
echo ""
echo -e "${CYAN}重要提示：${NC}"
echo "- 应用目录权限已设置为 $NEW_USER 所有"
echo "- 可以使用sudo执行需要root权限的操作"
echo "- 建议使用SSH密钥登录，禁用密码登录"
echo ""

