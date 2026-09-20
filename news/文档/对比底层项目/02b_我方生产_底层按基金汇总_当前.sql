-- 我方生产库 investment_tools
-- 口径：当前底层（b_project generate，剩余成本>0）
-- 截止日期：2026-09-30，版本取当月最新
-- 对比键：fund + IFNULL(investor,'') + company + fund_type
-- 金额字段：cost/exit_cost/net_cost=项目成本口径；cost_1/net_cost_1=穿透口径


WITH input_params AS (
    SELECT
        '2026-09-30' AS target_date,
        STR_TO_DATE(CONCAT(DATE_FORMAT('2026-09-30', '%Y-%m'), '-01'), '%Y-%m-%d') AS first_date
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
txn AS (
    SELECT
        t.fund AS fund,
        t.spv AS spv,
        t.sub_fund,
        t.company,
        t.lp,
        TRIM(t.transaction_type) AS transaction_type,
        TRIM(t.scene_tag) AS scene_tag,
        COALESCE(t.transaction_amount, 0) AS amount,
        COALESCE(t.capital, 0) AS capital
    FROM b_transaction t
    WHERE t.version = (SELECT current_version FROM current_version)
      AND t.F_DeleteMark = 0
),
listed AS (
    SELECT DISTINCT
        i.fund AS fund,
        i.company AS project
    FROM perf_ipo i
    WHERE i.version = (SELECT current_version FROM current_version)
      AND i.F_DeleteMark = 0
      AND i.company IS NOT NULL AND TRIM(i.company) <> ''
      AND i.ticker IS NOT NULL AND TRIM(i.ticker) <> ''
      AND i.ipo_date IS NOT NULL
      AND DATE(i.ipo_date) <= (SELECT target_date FROM input_params)
),
listed_co AS (
    SELECT DISTINCT project FROM listed
),

ratio AS (
    SELECT
        r.fund AS fund,
        r.spv,
        r.company,
        MAX(COALESCE(r.initial_ratio, 0.995)) AS initial_ratio
    FROM perf_fof_to_company_ratio r
    WHERE r.version = (SELECT current_version FROM current_version)
      AND r.F_DeleteMark = 0
    GROUP BY 1, 2, 3
),
ratio_spv AS (
    SELECT spv, company, MAX(initial_ratio) AS initial_ratio
    FROM ratio
    GROUP BY spv, company
),

sf_rel AS (
    SELECT
        CASE
            WHEN r.lp_type = '母基金' THEN
                r.lp
            ELSE
                r.fund
        END AS fund,
        r.sub_fund,
        SUM(COALESCE(r.subscription_amount, 0)) AS subscription_amount
    FROM perf_relation r
    WHERE r.version = (SELECT current_version FROM current_version)
      AND r.F_DeleteMark = 0
      AND r.sub_fund IS NOT NULL AND TRIM(r.sub_fund) <> ''
    GROUP BY 1, 2
),
sf_flow AS (
    SELECT
        t.fund,
        t.sub_fund,
        SUM(CASE WHEN t.transaction_type = '实缴' THEN t.amount ELSE 0 END) AS paidin,
        SUM(CASE WHEN t.transaction_type = '转让' THEN COALESCE(NULLIF(t.capital, 0), t.amount) ELSE 0 END) AS xfer
    FROM txn t
    WHERE t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND t.sub_fund IS NOT NULL AND TRIM(t.sub_fund) <> ''
      AND (t.company IS NULL OR TRIM(t.company) = '')
    GROUP BY t.fund, t.sub_fund
),
sf_open AS (
    SELECT r.fund, r.sub_fund
    FROM sf_rel r
    LEFT JOIN sf_flow f ON f.fund = r.fund AND f.sub_fund = r.sub_fund
    WHERE r.fund IS NOT NULL AND TRIM(r.fund) <> ''
      AND r.subscription_amount > 0
      AND COALESCE(f.xfer, 0) < r.subscription_amount
),
sf_ratio AS (
    SELECT
        o.fund,
        o.sub_fund,
        (COALESCE(f.paidin, 0) - COALESCE(f.xfer, 0)) / NULLIF(pf.paidin, 0) AS paid_ratio
    FROM sf_open o
    LEFT JOIN sf_flow f ON f.fund = o.fund AND f.sub_fund = o.sub_fund
    LEFT JOIN perf_fund pf
        ON pf.version = (SELECT current_version FROM current_version)
       AND pf.F_DeleteMark = 0
       AND pf.fund_type = '子基金'
       AND pf.fund = o.sub_fund
),
sf_hold AS (
    SELECT
        r.fund,
        t.sub_fund AS investor,
        t.company,
        '子基金' COLLATE utf8mb4_0900_ai_ci AS fund_type,
        SUM(CASE WHEN t.transaction_type = '出资' THEN t.amount ELSE 0 END) AS cost,
        SUM(CASE
            WHEN t.transaction_type IN ('退出', '债转股回收', '债转股收回')
            THEN COALESCE(NULLIF(t.capital, 0), t.amount)
            ELSE 0
        END) AS exit_cost
    FROM txn t
    INNER JOIN sf_open r
        ON r.sub_fund = t.sub_fund
       AND (t.fund IS NULL OR TRIM(t.fund) = '' OR t.fund = r.fund)
    WHERE t.sub_fund IS NOT NULL AND TRIM(t.sub_fund) <> ''
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
    GROUP BY r.fund, t.sub_fund, t.company
    HAVING SUM(CASE WHEN t.transaction_type = '出资' THEN t.amount ELSE 0 END)
         - SUM(CASE
               WHEN t.transaction_type IN ('退出', '债转股回收', '债转股收回')
               THEN COALESCE(NULLIF(t.capital, 0), t.amount)
               ELSE 0
           END) > 0
),
fof_cost AS (
    SELECT
        t.fund,
        t.company,
        SUM(CASE WHEN t.transaction_type = '实缴' THEN t.amount ELSE 0 END) AS cost
    FROM txn t
    WHERE t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND t.fund <> '国方一期产品'
      AND t.spv IS NOT NULL AND TRIM(t.spv) <> ''
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    GROUP BY t.fund, t.company
),
fof_cost_any AS (
    SELECT company, MAX(fund) AS fund, SUM(cost) AS cost
    FROM fof_cost
    GROUP BY company
),

spv_exit AS (
    SELECT
        t.spv,
        t.company,
        SUM(CASE
            WHEN t.transaction_type = '退出' THEN COALESCE(NULLIF(t.capital, 0), t.amount)
            ELSE 0
        END) AS exit_cost
    FROM txn t
    WHERE (t.fund IS NULL OR TRIM(t.fund) = '')
      AND t.spv IS NOT NULL AND TRIM(t.spv) <> ''
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
      AND t.transaction_type = '退出'
    GROUP BY t.spv, t.company
),
fof_exit_spv AS (
    SELECT
        c.fund,
        e.company,
        SUM(e.exit_cost * c.cost / NULLIF(tot.total_cost, 0)) AS exit_cost
    FROM spv_exit e
    INNER JOIN fof_cost c ON c.company = e.company
    INNER JOIN (
        SELECT company, SUM(cost) AS total_cost
        FROM fof_cost
        GROUP BY company
    ) tot ON tot.company = e.company
    GROUP BY c.fund, e.company
),
fof_exit_fund AS (
    SELECT
        t.fund,
        t.company,
        SUM(COALESCE(NULLIF(t.capital, 0), 0)) AS exit_cost
    FROM txn t
    WHERE t.transaction_type IN ('分配', '退出', '分红')
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND t.fund <> '国方一期产品'
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    GROUP BY t.fund, t.company
),
fof_exit_xfer AS (
    SELECT
        t.fund,
        t.company,
        SUM(COALESCE(NULLIF(t.capital, 0), t.amount)) AS exit_cost
    FROM txn t
    WHERE t.transaction_type = '转让'
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND t.fund <> '国方一期产品'
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
    GROUP BY t.fund, t.company
    UNION ALL
    SELECT
        c.fund,
        t.company,
        SUM(COALESCE(NULLIF(t.capital, 0), t.amount) * c.cost / NULLIF(tot.total_cost, 0)) AS exit_cost
    FROM txn t
    INNER JOIN fof_cost c ON c.company = t.company
    INNER JOIN (
        SELECT company, SUM(cost) AS total_cost
        FROM fof_cost
        GROUP BY company
    ) tot ON tot.company = t.company
    WHERE t.transaction_type = '转让'
      AND (t.fund IS NULL OR TRIM(t.fund) = '')
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
    GROUP BY c.fund, t.company
),
fof_exit AS (
    SELECT
        k.fund,
        k.company,
        COALESCE(x.exit_cost, 0)
          + CASE
                WHEN COALESCE(f.exit_cost, 0) > 0 THEN f.exit_cost
                ELSE COALESCE(s.exit_cost, 0)
            END AS exit_cost
    FROM (
        SELECT fund, company FROM fof_exit_fund
        UNION
        SELECT fund, company FROM fof_exit_spv
        UNION
        SELECT fund, company FROM fof_exit_xfer
    ) k
    LEFT JOIN fof_exit_fund f ON f.fund = k.fund AND f.company = k.company
    LEFT JOIN fof_exit_spv s ON s.fund = k.fund AND s.company = k.company
    LEFT JOIN (
        SELECT fund, company, SUM(exit_cost) AS exit_cost
        FROM fof_exit_xfer
        GROUP BY fund, company
    ) x ON x.fund = k.fund AND x.company = k.company
),
fof_hold AS (
    SELECT
        x.fund,
        CAST(NULL AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_0900_ai_ci AS investor,
        x.company,
        '母基金' COLLATE utf8mb4_0900_ai_ci AS fund_type,
        SUM(x.cost) AS cost,
        SUM(x.exit_cost) AS exit_cost
    FROM (
        SELECT fund, company, cost, 0 AS exit_cost FROM fof_cost
        UNION ALL
        SELECT fund, company, 0 AS cost, exit_cost FROM fof_exit WHERE fund IS NOT NULL AND TRIM(fund) <> ''
    ) x
    GROUP BY x.fund, x.company
    HAVING SUM(x.cost) - SUM(x.exit_cost) > 1000
),
holdings AS (
    SELECT
        s.fund,
        s.investor,
        s.company,
        s.fund_type,
        s.cost,
        s.exit_cost,
        s.cost - s.exit_cost AS net_cost,
        s.cost * COALESCE(sr.paid_ratio, 0) AS cost_1,
        (s.cost - s.exit_cost) * COALESCE(sr.paid_ratio, 0) AS net_cost_1,
        CASE WHEN l.project IS NOT NULL THEN 1 ELSE 0 END AS is_listed
    FROM sf_hold s
    LEFT JOIN sf_ratio sr ON sr.fund = s.fund AND sr.sub_fund = s.investor
    LEFT JOIN listed_co l ON l.project = s.company
    UNION ALL
    SELECT
        f.fund,
        f.investor,
        f.company,
        f.fund_type,
        f.cost,
        f.exit_cost,
        f.cost - f.exit_cost AS net_cost,
        f.cost AS cost_1,
        f.cost - f.exit_cost AS net_cost_1,
        CASE WHEN l.project IS NOT NULL THEN 1 ELSE 0 END AS is_listed
    FROM fof_hold f
    LEFT JOIN listed_co l ON l.project = f.company
)
SELECT
    h.fund,
    COUNT(*) AS project_num,
    COUNT(DISTINCT h.company) AS company_num,
    ROUND(SUM(h.net_cost) / 1e8, 2) AS invest_yi,
    ROUND(SUM(h.net_cost_1) / 1e8, 2) AS ct_yi,
    SUM(CASE WHEN h.is_listed = 1 THEN 1 ELSE 0 END) AS ipo_num,
    ROUND(SUM(CASE WHEN h.is_listed = 1 THEN h.net_cost_1 ELSE 0 END) / 1e8, 2) AS ipo_ct_yi
FROM holdings h
WHERE h.fund IS NOT NULL AND TRIM(h.fund) <> ''
  AND h.fund <> '国方一期产品'
  AND h.net_cost > 0
GROUP BY h.fund
ORDER BY h.fund
;