-- generate → b_ipo_p（直投项目上市进展）
-- rest_cost = 每个 fund+project 的投资成本 paid_amount − 退出成本
-- 退出成本：b_transaction.capital。直投取交易类型「退出」；SPV 取「退出/分配/转让」。
-- 基金层有退出成本时用基金层，否则按穿透比例取 SPV 层「退出」的 capital（与已实现价值同一套比例）
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
txn AS (
    SELECT
        t.fund AS fund,
        t.spv AS spv,
        t.company,
        t.lp,
        t.sub_fund,
        TRIM(t.transaction_type) AS transaction_type,
        TRIM(t.scene_tag) AS scene_tag,
        COALESCE(t.transaction_amount, 0) AS amount,
        COALESCE(t.capital, 0) AS capital
    FROM b_transaction t
    WHERE t.version = (SELECT current_version FROM current_version)
      AND t.F_DeleteMark = 0
      AND (t.fund IS NULL OR t.fund <> '国方一期产品')
),
ratio AS (
    SELECT
        r.fund AS fund,
        r.spv,
        r.company,
        r.initial_ratio,
        r.end_ratio
    FROM perf_fof_to_company_ratio r
    WHERE r.version = (SELECT current_version FROM current_version)
      AND r.F_DeleteMark = 0
),
positions AS (
    SELECT
        t.fund,
        t.spv,
        t.company AS project,
        SUM(CASE
            WHEN t.spv IS NOT NULL AND TRIM(t.spv) <> '' AND t.transaction_type = '实缴' THEN t.amount
            WHEN (t.spv IS NULL OR TRIM(t.spv) = '') AND t.transaction_type = '出资' THEN t.amount
            WHEN (t.spv IS NULL OR TRIM(t.spv) = '') AND t.transaction_type = '债转股回收' THEN -t.amount
            ELSE 0
        END) AS paid_amount
    FROM txn t
    WHERE t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
      AND (
            (t.spv IS NOT NULL AND TRIM(t.spv) <> '' AND t.transaction_type = '实缴')
         OR ((t.spv IS NULL OR TRIM(t.spv) = '') AND t.transaction_type IN ('出资', '债转股回收'))
      )
    GROUP BY t.fund, t.spv, t.company
),
-- 母基金自己的分配/退出/转让（fund 非空）
fund_realized AS (
    SELECT
        t.fund,
        t.company AS project,
        SUM(CASE
            WHEN t.scene_tag = '上市前' AND t.transaction_type IN ('退出', '分红', '分配') THEN t.amount
            ELSE 0
        END) AS realized_pre,
        SUM(CASE
            WHEN t.scene_tag = '上市后' AND t.transaction_type IN ('退出', '分红', '分配') THEN t.amount
            ELSE 0
        END) AS realized_post,
        SUM(CASE
            WHEN t.scene_tag = 'SPV份额转让' AND t.transaction_type IN ('转让', '分配') THEN t.amount
            ELSE 0
        END) AS realized_xfer
    FROM txn t
    WHERE t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    GROUP BY t.fund, t.company
),
-- SPV 项目层流水（fund 空）按穿透比例记到母基金
spv_lookthrough AS (
    SELECT
        p.fund,
        p.project,
        SUM(CASE
            WHEN t.scene_tag = '上市前' AND t.transaction_type IN ('退出', '分红', '分配')
            THEN t.amount * COALESCE(r.initial_ratio, 0.995)
            ELSE 0
        END) AS realized_pre,
        SUM(CASE
            WHEN t.scene_tag = '上市后' AND t.transaction_type IN ('退出', '分红', '分配')
            THEN t.amount * COALESCE(r.end_ratio, r.initial_ratio, 0.995)
            ELSE 0
        END) AS realized_post
    FROM positions p
    INNER JOIN txn t
        ON t.spv = p.spv
       AND t.company = p.project
       AND (t.fund IS NULL OR TRIM(t.fund) = '')
       AND (t.lp IS NULL OR TRIM(t.lp) = '')
       AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    LEFT JOIN ratio r
        ON r.fund = p.fund
       AND r.spv = p.spv
       AND r.company = p.project
    WHERE p.spv IS NOT NULL AND TRIM(p.spv) <> ''
    GROUP BY p.fund, p.project
),
fund_exit_cost AS (
    SELECT
        t.fund,
        t.company AS project,
        SUM(CASE
            WHEN (t.spv IS NULL OR TRIM(t.spv) = '') AND t.transaction_type = '退出' THEN t.capital
            WHEN t.spv IS NOT NULL AND TRIM(t.spv) <> '' AND t.transaction_type IN ('退出', '分配', '转让') THEN t.capital
            ELSE 0
        END) AS exit_cost
    FROM txn t
    WHERE t.company IS NOT NULL AND TRIM(t.company) <> ''
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND (t.lp IS NULL OR TRIM(t.lp) = '')
      AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    GROUP BY t.fund, t.company
),
spv_exit_cost AS (
    SELECT
        p.fund,
        p.project,
        SUM(CASE
            WHEN t.transaction_type = '退出' AND t.scene_tag = '上市后'
            THEN t.capital * COALESCE(r.end_ratio, r.initial_ratio, 0.995)
            WHEN t.transaction_type = '退出'
            THEN t.capital * COALESCE(r.initial_ratio, 0.995)
            ELSE 0
        END) AS exit_cost
    FROM positions p
    INNER JOIN txn t
        ON t.spv = p.spv
       AND t.company = p.project
       AND (t.fund IS NULL OR TRIM(t.fund) = '')
       AND (t.lp IS NULL OR TRIM(t.lp) = '')
       AND (t.sub_fund IS NULL OR TRIM(t.sub_fund) = '')
    LEFT JOIN ratio r
        ON r.fund = p.fund
       AND r.spv = p.spv
       AND r.company = p.project
    WHERE p.spv IS NOT NULL AND TRIM(p.spv) <> ''
    GROUP BY p.fund, p.project
),
unrl AS (
    SELECT
        t.fund,
        t.company AS project,
        SUM(t.amount) AS unrealized
    FROM txn t
    WHERE t.transaction_type = '未实现价值'
      AND t.fund IS NOT NULL AND TRIM(t.fund) <> ''
      AND t.company IS NOT NULL AND TRIM(t.company) <> ''
    GROUP BY t.fund, t.company
),
px AS (
    SELECT f_ticker, f_close
    FROM perf_stock_price
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
),
fx AS (
    SELECT currency, rate
    FROM perf_exchange_rate
    WHERE version = (SELECT current_version FROM current_version)
      AND F_DeleteMark = 0
),
listed AS (
    SELECT
        i.fund AS fund,
        i.company AS project,
        MAX(i.ticker) AS ticker,
        MIN(i.ipo_date) AS ipo_date,
        SUM(
            COALESCE(i.current_hold_shares, 0)
            * COALESCE(px.f_close, 0)
            * COALESCE(fx.rate, 1)
        ) AS mkt_unrealized
    FROM perf_ipo i
    LEFT JOIN px ON px.f_ticker = i.ticker
    LEFT JOIN fx ON fx.currency = CASE
        WHEN i.ticker LIKE '%HK%' THEN 'HKD'
        WHEN i.ticker LIKE '%.O%' THEN 'USD'
        ELSE 'CNY'
    END
    WHERE i.version = (SELECT current_version FROM current_version)
      AND i.F_DeleteMark = 0
      AND i.fund IS NOT NULL AND TRIM(i.fund) <> ''
      AND i.company IS NOT NULL AND TRIM(i.company) <> ''
      AND i.ticker IS NOT NULL AND TRIM(i.ticker) <> ''
    GROUP BY
        i.fund,
        i.company
),
listed_any AS (
    SELECT
        i.company AS project,
        MAX(i.ticker) AS ticker,
        MIN(i.ipo_date) AS ipo_date
    FROM perf_ipo i
    WHERE i.version = (SELECT current_version FROM current_version)
      AND i.F_DeleteMark = 0
      AND i.company IS NOT NULL AND TRIM(i.company) <> ''
      AND i.ticker IS NOT NULL AND TRIM(i.ticker) <> ''
    GROUP BY i.company
),
progress AS (
    SELECT
        x.project,
        x.a_statue,
        x.update_time
    FROM (
        SELECT
            c.company AS project,
            p.a_statue,
            p.update_time,
            ROW_NUMBER() OVER (
                PARTITION BY c.company
                ORDER BY COALESCE(p.update_time, '1970-01-01') DESC, p.F_Id DESC
            ) AS rn
        FROM perf_company c
        INNER JOIN perf_ipo_progress p
            ON p.company_full = c.company_full
           AND p.version = (SELECT current_version FROM current_version)
           AND p.F_DeleteMark = 0
        WHERE c.version = (SELECT current_version FROM current_version)
          AND c.F_DeleteMark = 0
    ) x
    WHERE x.rn = 1
),
pos_fund AS (
    SELECT
        p.fund,
        p.project,
        SUM(p.paid_amount) AS paid_amount,
        COALESCE(MAX(u.unrealized), 0) AS val_unrealized
    FROM positions p
    LEFT JOIN unrl u
        ON u.fund = p.fund
       AND u.project = p.project
    GROUP BY p.fund, p.project
),
assembled AS (
    SELECT
        pf.fund,
        pf.project,
        pf.paid_amount,
        CASE
            WHEN COALESCE(fec.exit_cost, 0) > 0 THEN COALESCE(fec.exit_cost, 0)
            ELSE COALESCE(sec.exit_cost, 0)
        END AS exit_cost,
        CASE
            WHEN COALESCE(fr.realized_pre, 0) + COALESCE(fr.realized_post, 0) + COALESCE(fr.realized_xfer, 0) > 0
            THEN COALESCE(fr.realized_pre, 0) + COALESCE(fr.realized_post, 0) + COALESCE(fr.realized_xfer, 0)
            ELSE COALESCE(lt.realized_pre, 0) + COALESCE(lt.realized_post, 0)
        END AS realized,
        CASE
            WHEN COALESCE(ls.ticker, la.ticker) IS NOT NULL
             AND TRIM(COALESCE(ls.ticker, la.ticker)) <> '' THEN '已上市'
            WHEN pg.a_statue IN (
                '已受理', '已问询', '上市委会议', '上市委会议通过',
                '中止', '处理中', '递交A1', '通过聆讯', '征求意见', '已接收',
                '补充材料', '暂缓审议', '上市委会议未通过', '密交',
                '中止(财报更新', '處理中', '注册生效'
            ) THEN '已受理'
            WHEN pg.a_statue IN (
                '终止(撤回)', '终止', '撤回', '失效', '终止注册',
                '撤回辅导备案', '终止(审核不通过)'
            ) THEN NULL
            WHEN pg.a_statue IN ('辅导备案', '备案完成', '辅导验收', '辅导工作完成') THEN '辅导备案'
            ELSE NULL
        END AS ipo_status,
        pg.a_statue AS ipo_progress,
        COALESCE(ls.ticker, la.ticker) AS ticker,
        COALESCE(ls.ipo_date, la.ipo_date, pg.update_time) AS ipo_date,
        pf.val_unrealized,
        COALESCE(ls.mkt_unrealized, 0) AS mkt_unrealized
    FROM pos_fund pf
    LEFT JOIN fund_realized fr ON fr.fund = pf.fund AND fr.project = pf.project
    LEFT JOIN fund_exit_cost fec ON fec.fund = pf.fund AND fec.project = pf.project
    LEFT JOIN spv_lookthrough lt ON lt.fund = pf.fund AND lt.project = pf.project
    LEFT JOIN spv_exit_cost sec ON sec.fund = pf.fund AND sec.project = pf.project
    LEFT JOIN listed ls ON ls.fund = pf.fund AND ls.project = pf.project
    LEFT JOIN listed_any la ON la.project = pf.project
    LEFT JOIN progress pg ON pg.project = pf.project
)
SELECT
    (SELECT target_date FROM input_params) AS b_date,
    (SELECT current_version FROM current_version) AS version,
    a.fund,
    a.project,
    a.ticker,
    DATE(a.ipo_date) AS ipo_date,
    a.ipo_status,
    a.ipo_progress,
    a.paid_amount,
    a.paid_amount - COALESCE(a.exit_cost, 0) AS rest_cost,
    a.realized,
    CASE
        WHEN CURDATE() > (SELECT target_date FROM input_params) THEN a.val_unrealized
        WHEN a.ipo_status = '已上市' THEN a.mkt_unrealized
        ELSE a.val_unrealized
    END AS unrealized,
    a.realized + CASE
        WHEN CURDATE() > (SELECT target_date FROM input_params) THEN a.val_unrealized
        WHEN a.ipo_status = '已上市' THEN a.mkt_unrealized
        ELSE a.val_unrealized
    END AS total_value,
    a.realized / NULLIF(a.paid_amount, 0) AS DPI,
    (a.realized + CASE
        WHEN CURDATE() > (SELECT target_date FROM input_params) THEN a.val_unrealized
        WHEN a.ipo_status = '已上市' THEN a.mkt_unrealized
        ELSE a.val_unrealized
    END) / NULLIF(a.paid_amount, 0) AS MOC
FROM assembled a
WHERE a.ipo_status IS NOT NULL
ORDER BY a.ipo_date DESC, a.fund, a.project
;
