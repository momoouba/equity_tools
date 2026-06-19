#!/bin/bash
# 查看完整的邮件发送日志（不过滤）

echo "=== 查看完整的邮件发送日志（不过滤） ==="
echo ""

# 方法1：查看最近100行日志（不过滤）
echo "方法1：查看最近100行日志（不过滤）"
echo "命令：docker compose logs --tail 100 app"
echo ""
docker compose logs --tail 100 app

echo ""
echo "=== 分隔线 ==="
echo ""

# 方法2：实时查看所有日志（不过滤）
echo "方法2：实时查看所有日志（不过滤）"
echo "命令：docker compose logs -f app"
echo "（按 Ctrl+C 退出）"
echo ""

# 方法3：查看最近10分钟的日志（不过滤）
echo "方法3：查看最近10分钟的日志（不过滤）"
echo "命令：docker compose logs --since 10m app"
echo ""
docker compose logs --since 10m app

echo ""
echo "=== 使用说明 ==="
echo ""
echo "1. 查看所有日志（不过滤）："
echo "   docker compose logs app"
echo ""
echo "2. 实时查看日志（发送邮件时使用）："
echo "   docker compose logs -f app"
echo ""
echo "3. 查看最近100行日志："
echo "   docker compose logs --tail 100 app"
echo ""
echo "4. 查看最近5分钟的日志："
echo "   docker compose logs --since 5m app"
echo ""
echo "5. 只查看邮件发送相关日志（过滤）："
echo "   docker compose logs app | grep '邮件发送'"
echo ""

