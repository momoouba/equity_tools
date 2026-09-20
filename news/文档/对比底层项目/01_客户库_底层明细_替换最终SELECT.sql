-- ========== 客户库：把原 b_project_a SQL 最后的汇总 SELECT 整段替换为下面 ==========
-- 在客户源库执行（含 fundraising / project_transaction_detail 等）
-- 对比键建议：fund + investor + company + fund_type

SELECT
    (SELECT current_version FROM current_version) AS version,
    (SELECT target_date FROM input_params) AS b_date,
    CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END AS fund,
    a2.investor,
    a2.company,
    a2.company_id,
    a2.fund_type,
    a2.cost,
    a2.exit_cost,
    a2.net_cost,
    a2.cost_1,
    a2.net_cost_1,
    a2.is_listed
FROM a2
WHERE a2.fund IS NOT NULL AND TRIM(a2.fund) <> ''
ORDER BY fund, a2.fund_type, a2.investor, a2.company
;
