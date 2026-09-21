-- generate → b_investment_sf（纯外部子基金投资组合明细）
-- 配置：数据接口配置，分层 generate，目标表 b_investment_sf，数据库 investment_tools（不要选外部库）
-- 输入：本系统 b_investment、perf_fund（须已生成）
-- exec_order 须大于 b_investment，且排在 b_investment_sum 之前
-- 口径：b_investment_sum 去掉直投项目，再排除 perf_fund.sub_fund 有值的内部子基金
-- 本地试跑可把 '${date}' 临时改成 '2026-08-31'；创建版本时会替换
WITH input_params AS (
    SELECT
        '${date}' AS target_date
),
current_version AS (
    SELECT version AS current_version
    FROM b_version
    WHERE YEAR(b_date) = YEAR((SELECT target_date FROM input_params))
      AND MONTH(b_date) = MONTH((SELECT target_date FROM input_params))
      AND F_DeleteMark = 0
    ORDER BY CAST(REGEXP_SUBSTR(version, '[0-9]+$') AS UNSIGNED) DESC
    LIMIT 1
),
internal_sf AS (
    SELECT DISTINCT TRIM(sub_fund) AS name
    FROM perf_fund
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
      AND sub_fund IS NOT NULL AND TRIM(sub_fund) <> ''
)
SELECT
    (SELECT target_date FROM input_params) AS b_date,
    (SELECT current_version FROM current_version) AS version,
    transaction_type,
    project,
    MIN(first_date) AS first_date,
    SUM(acc_sub) AS acc_sub,
    SUM(change_sub) AS change_sub,
    SUM(acc_paidin) AS acc_paidin,
    SUM(change_paidin) AS change_paidin,
    SUM(acc_exit) AS acc_exit,
    SUM(change_exit) AS change_exit,
    SUM(acc_receive) AS acc_receive,
    SUM(change_receive) AS change_receive,
    SUM(unrealized) AS unrealized,
    SUM(change_unrealized) AS change_unrealized,
    SUM(acc_receive) + SUM(unrealized) AS total_value,
    (SUM(acc_receive) + SUM(unrealized)) / SUM(acc_paidin) AS moc,
    SUM(acc_receive) / SUM(acc_paidin) AS dpi
FROM b_investment
WHERE version = (SELECT current_version FROM current_version)
  AND transaction_type = '子基金'
  AND fund <> '国方一期产品'
  AND F_DeleteMark = 0
  AND NOT EXISTS (
      SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project
  )
GROUP BY project, transaction_type
ORDER BY transaction_type
;
