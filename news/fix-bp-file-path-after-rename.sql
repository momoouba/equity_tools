-- ============================================================
-- 修复因目录重命名导致的 bp_file_path 历史数据路径断链
-- 背景：uploads/竞品分析/bp/ 已重命名为 uploads/competitor-analysis/bp/
--       数据库 pre_investment_project.bp_file_path 列仍存旧路径
-- 运行前请先备份对应表；仅更新 bp_file_path 以 '竞品分析/' 开头的行
-- ============================================================

-- 1. 查看受影响行数（dry-run 用）
SELECT COUNT(*) AS affected_rows
  FROM pre_investment_project
 WHERE bp_file_path IS NOT NULL
   AND bp_file_path LIKE '竞品分析/%';

SELECT f_id, bp_file_path
  FROM pre_investment_project
 WHERE bp_file_path IS NOT NULL
   AND bp_file_path LIKE '竞品分析/%'
 LIMIT 20;

-- 2. 执行更新（把前缀 '竞品分析/' 替换为 'competitor-analysis/'）
UPDATE pre_investment_project
   SET bp_file_path = CONCAT('competitor-analysis/', SUBSTRING(bp_file_path, CHAR_LENGTH('竞品分析/') + 1))
 WHERE bp_file_path IS NOT NULL
   AND bp_file_path LIKE '竞品分析/%';

-- 3. 校验
SELECT COUNT(*) AS remaining_old
  FROM pre_investment_project
 WHERE bp_file_path IS NOT NULL
   AND bp_file_path LIKE '竞品分析/%';   -- 期望为 0
