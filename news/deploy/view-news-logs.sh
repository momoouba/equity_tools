#!/bin/bash

echo "=== 查看新闻接口日志 ==="
echo ""

# 检查应用容器是否运行
if ! sudo docker ps | grep -q newsapp; then
    echo "✗ 应用容器未运行"
    echo "请先启动应用容器："
    echo "  sudo docker compose up -d app"
    exit 1
fi

echo "选择查看方式："
echo "1. 查看实时日志（推荐，按 Ctrl+C 退出）"
echo "2. 查看最近100行日志"
echo "3. 查看最近500行日志"
echo "4. 搜索企查查相关日志"
echo "5. 搜索新榜相关日志"
echo "6. 搜索错误日志"
echo ""

read -p "请选择 (1-6): " choice

case $choice in
    1)
        echo "=== 实时日志（按 Ctrl+C 退出）==="
        sudo docker compose logs -f app
        ;;
    2)
        echo "=== 最近100行日志 ==="
        sudo docker compose logs app --tail 100
        ;;
    3)
        echo "=== 最近500行日志 ==="
        sudo docker compose logs app --tail 500
        ;;
    4)
        echo "=== 企查查相关日志（最近200行）==="
        sudo docker compose logs app --tail 200 | grep -i "企查查\|qichacha"
        ;;
    5)
        echo "=== 新榜相关日志（最近200行）==="
        sudo docker compose logs app --tail 200 | grep -i "新榜\|新闻同步\|同步新闻"
        ;;
    6)
        echo "=== 错误日志（最近200行）==="
        sudo docker compose logs app --tail 200 | grep -i "error\|失败\|失败"
        ;;
    *)
        echo "无效选择，显示最近100行日志"
        sudo docker compose logs app --tail 100
        ;;
esac

echo ""
echo "=== 提示 ==="
echo "更多日志查看命令："
echo "  # 实时查看所有日志"
echo "  sudo docker compose logs -f app"
echo ""
echo "  # 查看最近N行日志"
echo "  sudo docker compose logs app --tail N"
echo ""
echo "  # 搜索特定关键词"
echo "  sudo docker compose logs app | grep '关键词'"
echo ""
echo "  # 查看特定时间段的日志（需要先导出）"
echo "  sudo docker compose logs app --since 1h"

