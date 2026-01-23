-- ============================================
-- 邮件发送查询SQL测试
-- ============================================

-- 1. 首先测试直接查询这条新闻的fund和sub_fund字段
SELECT 
    id, 
    title, 
    enterprise_full_name, 
    entity_type,
    fund, 
    sub_fund,
    created_at
FROM news_detail 
WHERE id = '2026012106003000001';

-- 2. 测试完整的邮件查询SQL（简化版，针对这条新闻）
-- 注意：需要根据实际情况替换参数
SELECT DISTINCT 
    nd.id, 
    nd.title, 
    nd.enterprise_full_name, 
    nd.news_sentiment, 
    nd.keywords,
    nd.news_abstract, 
    nd.summary, 
    nd.content, 
    nd.public_time, 
    nd.account_name, 
    nd.wechat_account, 
    nd.source_url, 
    nd.created_at,
    nd.APItype, 
    nd.news_category, 
    nd.entity_type, 
    nd.fund, 
    nd.sub_fund,
    COALESCE(ie.project_abbreviation, '') as project_abbreviation
FROM news_detail nd
LEFT JOIN invested_enterprises ie ON (
    nd.enterprise_full_name = ie.enterprise_full_name 
    OR (CASE 
        WHEN nd.enterprise_full_name LIKE '%(%' THEN 
            TRIM(SUBSTRING_INDEX(nd.enterprise_full_name, '(', 1))
        ELSE 
            nd.enterprise_full_name
    END) = ie.enterprise_full_name
    OR nd.enterprise_full_name = (CASE 
        WHEN ie.enterprise_full_name LIKE '%(%' THEN 
            TRIM(SUBSTRING_INDEX(ie.enterprise_full_name, '(', 1))
        ELSE 
            ie.enterprise_full_name
    END)
) AND ie.delete_mark = 0
WHERE nd.id = '2026012106003000001'
    AND nd.delete_mark = 0
ORDER BY nd.enterprise_full_name, nd.public_time DESC;

-- 3. 测试不使用DISTINCT的查询
SELECT 
    nd.id, 
    nd.title, 
    nd.enterprise_full_name, 
    nd.entity_type,
    nd.fund, 
    nd.sub_fund,
    COALESCE(ie.project_abbreviation, '') as project_abbreviation
FROM news_detail nd
LEFT JOIN invested_enterprises ie ON (
    nd.enterprise_full_name = ie.enterprise_full_name 
    OR (CASE 
        WHEN nd.enterprise_full_name LIKE '%(%' THEN 
            TRIM(SUBSTRING_INDEX(nd.enterprise_full_name, '(', 1))
        ELSE 
            nd.enterprise_full_name
    END) = ie.enterprise_full_name
) AND ie.delete_mark = 0
WHERE nd.id = '2026012106003000001'
    AND nd.delete_mark = 0;

-- 4. 测试不使用LEFT JOIN的查询（只查询news_detail表）
SELECT 
    id, 
    title, 
    enterprise_full_name, 
    entity_type,
    fund, 
    sub_fund,
    created_at
FROM news_detail 
WHERE id = '2026012106003000001'
    AND delete_mark = 0;

-- 5. 检查字段是否存在
SHOW COLUMNS FROM news_detail LIKE 'fund';
SHOW COLUMNS FROM news_detail LIKE 'sub_fund';

-- 6. 检查所有相关新闻的fund和sub_fund字段
SELECT 
    id, 
    enterprise_full_name, 
    entity_type,
    fund, 
    sub_fund
FROM news_detail 
WHERE entity_type IN ('子基金', '子基金管理人', '子基金GP')
    AND delete_mark = 0
    AND created_at >= DATE_SUB(CURDATE(), INTERVAL 1 DAY)
ORDER BY created_at DESC
LIMIT 20;
