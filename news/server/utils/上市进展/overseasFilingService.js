const db = require('../../db');
const { createShanghaiDate, formatDateOnly } = require('./listingBeijingDate');
const { runOverseasFilingDiscoverSync } = require('./overseasFilingDiscoverSync');
const { runOverseasFilingSync } = require('./overseasFilingSync');
const { runOverseasFilingNoticeSync } = require('./overseasFilingNoticeSync');

const OVERSEAS_BOARD = '境外发行备案';
/** 证监会政府信息公开 · 境外证券发行（含 channelid，与需求文档列表入口一致） */
const DEFAULT_CSRC_PORTAL_URL =
  'http://www.csrc.gov.cn/csrc/c101935/zfxxgk_zdgk.shtml?channelid=8f3f0d4be56b4f8aa8183b3234b88ede';

/** 企业名称匹配：规范化后全等（与需求 2026-04-20 一致） */
function normalizeOverseasNameKey(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

/** `register_address` 是否像公文文号（国合函〔…〕号） */
function looksLikeCsrcDocNumber(registerAddress) {
  const ra = String(registerAddress || '').trim();
  if (!ra) return false;
  if (/国合函/.test(ra)) return true;
  return /〔\s*\d{4}\s*〕/.test(ra) && /号\s*$/.test(ra);
}

/**
 * 与 Excel 先入行合并：同日、同企业（规范化全等），且 register_address 尚非文号。
 */
async function findOverseasExcelMergeTarget(projectName, receiveYmd) {
  const key = normalizeOverseasNameKey(projectName);
  if (!key) return null;
  const rows = await db.query(
    `SELECT f_id, project_name, register_address, status, company, exchange
     FROM ipo_progress
     WHERE F_DeleteMark = 0 AND board = ? AND receive_date = ?
     ORDER BY f_id ASC`,
    [OVERSEAS_BOARD, receiveYmd]
  );
  for (const r of rows) {
    if (normalizeOverseasNameKey(r.project_name) !== key) continue;
    if (!looksLikeCsrcDocNumber(r.register_address)) return r;
  }
  return null;
}

function assertManualOverseasDateRange(from, to, triggerType) {
  if (triggerType !== 'manual' || !from || !to) return;
  const a = String(from).slice(0, 10);
  const b = String(to).slice(0, 10);
  const d0 = new Date(`${a}T12:00:00+08:00`);
  const d1 = new Date(`${b}T12:00:00+08:00`);
  if (Number.isNaN(d0.getTime()) || Number.isNaN(d1.getTime())) return;
  const inclusiveDays = Math.floor((d1.getTime() - d0.getTime()) / 86400000) + 1;
  if (inclusiveDays > 30) {
    throw new Error('手动同步时间区间不得超过 30 天（含起止日期）');
  }
}

/**
 * 备案通知书行写入 ipo_progress：优先合并 Excel 行；否则按文号 upsert。
 */
async function upsertNoticeFilingRow(row, adminId, writeDate) {
  if (row && row.error && !row.company_name) return 'skipped';
  const projectName = String(row.company_name || '').trim();
  const receiveYmd = String(row.receive_date || '').slice(0, 10);
  const docNo = String(row.filing_type || '').trim().slice(0, 200);
  if (!receiveYmd || !docNo) return 'skipped';
  if (!projectName) return 'skipped';

  const company = overseasCompanyFromRow(row.filing_entity, projectName);
  const status = '备案完成';
  const exchange = String(row.target_exchange || '').trim().slice(0, 100);
  const fUpdateTime = `${receiveYmd} 00:00:00`;
  const writeYmd = String(writeDate || '').slice(0, 10) || receiveYmd;

  const merge = await findOverseasExcelMergeTarget(projectName, receiveYmd);
  if (merge) {
    await db.execute(
      `UPDATE ipo_progress SET
        f_update_time = ?, status = ?, company = ?, exchange = ?, project_name = ?,
        register_address = ?, F_LastModifyUserId = ?, F_LastModifyTime = NOW()
       WHERE f_id = ? AND F_DeleteMark = 0`,
      [fUpdateTime, status, company, exchange, projectName, docNo, adminId, merge.f_id]
    );
    return 'updated';
  }

  const byDoc = await db.query(
    `SELECT f_id, project_name, status, company, exchange, receive_date
     FROM ipo_progress
     WHERE F_DeleteMark = 0 AND board = ? AND register_address = ?`,
    [OVERSEAS_BOARD, docNo]
  );
  if (byDoc.length) {
    const old = byDoc[0];
    const changed =
      String(old.status || '') !== status ||
      String(old.company || '') !== company ||
      String(old.exchange || '') !== exchange ||
      String(old.project_name || '') !== projectName ||
      String(old.receive_date || '').slice(0, 10) !== receiveYmd;
    if (!changed) return 'skipped';
    await db.execute(
      `UPDATE ipo_progress SET
        f_update_time = ?, status = ?, company = ?, exchange = ?, project_name = ?, receive_date = ?,
        F_LastModifyUserId = ?, F_LastModifyTime = NOW()
       WHERE f_id = ? AND F_DeleteMark = 0`,
      [fUpdateTime, status, company, exchange, projectName, receiveYmd, adminId, old.f_id]
    );
    return 'updated';
  }

  await db.execute(
    `INSERT INTO ipo_progress (
      f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
      company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
    [
      writeYmd,
      fUpdateTime,
      '',
      projectName,
      status,
      docNo,
      receiveYmd,
      company,
      OVERSEAS_BOARD,
      exchange,
      adminId,
      adminId,
    ]
  );
  return 'inserted';
}

/**
 * 申报主体（Excel）为空或为 /、— 等占位时，公司全称用企业名称（project_name）。
 */
function overseasCompanyFromRow(filingEntity, projectName) {
  const pn = String(projectName || '').trim();
  if (!pn) return '';
  const raw = String(filingEntity ?? '')
    .trim()
    .replace(/\u00a0/g, ' ');
  if (!raw) return pn;
  const compact = raw.replace(/\s/g, '');
  if (!compact) return pn;
  if (/^[/\\\-—－／\\.。、・]+$/.test(compact)) return pn;
  const low = raw.toLowerCase();
  if (['无', '暂无', 'na', 'n/a', 'none', 'null'].includes(low)) return pn;
  return raw;
}

async function resolveAdminId() {
  const rows = await db.query(`SELECT id FROM users WHERE account = 'admin' LIMIT 1`);
  if (!rows.length) throw new Error('未找到 account=admin 用户，无法写入境外备案数据');
  return rows[0].id;
}

async function resolveOverseasSourceUrl() {
  const rows = await db.query(
    `SELECT request_url
     FROM listing_data_config
     WHERE is_active = 1
       AND news_interface_type = 'overseas_filing'
       AND request_url IS NOT NULL
       AND TRIM(request_url) <> ''
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );
  return rows[0]?.request_url ? String(rows[0].request_url).trim() : '';
}

/**
 * 境外备案行写入 ipo_progress（与《上市进展需求》字段映射一致）。
 * 判重键：board + project_name(企业名称) + receive_date + register_address(申报类型)
 */
async function upsertOverseasToIpoProgress(row, adminId, writeDate) {
  const projectName = String(row.company_name || '').trim();
  const company = overseasCompanyFromRow(row.filing_entity, projectName);
  if (!projectName || !row.receive_date) return 'skipped';

  const receiveYmd = String(row.receive_date).slice(0, 10);
  const fUpdateTime = `${receiveYmd} 00:00:00`;
  const registerAddress = String(row.filing_type || '').trim().slice(0, 200);
  const status = String(row.filing_status || '').trim().slice(0, 50) || '-';
  const exchange = String(row.target_exchange || '').trim().slice(0, 100);
  const writeYmd = String(writeDate || '').slice(0, 10) || receiveYmd;

  const exists = await db.query(
    `SELECT f_id, status, company, exchange, project_name
     FROM ipo_progress
     WHERE F_DeleteMark = 0 AND board = ?
       AND project_name = ? AND receive_date = ? AND register_address = ?`,
    [OVERSEAS_BOARD, projectName, receiveYmd, registerAddress]
  );

  if (!exists.length) {
    await db.execute(
      `INSERT INTO ipo_progress (
        f_create_date, f_update_time, code, project_name, status, register_address, receive_date,
        company, board, exchange, F_CreatorUserId, F_LastModifyUserId, F_LastModifyTime, F_DeleteMark
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
      [
        writeYmd,
        fUpdateTime,
        '',
        projectName,
        status,
        registerAddress,
        receiveYmd,
        company,
        OVERSEAS_BOARD,
        exchange,
        adminId,
        adminId,
      ]
    );
    return 'inserted';
  }

  const old = exists[0];
  const changed =
    String(old.status || '') !== status ||
    String(old.company || '') !== company ||
    String(old.exchange || '') !== exchange ||
    String(old.project_name || '') !== projectName;
  if (!changed) return 'skipped';

  await db.execute(
    `UPDATE ipo_progress SET
      f_update_time = ?, status = ?, company = ?, exchange = ?, project_name = ?,
      F_LastModifyUserId = ?, F_LastModifyTime = NOW()
     WHERE f_id = ? AND F_DeleteMark = 0`,
    [fUpdateTime, status, company, exchange, projectName, adminId, old.f_id]
  );
  return 'updated';
}

async function syncOverseasFiling(options = {}) {
  const now = createShanghaiDate();
  const from = options.from || formatDateOnly(now);
  const to = options.to || formatDateOnly(now);
  const triggerType = options.triggerType || 'manual';
  const logTag = options.logTag || '[境外备案审核同步]';
  const source = options.source || 'url';
  const explicitUrl = String(options.sourceUrl || '').trim();
  const explicitFile = String(options.sourceFile || '').trim();
  const useCsrcDiscover = options.useCsrcDiscover !== false;

  assertManualOverseasDateRange(from, to, triggerType);

  console.log(`${logTag} 执行开始 from=${from} to=${to} trigger=${triggerType}`);
  let sourceUrl = explicitUrl || (source === 'url' ? await resolveOverseasSourceUrl() : '');
  let csrcDiscover = null;
  if (
    triggerType === 'manual' &&
    source === 'url' &&
    !explicitFile &&
    !sourceUrl &&
    useCsrcDiscover
  ) {
    const disc = runOverseasFilingDiscoverSync({ logTag });
    if (!disc.ok) {
      // getSearch 偶发 5xx/502 时，直接回退到政府信息公开门户地址，
      // 由 overseas_filing_fetch.py 继续执行 discover/playwright 兜底，避免整次任务提前失败。
      sourceUrl = process.env.CSRC_ZFXXGK_PAGE_URL || DEFAULT_CSRC_PORTAL_URL;
      console.warn(
        `${logTag} 自动解析 Excel 失败，回退门户抓取 sourceUrl=${sourceUrl} err=${
          disc.stderr || 'unknown'
        }`
      );
    } else {
      sourceUrl = disc.excelUrl;
      csrcDiscover = {
        detailUrl: disc.detailUrl,
        tableTitle: disc.title,
        excelUrl: disc.excelUrl,
      };
      console.log(`${logTag} 已自动解析 Excel`, csrcDiscover);
    }
  }
  if (source === 'url' && !explicitFile && !sourceUrl) {
    sourceUrl = (process.env.CSRC_ZFXXGK_PAGE_URL || '').trim() || DEFAULT_CSRC_PORTAL_URL;
    console.log(`${logTag} request_url 未配置，使用默认证监会信息公开入口`);
  }
  const fetched = runOverseasFilingSync({
    startDate: from,
    endDate: to,
    source,
    sourceUrl,
    sourceFile: explicitFile,
    logTag,
    detailPageUrl: csrcDiscover?.detailUrl || '',
  });
  if (!fetched.ok) {
    throw new Error(fetched.stderr || '境外备案抓取失败');
  }
  const rows = fetched.rows || [];
  const adminId = await resolveAdminId();
  const writeDate = formatDateOnly(createShanghaiDate());
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const state = await upsertOverseasToIpoProgress(row, adminId, writeDate);
    if (state === 'inserted') inserted += 1;
    else if (state === 'updated') updated += 1;
    else skipped += 1;
  }

  let noticeFetched = 0;
  let noticeInserted = 0;
  let noticeUpdated = 0;
  let noticeSkipped = 0;
  const noticeDisabled = String(process.env.OVERSEAS_FILING_NOTICE_DISABLE || '').trim() === '1';
  const noticeListUrl = String(process.env.OVERSEAS_FILING_NOTICE_LIST_URL || '').trim();

  if (source !== 'file' && !noticeDisabled) {
    const noticeLog = `${logTag}[备案通知书HTML]`;
    console.log(`${noticeLog} 开始 from=${from} to=${to}`);
    const noticeRun = runOverseasFilingNoticeSync({
      startDate: from,
      endDate: to,
      listUrl: noticeListUrl,
      logTag: noticeLog,
    });
    if (!noticeRun.ok) {
      throw new Error(noticeRun.stderr || '境外备案通知书 HTML 抓取失败');
    }
    const nrows = noticeRun.rows || [];
    noticeFetched = nrows.length;
    for (const nrow of nrows) {
      const st = await upsertNoticeFilingRow(nrow, adminId, writeDate);
      if (st === 'inserted') noticeInserted += 1;
      else if (st === 'updated') noticeUpdated += 1;
      else noticeSkipped += 1;
    }
    console.log(`${noticeLog} 完成 fetched=${noticeFetched} inserted=${noticeInserted} updated=${noticeUpdated} skipped=${noticeSkipped}`);
  }

  const result = {
    from,
    to,
    triggerType,
    fetched: rows.length,
    inserted,
    updated,
    skipped,
    sourceRows: Number((fetched.summary && fetched.summary.sourceRows) || 0),
    source: String((fetched.summary && fetched.summary.source) || source),
    noticeFetched,
    noticeInserted,
    noticeUpdated,
    noticeSkipped,
    noticeSkippedReason: noticeDisabled ? 'OVERSEAS_FILING_NOTICE_DISABLE=1' : source === 'file' ? 'source=file' : null,
    message: '境外备案审核同步完成（已写入 ipo_progress，board=境外发行备案）',
    executedAt: new Date().toISOString(),
    ...(csrcDiscover ? { csrcDiscover, usedCsrcAutoDiscover: true } : {}),
  };
  console.log(`${logTag} 执行完成`, result);
  return result;
}

module.exports = {
  syncOverseasFiling,
  assertManualOverseasDateRange,
  DEFAULT_CSRC_PORTAL_URL,
};
