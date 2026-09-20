-- ============================================================
-- 客户环境（国方源库）底层明细
-- 用法：保留你之前那整段 b_project_a CTE（到 a2 为止），
--       删掉原来最后的汇总 SELECT，换成下面 A 或 B。
-- 对比键：fund + IFNULL(investor,'') + company + fund_type
-- ============================================================

-- A) 明细（导出 CSV 与我方 02_*.sql 结果对齐）
SELECT
    (SELECT current_version FROM current_version) AS version,
    (SELECT target_date FROM input_params) AS b_date,
    CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END AS fund,
    a2.investor,
    a2.company,
    a2.company_id,
    a2.fund_type,
    ROUND(a2.cost, 2) AS cost,
    ROUND(a2.exit_cost, 2) AS exit_cost,
    ROUND(a2.net_cost, 2) AS net_cost,
    ROUND(a2.cost_1, 2) AS cost_1,
    ROUND(a2.net_cost_1, 2) AS net_cost_1,
    a2.is_listed
FROM a2
WHERE a2.fund IS NOT NULL AND TRIM(a2.fund) <> ''
  AND a2.net_cost > 0
ORDER BY fund, a2.fund_type, COALESCE(a2.investor, ''), a2.company
;

-- B) 按基金汇总（应接近弹窗各行；客户投资金额=sum(cost)，穿透=sum(cost_1)）
SELECT
    CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END AS fund,
    COUNT(*) AS project_num,
    COUNT(DISTINCT a2.company) AS company_num,
    ROUND(SUM(a2.cost) / 1e8, 2) AS invest_yi_cost,
    ROUND(SUM(a2.net_cost) / 1e8, 2) AS invest_yi_net,
    ROUND(SUM(a2.cost_1) / 1e8, 2) AS ct_yi_cost1,
    ROUND(SUM(a2.net_cost_1) / 1e8, 2) AS ct_yi_net1,
    SUM(CASE WHEN a2.is_listed = '是' THEN 1 ELSE 0 END) AS ipo_num,
    ROUND(SUM(CASE WHEN a2.is_listed = '是' THEN a2.cost_1 ELSE 0 END) / 1e8, 2) AS ipo_ct_yi
FROM a2
WHERE a2.fund IS NOT NULL AND TRIM(a2.fund) <> ''
  AND a2.net_cost > 0
GROUP BY CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END
ORDER BY fund
;

-- C) 只看国方一期/二期明细
SELECT
    CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END AS fund,
    a2.investor,
    a2.company,
    a2.fund_type,
    ROUND(a2.cost, 2) AS cost,
    ROUND(a2.exit_cost, 2) AS exit_cost,
    ROUND(a2.net_cost, 2) AS net_cost,
    ROUND(a2.cost_1, 2) AS cost_1,
    ROUND(a2.net_cost_1, 2) AS net_cost_1,
    a2.is_listed
FROM a2
WHERE a2.fund IN ('国方一期', '国方二期')
  AND a2.net_cost > 0
ORDER BY fund, a2.fund_type, COALESCE(a2.investor, ''), a2.company
;
