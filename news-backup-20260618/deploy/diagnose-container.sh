#!/bin/bash

echo "=== 检查 newsapp 容器状态 ==="
sudo docker ps -a | grep newsapp

echo ""
echo "=== 查看 newsapp 容器日志（最后50行） ==="
sudo docker logs newsapp --tail 50

echo ""
echo "=== 查看 newsapp 容器健康检查状态 ==="
sudo docker inspect newsapp --format='{{json .State.Health}}' | python3 -m json.tool 2>/dev/null || sudo docker inspect newsapp | grep -A 10 Health

echo ""
echo "=== 检查应用是否能访问数据库 ==="
sudo docker exec newsapp-mysql mysql -u root -p${MYSQL_ROOT_PASSWORD:-RootPassword123!} -e "SELECT 1;" 2>/dev/null || echo "无法连接到 MySQL"

echo ""
echo "=== 检查环境变量 ==="
sudo docker exec newsapp env | grep -E "DB_|NODE_ENV|PORT" || echo "容器未运行，无法检查环境变量"

echo ""
echo "=== 尝试进入容器检查 ==="
echo "执行以下命令进入容器："
echo "sudo docker exec -it newsapp sh"

