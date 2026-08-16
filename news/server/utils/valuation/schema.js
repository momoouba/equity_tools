/**
 * 项目估值表结构：独立于 db.js 主体，启动时由 ensureValuationSchema(pool) 调用。
 */
const SW_INDUSTRY_L3_SEED = require('./swIndustryL3Seed');

async function seedSwIndustryCatalog(dbPool) {
  const [rows] = await dbPool.query('SELECT COUNT(*) AS n FROM valuation_sw_industry');
  if (Number(rows[0]?.n) > 0) return;
  const seed = Array.isArray(SW_INDUSTRY_L3_SEED) ? SW_INDUSTRY_L3_SEED : [];
  if (!seed.length) return;
  const prefix = '20260816180000';
  const values = [];
  const params = [];
  for (let i = 0; i < seed.length; i += 1) {
    const id = `${prefix}${String(i + 1).padStart(5, '0')}`;
    const row = seed[i] || {};
    if (!row.l3) continue;
    values.push('(?,?,?,?,NOW())');
    params.push(id, row.l1 || '', row.l2 || '', row.l3);
  }
  if (!values.length) return;
  await dbPool.query(
    `INSERT INTO valuation_sw_industry (F_Id, sw_industry_l1, sw_industry_l2, sw_industry_l3, F_CreatorTime)
     VALUES ${values.join(',')}`,
    params
  );
  console.log(`✓ 已初始化申万三级行业目录 ${seed.length} 个`);
}

async function ensureValuationSchema(dbPool) {
  if (!dbPool) return;

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_pre_project (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
      enterprise_full_name VARCHAR(255) NOT NULL COMMENT '企业全称（手工新建）',
      project_abbreviation VARCHAR(255) NULL COMMENT '项目简称',
      unified_credit_code VARCHAR(64) NULL COMMENT '统一社会信用代码',
      competitor_pre_project_id VARCHAR(19) NULL COMMENT '竞品分析投前项目 ID',
      snapshot_name VARCHAR(255) NULL COMMENT '关联时快照名称',
      F_CreatorUserId VARCHAR(19) NOT NULL COMMENT '创建人',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
      F_DeleteTime DATETIME NULL,
      F_DeleteUserId VARCHAR(19) NULL,
      KEY idx_vpp_creator (F_CreatorUserId, F_DeleteMark),
      KEY idx_vpp_ca (competitor_pre_project_id),
      KEY idx_vpp_credit (unified_credit_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—投前主体'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_case (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY COMMENT '主键',
      case_type VARCHAR(32) NOT NULL COMMENT 'pre_investment / post_investment',
      pre_project_id VARCHAR(19) NULL COMMENT 'valuation_pre_project.F_Id',
      invested_enterprise_id VARCHAR(19) NULL COMMENT 'invested_enterprises.F_Id（项目估值域）',
      subject_display_name VARCHAR(255) NULL COMMENT '主体展示名快照',
      round_deal_value_yi DECIMAL(20,6) NULL COMMENT '本轮交易估值（亿元），只对照',
      status VARCHAR(32) NOT NULL DEFAULT 'draft' COMMENT 'draft/ready/archived',
      F_CreatorUserId VARCHAR(19) NOT NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
      F_DeleteTime DATETIME NULL,
      F_DeleteUserId VARCHAR(19) NULL,
      KEY idx_vc_type (case_type, F_DeleteMark),
      KEY idx_vc_pre (pre_project_id),
      KEY idx_vc_ie (invested_enterprise_id),
      KEY idx_vc_creator (F_CreatorUserId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—案件（一主体一案）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_case_comparable (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      stock_code VARCHAR(32) NOT NULL,
      stock_name VARCHAR(200) NULL,
      listing_market VARCHAR(16) NULL COMMENT 'sse/szse/bse/neeq',
      unified_credit_code VARCHAR(64) NULL,
      competitor_relation_id VARCHAR(19) NULL,
      relevance_score DECIMAL(10,4) NULL,
      comparability VARCHAR(16) NULL COMMENT 'strong/medium/weak',
      in_pool TINYINT(1) NOT NULL DEFAULT 1,
      selected TINYINT(1) NOT NULL DEFAULT 1,
      source VARCHAR(32) NOT NULL DEFAULT 'competitor_run' COMMENT 'competitor_run/manual/excel',
      pe_median_override DECIMAL(20,6) NULL COMMENT '底稿 PE 中位，有值则进 POOL',
      ps_median_override DECIMAL(20,6) NULL COMMENT '底稿 PS 中位，有值则进 POOL',
      disabled_reason VARCHAR(255) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
      KEY idx_vcc_case (case_id, F_DeleteMark),
      KEY idx_vcc_code (stock_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—案件可比快照'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS listed_company_financials (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      stock_code VARCHAR(32) NOT NULL,
      listing_market VARCHAR(16) NULL,
      report_period VARCHAR(16) NOT NULL COMMENT '报告期 YYYY-MM-DD 或 YYYYMMDD',
      report_type VARCHAR(16) NOT NULL COMMENT 'annual/q1/interim/q3',
      statement_type VARCHAR(16) NOT NULL COMMENT 'pl/bs/cf',
      revenue DECIMAL(24,4) NULL COMMENT '营业收入，元',
      cogs DECIMAL(24,4) NULL COMMENT '营业成本，元',
      gross_profit DECIMAL(24,4) NULL COMMENT '毛利，元',
      tax_surcharge DECIMAL(24,4) NULL COMMENT '税金及附加，元',
      selling DECIMAL(24,4) NULL COMMENT '销售费用，元',
      admin DECIMAL(24,4) NULL COMMENT '管理费用，元',
      rd DECIMAL(24,4) NULL COMMENT '研发费用，元',
      operating_profit DECIMAL(24,4) NULL COMMENT '营业利润，元',
      net_income DECIMAL(24,4) NULL COMMENT '净利润，元',
      cash DECIMAL(24,4) NULL COMMENT '货币资金，元',
      notes_receivable DECIMAL(24,4) NULL COMMENT '应收票据，元',
      accounts_receivable DECIMAL(24,4) NULL COMMENT '应收账款，元',
      prepayment DECIMAL(24,4) NULL COMMENT '预付款项，元',
      inventory DECIMAL(24,4) NULL COMMENT '存货，元',
      other_current_assets DECIMAL(24,4) NULL COMMENT '其他流动资产，元',
      current_assets DECIMAL(24,4) NULL COMMENT '流动资产合计，元',
      fixed_assets DECIMAL(24,4) NULL COMMENT '固定资产，元',
      cip DECIMAL(24,4) NULL COMMENT '在建工程，元',
      intangible DECIMAL(24,4) NULL COMMENT '无形资产，元',
      long_prepaid DECIMAL(24,4) NULL COMMENT '长期待摊费用，元',
      deferred_tax_assets DECIMAL(24,4) NULL COMMENT '递延所得税资产，元',
      total_assets DECIMAL(24,4) NULL COMMENT '资产总计，元',
      short_term_loan DECIMAL(24,4) NULL COMMENT '短期借款，元',
      notes_payable DECIMAL(24,4) NULL COMMENT '应付票据，元',
      accounts_payable DECIMAL(24,4) NULL COMMENT '应付账款，元',
      advance_receipt DECIMAL(24,4) NULL COMMENT '预收款项，元',
      staff_payable DECIMAL(24,4) NULL COMMENT '应付职工薪酬，元',
      tax_payable DECIMAL(24,4) NULL COMMENT '应交税费，元',
      long_term_loan DECIMAL(24,4) NULL COMMENT '长期借款，元',
      deferred_income DECIMAL(24,4) NULL COMMENT '递延收益，元',
      total_liab_equity DECIMAL(24,4) NULL COMMENT '负债和所有者权益总计，元',
      equity DECIMAL(24,4) NULL COMMENT '净资产合计，元',
      cfo DECIMAL(24,4) NULL COMMENT '经营现金流净额，元',
      cfi DECIMAL(24,4) NULL COMMENT '投资现金流净额，元',
      cff DECIMAL(24,4) NULL COMMENT '筹资现金流净额，元',
      da DECIMAL(24,4) NULL COMMENT '折旧摊销，元',
      capex DECIMAL(24,4) NULL COMMENT '购建长期资产现金，元',
      cash_begin DECIMAL(24,4) NULL COMMENT '期初现金，元',
      cash_end DECIMAL(24,4) NULL COMMENT '期末现金，元',
      data_source VARCHAR(64) NULL,
      fetched_at DATETIME NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_lcf (stock_code, report_period, report_type, statement_type),
      KEY idx_lcf_code (stock_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—上市财报（按报告期，科目列）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS listed_company_market_multiples (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      stock_code VARCHAR(32) NOT NULL,
      listing_market VARCHAR(16) NULL,
      trade_date DATE NOT NULL,
      pe_ttm DECIMAL(20,6) NULL,
      pe_lyr DECIMAL(20,6) NULL,
      ps_ttm DECIMAL(20,6) NULL,
      ps_lyr DECIMAL(20,6) NULL,
      market_cap DECIMAL(24,4) NULL COMMENT '市值，元',
      data_source VARCHAR(64) NULL,
      quality_warning VARCHAR(255) NULL,
      fetched_at DATETIME NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_lcmm (stock_code, trade_date),
      KEY idx_lcmm_code (stock_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—个股历史 PE/PS'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS industry_market_multiples (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      sw_industry_l3 VARCHAR(128) NOT NULL,
      trade_date DATE NOT NULL,
      stat_method VARCHAR(16) NOT NULL COMMENT 'arithmetic/overall',
      pe_median DECIMAL(20,6) NULL,
      ps_median DECIMAL(20,6) NULL,
      pe_min DECIMAL(20,6) NULL,
      pe_max DECIMAL(20,6) NULL,
      ps_min DECIMAL(20,6) NULL,
      ps_max DECIMAL(20,6) NULL,
      data_source VARCHAR(64) NULL,
      fetched_at DATETIME NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_imm (sw_industry_l3, trade_date, stat_method)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—申万三级行业 PE/PS'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_sw_constituent (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      stock_code VARCHAR(32) NOT NULL,
      stock_name VARCHAR(200) NULL,
      em2016 VARCHAR(255) NULL,
      sw_industry_l1 VARCHAR(128) NULL,
      sw_industry_l2 VARCHAR(128) NULL,
      sw_industry_l3 VARCHAR(128) NULL,
      fetched_at DATETIME NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vsc_code (stock_code),
      KEY idx_vsc_l3 (sw_industry_l3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—申万行业成分（东财 EM2016）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_sw_industry (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      sw_industry_l1 VARCHAR(128) NULL,
      sw_industry_l2 VARCHAR(128) NULL,
      sw_industry_l3 VARCHAR(128) NOT NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vsi_path (sw_industry_l1, sw_industry_l2, sw_industry_l3),
      KEY idx_vsi_l3 (sw_industry_l3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—申万三级行业目录（东财 EM2016 现行）'
  `);
  await seedSwIndustryCatalog(dbPool);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_target_pl_line (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0' COMMENT '0=草稿，否则为 valuation_version.F_Id',
      line_no INT NOT NULL COMMENT '从 0 起，对应预测年第几列',
      fiscal_year VARCHAR(16) NOT NULL COMMENT '会计年度，如 2026',
      revenue DECIMAL(24,4) NULL COMMENT '营业收入，元',
      cogs DECIMAL(24,4) NULL COMMENT '营业成本，元',
      gross_profit DECIMAL(24,4) NULL COMMENT '毛利，元',
      selling DECIMAL(24,4) NULL COMMENT '销售费用，元',
      admin DECIMAL(24,4) NULL COMMENT '管理费用，元',
      rd DECIMAL(24,4) NULL COMMENT '研发费用，元',
      operating_profit DECIMAL(24,4) NULL COMMENT '营业利润，元',
      net_income DECIMAL(24,4) NULL COMMENT '净利润，元',
      revenue_growth DECIMAL(20,8) NULL COMMENT '收入同比，小数',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vtpl (case_id, version_id, line_no),
      KEY idx_vtpl_case (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—标的利润表（按年一行，金额元）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_target_bs (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0' COMMENT '0=草稿',
      cash DECIMAL(24,4) NULL COMMENT '货币资金，元',
      notes_receivable DECIMAL(24,4) NULL COMMENT '应收票据，元',
      accounts_receivable DECIMAL(24,4) NULL COMMENT '应收账款，元',
      prepayment DECIMAL(24,4) NULL COMMENT '预付款项，元',
      inventory DECIMAL(24,4) NULL COMMENT '存货，元',
      other_current_assets DECIMAL(24,4) NULL COMMENT '其他流动资产，元',
      fixed_assets DECIMAL(24,4) NULL COMMENT '固定资产，元',
      cip DECIMAL(24,4) NULL COMMENT '在建工程，元',
      intangible DECIMAL(24,4) NULL COMMENT '无形资产，元',
      long_prepaid DECIMAL(24,4) NULL COMMENT '长期待摊费用，元',
      deferred_tax_assets DECIMAL(24,4) NULL COMMENT '递延所得税资产，元',
      short_term_loan DECIMAL(24,4) NULL COMMENT '短期借款，元',
      notes_payable DECIMAL(24,4) NULL COMMENT '应付票据，元',
      accounts_payable DECIMAL(24,4) NULL COMMENT '应付账款，元',
      advance_receipt DECIMAL(24,4) NULL COMMENT '预收款项，元',
      staff_payable DECIMAL(24,4) NULL COMMENT '应付职工薪酬，元',
      tax_payable DECIMAL(24,4) NULL COMMENT '应交税费，元',
      long_term_loan DECIMAL(24,4) NULL COMMENT '长期借款，元',
      deferred_income DECIMAL(24,4) NULL COMMENT '递延收益，元',
      equity DECIMAL(24,4) NULL COMMENT '所有者权益合计，元',
      net_debt_override DECIMAL(24,4) NULL COMMENT '净负债手工覆盖，元',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vtbs (case_id, version_id),
      KEY idx_vtbs_case (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—标的资产负债表（金额元）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_target_cf (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0' COMMENT '0=草稿',
      da_default DECIMAL(24,4) NULL COMMENT '折旧摊销默认，元/年',
      capex_default DECIMAL(24,4) NULL COMMENT '资本性支出默认，元/年',
      dnwc_default DECIMAL(24,4) NULL COMMENT '营运资本增加默认，元/年',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vtcf (case_id, version_id),
      KEY idx_vtcf_case (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—标的现金流假设（金额元）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_target_cf_line (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0' COMMENT '0=草稿',
      line_no INT NOT NULL,
      fiscal_year VARCHAR(16) NULL,
      da DECIMAL(24,4) NULL COMMENT '折旧摊销，元',
      capex DECIMAL(24,4) NULL COMMENT '资本性支出，元',
      dnwc DECIMAL(24,4) NULL COMMENT '营运资本增加，元',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vtcfl (case_id, version_id, line_no),
      KEY idx_vtcfl_case (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—标的现金流按年明细（金额元）'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_draft (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      F_CreatorUserId VARCHAR(19) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vd_case (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—自动草稿头'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_version (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_no INT NOT NULL COMMENT 'v1/v2 序号',
      round_deal_value_yi DECIMAL(20,6) NULL,
      remark VARCHAR(500) NULL,
      F_CreatorUserId VARCHAR(19) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      F_DeleteMark TINYINT(1) NOT NULL DEFAULT 0,
      UNIQUE KEY uk_vv_case_no (case_id, version_no),
      KEY idx_vv_case (case_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—正式版本'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_fetch_log (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NULL,
      job_id VARCHAR(19) NULL,
      stock_code VARCHAR(32) NULL,
      action VARCHAR(64) NULL,
      status VARCHAR(16) NULL,
      message VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vfl_case (case_id),
      KEY idx_vfl_code (stock_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—抓取日志'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_job (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      job_type VARCHAR(32) NOT NULL COMMENT 'fetch_and_calc/calc_only',
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      progress INT NOT NULL DEFAULT 0,
      message VARCHAR(1000) NULL,
      F_CreatorUserId VARCHAR(19) NULL,
      started_at DATETIME NULL,
      finished_at DATETIME NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_vj_case (case_id, F_CreatorTime)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—异步任务'
  `);

  await createStructuredResultTables(dbPool);
  await addListedMetricColumnsIfMissing(dbPool);
  await addTargetBsColumnsIfMissing(dbPool);
  if (await tableExists(dbPool, 'valuation_gross_margin_period')) {
    const gmCols = await listColumns(dbPool, 'valuation_gross_margin_period');
    if (!gmCols.has('fiscal_year')) {
      await dbPool.query(
        `ALTER TABLE valuation_gross_margin_period ADD COLUMN fiscal_year VARCHAR(16) NULL COMMENT '会计年度'`
      );
    }
  }
  if (await tableExists(dbPool, 'valuation_assumption')) {
    const assCols = await listColumns(dbPool, 'valuation_assumption');
    if (!assCols.has('dcf_liquidity_discount')) {
      await dbPool.query(`ALTER TABLE valuation_assumption ADD COLUMN dcf_liquidity_discount DECIMAL(20,8) NULL COMMENT '并购 DCF 流动性折扣，与市场法折扣分开'`);
    }
  }
  if (await tableExists(dbPool, 'valuation_case_comparable')) {
    const compCols = await listColumns(dbPool, 'valuation_case_comparable');
    if (!compCols.has('pe_median_override')) {
      await dbPool.query(`ALTER TABLE valuation_case_comparable ADD COLUMN pe_median_override DECIMAL(20,6) NULL COMMENT '底稿 PE 中位，有值则进 POOL'`);
    }
    if (!compCols.has('ps_median_override')) {
      await dbPool.query(`ALTER TABLE valuation_case_comparable ADD COLUMN ps_median_override DECIMAL(20,6) NULL COMMENT '底稿 PS 中位，有值则进 POOL'`);
    }
  }
  if (await tableExists(dbPool, 'valuation_relative_row')) {
    const relCols = await listColumns(dbPool, 'valuation_relative_row');
    if (!relCols.has('asof_date')) {
      await dbPool.query(`ALTER TABLE valuation_relative_row ADD COLUMN asof_date DATE NULL COMMENT '市场法锚定日'`);
    }
    if (!relCols.has('asof_trade_date')) {
      await dbPool.query(`ALTER TABLE valuation_relative_row ADD COLUMN asof_trade_date DATE NULL COMMENT '该公司实际截面交易日'`);
    }
    if (!relCols.has('pe_median_override')) {
      await dbPool.query(`ALTER TABLE valuation_relative_row ADD COLUMN pe_median_override DECIMAL(20,6) NULL COMMENT '底稿 PE 中位'`);
    }
    if (!relCols.has('ps_median_override')) {
      await dbPool.query(`ALTER TABLE valuation_relative_row ADD COLUMN ps_median_override DECIMAL(20,6) NULL COMMENT '底稿 PS 中位'`);
    }
  }
  try {
    await migrateListedMetricsJson(dbPool);
    const { migrateValuationJsonStores } = require('./workspaceStore');
    await migrateValuationJsonStores(dbPool);
    await dropValuationJsonArtifacts(dbPool);
  } catch (e) {
    console.error('估值 JSON → 结构化迁移失败，本次保留 JSON 列以便下次重试:', e);
  }

  console.log('✓ 项目估值表结构已就绪');
}

async function listColumns(dbPool, table) {
  const [rows] = await dbPool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return new Set((rows || []).map((r) => r.COLUMN_NAME));
}

async function tableExists(dbPool, table) {
  const [rows] = await dbPool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table]
  );
  return !!(rows && rows.length);
}

async function addListedMetricColumnsIfMissing(dbPool) {
  if (!(await tableExists(dbPool, 'listed_company_financials'))) return;
  const { LISTED_METRIC_COLS, metricColumnDdl } = require('./listedMetrics');
  const have = await listColumns(dbPool, 'listed_company_financials');
  for (const name of LISTED_METRIC_COLS) {
    if (have.has(name)) continue;
    await dbPool.query(
      `ALTER TABLE listed_company_financials ADD COLUMN \`${name}\` ${metricColumnDdl(name)}`
    );
  }
}

async function addTargetBsColumnsIfMissing(dbPool) {
  if (!(await tableExists(dbPool, 'valuation_target_bs'))) return;
  const { BS_INPUT_FIELDS } = require('./targetBsFields');
  const have = await listColumns(dbPool, 'valuation_target_bs');
  for (const f of BS_INPUT_FIELDS) {
    if (have.has(f.key)) continue;
    await dbPool.query(
      `ALTER TABLE valuation_target_bs ADD COLUMN \`${f.key}\` DECIMAL(24,4) NULL COMMENT '${f.comment}'`
    );
  }
}

async function migrateListedMetricsJson(dbPool) {
  if (!(await tableExists(dbPool, 'listed_company_financials'))) return;
  const have = await listColumns(dbPool, 'listed_company_financials');
  if (!have.has('metrics_json')) return;
  const { LISTED_METRIC_COLS, parseJson, toNum } = require('./listedMetrics');
  const [rows] = await dbPool.query(
    'SELECT F_Id, metrics_json FROM listed_company_financials WHERE metrics_json IS NOT NULL'
  );
  for (const r of rows || []) {
    const m = parseJson(r.metrics_json, {});
    const sets = [];
    const params = [];
    for (const k of LISTED_METRIC_COLS) {
      const n = toNum(m[k]);
      if (n == null) continue;
      sets.push(`\`${k}\` = COALESCE(\`${k}\`, ?)`);
      params.push(n);
    }
    if (!sets.length) continue;
    params.push(r.F_Id);
    await dbPool.query(
      `UPDATE listed_company_financials SET ${sets.join(', ')} WHERE F_Id = ?`,
      params
    );
  }
}

async function dropColumnIfExists(dbPool, table, col) {
  if (!(await tableExists(dbPool, table))) return;
  const have = await listColumns(dbPool, table);
  if (!have.has(col)) return;
  await dbPool.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${col}\``);
}

async function dropValuationJsonArtifacts(dbPool) {
  await dropColumnIfExists(dbPool, 'listed_company_financials', 'metrics_json');
  await dropColumnIfExists(dbPool, 'valuation_case', 'method_config_json');
  await dropColumnIfExists(dbPool, 'valuation_draft', 'payload_json');
  await dropColumnIfExists(dbPool, 'valuation_version', 'method_config_json');
  await dropColumnIfExists(dbPool, 'valuation_version', 'assumptions_json');
  await dropColumnIfExists(dbPool, 'valuation_version', 'conclusion_json');
  await dropColumnIfExists(dbPool, 'valuation_job', 'result_json');
  if (await tableExists(dbPool, 'valuation_version_sheet')) {
    await dbPool.query('DROP TABLE valuation_version_sheet');
  }
}

async function createStructuredResultTables(dbPool) {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_method (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      terminal_type VARCHAR(32) NULL,
      fcf_method VARCHAR(32) NULL,
      sensitivity_axes VARCHAR(32) NULL,
      scenario_mode VARCHAR(32) NULL,
      multiple_source VARCHAR(32) NULL,
      industry_stat_method VARCHAR(32) NULL,
      confirmed TINYINT(1) NOT NULL DEFAULT 0,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vm (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—方法配置'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_assumption (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      discount_rate DECIMAL(20,8) NULL,
      exit_pe DECIMAL(20,6) NULL,
      exit_ps DECIMAL(20,6) NULL,
      liquidity_discount DECIMAL(20,8) NULL,
      dcf_liquidity_discount DECIMAL(20,8) NULL COMMENT '并购 DCF 流动性折扣，与市场法折扣分开',
      tax_rate DECIMAL(20,8) NULL,
      forecast_years INT NULL,
      esop DECIMAL(24,4) NULL,
      valuation_date VARCHAR(16) NULL,
      round_deal_value_yi DECIMAL(20,6) NULL,
      display_unit VARCHAR(16) NULL,
      wacc_risk_free_rate DECIMAL(20,8) NULL,
      wacc_erp DECIMAL(20,8) NULL,
      wacc_beta DECIMAL(20,8) NULL,
      wacc_debt_equity DECIMAL(20,8) NULL,
      wacc_debt_cost DECIMAL(20,8) NULL,
      wacc_tax_rate DECIMAL(20,8) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_va (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—假设'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_scenario (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      scenario_key VARCHAR(16) NOT NULL COMMENT 'ma/ipo',
      name VARCHAR(64) NULL,
      discount_rate DECIMAL(20,8) NULL,
      exit_pe DECIMAL(20,6) NULL,
      exit_ps DECIMAL(20,6) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vs (case_id, version_id, scenario_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—并购/上市情景'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_calc_meta (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      last_job_id VARCHAR(19) NULL,
      amount_unit VARCHAR(16) NULL,
      sw_industry_l3 VARCHAR(128) NULL,
      wacc_rate DECIMAL(20,8) NULL,
      wacc_used_breakdown TINYINT(1) NULL,
      wacc_ke DECIMAL(20,8) NULL,
      wacc_we DECIMAL(20,8) NULL,
      wacc_wd DECIMAL(20,8) NULL,
      net_debt DECIMAL(24,4) NULL COMMENT '元',
      net_debt_source VARCHAR(32) NULL,
      industry_unavailable TINYINT(1) NOT NULL DEFAULT 0,
      industry_message VARCHAR(500) NULL,
      relative_formula VARCHAR(1000) NULL,
      dcf_formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vcm (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—计算元数据'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_warning (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      line_no INT NOT NULL,
      message VARCHAR(1000) NOT NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vw (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—告警'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_relative_row (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      stock_code VARCHAR(32) NULL,
      stock_name VARCHAR(200) NULL,
      in_pool TINYINT(1) NOT NULL DEFAULT 1,
      pe_latest DECIMAL(20,6) NULL,
      pe_median DECIMAL(20,6) NULL,
      pe_median_override DECIMAL(20,6) NULL COMMENT '底稿 PE 中位',
      pe_stdev DECIMAL(20,6) NULL,
      pe_minus_1s DECIMAL(20,6) NULL,
      pe_plus_1s DECIMAL(20,6) NULL,
      pe_usable TINYINT(1) NULL,
      ps_latest DECIMAL(20,6) NULL,
      ps_median DECIMAL(20,6) NULL,
      ps_median_override DECIMAL(20,6) NULL COMMENT '底稿 PS 中位',
      ps_stdev DECIMAL(20,6) NULL,
      ps_minus_1s DECIMAL(20,6) NULL,
      ps_plus_1s DECIMAL(20,6) NULL,
      ps_usable TINYINT(1) NULL,
      asof_date DATE NULL COMMENT '市场法锚定日',
      asof_trade_date DATE NULL COMMENT '该公司实际截面交易日',
      quality_warning VARCHAR(500) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vrr (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—相对估值一行一家'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_ratio_summary (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      selling_median DECIMAL(20,8) NULL,
      admin_median DECIMAL(20,8) NULL,
      rd_median DECIMAL(20,8) NULL,
      gm_set_median DECIMAL(20,8) NULL,
      dso_median DECIMAL(20,6) NULL,
      dpo_median DECIMAL(20,6) NULL,
      dio_median DECIMAL(20,6) NULL,
      fees_formula VARCHAR(1000) NULL,
      gm_formula VARCHAR(1000) NULL,
      wc_formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vrs (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—三费/毛利/营运汇总'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_gross_margin_row (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      stock_code VARCHAR(32) NULL,
      stock_name VARCHAR(200) NULL,
      latest_gm DECIMAL(20,8) NULL,
      median_gm DECIMAL(20,8) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vgmr (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—可比毛利率'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_gross_margin_period (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      row_id VARCHAR(19) NOT NULL,
      seq_no INT NOT NULL,
      fiscal_year VARCHAR(16) NULL COMMENT '会计年度',
      gross_margin DECIMAL(20,8) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vgmp (row_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—可比各期毛利率'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_market_result (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      base_year VARCHAR(16) NULL,
      revenue_base DECIMAL(24,4) NULL COMMENT '元',
      operating_profit_base DECIMAL(24,4) NULL COMMENT '元',
      liquidity_discount DECIMAL(20,8) NULL,
      pe_min DECIMAL(20,6) NULL,
      pe_median DECIMAL(20,6) NULL,
      pe_max DECIMAL(20,6) NULL,
      ps_min DECIMAL(20,6) NULL,
      ps_median DECIMAL(20,6) NULL,
      ps_max DECIMAL(20,6) NULL,
      pe_low_circ DECIMAL(24,4) NULL,
      pe_low_illiq DECIMAL(24,4) NULL,
      pe_mid_circ DECIMAL(24,4) NULL,
      pe_mid_illiq DECIMAL(24,4) NULL,
      pe_high_circ DECIMAL(24,4) NULL,
      pe_high_illiq DECIMAL(24,4) NULL,
      ps_low_circ DECIMAL(24,4) NULL,
      ps_low_illiq DECIMAL(24,4) NULL,
      ps_mid_circ DECIMAL(24,4) NULL,
      ps_mid_illiq DECIMAL(24,4) NULL,
      ps_high_circ DECIMAL(24,4) NULL,
      ps_high_illiq DECIMAL(24,4) NULL,
      formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vmr (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—市场法结果'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_comparison (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      market_ps_low DECIMAL(24,4) NULL COMMENT '元',
      market_ps_high DECIMAL(24,4) NULL,
      market_pe_low DECIMAL(24,4) NULL,
      market_pe_high DECIMAL(24,4) NULL,
      scenario_dual TINYINT(1) NOT NULL DEFAULT 0,
      dcf_low DECIMAL(24,4) NULL COMMENT '单情景或并购低端，元',
      dcf_high DECIMAL(24,4) NULL,
      dcf_ipo_low DECIMAL(24,4) NULL,
      dcf_ipo_high DECIMAL(24,4) NULL,
      dcf_ma_name VARCHAR(64) NULL,
      dcf_ipo_name VARCHAR(64) NULL,
      formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vcmp (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—结果对比'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_dcf_run (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      role_key VARCHAR(16) NOT NULL COMMENT 'primary/secondary',
      scenario_name VARCHAR(64) NULL,
      discount_rate DECIMAL(20,8) NULL,
      equity_value DECIMAL(24,4) NULL COMMENT '元',
      enterprise_value DECIMAL(24,4) NULL,
      net_debt DECIMAL(24,4) NULL,
      terminal_value DECIMAL(24,4) NULL,
      terminal_pv DECIMAL(24,4) NULL,
      terminal_base DECIMAL(24,4) NULL,
      exit_multiple DECIMAL(20,6) NULL,
      fcf_method VARCHAR(32) NULL,
      terminal_type VARCHAR(32) NULL,
      sens_row_kind VARCHAR(16) NULL,
      sens_col_kind VARCHAR(16) NULL,
      sens_low DECIMAL(24,4) NULL,
      sens_high DECIMAL(24,4) NULL,
      formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vdr (case_id, version_id, role_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—DCF 情景'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_dcf_year (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      run_id VARCHAR(19) NOT NULL,
      line_no INT NOT NULL,
      fiscal_year VARCHAR(16) NULL,
      fcf DECIMAL(24,4) NULL COMMENT '元',
      factor DECIMAL(20,10) NULL,
      pv DECIMAL(24,4) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vdy (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—DCF 分年现金流'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_dcf_sens_cell (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      run_id VARCHAR(19) NOT NULL,
      row_idx INT NOT NULL,
      col_idx INT NOT NULL,
      row_value DECIMAL(20,8) NULL,
      col_value DECIMAL(20,8) NULL,
      equity_value DECIMAL(24,4) NULL COMMENT '元',
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vdsc (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—DCF 敏感性格子'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_forecast_pl_line (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      line_no INT NOT NULL,
      fiscal_year VARCHAR(16) NULL,
      revenue DECIMAL(24,4) NULL,
      cogs DECIMAL(24,4) NULL,
      gross_profit DECIMAL(24,4) NULL,
      selling DECIMAL(24,4) NULL,
      admin DECIMAL(24,4) NULL,
      rd DECIMAL(24,4) NULL,
      operating_profit DECIMAL(24,4) NULL,
      net_income DECIMAL(24,4) NULL,
      revenue_growth DECIMAL(20,8) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vfpl (case_id, version_id, line_no)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—外推利润表快照'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_industry_result (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      version_id VARCHAR(19) NOT NULL DEFAULT '0',
      unavailable TINYINT(1) NOT NULL DEFAULT 0,
      message VARCHAR(500) NULL,
      sw_industry_l3 VARCHAR(128) NULL,
      trade_date DATE NULL,
      stat_method VARCHAR(16) NULL,
      pe_median DECIMAL(20,6) NULL,
      ps_median DECIMAL(20,6) NULL,
      pe_min DECIMAL(20,6) NULL,
      pe_max DECIMAL(20,6) NULL,
      ps_min DECIMAL(20,6) NULL,
      ps_max DECIMAL(20,6) NULL,
      formula VARCHAR(1000) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      F_LastModifyTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_vir (case_id, version_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—行业倍数快照'
  `);

  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS valuation_change_log (
      F_Id VARCHAR(19) NOT NULL PRIMARY KEY,
      case_id VARCHAR(19) NOT NULL,
      field_key VARCHAR(64) NOT NULL COMMENT '字段键',
      field_label VARCHAR(128) NOT NULL COMMENT '字段中文名',
      old_value VARCHAR(500) NULL,
      new_value VARCHAR(500) NULL,
      source VARCHAR(32) NULL COMMENT 'draft/compute/method/version/restore/case',
      F_CreatorUserId VARCHAR(19) NULL,
      F_CreatorTime TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vcl_case (case_id, F_CreatorTime),
      KEY idx_vcl_field (case_id, field_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='项目估值—关键假设与方法变更留痕'
  `);
}

module.exports = { ensureValuationSchema };
