-- ============================================================
-- 客户环境（国方源库）底层项目 SQL
-- 用途：导出明细，与小工具 production 的 02/02c 对比
-- 对比键：fund + IFNULL(investor,'') + company + fund_type
--
-- 说明：
-- 1) 这是你之前贴的 b_project_a 逻辑（实际是「当前仍持有」过滤）
-- 2) 已做小修正，避免和我方对比时口径打架：
--    - 母基金 net_cost_1 改为剩余成本（原错误写成 cost）
--    - 上市日判断改为用 target_date（原 hold_company 写死 2025-07-01，且用 bsharecode 当日期）
--    - 汇总同时输出 cost / net_cost / cost_1 / net_cost_1，方便看客户弹窗用的是哪套
-- 3) 最终默认出「明细」；文件末尾另有按基金汇总、国方一二期明细
-- 4) target_date 按需改
-- ============================================================

WITH input_params AS (
    SELECT '2026-09-30' AS target_date
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
-- 本月仍开放子基金（转让认缴未退完）
sub_fund AS (
    SELECT DISTINCT subquery.sub_fund_in AS sub_fund_in
    FROM (
        SELECT
            fr.fof_out,
            fr.sub_fund_in,
            fr.subscription_amount,
            SUM(COALESCE(ftd.transfercapital, 0)) AS total_transfercapital
        FROM fundraising fr
        LEFT JOIN fund_transaction_detail ftd
            ON fr.f_id = ftd.fundraising_id
           AND ftd.F_DeleteMark = 0
           AND ftd.received_date <= (SELECT target_date FROM input_params)
        WHERE fr.F_DeleteMark = 0
          AND fr.sign_date <= (SELECT target_date FROM input_params)
        GROUP BY fr.fof_out, fr.sub_fund_in, fr.subscription_amount
    ) subquery
    WHERE subquery.total_transfercapital < subquery.subscription_amount
      AND subquery.subscription_amount > 0
      AND subquery.sub_fund_in IS NOT NULL
),
-- 子基金当前实缴比例
sub_fund_ratio AS (
    SELECT DISTINCT
        f.sub_fund_in AS sub_fund_id,
        f.fof_out AS fof_id,
        fof.f_name AS fof,
        sf.f_name AS sub_fund,
        p.paidin AS total,
        (
            SUM(CASE WHEN ftd.transaction_type = '3bbb016827a54e0eb274dfa385276e53' THEN ftd.amount ELSE 0 END)
          - SUM(CASE WHEN ftd.transaction_type = '44c911b06f5b43129e1bfa681d71c7aa' THEN ftd.transferpaidin ELSE 0 END)
        ) / p.paidin AS paid_ratio
    FROM fundraising f
    LEFT JOIN sub_fund_management sf ON sf.f_id = f.sub_fund_in AND f.F_DeleteMark = 0
    LEFT JOIN fof_fund_management fof ON fof.f_id = f.fof_out AND fof.F_DeleteMark = 0
    LEFT JOIN (
        SELECT p1.*
        FROM sonfundpaidin p1
        JOIN (
            SELECT sub_fund_id, MAX(F_CreatorTime) AS max_create_time
            FROM sonfundpaidin
            WHERE F_DeleteMark = 0
            GROUP BY sub_fund_id
        ) p2 ON p1.sub_fund_id = p2.sub_fund_id AND p1.F_CreatorTime = p2.max_create_time
    ) p ON p.sub_fund_id = f.sub_fund_in
    LEFT JOIN fund_transaction_detail ftd
        ON ftd.sub_fund_in = f.sub_fund_in
       AND ftd.fof_out = f.fof_out
       AND ftd.sub_fund_in IS NOT NULL
       AND ftd.F_DeleteMark = 0
       AND ftd.received_date <= (SELECT target_date FROM input_params)
    WHERE f.sub_fund_in IS NOT NULL
      AND f.fof_out IS NOT NULL
      AND sf.F_DeleteMark = 0
    GROUP BY 1, 2, 3, 4, 5
),
-- 子基金底层项目（剩余成本>0）
TransactionSummary AS (
    SELECT
        COALESCE(ptd.sub_fund_out) AS investor_id,
        COALESCE(sf.f_name) AS investor,
        '子基金' AS fund_type,
        ptd.receive_side AS company_id,
        SUM(CASE WHEN ptd.transaction_type = '4c5ec4175d354e728f28f3fee8ad53e3' THEN ptd.transaction_amount ELSE 0 END) AS cost,
        SUM(CASE WHEN ptd.transaction_type IN ('d199612214994bd9a6f838f98670ed3e', '2dc8bb7c38324215bbf5418afd0b0c81') THEN ptd.exit_cost ELSE 0 END) AS exit_cost
    FROM project_transaction_detail ptd
    LEFT JOIN sub_fund_management sf ON sf.f_id = ptd.sub_fund_out
    LEFT JOIN invested_company ic ON ic.f_id = ptd.receive_side
    WHERE ptd.F_DeleteMark = 0
      AND ptd.receive_side IS NOT NULL
      AND ptd.sub_fund_out IS NOT NULL
      AND ptd.transaction_date <= (SELECT target_date FROM input_params)
      AND ptd.sub_fund_out IN (SELECT sub_fund_in FROM sub_fund)
    GROUP BY
        COALESCE(ptd.sub_fund_out),
        COALESCE(sf.f_name),
        ptd.receive_side,
        '子基金'
    HAVING
        SUM(CASE WHEN ptd.transaction_type = '4c5ec4175d354e728f28f3fee8ad53e3' THEN ptd.transaction_amount ELSE 0 END)
      - SUM(CASE WHEN ptd.transaction_type IN ('d199612214994bd9a6f838f98670ed3e', '2dc8bb7c38324215bbf5418afd0b0c81') THEN ptd.exit_cost ELSE 0 END) > 0
),
hold_company AS (
    SELECT DISTINCT
        CASE
            WHEN ts.fund_type = '直投基金' THEN ts.investor
            WHEN ts.fund_type = '子基金' THEN fof.f_name
            ELSE NULL
        END AS fund,
        ts.investor,
        ts.company_id,
        ts.fund_type,
        ic.f_name AS company,
        ts.cost,
        ts.exit_cost,
        (ts.cost - ts.exit_cost) AS net_cost,
        CASE WHEN ts.fund_type = '子基金' THEN ts.cost * sfr.paid_ratio ELSE ts.cost END AS cost_1,
        -- 修正：非子基金穿透剩余应用 net_cost，不能用 cost
        CASE
            WHEN ts.fund_type = '子基金' THEN (ts.cost - ts.exit_cost) * sfr.paid_ratio
            ELSE (ts.cost - ts.exit_cost)
        END AS net_cost_1,
        CASE WHEN EXISTS (
            SELECT 1 FROM ipo
            WHERE ipo.company = ts.company_id
              AND ipo.ticker IS NOT NULL AND TRIM(ipo.ticker) <> ''
              AND ipo.f_deletemark = 0
              AND COALESCE(ipo.company, '') <> ''
              AND COALESCE(
                    STR_TO_DATE(ipo.bsharecode, '%Y-%m-%d %H:%i:%s'),
                    STR_TO_DATE(ipo.bsharecode, '%Y-%m-%d'),
                    '1970-01-01'
                  ) <= (SELECT target_date FROM input_params)
        ) THEN '是' ELSE '否' END AS is_listed
    FROM TransactionSummary ts
    LEFT JOIN invested_company ic ON ic.f_id = ts.company_id
    LEFT JOIN (
        SELECT fr.sub_fund_in, fof.f_name, fr.fof_out
        FROM fundraising fr
        JOIN fof_fund_management fof ON fr.fof_out = fof.f_id
        WHERE fr.F_DeleteMark = 0 AND fof.F_DeleteMark = 0
    ) fof ON ts.investor_id = fof.sub_fund_in AND ts.fund_type = '子基金'
    LEFT JOIN sub_fund_ratio sfr
        ON sfr.sub_fund_id = ts.investor_id
       AND fof.fof_out = sfr.fof_id
),
-- SPV 穿透比例
y0 AS (
    SELECT DISTINCT
        a.fof_out,
        a.sub_fund_in,
        a.spv_in,
        b.receive_side
    FROM penetration3_lpview_project a
    LEFT JOIN investment_agreement b
        ON a.sub_fund_in = b.sub_fund_out
       AND b.f_deletemark = 0
       AND a.fof_out IS NOT NULL
       AND a.sub_fund_in IS NOT NULL
    WHERE a.f_deletemark = 0
      AND b.f_deletemark = 0
      AND b.sign_date <= (SELECT target_date FROM input_params)
      AND b.receive_side IS NOT NULL
      AND ((a.spv_in IS NULL AND a.sub_fund_in IS NOT NULL) OR (a.spv_in IS NOT NULL AND a.sub_fund_in IS NULL))

    UNION ALL

    SELECT DISTINCT
        a.fof_out,
        a.sub_fund_in,
        a.spv_in,
        b.receive_side
    FROM penetration3_lpview_project a
    LEFT JOIN investment_agreement b
        ON a.spv_in = b.spv_out
       AND b.f_deletemark = 0
       AND a.fof_out IS NOT NULL
       AND a.spv_in IS NOT NULL
    WHERE a.f_deletemark = 0
      AND b.f_deletemark = 0
      AND b.sign_date <= (SELECT target_date FROM input_params)
      AND ((a.spv_in IS NULL AND a.sub_fund_in IS NOT NULL) OR (a.spv_in IS NOT NULL AND a.sub_fund_in IS NULL))
),
y01 AS (
    SELECT
        fof_id, spv_id, company_id, initial_ratio, end_ratio,
        ROW_NUMBER() OVER (PARTITION BY fof_id, spv_id, company_id ORDER BY q_date DESC) AS rn
    FROM fof_to_spv a
    WHERE q_date <= (SELECT target_date FROM input_params)
      AND f_deletemark = 0
),
y0_valid AS (
    SELECT * FROM y01 WHERE rn = 1
),
y1 AS (
    SELECT fof_id, spv_id, company_id, initial_ratio, end_ratio
    FROM y0_valid
    UNION ALL
    SELECT
        fof_out AS fof_id,
        spv_in AS spv_id,
        receive_side AS company_id,
        0.995 AS initial_ratio,
        0.995 AS end_ratio
    FROM y0
    WHERE spv_in IS NOT NULL
      AND fof_out IS NOT NULL
      AND sub_fund_in IS NULL
      AND receive_side IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM y0_valid y
          WHERE y.fof_id = y0.fof_out
            AND y.spv_id = y0.spv_in
            AND y.company_id = y0.receive_side
      )
),
-- 母基金直投成本/退出
a0 AS (
    SELECT
        ftd.fof_out AS fund_id,
        pi.company_id AS company_id,
        COALESCE(SUM(CASE WHEN ftd.transaction_type = '3bbb016827a54e0eb274dfa385276e53' THEN ftd.amount END), 0) AS cost,
        0 AS exit_cost
    FROM fund_transaction_detail ftd
    LEFT JOIN pre_investment pi ON pi.f_id = ftd.project_id
    WHERE ftd.f_deletemark = 0
      AND ftd.fof_out IS NOT NULL
      AND ftd.spv_in IS NOT NULL
      AND ftd.sub_fund_in IS NULL
      AND DATE(ftd.received_date) <= (SELECT target_date FROM input_params)
      AND ftd.project_id IS NOT NULL
    GROUP BY ftd.fof_out, pi.company_id

    UNION ALL
    -- 上市退出
    SELECT
        ipo.fof_id AS fund_id,
        ptd.receive_side AS company_id,
        0 AS cost,
        COALESCE(SUM(CASE WHEN ptd.transaction_type = 'd199612214994bd9a6f838f98670ed3e' THEN ptd.exit_cost END), 0) AS exit_cost
    FROM project_transaction_detail ptd
    LEFT JOIN ipo ON ipo.f_id = ptd.ipomanageid AND ipo.F_DeleteMark = 0
    WHERE ptd.f_deletemark = 0
      AND ptd.direct_out IS NULL
      AND ptd.spv_out IS NOT NULL
      AND ptd.sub_fund_out IS NULL
      AND DATE(ptd.transaction_date) <= (SELECT target_date FROM input_params)
      AND ptd.receive_side IS NOT NULL
      AND ptd.ipomanageid IS NOT NULL
      AND ipo.fof_id IS NOT NULL AND ipo.fof_id <> ''
    GROUP BY ipo.fof_id, ptd.spv_out, ptd.receive_side

    UNION ALL
    -- 转让退出
    SELECT
        e.fof_id AS fund_id,
        ftd.company_id AS company_id,
        0 AS cost,
        SUM(CASE WHEN ftd.transaction_type IN ('c74c96010fee4a1d8dbae0b8b02f94ea', '44c911b06f5b43129e1bfa681d71c7aa') THEN ftd.capital ELSE 0 END) AS exit_cost
    FROM exitmanage e
    LEFT JOIN fund_transaction_detail ftd ON ftd.exit_id = e.f_id
    WHERE e.fof_id IS NOT NULL
      AND e.F_DeleteMark = 0
      AND e.F_LayoutId = 'd26f370d02424b17b55524d62130db13'
      AND ftd.f_deletemark = 0
      AND ftd.received_date <= (SELECT target_date FROM input_params)
      AND ftd.spv_in IS NOT NULL
      AND ftd.company_id IS NOT NULL
    GROUP BY 1, 2

    UNION ALL
    -- 一级市场退出 * 穿透比例
    SELECT
        y1.fof_id AS fund_id,
        ptd.receive_side AS company_id,
        0 AS cost,
        SUM(CASE WHEN ptd.transaction_type = 'd199612214994bd9a6f838f98670ed3e' AND ptd.ipomanageid IS NULL THEN ptd.exit_cost ELSE 0 END) * y1.initial_ratio AS exit_cost
    FROM project_transaction_detail ptd
    LEFT JOIN y1 ON ptd.spv_out = y1.spv_id AND ptd.receive_side = y1.company_id
    WHERE ptd.f_deletemark = 0
      AND ptd.transaction_date <= (SELECT target_date FROM input_params)
      AND ptd.receive_side IS NOT NULL
      AND ptd.spv_out IS NOT NULL
    GROUP BY 1, 2, y1.initial_ratio
),
a1 AS (
    SELECT
        fof.f_name AS fund,
        CAST(NULL AS CHAR) AS investor,
        a0.company_id AS company_id,
        '母基金' AS fund_type,
        ic.f_name AS company,
        SUM(cost) AS cost,
        SUM(exit_cost) AS exit_cost,
        SUM(cost) - SUM(exit_cost) AS net_cost,
        SUM(cost) AS cost_1,
        SUM(cost) - SUM(exit_cost) AS net_cost_1,
        CASE WHEN EXISTS (
            SELECT 1 FROM ipo
            WHERE ipo.company = a0.company_id
              AND ipo.ticker IS NOT NULL AND TRIM(ipo.ticker) <> ''
              AND ipo.f_deletemark = 0
              AND COALESCE(ipo.company, '') <> ''
              AND COALESCE(
                    STR_TO_DATE(ipo.bsharecode, '%Y-%m-%d %H:%i:%s'),
                    STR_TO_DATE(ipo.bsharecode, '%Y-%m-%d'),
                    '1970-01-01'
                  ) <= (SELECT target_date FROM input_params)
        ) THEN '是' ELSE '否' END AS is_listed
    FROM a0
    LEFT JOIN fof_fund_management fof ON fof.f_id = a0.fund_id
    LEFT JOIN invested_company ic ON ic.f_id = a0.company_id
    GROUP BY a0.fund_id, fof.f_name, a0.company_id, ic.f_name
    HAVING SUM(cost) - SUM(exit_cost) > 1000
),
a2 AS (
    SELECT * FROM hold_company
    UNION ALL
    SELECT * FROM a1
)

-- ========== A. 明细（默认执行这段；与小工具 02/02c 对齐）==========
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
  AND a2.fund <> '国方一期产品'
  AND a2.net_cost > 0
ORDER BY fund, a2.fund_type, COALESCE(a2.investor, ''), a2.company
;

-- ========== B. 按基金汇总（核对客户弹窗；客户弹窗投资≈cost，穿透≈cost_1）==========
/*
SELECT
    CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END AS fund,
    COUNT(*) AS project_num,
    COUNT(DISTINCT a2.company) AS company_num,
    ROUND(SUM(a2.cost) / 1e8, 2) AS invest_yi_cost,
    ROUND(SUM(a2.net_cost) / 1e8, 2) AS invest_yi_net,
    ROUND(SUM(a2.cost_1) / 1e8, 2) AS ct_yi_cost1,
    ROUND(SUM(a2.net_cost_1) / 1e8, 2) AS ct_yi_net1,
    SUM(CASE WHEN a2.is_listed = '是' THEN 1 ELSE 0 END) AS ipo_num,
    ROUND(SUM(CASE WHEN a2.is_listed = '是' THEN a2.cost_1 ELSE 0 END) / 1e8, 2) AS ipo_ct_cost1,
    ROUND(SUM(CASE WHEN a2.is_listed = '是' THEN a2.net_cost_1 ELSE 0 END) / 1e8, 2) AS ipo_ct_net1
FROM a2
WHERE a2.fund IS NOT NULL AND TRIM(a2.fund) <> ''
  AND a2.fund <> '国方一期产品'
  AND a2.net_cost > 0
GROUP BY CASE WHEN a2.fund = '长三角协同引领基金' THEN '长三角二期' ELSE a2.fund END
ORDER BY fund;
*/

-- ========== C. 只看国方一期/二期明细 ==========
/*
SELECT
    a2.fund,
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
ORDER BY a2.fund, a2.fund_type, COALESCE(a2.investor, ''), a2.company;
*/
