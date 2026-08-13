/**
 * P4：wewe 专队工作日入库 → news_detail + 异步 AI
 *
 * weweBizDates = union(resolveSyncBizDates(...), { previousWorkdayYmd })
 * 与新榜账本差异：额外含「上个工作日当天」（节后例 1～6）。
 */
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { IE_NEWS_APP_FILTER_SQL } = require('../investedEnterpriseNewsAppSql');
const {
  formatBeijingYmd,
  addDaysYmd,
  isWorkdayYmd,
  findPreviousWorkdayYmd,
  resolveSyncBizDates
} = require('../newsFetchDayLog');
const { getWewePrivateConfig } = require('./wewePrivateTeam');

const APITYPE_WEWE = '私有公众号';

async function isIngestEnabled() {
  const cfg = await getWewePrivateConfig();
  return Boolean(cfg && Number(cfg.wewe_enabled) === 1 && Number(cfg.ingest_enabled) === 1);
}

/**
 * wewe 入库业务日集合（北京日历）
 * @returns {Promise<string[]>}
 */
async function resolveWeweIngestBizDates(runDate = new Date()) {
  const todayYmd = formatBeijingYmd(runDate);
  const yesterdayYmd = addDaysYmd(todayYmd, -1);
  const base = await resolveSyncBizDates({ runDate });
  const prevWd = await findPreviousWorkdayYmd(todayYmd);
  const set = new Set(base);
  if (prevWd && prevWd <= yesterdayYmd) {
    set.add(prevWd);
  }
  return [...set].filter((d) => d <= yesterdayYmd).sort();
}

async function loadAdditionalAccountIds() {
  try {
    const rows = await db.query(
      `SELECT wechat_account_id FROM additional_wechat_accounts
       WHERE F_DeleteMark = 0 AND status = 'active'
         AND wechat_account_id IS NOT NULL AND wechat_account_id != ''`
    );
    return new Set(rows.map((r) => String(r.wechat_account_id).trim()).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

async function resolveAccountName(wechatAccountId) {
  const gh = String(wechatAccountId || '').trim();
  if (!gh) return '';
  try {
    const ad = await db.query(
      `SELECT account_name FROM additional_wechat_accounts
       WHERE F_DeleteMark = 0 AND wechat_account_id = ? LIMIT 1`,
      [gh]
    );
    if (ad[0] && ad[0].account_name) return String(ad[0].account_name);
  } catch (_) {
    /* ignore */
  }
  try {
    const ie = await db.query(
      `SELECT project_abbreviation, enterprise_full_name
       FROM invested_enterprises
       WHERE ${IE_NEWS_APP_FILTER_SQL} AND F_DeleteMark = 0
         AND (wechat_official_account_id = ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?
           OR wechat_official_account_id LIKE ?)
       LIMIT 1`,
      [gh, `${gh},%`, `%,${gh},%`, `%,${gh}`]
    );
    if (ie[0]) {
      return String(ie[0].project_abbreviation || ie[0].enterprise_full_name || gh);
    }
  } catch (_) {
    /* ignore */
  }
  return gh;
}

async function resolveEnterpriseMeta(wechatAccountId) {
  const gh = String(wechatAccountId || '').trim();
  let enterpriseFullName = null;
  let entityType = null;
  let enterpriseAbbreviation = null;
  let fund = null;
  let sub_fund = null;

  try {
    const enterpriseResult = await db.query(
      `SELECT enterprise_full_name, entity_type, project_abbreviation, fund, sub_fund
       FROM invested_enterprises
       WHERE ${IE_NEWS_APP_FILTER_SQL} AND (
         wechat_official_account_id = ?
         OR wechat_official_account_id LIKE ?
         OR wechat_official_account_id LIKE ?
         OR wechat_official_account_id LIKE ?
       )
       AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND F_DeleteMark = 0
       LIMIT 1`,
      [gh, `${gh},%`, `%,${gh},%`, `%,${gh}`]
    );
    if (enterpriseResult.length > 0) {
      enterpriseFullName = enterpriseResult[0].enterprise_full_name;
      entityType = enterpriseResult[0].entity_type || null;
      enterpriseAbbreviation = enterpriseResult[0].project_abbreviation || null;
      fund = enterpriseResult[0].fund || null;
      sub_fund = enterpriseResult[0].sub_fund || null;
    }
  } catch (e) {
    console.warn(`[wewe入库] 匹配企业失败 account=${gh}: ${e.message}`);
  }

  return { enterpriseFullName, entityType, enterpriseAbbreviation, fund, sub_fund };
}

function formatPublicTimeForDb(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 19).replace('T', ' ');
  }
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str);
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function findExistingBySourceUrl(sourceUrl) {
  if (!sourceUrl) return null;
  const rows = await db.query(
    `SELECT F_Id, F_DeleteMark, APItype FROM news_detail WHERE source_url = ? LIMIT 1`,
    [sourceUrl]
  );
  return rows[0] || null;
}

function triggerAsyncAi(newsItem, isAdditionalAccount) {
  setImmediate(async () => {
    try {
      const newsAnalysis = require('../newsAnalysis');
      await newsAnalysis.analyzeXinbangNewsImmediately(newsItem, isAdditionalAccount);
      console.log(`[wewe入库] ✓ 异步 AI 完成 newsId=${newsItem.F_Id}`);
    } catch (e) {
      console.error(`[wewe入库] ✗ 异步 AI 失败 newsId=${newsItem.F_Id}: ${e.message}`);
    }
  });
}

async function markStage(stageId, status, { newsId = null, error = null } = {}) {
  await db.execute(
    `UPDATE wewe_private_article_stage
     SET ingest_status = ?,
         ingested_news_id = COALESCE(?, ingested_news_id),
         ingest_error = ?,
         F_LastModifyTime = CURRENT_TIMESTAMP
     WHERE F_Id = ?`,
    [status, newsId, error ? String(error).slice(0, 500) : null, stageId]
  );
}

/**
 * 入库单条暂存
 * @returns {Promise<{action:string, newsId?:string, reason?:string}>}
 */
async function ingestOneStage(stageRow, options = {}) {
  const ingestYmd = options.ingestYmd || formatBeijingYmd();
  const additionalIds = options.additionalIds || (await loadAdditionalAccountIds());
  const gh = stageRow.wechat_account_id;
  const sourceUrl = String(stageRow.source_url || '').trim();
  const title = String(stageRow.title || '').trim();

  if (!title) {
    await markStage(stageRow.F_Id, 'skipped', { error: 'empty_title' });
    return { action: 'skipped', reason: 'empty_title' };
  }
  if (!sourceUrl) {
    await markStage(stageRow.F_Id, 'skipped', { error: 'empty_source_url' });
    return { action: 'skipped', reason: 'empty_source_url' };
  }

  const existing = await findExistingBySourceUrl(sourceUrl);
  if (existing) {
    await markStage(stageRow.F_Id, 'skipped', {
      newsId: existing.F_Id,
      error: `dup_source_url apitype=${existing.APItype || ''}`
    });
    console.log(
      `[wewe入库] 跳过 source_url 去重 stage=${stageRow.F_Id} existing=${existing.F_Id}`
    );
    return { action: 'skipped', reason: 'dup_source_url', newsId: existing.F_Id };
  }

  let content = stageRow.content || '';
  if (!String(content).trim()) {
    console.warn(
      `[wewe入库] 正文为空，入库后由异步 AI/Python 补抽 stage=${stageRow.F_Id} url=${sourceUrl}`
    );
  }

  const accountName = await resolveAccountName(gh);
  const meta = await resolveEnterpriseMeta(gh);
  const isAdditional = additionalIds.has(gh);
  const publicTime = formatPublicTimeForDb(stageRow.public_time);
  // F_CreatorTime = 该工作日（探测 force 时用 ingestYmd）
  const creatorTime = `${ingestYmd} ${new Date()
    .toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' })
    .slice(11, 19)}`;

  try {
    const newsId = await generateId('news_detail');
    await db.execute(
      `INSERT INTO news_detail
       (F_Id, account_name, wechat_account, enterprise_full_name, enterprise_abbreviation, entity_type,
        source_url, title, summary, public_time, content, keywords, news_abstract, news_sentiment,
        APItype, fund, sub_fund, F_CreatorTime)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newsId,
        accountName,
        gh,
        meta.enterpriseFullName,
        meta.enterpriseAbbreviation,
        meta.entityType,
        sourceUrl,
        title,
        '',
        publicTime,
        content || '',
        null,
        null,
        'neutral',
        APITYPE_WEWE,
        meta.fund,
        meta.sub_fund,
        creatorTime
      ]
    );

    await markStage(stageRow.F_Id, 'ingested', { newsId });
    triggerAsyncAi(
      {
        id: newsId,
        F_Id: newsId,
        title,
        content: content || '',
        source_url: sourceUrl,
        wechat_account: gh,
        enterprise_full_name: meta.enterpriseFullName
      },
      isAdditional
    );

    console.log(
      `[wewe入库] ✓ 已写入 news_detail id=${newsId} gh=${gh} extract_ymd=${stageRow.extract_ymd}`
    );
    return { action: 'ingested', newsId };
  } catch (e) {
    await markStage(stageRow.F_Id, 'failed', { error: e.message });
    console.warn(`[wewe入库] 失败 stage=${stageRow.F_Id}: ${e.message}`);
    return { action: 'failed', reason: e.message };
  }
}

/**
 * 工作日入库主入口
 * @param {{ force?: boolean, runDate?: Date|string, bizDates?: string[] }} options
 */
async function runIngestTick(options = {}) {
  const force = options.force === true;
  const runDate =
    options.runDate instanceof Date
      ? options.runDate
      : options.runDate
        ? new Date(String(options.runDate))
        : new Date();

  if (!(await isIngestEnabled()) && !force) {
    return { action: 'skip_disabled' };
  }

  const ingestYmd = formatBeijingYmd(runDate);
  if (!(await isWorkdayYmd(ingestYmd)) && !force) {
    return { action: 'skip_non_workday', ingestYmd };
  }

  const bizDates =
    Array.isArray(options.bizDates) && options.bizDates.length > 0
      ? options.bizDates.map(String).sort()
      : await resolveWeweIngestBizDates(runDate);

  if (bizDates.length === 0) {
    return { action: 'idle_empty_biz_dates', ingestYmd, bizDates };
  }

  const placeholders = bizDates.map(() => '?').join(',');
  const pending = await db.query(
    `SELECT * FROM wewe_private_article_stage
     WHERE F_DeleteMark = 0
       AND ingest_status = 'pending'
       AND extract_ymd IN (${placeholders})
     ORDER BY extract_ymd ASC, F_CreatorTime ASC
     LIMIT 500`,
    bizDates
  );

  // 未跑完提取：只入库已暂存部分；统计仍 pending 之外的「已映射但无 stage」不在此强拦
  const additionalIds = await loadAdditionalAccountIds();
  const summary = {
    action: 'ingested_batch',
    ingestYmd,
    bizDates,
    pending: pending.length,
    ingested: 0,
    skipped: 0,
    failed: 0,
    items: []
  };

  for (const row of pending) {
    const r = await ingestOneStage(row, { ingestYmd, additionalIds });
    if (r.action === 'ingested') summary.ingested += 1;
    else if (r.action === 'skipped') summary.skipped += 1;
    else if (r.action === 'failed') summary.failed += 1;
    summary.items.push({
      stageId: row.F_Id,
      extractYmd: row.extract_ymd,
      title: (row.title || '').slice(0, 80),
      ...r
    });
  }

  // 仍有 active 号 extract_pending=1 时记一笔汇总（P4.7）
  try {
    const unfinished = await db.query(
      `SELECT COUNT(*) AS c FROM wewe_private_accounts
       WHERE F_DeleteMark = 0 AND team_status = 'active' AND extract_pending = 1`
    );
    const c = Number(unfinished[0]?.c || 0);
    if (c > 0) {
      summary.extractStillPendingAccounts = c;
      console.warn(`[wewe入库] 提取未跑完：仍有 ${c} 个账号 extract_pending=1，仅入库已暂存部分`);
    }
  } catch (_) {
    /* ignore */
  }

  console.log(
    `[wewe入库] 完成 ingestYmd=${ingestYmd} biz=${bizDates.join(',')} pending=${summary.pending} ok=${summary.ingested} skip=${summary.skipped} fail=${summary.failed}`
  );
  return summary;
}

async function previewIngest(runDate = new Date()) {
  const ingestYmd = formatBeijingYmd(runDate);
  const bizDates = await resolveWeweIngestBizDates(runDate);
  const workday = await isWorkdayYmd(ingestYmd);
  let pendingCounts = [];
  if (bizDates.length > 0) {
    const placeholders = bizDates.map(() => '?').join(',');
    pendingCounts = await db.query(
      `SELECT extract_ymd, COUNT(*) AS c
       FROM wewe_private_article_stage
       WHERE F_DeleteMark = 0 AND ingest_status = 'pending' AND extract_ymd IN (${placeholders})
       GROUP BY extract_ymd
       ORDER BY extract_ymd`,
      bizDates
    );
  }
  return {
    ingestYmd,
    isWorkday: workday,
    bizDates,
    pendingByDay: pendingCounts,
    enabled: await isIngestEnabled()
  };
}

module.exports = {
  APITYPE_WEWE,
  isIngestEnabled,
  resolveWeweIngestBizDates,
  runIngestTick,
  ingestOneStage,
  previewIngest,
  formatBeijingYmd
};
