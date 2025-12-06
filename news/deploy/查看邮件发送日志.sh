#!/bin/bash
# 查看邮件发送相关日志

echo "=== 查看邮件发送日志 ==="
echo ""

# 方法1：查看最近的邮件发送日志（包含所有相关日志）
echo "方法1：查看最近的邮件发送日志（推荐）"
echo "命令：docker compose logs app | grep -E '邮件发送|管理员' | tail -50"
echo ""
docker compose logs app | grep -E '邮件发送|管理员' | tail -50

echo ""
echo "=== 分隔线 ==="
echo ""

# 方法2：查看所有应用日志（实时）
echo "方法2：实时查看所有应用日志"
echo "命令：docker compose logs -f app"
echo "（按 Ctrl+C 退出）"
echo ""

# 方法3：查看特定时间段的日志
echo "方法3：查看最近10分钟的日志"
echo "命令：docker compose logs --since 10m app | grep -E '邮件发送|管理员'"
echo ""
docker compose logs --since 10m app | grep -E '邮件发送|管理员'

echo ""
echo "=== 完整日志查看方法 ==="
echo ""
echo "1. 查看所有邮件发送相关日志："
echo "   docker compose logs app | grep '邮件发送'"
echo ""
echo "2. 实时查看日志（发送邮件时使用）："
echo "   docker compose logs -f app | grep '邮件发送'"
echo ""
echo "3. 查看最近100行日志："
echo "   docker compose logs --tail 100 app | grep '邮件发送'"
echo ""
echo "4. 查看最近5分钟的日志："
echo "   docker compose logs --since 5m app | grep '邮件发送'"
echo ""

