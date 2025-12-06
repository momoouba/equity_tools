#!/bin/bash

# 检查数据丢失问题的脚本
# 使用方法: ./deploy/check-data-loss.sh

echo "=========================================="
echo "检查数据丢失问题"
echo "=========================================="

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo "错误: 请在项目根目录执行此脚本"
    exit 1
fi

echo ""
echo "步骤 1: 检查数据库连接"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "SELECT '数据库连接成功' AS status;" || {
    echo "错误: 无法连接到数据库"
    exit 1
}

echo ""
echo "步骤 2: 检查新闻数据总数"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "
SELECT 
    '总数据量' AS type,
    COUNT(*) AS count
FROM news_detail
UNION ALL
SELECT 
    '未删除数据',
    COUNT(*)
FROM news_detail
WHERE delete_mark = 0
UNION ALL
SELECT 
    '已删除数据',
    COUNT(*)
FROM news_detail
WHERE delete_mark = 1;
"

echo ""
echo "步骤 3: 按日期统计数据量"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "
SELECT 
    DATE(public_time) AS date,
    COUNT(*) AS count
FROM news_detail
WHERE delete_mark = 0
GROUP BY DATE(public_time)
ORDER BY date DESC
LIMIT 30;
"

echo ""
echo "步骤 4: 检查11月23日之前的数据"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "
SELECT 
    '11月23日之前的数据量' AS type,
    COUNT(*) AS count
FROM news_detail
WHERE public_time < '2024-11-23 00:00:00' AND delete_mark = 0;
"

echo ""
echo "步骤 5: 检查最早和最晚的数据时间"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "
SELECT 
    '最早数据时间' AS type,
    MIN(public_time) AS time
FROM news_detail
WHERE delete_mark = 0
UNION ALL
SELECT 
    '最晚数据时间',
    MAX(public_time)
FROM news_detail
WHERE delete_mark = 0;
"

echo ""
echo "步骤 6: 检查是否有表迁移的日志"
echo "----------------------------------------"
echo "检查应用日志中是否有表迁移相关信息..."
sudo docker compose logs app 2>/dev/null | grep -i "迁移\|清空\|truncate\|drop\|migrate" | tail -20 || echo "未找到相关日志"

echo ""
echo "步骤 7: 检查新闻接口配置的最后同步时间"
echo "----------------------------------------"
sudo docker compose exec mysql mysql -u newsapp -pNewsApp@2024 investment_tools -e "
SELECT 
    id,
    interface_type,
    last_sync_time,
    last_sync_date,
    created_at
FROM news_interface_config
WHERE is_deleted = 0
ORDER BY last_sync_time DESC;
"

echo ""
echo "=========================================="
echo "检查完成！"
echo "=========================================="
echo ""
echo "如果发现数据丢失，可以尝试："
echo "1. 检查逻辑删除的数据: SELECT * FROM news_detail WHERE delete_mark = 1 LIMIT 10;"
echo "2. 恢复逻辑删除的数据: UPDATE news_detail SET delete_mark = 0 WHERE delete_mark = 1 AND public_time < '2024-11-23';"
echo "3. 检查数据库备份: ls -lh /opt/newsapp/news/backup/ 2>/dev/null || echo '未找到备份目录'"
echo ""

