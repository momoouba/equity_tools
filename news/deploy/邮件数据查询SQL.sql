-- ============================================
-- 邮件数据查询SQL（管理员）
-- 时间范围：2025-12-03 00:00:00 到 2025-12-04 00:00:00
-- 使用方法：直接在MySQL客户端或Navicat中执行
-- ============================================

-- ============================================
-- 【推荐】步骤4：完整的邮件数据查询SQL（管理员）
-- 此查询对应邮件发送逻辑，直接执行此查询即可
-- ============================================
SELECT DISTINCT 
    nd.id, 
    nd.title, 
    nd.enterprise_full_name, 
    nd.news_sentiment, 
    nd.keywords, 
    nd.news_abstract, 
    nd.content, 
    nd.public_time, 
    nd.account_name, 
    nd.wechat_account,
    nd.source_url, 
    nd.created_at,
    nd.APItype, 
    nd.news_category
FROM news_detail nd
WHERE (
    -- 方式1：通过公众号ID匹配（支持逗号分隔的公众号ID）
    EXISTS (
        SELECT 1 
        FROM invested_enterprises ie
        WHERE ie.exit_status NOT IN ('完全退出', '已上市')
        AND ie.wechat_official_account_id IS NOT NULL 
        AND ie.wechat_official_account_id != ''
        AND ie.delete_mark = 0
        AND (
            -- 完全匹配
            nd.wechat_account = ie.wechat_official_account_id
            -- 或者公众号ID在逗号分隔的列表中
            OR FIND_IN_SET(nd.wechat_account, ie.wechat_official_account_id) > 0
            OR FIND_IN_SET(ie.wechat_official_account_id, nd.wechat_account) > 0
        )
    )
    OR
    -- 方式2：通过企业全称匹配
    (nd.enterprise_full_name IS NOT NULL 
     AND nd.enterprise_full_name != ''
     AND EXISTS (
        SELECT 1
        FROM invested_enterprises ie
        WHERE ie.enterprise_full_name = nd.enterprise_full_name
        AND ie.exit_status NOT IN ('完全退出', '已上市')
        AND ie.delete_mark = 0
     ))
)
AND nd.public_time >= '2025-12-03 00:00:00' 
AND nd.public_time < '2025-12-04 00:00:00'
AND nd.delete_mark = 0
ORDER BY nd.enterprise_full_name, nd.public_time DESC;

-- ============================================
-- 以下为诊断查询，用于排查问题
-- ============================================

-- 步骤1：查询满足条件的被投企业的公众号ID
SELECT DISTINCT 
    wechat_official_account_id,
    enterprise_full_name,
    exit_status
FROM invested_enterprises 
WHERE exit_status NOT IN ('完全退出', '已上市')
AND wechat_official_account_id IS NOT NULL 
AND wechat_official_account_id != ''
AND delete_mark = 0;

-- 步骤2：查询时间范围内的总新闻数
SELECT COUNT(*) as total_count
FROM news_detail 
WHERE public_time >= '2025-12-03 00:00:00' 
AND public_time < '2025-12-04 00:00:00'
AND delete_mark = 0;

-- 步骤3：查询时间范围内的新闻详情（前10条）
SELECT 
    id,
    title,
    enterprise_full_name,
    wechat_account,
    account_name,
    public_time,
    news_abstract,
    content,
    APItype,
    news_category,
    delete_mark
FROM news_detail 
WHERE public_time >= '2025-12-03 00:00:00' 
AND public_time < '2025-12-04 00:00:00'
AND delete_mark = 0
ORDER BY public_time DESC
LIMIT 10;

-- 步骤5：简化版本 - 直接查询所有时间范围内的新闻（不限制公众号）
SELECT DISTINCT 
    nd.id, 
    nd.title, 
    nd.enterprise_full_name, 
    nd.wechat_account,
    nd.account_name,
    nd.public_time, 
    nd.news_abstract, 
    nd.content,
    nd.APItype, 
    nd.news_category
FROM news_detail nd
WHERE nd.public_time >= '2025-12-03 00:00:00' 
AND nd.public_time < '2025-12-04 00:00:00'
AND nd.delete_mark = 0
ORDER BY nd.public_time DESC;

-- 步骤6：检查公众号ID匹配情况
-- 查询被投企业表中的公众号ID和新闻表中的wechat_account是否匹配
SELECT 
    ie.wechat_official_account_id as invested_enterprise_account,
    ie.enterprise_full_name as invested_enterprise_name,
    COUNT(DISTINCT nd.id) as matched_news_count
FROM invested_enterprises ie
LEFT JOIN news_detail nd ON (
    nd.wechat_account = ie.wechat_official_account_id
    OR nd.wechat_account LIKE CONCAT(ie.wechat_official_account_id, ',%')
    OR nd.wechat_account LIKE CONCAT('%,', ie.wechat_official_account_id)
    OR nd.wechat_account LIKE CONCAT('%,', ie.wechat_official_account_id, ',%')
)
AND nd.public_time >= '2025-12-03 00:00:00' 
AND nd.public_time < '2025-12-04 00:00:00'
AND nd.delete_mark = 0
WHERE ie.exit_status NOT IN ('完全退出', '已上市')
AND ie.wechat_official_account_id IS NOT NULL 
AND ie.wechat_official_account_id != ''
AND ie.delete_mark = 0
GROUP BY ie.wechat_official_account_id, ie.enterprise_full_name
ORDER BY matched_news_count DESC;

-- 步骤7：检查企业全称匹配情况
SELECT 
    ie.enterprise_full_name,
    COUNT(DISTINCT nd.id) as matched_news_count
FROM invested_enterprises ie
LEFT JOIN news_detail nd ON (
    nd.enterprise_full_name = ie.enterprise_full_name
    AND nd.public_time >= '2025-12-03 00:00:00' 
    AND nd.public_time < '2025-12-04 00:00:00'
    AND nd.delete_mark = 0
)
WHERE ie.exit_status NOT IN ('完全退出', '已上市')
AND ie.delete_mark = 0
GROUP BY ie.enterprise_full_name
ORDER BY matched_news_count DESC;

