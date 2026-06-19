#!/bin/bash

# Docker 部署脚本
# 使用方法: ./deploy/docker-deploy.sh

set -e

echo "=========================================="
echo "  新闻管理系统 Docker 部署脚本"
echo "=========================================="
echo ""

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装，请先安装 Docker"
    echo "   参考: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose 未安装，请先安装 Docker Compose"
    echo "   参考: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✓ Docker 和 Docker Compose 已安装"
echo ""

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，正在创建..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "✓ 已从 .env.example 创建 .env 文件"
        echo "⚠️  请编辑 .env 文件，修改数据库密码等配置"
        read -p "按 Enter 继续，或 Ctrl+C 取消..."
    else
        echo "❌ .env.example 文件不存在，无法创建 .env"
        exit 1
    fi
fi

echo "✓ 环境变量文件检查完成"
echo ""

# 创建必要的目录
echo "正在创建必要的目录..."
mkdir -p uploads logs/nginx deploy/ssl
echo "✓ 目录创建完成"
echo ""

# 检查 Nginx 配置
if [ ! -f deploy/nginx-site.conf ]; then
    echo "⚠️  Nginx 配置文件不存在，正在创建..."
    if [ -f deploy/nginx-docker.conf ]; then
        cp deploy/nginx-docker.conf deploy/nginx-site.conf
        echo "✓ 已创建 Nginx 配置文件"
    else
        echo "❌ deploy/nginx-docker.conf 文件不存在"
        exit 1
    fi
fi

echo "✓ Nginx 配置检查完成"
echo ""

# 构建和启动服务
echo "正在构建 Docker 镜像..."
docker compose build

echo ""
echo "正在启动服务..."
docker compose up -d

echo ""
echo "等待服务启动..."
sleep 10

# 检查服务状态
echo ""
echo "=========================================="
echo "  服务状态"
echo "=========================================="
docker compose ps

echo ""
echo "=========================================="
echo "  部署完成！"
echo "=========================================="
echo ""
echo "服务访问地址:"
echo "  - HTTP:  http://localhost"
echo "  - API:   http://localhost/api"
echo "  - 健康检查: http://localhost/api/health"
echo ""
echo "常用命令:"
echo "  - 查看日志: docker compose logs -f"
echo "  - 停止服务: docker compose down"
echo "  - 重启服务: docker compose restart"
echo "  - 查看状态: docker compose ps"
echo ""
echo "⚠️  请确保已修改 .env 文件中的默认密码！"
echo ""

