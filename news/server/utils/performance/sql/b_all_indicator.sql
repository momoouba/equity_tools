-- generate → b_all_indicator（投资组合 / 整体组合指标）
-- 配置：数据接口配置，分层 generate，目标表 b_all_indicator，数据库 investment_tools（不要选外部库）
-- 输入：本系统 b_investment、b_investment_spv、b_ipo_p、perf_fund（须已生成）；上月读本系统上一 version
-- exec_order 须大于 b_investment / b_investment_spv / b_ipo_p；那三条若仍是未分层，本条先不要改 generate
-- 子基金/直投：b_investment（排除国方一期产品）
-- 外部子基金 *_w：同一套子基金口径，再排除 perf_fund.sub_fund 有值的内部子基金名
-- SPV：b_investment_spv 中 lp_paid>0 的 SPV项目
-- 上市/辅导/受理：b_ipo_p
-- 数量/金额变动 = 本月累计 − 上月累计；子基金退出/回款变动、直投回款变动沿用现网：取本月 change_* 合计
-- 本地试跑可把 '${date}' 临时改成 '2026-08-31'；创建版本时会替换
WITH input_params AS (
    SELECT
        '${date}' AS target_date,
        STR_TO_DATE(CONCAT(DATE_FORMAT('${date}', '%Y-%m'), '-01'), '%Y-%m-%d') AS first_date
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
last_month_version AS (
    SELECT version AS last_month_version
    FROM b_version
    WHERE YEAR(b_date) = YEAR(DATE_SUB((SELECT target_date FROM input_params), INTERVAL 1 MONTH))
      AND MONTH(b_date) = MONTH(DATE_SUB((SELECT target_date FROM input_params), INTERVAL 1 MONTH))
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
),
internal_sf_lm AS (
    SELECT DISTINCT TRIM(sub_fund) AS name
    FROM perf_fund
    WHERE version = (SELECT last_month_version FROM last_month_version)
      AND F_DeleteMark = 0
      AND sub_fund IS NOT NULL AND TRIM(sub_fund) <> ''
),
cur_inv AS (
    SELECT
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '子基金' THEN project END) AS fund_inv,
        SUM(CASE WHEN acc_sub > 0 AND transaction_type = '子基金' THEN COALESCE(acc_sub, 0) ELSE 0 END) AS fund_sub,
        SUM(CASE WHEN acc_paidin > 0 AND transaction_type = '子基金' THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS fund_paidin,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '子基金' THEN project END) AS fund_exit,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' THEN COALESCE(acc_exit, 0) ELSE 0 END) AS fund_exit_amount,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' THEN COALESCE(acc_receive, 0) ELSE 0 END) AS fund_receive,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' THEN COALESCE(change_exit, 0) ELSE 0 END) AS fund_exit_amount_change,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' THEN COALESCE(change_receive, 0) ELSE 0 END) AS fund_receive_change,
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN project END) AS fund_inv_w,
        SUM(CASE WHEN acc_sub > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(acc_sub, 0) ELSE 0 END) AS fund_sub_w,
        SUM(CASE WHEN acc_paidin > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS fund_paidin_w,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN project END) AS fund_exit_w,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(acc_exit, 0) ELSE 0 END) AS fund_exit_amount_w,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(acc_receive, 0) ELSE 0 END) AS fund_receive_w,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(change_exit, 0) ELSE 0 END) AS fund_exit_amount_change_w,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf i WHERE i.name = b_investment.project) THEN COALESCE(change_receive, 0) ELSE 0 END) AS fund_receive_change_w,
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '直投项目' THEN project END) AS project_inv,
        SUM(CASE WHEN acc_paidin IS NOT NULL AND transaction_type = '直投项目' THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS project_paidin,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '直投项目' THEN project END) AS project_exit,
        SUM(CASE WHEN acc_receive IS NOT NULL AND transaction_type = '直投项目' THEN COALESCE(acc_receive, 0) ELSE 0 END) AS project_receive,
        SUM(CASE WHEN change_receive > 0 AND transaction_type = '直投项目' THEN COALESCE(change_receive, 0) ELSE 0 END) AS project_receive_change
    FROM b_investment
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
      AND COALESCE(fund, '') <> '国方一期产品'
),
lm_inv AS (
    SELECT
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '子基金' THEN project END) AS fund_inv,
        SUM(CASE WHEN acc_sub > 0 AND transaction_type = '子基金' THEN COALESCE(acc_sub, 0) ELSE 0 END) AS fund_sub,
        SUM(CASE WHEN acc_paidin > 0 AND transaction_type = '子基金' THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS fund_paidin,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '子基金' THEN project END) AS fund_exit,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' THEN COALESCE(acc_exit, 0) ELSE 0 END) AS fund_exit_amount,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' THEN COALESCE(acc_receive, 0) ELSE 0 END) AS fund_receive,
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN project END) AS fund_inv_w,
        SUM(CASE WHEN acc_sub > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN COALESCE(acc_sub, 0) ELSE 0 END) AS fund_sub_w,
        SUM(CASE WHEN acc_paidin > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS fund_paidin_w,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN project END) AS fund_exit_w,
        SUM(CASE WHEN acc_exit > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN COALESCE(acc_exit, 0) ELSE 0 END) AS fund_exit_amount_w,
        SUM(CASE WHEN acc_receive > 0 AND transaction_type = '子基金' AND NOT EXISTS (SELECT 1 FROM internal_sf_lm i WHERE i.name = b_investment.project) THEN COALESCE(acc_receive, 0) ELSE 0 END) AS fund_receive_w,
        COUNT(DISTINCT CASE WHEN acc_sub > 0 AND transaction_type = '直投项目' THEN project END) AS project_inv,
        SUM(CASE WHEN acc_paidin IS NOT NULL AND transaction_type = '直投项目' THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS project_paidin,
        COUNT(DISTINCT CASE WHEN acc_exit > 0 AND transaction_type = '直投项目' THEN project END) AS project_exit,
        SUM(CASE WHEN acc_receive IS NOT NULL AND transaction_type = '直投项目' THEN COALESCE(acc_receive, 0) ELSE 0 END) AS project_receive
    FROM b_investment
    WHERE version = (SELECT last_month_version FROM last_month_version)
      AND F_DeleteMark = 0
      AND COALESCE(fund, '') <> '国方一期产品'
),
cur_spv AS (
    SELECT
        SUM(CASE WHEN acc_paidin IS NOT NULL AND transaction_type = 'SPV项目' AND lp_paid > 0 THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS spv_paidin,
        SUM(CASE WHEN acc_receive IS NOT NULL AND transaction_type = 'SPV项目' AND lp_paid > 0 THEN COALESCE(acc_receive, 0) ELSE 0 END) AS spv_receive
    FROM b_investment_spv
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
),
lm_spv AS (
    SELECT
        SUM(CASE WHEN acc_paidin IS NOT NULL AND transaction_type = 'SPV项目' AND lp_paid > 0 THEN COALESCE(acc_paidin, 0) ELSE 0 END) AS spv_paidin,
        SUM(CASE WHEN acc_receive IS NOT NULL AND transaction_type = 'SPV项目' AND lp_paid > 0 THEN COALESCE(acc_receive, 0) ELSE 0 END) AS spv_receive
    FROM b_investment_spv
    WHERE version = (SELECT last_month_version FROM last_month_version)
      AND F_DeleteMark = 0
),
cur_ipo AS (
    SELECT
        COUNT(DISTINCT CASE WHEN ipo_status = '已上市' THEN project END) AS ipo_num,
        SUM(CASE WHEN ipo_status = '已上市' THEN COALESCE(paid_amount, 0) ELSE 0 END) AS ipo_cost,
        SUM(CASE WHEN ipo_status = '已上市' THEN COALESCE(total_value, 0) ELSE 0 END) AS ipo_valuation,
        COUNT(DISTINCT CASE WHEN ipo_status = '辅导备案' THEN project END) AS fd_num,
        SUM(CASE WHEN ipo_status = '辅导备案' THEN COALESCE(paid_amount, 0) ELSE 0 END) AS fd_cost,
        SUM(CASE WHEN ipo_status = '辅导备案' THEN COALESCE(total_value, 0) ELSE 0 END) AS fd_valuation,
        COUNT(DISTINCT CASE WHEN ipo_status = '已受理' THEN project END) AS sl_num,
        SUM(CASE WHEN ipo_status = '已受理' THEN COALESCE(paid_amount, 0) ELSE 0 END) AS sl_cost,
        SUM(CASE WHEN ipo_status = '已受理' THEN COALESCE(total_value, 0) ELSE 0 END) AS sl_valuation
    FROM b_ipo_p
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
      AND ipo_status IS NOT NULL
)
SELECT
    (SELECT target_date FROM input_params) AS b_date,
    (SELECT current_version FROM current_version) AS version,
    COALESCE(c.fund_inv, 0) AS fund_inv,
    COALESCE(l.fund_inv, 0) AS lm_fund_inv,
    COALESCE(c.fund_inv, 0) - COALESCE(l.fund_inv, 0) AS fund_inv_change,
    COALESCE(c.fund_sub, 0) AS fund_sub,
    COALESCE(l.fund_sub, 0) AS lm_fund_sub,
    COALESCE(c.fund_sub, 0) - COALESCE(l.fund_sub, 0) AS fund_sub_change,
    COALESCE(c.fund_paidin, 0) AS fund_paidin,
    COALESCE(l.fund_paidin, 0) AS lm_fund_paidin,
    COALESCE(c.fund_paidin, 0) - COALESCE(l.fund_paidin, 0) AS fund_paidin_change,
    COALESCE(c.fund_exit, 0) AS fund_exit,
    COALESCE(l.fund_exit, 0) AS lm_fund_exit,
    COALESCE(c.fund_exit, 0) - COALESCE(l.fund_exit, 0) AS fund_exit_change,
    COALESCE(c.fund_exit_amount, 0) AS fund_exit_amount,
    COALESCE(l.fund_exit_amount, 0) AS lm_fund_exit_amount,
    COALESCE(c.fund_exit_amount_change, 0) AS fund_exit_amount_change,
    COALESCE(c.fund_receive, 0) AS fund_receive,
    COALESCE(l.fund_receive, 0) AS lm_fund_receive,
    COALESCE(c.fund_receive_change, 0) AS fund_receive_change,
    COALESCE(c.fund_inv_w, 0) AS fund_inv_w,
    COALESCE(l.fund_inv_w, 0) AS lm_fund_inv_w,
    COALESCE(c.fund_inv_w, 0) - COALESCE(l.fund_inv_w, 0) AS fund_inv_change_w,
    COALESCE(c.fund_sub_w, 0) AS fund_sub_w,
    COALESCE(l.fund_sub_w, 0) AS lm_fund_sub_w,
    COALESCE(c.fund_sub_w, 0) - COALESCE(l.fund_sub_w, 0) AS fund_sub_change_w,
    COALESCE(c.fund_paidin_w, 0) AS fund_paidin_w,
    COALESCE(l.fund_paidin_w, 0) AS lm_fund_paidin_w,
    COALESCE(c.fund_paidin_w, 0) - COALESCE(l.fund_paidin_w, 0) AS fund_paidin_change_w,
    COALESCE(c.fund_exit_w, 0) AS fund_exit_w,
    COALESCE(l.fund_exit_w, 0) AS lm_fund_exit_w,
    COALESCE(c.fund_exit_w, 0) - COALESCE(l.fund_exit_w, 0) AS fund_exit_change_w,
    COALESCE(c.fund_exit_amount_w, 0) AS fund_exit_amount_w,
    COALESCE(l.fund_exit_amount_w, 0) AS lm_fund_exit_amount_w,
    COALESCE(c.fund_exit_amount_change_w, 0) AS fund_exit_amount_change_w,
    COALESCE(c.fund_receive_w, 0) AS fund_receive_w,
    COALESCE(l.fund_receive_w, 0) AS lm_fund_receive_w,
    COALESCE(c.fund_receive_change_w, 0) AS fund_receive_change_w,
    COALESCE(c.project_inv, 0) AS project_inv,
    COALESCE(l.project_inv, 0) AS lm_project_inv,
    COALESCE(c.project_inv, 0) - COALESCE(l.project_inv, 0) AS project_inv_change,
    COALESCE(c.project_paidin, 0) AS project_paidin,
    COALESCE(l.project_paidin, 0) AS lm_project_paidin,
    COALESCE(c.project_paidin, 0) - COALESCE(l.project_paidin, 0) AS project_paidin_change,
    COALESCE(c.project_exit, 0) AS project_exit,
    COALESCE(l.project_exit, 0) AS lm_project_exit,
    COALESCE(c.project_exit, 0) - COALESCE(l.project_exit, 0) AS project_exit_change,
    COALESCE(c.project_receive, 0) AS project_receive,
    COALESCE(l.project_receive, 0) AS lm_project_receive,
    COALESCE(c.project_receive_change, 0) AS project_receive_change,
    COALESCE(s.spv_paidin, 0) AS spv_paidin,
    COALESCE(ls.spv_paidin, 0) AS lm_spv_paidin,
    COALESCE(s.spv_paidin, 0) - COALESCE(ls.spv_paidin, 0) AS spv_paidin_change,
    COALESCE(s.spv_receive, 0) AS spv_receive,
    COALESCE(ls.spv_receive, 0) AS lm_spv_receive,
    COALESCE(s.spv_receive, 0) - COALESCE(ls.spv_receive, 0) AS spv_receive_change,
    COALESCE(i.ipo_num, 0) AS ipo_num,
    COALESCE(i.ipo_cost, 0) AS ipo_cost,
    COALESCE(i.ipo_valuation, 0) AS ipo_valuation,
    COALESCE(i.fd_num, 0) AS fd_num,
    COALESCE(i.fd_cost, 0) AS fd_cost,
    COALESCE(i.fd_valuation, 0) AS fd_valuation,
    COALESCE(i.sl_num, 0) AS sl_num,
    COALESCE(i.sl_cost, 0) AS sl_cost,
    COALESCE(i.sl_valuation, 0) AS sl_valuation
FROM cur_inv c
LEFT JOIN lm_inv l ON 1 = 1
LEFT JOIN cur_spv s ON 1 = 1
LEFT JOIN lm_spv ls ON 1 = 1
LEFT JOIN cur_ipo i ON 1 = 1
;
