-- 第三方公众号 wechat_account_id 唯一约束迁移
-- 从「全局唯一」改为「同一用户(creator_user_id)下唯一」
-- 即：不同用户可创建相同的 wechat_account_id，同一用户下 wechat_account_id 不可重复
--
-- 使用方法：在 MySQL 中执行本脚本（连接 investment_tools 数据库后执行）
-- 若使用 Docker: docker compose exec mysql mysql -u newsapp -p investment_tools < additional_wechat_accounts_unique_constraint_migration.sql

USE investment_tools;

-- 1. 删除旧的 wechat_account_id 全局唯一约束
ALTER TABLE additional_wechat_accounts DROP INDEX wechat_account_id;

-- 2. 添加新的 (creator_user_id, wechat_account_id) 联合唯一约束
ALTER TABLE additional_wechat_accounts ADD UNIQUE KEY uk_creator_wechat (creator_user_id, wechat_account_id);
