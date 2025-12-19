#!/bin/bash
set -e

echo "=== 开始部署Python支持更新 ==="

# 进入项目目录
cd /opt/newsapp/news || cd "$(dirname "$0")/.."

# 备份当前容器
echo "备份当前容器..."
docker commit newsapp newsapp-backup:$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "备份跳过（容器可能不存在）"

# 停止应用
echo "停止应用容器..."
sudo docker compose stop app || echo "容器已停止"

# 重新构建镜像
echo "重新构建Docker镜像（包含Python支持）..."
sudo docker compose build --no-cache app

# 启动应用
echo "启动应用容器..."
sudo docker compose up -d app

# 等待应用启动
echo "等待应用启动（30秒）..."
sleep 30

# 验证Python环境
echo "验证Python环境..."
if sudo docker exec newsapp python --version > /dev/null 2>&1; then
    echo "✓ Python已安装:"
    sudo docker exec newsapp python --version
else
    echo "✗ Python未安装或无法执行"
    exit 1
fi

# 检查Python依赖
echo "检查Python依赖..."
if sudo docker exec newsapp pip list | grep -q requests; then
    echo "✓ Python依赖已安装"
    sudo docker exec newsapp pip list | grep -E "requests|beautifulsoup4|lxml|Pillow"
else
    echo "✗ Python依赖未安装，尝试安装..."
    sudo docker exec newsapp pip install --no-cache-dir -r /app/server/utils/requirements.txt
fi

# 检查应用健康状态
echo "检查应用健康状态..."
for i in {1..10}; do
    if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
        echo "✓ 应用健康检查通过"
        break
    else
        echo "等待应用启动... ($i/10)"
        sleep 5
    fi
done

# 查看应用日志
echo "查看应用启动日志（最后50行）..."
sudo docker compose logs app --tail 50

echo ""
echo "=== 部署完成 ==="
echo "请检查上面的日志确认应用正常启动"
echo "如果遇到问题，请查看完整日志: sudo docker compose logs app --tail 200"

