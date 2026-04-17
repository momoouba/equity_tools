const db = require('../../db');
const { createShanghaiDate, formatDateOnly } = require('./listingBeijingDate');
const { runOverseasFilingDiscoverSync } = require('./overseasFilingDiscoverSync');
const { runOverseasFilingSync } = require('./overseasFilingSync');

const OVERSEAS_BOARD = '境外发行备案';

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
      throw new Error(
        disc.stderr ||
          '自动发现证监会备案表失败：请在「上市数据配置」填写 request_url，或检查网络后重试'
      );
    }
    sourceUrl = disc.excelUrl;
    csrcDiscover = {
      detailUrl: disc.detailUrl,
      tableTitle: disc.title,
      excelUrl: disc.excelUrl,
    };
    console.log(`${logTag} 已自动解析 Excel`, csrcDiscover);
  }
  const fetched = runOverseasFilingSync({
    startDate: from,
    endDate: to,
    source,
    sourceUrl,
    sourceFile: explicitFile,
    logTag,
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
    message: '境外备案审核同步完成（已写入 ipo_progress，board=境外发行备案）',
    executedAt: new Date().toISOString(),
    ...(csrcDiscover ? { csrcDiscover, usedCsrcAutoDiscover: true } : {}),
  };
  console.log(`${logTag} 执行完成`, result);
  return result;
}

module.exports = {
  syncOverseasFiling,
};
