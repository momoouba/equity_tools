# 邮件发送相关的SQL查询语句

## 1. 管理员查询新闻的主要SQL（包含fund和sub_fund）

```sql
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
WHERE (
    -- 通过公众号ID匹配（需要替换为实际的公众号ID列表）
    nd.wechat_account IN ('gh_xxx1', 'gh_xxx2', ...)
    OR
    -- 或者通过企业全称匹配
    (nd.enterprise_full_name IS NOT NULL 
     AND nd.enterprise_full_name != ''
     AND (
        -- 精确匹配
        nd.enterprise_full_name IN (
            SELECT enterprise_full_name 
            FROM invested_enterprises 
            WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
            AND delete_mark = 0
        )
        -- ... 其他匹配条件
     ))
)
AND nd.created_at >= '2026-01-21 00:00:00'  -- 需要替换为实际的时间范围
AND nd.created_at < '2026-01-22 00:00:00'
AND (
    nd.APItype != '上海国际'
    OR (
        nd.public_time IS NOT NULL
        AND nd.public_time != ''
        AND DATEDIFF(DATE(nd.created_at), DATE(nd.public_time)) BETWEEN 0 AND 30
    )
)
AND nd.delete_mark = 0
ORDER BY nd.enterprise_full_name, nd.public_time DESC;
```

## 2. 手动发送邮件时重新获取数据的SQL（包含fund和sub_fund）

```sql
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
    nd.sub_fund
FROM news_detail nd
WHERE nd.id IN ('2026012106003000001', '2026012007305600004', '2026012106004900001')  -- 需要替换为实际的新闻ID列表
AND nd.delete_mark = 0;
```

## 3. 测试特定新闻的fund和sub_fund字段

```sql
-- 测试单条新闻
SELECT 
    id, 
    enterprise_full_name, 
    entity_type, 
    fund, 
    sub_fund
FROM news_detail
WHERE id = '2026012106003000001'
AND delete_mark = 0;

-- 测试所有子基金相关的新闻
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
```

## 4. 检查字段是否存在

```sql
-- 检查fund字段是否存在
SHOW COLUMNS FROM news_detail LIKE 'fund';

-- 检查sub_fund字段是否存在
SHOW COLUMNS FROM news_detail LIKE 'sub_fund';

-- 查看表结构
DESC news_detail;
```

## 5. 验证查询结果是否包含fund和sub_fund

```sql
-- 使用第2个SQL查询，然后检查结果
SELECT DISTINCT 
    nd.id, 
    nd.enterprise_full_name,
    nd.entity_type,
    nd.fund, 
    nd.sub_fund,
    -- 检查字段是否存在
    CASE WHEN nd.fund IS NULL THEN 'fund为NULL' ELSE 'fund有值' END as fund_status,
    CASE WHEN nd.sub_fund IS NULL THEN 'sub_fund为NULL' ELSE 'sub_fund有值' END as sub_fund_status
FROM news_detail nd
WHERE nd.id IN ('2026012106003000001', '2026012007305600004', '2026012106004900001')
AND nd.delete_mark = 0;
```

## 6. 简化测试SQL（直接查询，不使用DISTINCT）

```sql
-- 不使用DISTINCT，直接查询
SELECT 
    id, 
    title, 
    enterprise_full_name, 
    entity_type, 
    fund, 
    sub_fund
FROM news_detail
WHERE id IN ('2026012106003000001', '2026012007305600004', '2026012106004900001')
AND delete_mark = 0;
```

## 注意事项

1. **DISTINCT可能导致字段丢失**：如果使用`SELECT DISTINCT`时，MySQL可能会优化查询，导致某些字段不返回。建议先测试不使用DISTINCT的查询。

2. **LEFT JOIN可能影响字段返回**：复杂的LEFT JOIN条件可能导致某些字段丢失。建议先测试不使用JOIN的简单查询。

3. **字段名大小写**：MySQL在某些配置下可能对字段名大小写敏感，确保字段名正确。

4. **上海国际邮件发送限制**：当 `APItype = '上海国际'` 时，邮件发送需要额外满足：
   - `public_time` 非空
   - `DATEDIFF(DATE(created_at), DATE(public_time)) <= 30`
   - 若日期差为负数（`public_time` 晚于 `created_at`）或大于30天，均不发送

5. **测试步骤**：
   - 先执行第6个简化SQL，确认字段能正常返回
   - 再执行第2个SQL（重新获取数据的SQL），检查是否包含字段
   - 最后执行第1个SQL（完整查询），检查是否包含字段
