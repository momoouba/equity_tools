-- 我方生产库 investment_tools | 累计（含已退出） | 来源 b_sql.target_table=b_project_a
-- 截止日期 2026-09-30，版本取当月最新 ready 版本
-- 导出后与客户明细按 fund + investor + company + fund_type 对齐

-- generate → b_project_a（底层资产 / 累计组合 按基金明细）
-- 配置：数据接口配置，分层 generate，目标表 b_project_a，数据库 investment_tools（不要选外部库）
-- 输入：本系统 b_transaction + perf_relation + perf_fund + perf_ipo + perf_fof_to_company_ratio
-- 粒度：母基金一行。子基金投的企业归到母基金；直投基金底层现网已注释，这里也不含
-- 累计：子基金不看是否转完；项目不滤剩余成本；母基金经 SPV 不滤 >1000
-- 子基金穿透成本 = 成本 × 母基金对子基金实缴 / 子基金 paidin（不扣转让）
-- 上市：perf_ipo 有记录且 ipo_date ≤ 时点（不强制 ticker）
-- 洗数须带出「子基金+企业」的出资/退出/债转股收回，否则只有母基金经 SPV 的企业
-- 本地试跑可把 '2026-09-30' 临时改成 '2026-08-31'；创建版本时会替换
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
    WHERE r.fund IS NOT NULL AND TRIM(r.fund) <> ''
      AND r.sub_fund IS NOT NULL AND TRIM(r.sub_fund) <> ''
),
sf_ratio AS (
    SELECT
        o.fund,
        o.sub_fund,
        COALESCE(f.paidin, 0) / NULLIF(pf.paidin, 0) AS paid_ratio
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
),
fof_cost AS (
    SELECT
        t.fund,
        t.company,
        SUM(CASE WHEN t.transaction_type = '实缴' THEN t.amount ELSE 0 END) AS cost
    FROM txn t
    WHERE t.fund IS NOT NULL AND TRIM(t.fund) <> ''
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
fof_exit AS (
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
    UNION ALL
    SELECT
        t.fund,
        t.company,
        SUM(COALESCE(NULLIF(t.capital, 0), t.amount)) AS exit_cost
    FROM txn t
    WHERE t.transaction_type = '转让'
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
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
    (SELECT target_date FROM input_params) AS b_date,
    (SELECT current_version FROM current_version) AS version,
    h.fund,
    h.investor,
    h.company,
    h.fund_type,
    h.cost,
    h.exit_cost,
    h.net_cost,
    h.cost_1,
    h.net_cost_1,
    CASE WHEN h.is_listed = 1 THEN '是' ELSE '否' END AS is_listed
FROM holdings h
WHERE h.fund IS NOT NULL AND TRIM(h.fund) <> ''
  AND h.fund <> '国方一期产品'
ORDER BY h.fund, h.fund_type, COALESCE(h.investor, ''), h.company
;