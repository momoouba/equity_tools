#!/bin/bash

# 一键安装 Node.js 和 PM2 脚本
# 适用于 Ubuntu/Debian 系统

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Node.js 和 PM2 一键安装脚本${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# 检查是否为root用户
if [[ $EUID -eq 0 ]]; then
    echo -e "${YELLOW}警告: 检测到使用root用户${NC}"
    echo -e "${YELLOW}建议使用普通用户运行，脚本会在需要时使用sudo${NC}"
    read -p "是否继续？(y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 检查 Node.js 是否已安装
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ 检测到已安装 Node.js: $NODE_VERSION${NC}"
    
    # 检查版本
    MAJOR_VERSION=$(echo $NODE_VERSION | cut -d'.' -f1 | sed 's/v//')
    if [[ $MAJOR_VERSION -ge 18 ]]; then
        echo -e "${GREEN}✓ Node.js 版本满足要求（>= 18.x）${NC}"
        SKIP_NODE=true
    else
        echo -e "${YELLOW}⚠ Node.js 版本过低，需要升级${NC}"
        SKIP_NODE=false
    fi
else
    echo -e "${YELLOW}⚠ 未检测到 Node.js${NC}"
    SKIP_NODE=false
fi

# 检查 npm 是否已安装
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "${GREEN}✓ 检测到已安装 npm: $NPM_VERSION${NC}"
else
    echo -e "${YELLOW}⚠ 未检测到 npm${NC}"
    SKIP_NODE=false
fi

# 安装 Node.js（如果需要）
if [[ "$SKIP_NODE" == "false" ]]; then
    echo ""
    echo -e "${BLUE}正在安装 Node.js 18.x...${NC}"
    
    # 更新系统
    echo "更新系统包列表..."
    sudo apt update
    
    # 安装 Node.js 18.x
    echo "添加 NodeSource 仓库..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    
    echo "安装 Node.js..."
    sudo apt-get install -y nodejs
    
    echo -e "${GREEN}✓ Node.js 安装完成${NC}"
else
    echo -e "${GREEN}✓ 跳过 Node.js 安装${NC}"
fi

# 验证 Node.js 和 npm
echo ""
echo -e "${BLUE}验证安装...${NC}"
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✓ Node.js: $NODE_VERSION${NC}"
echo -e "${GREEN}✓ npm: $NPM_VERSION${NC}"

# 检查 PM2 是否已安装
if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    echo -e "${GREEN}✓ 检测到已安装 PM2: $PM2_VERSION${NC}"
    SKIP_PM2=true
else
    echo -e "${YELLOW}⚠ 未检测到 PM2${NC}"
    SKIP_PM2=false
fi

# 安装 PM2（如果需要）
if [[ "$SKIP_PM2" == "false" ]]; then
    echo ""
    echo -e "${BLUE}正在安装 PM2...${NC}"
    npm install -g pm2
    echo -e "${GREEN}✓ PM2 安装完成${NC}"
else
    echo -e "${GREEN}✓ 跳过 PM2 安装${NC}"
fi

# 验证 PM2
if command -v pm2 &> /dev/null; then
    PM2_VERSION=$(pm2 --version)
    echo -e "${GREEN}✓ PM2: $PM2_VERSION${NC}"
fi

# 完成
echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${GREEN}安装完成！${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "${CYAN}下一步：${NC}"
echo "1. 使用 PM2 启动应用："
echo "   pm2 start deploy/ecosystem.config.js"
echo ""
echo "2. 查看日志："
echo "   pm2 logs newsapp"
echo "   或"
echo "   ./deploy/view-logs.sh --pm2"
echo ""
echo "3. 设置 PM2 开机自启："
echo "   pm2 startup"
echo "   pm2 save"
echo ""

