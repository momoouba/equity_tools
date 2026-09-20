-- b_ipo 当前上市企业明细
-- fund 直投分支仅保留 perf_fund.母基金，排除华虹虹芯等与子基金重复的直投基金
-- F_Id=2026051508431300001

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
sf_xfer AS (
    SELECT
        t.fund  AS fund,
        t.sub_fund,
        SUM(COALESCE(NULLIF(t.capital, 0), t.transaction_amount)) AS xfer
    FROM b_transaction t
    WHERE t.version = (SELECT current_version FROM current_version)
      AND t.F_DeleteMark = 0
      AND t.sub_fund IS NOT NULL AND TRIM(t.sub_fund) <> ''
      AND (t.company IS NULL OR TRIM(t.company) = '')
      AND TRIM(t.transaction_type) = '转让'
    GROUP BY 1, 2
),
sf_open AS (
    SELECT DISTINCT r.sub_fund
    FROM sf_rel r
    LEFT JOIN sf_xfer x ON x.fund = r.fund AND x.sub_fund = r.sub_fund
    WHERE r.subscription_amount > 0
      AND COALESCE(x.xfer, 0) < r.subscription_amount
)
SELECT
    (SELECT target_date FROM input_params) AS b_date,
    (SELECT current_version FROM current_version) AS version,
    CASE
        WHEN i.sub_fund IS NOT NULL AND TRIM(i.sub_fund) <> '' THEN '子基金'
        ELSE '母基金'
    END AS fund_type,
    CASE
        WHEN i.sub_fund IS NOT NULL AND TRIM(i.sub_fund) <> '' THEN i.sub_fund
        ELSE i.fund
    END AS fund,
    i.company AS project,
    DATE(i.ipo_date) AS ipo_date,
    i.initialcost AS amount,
    i.ticker AS stock_num,
    i.stock_name
FROM perf_ipo i
WHERE i.version = (SELECT current_version FROM current_version)
  AND i.F_DeleteMark = 0
  AND i.ipo_date IS NOT NULL
  AND DATE(i.ipo_date) <= (SELECT target_date FROM input_params)
  AND COALESCE(i.current_hold_shares, 0) > 100
  AND (
        (i.fund IS NOT NULL AND TRIM(i.fund) <> '' AND EXISTS (
        SELECT 1 FROM perf_fund pf
        WHERE pf.version = (SELECT current_version FROM current_version)
          AND pf.F_DeleteMark = 0
          AND pf.fund_type = '母基金'
          AND pf.fund = i.fund
      ))
     OR (i.sub_fund IS NOT NULL AND TRIM(i.sub_fund) <> '' AND i.sub_fund IN (SELECT sub_fund FROM sf_open))
  )
ORDER BY fund_type DESC, fund, ipo_date DESC
;
