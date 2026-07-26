'use strict';

/**
 * Stage 2 — 融资池 ← ipo_new_share 已上市画像同步
 */

const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');
const {
  buildNewShareIndex,
  classifyListedJoin,
  companyDedupeKey,
} = require('./listedFinancingJoin');

const LISTED_SYNC_VERSION = 'listed_sync_v1';
const PROTECTED_PROFILE_SOURCES = ['bp', 'llm_web', 'baike'];
const BULK_MARK_CHUNK = 80;
const MATCH_BATCH_SIZE = 80;
const PROFILE_GUARD = `LOWER(TRIM(COALESCE(s.profile_source, ''))) IN ('bp', 'llm_web', 'baike')`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function executeWithDeadlockRetry(db, sql, params, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await db.execute(sql, params);
    } catch (err) {
      if (err && err.code === 'ER_LOCK_DEADLOCK' && attempt < retries) {
        await sleep(Math.min(3000, 200 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return null;
}

function parseTagsJson(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

/**
 * @param {object} nsRow ipo_new_share 行
 */
function buildListedSyncPatch(nsRow) {
  const tagsJson = parseTagsJson(nsRow.industry_tags_json);
  return {
    listing_status: 'matched',
    listed_stock_code: strTrim(nsRow.stock_code) || null,
    listed_exchange: strTrim(nsRow.exchange) || null,
    new_share_row_id: nsRow.F_Id,
    profile_source: 'listed_sync',
    company_intro: strTrim(nsRow.company_intro) || null,
    ai_product_intro: strTrim(nsRow.product_intro) || null,
    ai_company_tags_display: strTrim(nsRow.industry_tags_display) || null,
    ai_company_tags_json: tagsJson,
    industry_category_4: strTrim(nsRow.industry_category_4) || null,
    ai_enrich_status: 'skipped',
    ai_enrich_version: LISTED_SYNC_VERSION,
  };
}

function buildBatchUpdateSet(force) {
  if (force) {
    return `
      s.listing_status = t.listing_status,
      s.listed_stock_code = t.listed_stock_code,
      s.listed_exchange = t.listed_exchange,
      s.new_share_row_id = t.new_share_row_id,
      s.profile_source = t.profile_source,
      s.company_intro = t.company_intro,
      s.ai_product_intro = t.ai_product_intro,
      s.ai_company_tags_display = t.ai_company_tags_display,
      s.ai_company_tags_json = t.ai_company_tags_json,
      s.industry_category_4 = t.industry_category_4,
      s.ai_enrich_status = t.ai_enrich_status,
      s.ai_enrich_version = t.ai_enrich_version`;
  }
  return `
      s.listing_status = t.listing_status,
      s.listed_stock_code = t.listed_stock_code,
      s.listed_exchange = t.listed_exchange,
      s.new_share_row_id = t.new_share_row_id,
      s.profile_source = CASE WHEN ${PROFILE_GUARD} THEN s.profile_source ELSE t.profile_source END,
      s.company_intro = CASE WHEN ${PROFILE_GUARD} THEN s.company_intro ELSE t.company_intro END,
      s.ai_product_intro = CASE WHEN ${PROFILE_GUARD} THEN s.ai_product_intro ELSE t.ai_product_intro END,
      s.ai_company_tags_display = CASE WHEN ${PROFILE_GUARD} THEN s.ai_company_tags_display ELSE t.ai_company_tags_display END,
      s.ai_company_tags_json = CASE WHEN ${PROFILE_GUARD} THEN s.ai_company_tags_json ELSE t.ai_company_tags_json END,
      s.industry_category_4 = CASE WHEN ${PROFILE_GUARD} THEN s.industry_category_4 ELSE t.industry_category_4 END,
      s.ai_enrich_status = CASE WHEN ${PROFILE_GUARD} THEN s.ai_enrich_status ELSE t.ai_enrich_status END,
      s.ai_enrich_version = CASE WHEN ${PROFILE_GUARD} THEN s.ai_enrich_version ELSE t.ai_enrich_version END`;
}

async function ensureTempSyncTable(db) {
  await db.execute(`
    CREATE TEMPORARY TABLE tmp_listed_financing_sync (
      match_type VARCHAR(8) NOT NULL,
      match_key VARCHAR(96) NOT NULL,
      listing_status VARCHAR(20) NOT NULL,
      listed_stock_code VARCHAR(32) NULL,
      listed_exchange VARCHAR(32) NULL,
      new_share_row_id BIGINT NOT NULL,
      profile_source VARCHAR(32) NOT NULL,
      company_intro TEXT NULL,
      ai_product_intro TEXT NULL,
      ai_company_tags_display VARCHAR(2000) NULL,
      ai_company_tags_json TEXT NULL,
      industry_category_4 VARCHAR(32) NULL,
      ai_enrich_status VARCHAR(20) NULL,
      ai_enrich_version VARCHAR(50) NULL,
      PRIMARY KEY (match_type, match_key)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

/**
 * @param {{ match_type: 'credit'|'name', match_key: string, patch: object }[]} entries
 */
async function countBatchWouldUpdate(db, entries) {
  let total = 0;
  for (const e of entries) {
    if (e.match_type === 'credit') {
      const rows = await db.query(
        `SELECT COUNT(*) AS c FROM sourcing_financing_event
         WHERE F_DeleteMark = 0 AND company_credit_code = ?`,
        [e.match_key]
      );
      total += Number(rows[0]?.c || 0);
    } else {
      const rows = await db.query(
        `SELECT COUNT(*) AS c FROM sourcing_financing_event
         WHERE F_DeleteMark = 0 AND TRIM(COALESCE(company_name, '')) = ?`,
        [e.match_key]
      );
      total += Number(rows[0]?.c || 0);
    }
  }
  return total;
}

/**
 * @param {{ match_type: 'credit'|'name', match_key: string, patch: object }[]} entries
 */
async function flushMatchedBatch(db, entries, opts = {}) {
  if (!entries.length) return 0;
  if (opts.dryRun) return countBatchWouldUpdate(db, entries);

  await db.execute('DROP TEMPORARY TABLE IF EXISTS tmp_listed_financing_sync');
  await ensureTempSyncTable(db);
  await db.execute('DELETE FROM tmp_listed_financing_sync');

  for (const e of entries) {
    const p = e.patch;
    const tagsJsonStr = p.ai_company_tags_json ? JSON.stringify(p.ai_company_tags_json) : null;
    await db.execute(
      `INSERT INTO tmp_listed_financing_sync (
        match_type, match_key, listing_status, listed_stock_code, listed_exchange, new_share_row_id,
        profile_source, company_intro, ai_product_intro, ai_company_tags_display, ai_company_tags_json,
        industry_category_4, ai_enrich_status, ai_enrich_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.match_type,
        e.match_key,
        p.listing_status,
        p.listed_stock_code,
        p.listed_exchange,
        p.new_share_row_id,
        p.profile_source,
        p.company_intro,
        p.ai_product_intro,
        p.ai_company_tags_display,
        tagsJsonStr,
        p.industry_category_4,
        p.ai_enrich_status,
        p.ai_enrich_version,
      ]
    );
  }

  const setClause = buildBatchUpdateSet(opts.force);
  const tail = `, s.listed_sync_at = CURRENT_TIMESTAMP, s.ai_enrich_error = NULL, s.F_LastModifyTime = CURRENT_TIMESTAMP`;

  const creditResult = await db.execute(
    `UPDATE sourcing_financing_event s
     INNER JOIN tmp_listed_financing_sync t
       ON t.match_type = 'credit' AND s.company_credit_code = t.match_key
     SET ${setClause}${tail}
     WHERE s.F_DeleteMark = 0`
  );
  const nameResult = await db.execute(
    `UPDATE sourcing_financing_event s
     INNER JOIN tmp_listed_financing_sync t
       ON t.match_type = 'name' AND TRIM(COALESCE(s.company_name, '')) = t.match_key
     SET ${setClause}${tail}
     WHERE s.F_DeleteMark = 0`
  );

  return (creditResult.affectedRows || 0) + (nameResult.affectedRows || 0);
}

async function bulkMarkListingStatus(db, companyRows, status, dryRun) {
  if (!companyRows.length) return 0;

  const credits = [];
  const names = [];
  for (const row of companyRows) {
    const credit = normalizeCreditCode(row.company_credit_code);
    if (credit) credits.push(credit);
    else {
      const name = strTrim(row.company_name);
      if (name) names.push(name);
    }
  }

  let marked = 0;

  const markChunk = async (field, values) => {
    for (let i = 0; i < values.length; i += BULK_MARK_CHUNK) {
      const chunk = values.slice(i, i + BULK_MARK_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      if (dryRun) {
        const cnt = await db.query(
          `SELECT COUNT(*) AS c FROM sourcing_financing_event
           WHERE F_DeleteMark = 0 AND COALESCE(listing_status, '') <> 'matched'
             AND ${field} IN (${placeholders})`,
          chunk
        );
        marked += Number(cnt[0]?.c || 0);
        continue;
      }
      const result = await executeWithDeadlockRetry(
        db,
        `UPDATE sourcing_financing_event SET
          listing_status = ?,
          F_LastModifyTime = CURRENT_TIMESTAMP
        WHERE F_DeleteMark = 0
          AND COALESCE(listing_status, '') NOT IN ('matched', ?)
          AND ${field} IN (${placeholders})`,
        [status, status, ...chunk]
      );
      marked += result.affectedRows || 0;
    }
  };

  await markChunk('company_credit_code', [...new Set(credits)]);
  await markChunk('company_name', [...new Set(names)]);
  return marked;
}

async function columnExists(db, table, column) {
  const rows = await db.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function loadNewShareProfileRows(db) {
  const hasUnifiedCreditCode = await columnExists(db, 'ipo_new_share', 'unified_credit_code');
  const cols = [
    'F_Id',
    'stock_code',
    'exchange',
    'stock_name',
    'enterprise_full_name_cn',
    'enterprise_full_name_display',
    'company_intro',
    'product_intro',
    'industry_tags_display',
    'industry_tags_json',
    'industry_category_4',
  ];
  if (hasUnifiedCreditCode) cols.push('unified_credit_code');
  return db.query(`SELECT ${cols.join(', ')} FROM ipo_new_share`);
}

async function countFinancingEvents(db) {
  const rows = await db.query(
    `SELECT COUNT(*) AS c FROM sourcing_financing_event WHERE F_DeleteMark = 0`
  );
  return Number(rows[0]?.c || 0);
}

const { IPO_ROUND_SQL } = require('./listedFinancingJoin');

async function loadFinancingCompanyRows(db, ipoOnly) {
  const hasListedStock = await columnExists(db, 'sourcing_financing_event', 'listed_stock_code');
  const cols = [
    'company_name',
    'company_credit_code',
    'round',
    'latest_round',
    'event_date',
  ];
  if (hasListedStock) cols.push('listed_stock_code');

  const ipoFilter = ipoOnly ? `AND ${IPO_ROUND_SQL}` : '';
  return db.query(`
    SELECT ${cols.join(', ')}
    FROM sourcing_financing_event
    WHERE F_DeleteMark = 0 AND TRIM(COALESCE(company_name, '')) <> ''
    ${ipoFilter}
  `);
}

async function countIpoFinancingEvents(db) {
  const rows = await db.query(
    `SELECT COUNT(*) AS c FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND TRIM(COALESCE(company_name, '')) <> '' AND ${IPO_ROUND_SQL}`
  );
  return Number(rows[0]?.c || 0);
}

function dedupeFinancingCompanies(eventRows) {
  const map = new Map();
  for (const row of eventRows) {
    const key = companyDedupeKey(row);
    const existing = map.get(key);
    const dt = String(row.event_date || '');
    if (!existing || dt > String(existing.event_date || '')) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

/**
 * @param {import('mysql2/promise').Pool|{ query: Function, execute: Function }} db
 * @param {{ ipoOnly?: boolean, markUnknown?: boolean, markNoMatch?: boolean, marksOnly?: boolean, force?: boolean, dryRun?: boolean }} opts
 */
async function runListedFinancingSync(db, opts = {}) {
  const ipoOnly = opts.ipoOnly !== false;
  const markUnknown = opts.markUnknown === true;
  const markNoMatch = opts.markNoMatch === true;
  const marksOnly = opts.marksOnly === true;

  await db.query('SELECT 1');

  const newShareRows = await loadNewShareProfileRows(db);
  const hasUnifiedCreditCode = newShareRows.some((r) => strTrim(r.unified_credit_code));
  const nsIndex = buildNewShareIndex(newShareRows, { hasUnifiedCreditCode });
  const nsById = new Map(newShareRows.map((r) => [r.F_Id, r]));

  const financingHasListedStock = await columnExists(db, 'sourcing_financing_event', 'listed_stock_code');
  console.log('[listedFinancingSync] 加载融资企业样本…');
  const companyEventRows = await loadFinancingCompanyRows(db, ipoOnly);
  const companies = dedupeFinancingCompanies(companyEventRows);
  const financingEventsTotal = await countFinancingEvents(db);
  const financingIpoEvents = ipoOnly
    ? companyEventRows.length
    : await countIpoFinancingEvents(db);

  console.log('[listedFinancingSync] 去重企业', companies.length, 'IPO 事件行', financingIpoEvents);

  const stats = {
    companies_total: companies.length,
    ipo_only: ipoOnly,
    matched_companies: 0,
    unknown_companies: 0,
    no_match_companies: 0,
    events_synced: 0,
    events_profile_skipped: 0,
    events_unknown_marked: 0,
    events_no_match_marked: 0,
    by_match_method: {},
  };

  const unknownCompanies = [];
  const noMatchCompanies = [];
  let matchBatch = [];

  const flushBatch = async () => {
    if (!matchBatch.length) return;
    stats.events_synced += await flushMatchedBatch(db, matchBatch, opts);
    matchBatch = [];
  };

  for (let i = 0; i < companies.length; i += 1) {
    const company = companies[i];
    const join = classifyListedJoin(company, nsIndex, {
      financingHasListedStock,
      skipFuzzy: true,
    });
    const method = join.match_method || 'none';
    stats.by_match_method[method] = (stats.by_match_method[method] || 0) + 1;

    if (join.listing_status === 'matched') {
      stats.matched_companies += 1;
      if (marksOnly) continue;
      const nsRow = nsById.get(join.new_share_id);
      if (!nsRow) continue;
      const patch = buildListedSyncPatch(nsRow);
      const credit = normalizeCreditCode(company.company_credit_code);
      matchBatch.push({
        match_type: credit ? 'credit' : 'name',
        match_key: credit || strTrim(company.company_name),
        patch,
      });
      if (matchBatch.length >= MATCH_BATCH_SIZE) {
        await flushBatch();
        console.log(`[listedFinancingSync] matched 进度 ${i + 1}/${companies.length}`);
      }
      continue;
    }

    if (join.listing_status === 'unknown') {
      stats.unknown_companies += 1;
      if (markUnknown) unknownCompanies.push(company);
      continue;
    }

    stats.no_match_companies += 1;
    if (markNoMatch) noMatchCompanies.push(company);
  }

  await flushBatch();

  if (marksOnly) {
    console.log('[listedFinancingSync] marks-only：跳过 matched 画像回写');
  }

  if (markUnknown && unknownCompanies.length) {
    console.log('[listedFinancingSync] 批量标记 unknown:', unknownCompanies.length, '家企业');
    stats.events_unknown_marked = await bulkMarkListingStatus(db, unknownCompanies, 'unknown', opts.dryRun);
  }

  if (markNoMatch && noMatchCompanies.length) {
    console.log('[listedFinancingSync] 批量标记 no_match:', noMatchCompanies.length, '家企业');
    stats.events_no_match_marked = await bulkMarkListingStatus(db, noMatchCompanies, 'no_match', opts.dryRun);
  }

  return {
    ...stats,
    match_rate: stats.companies_total ? stats.matched_companies / stats.companies_total : 0,
    new_share_pool_size: newShareRows.length,
    financing_events_total: financingEventsTotal,
    financing_ipo_events: financingIpoEvents,
  };
}

module.exports = {
  LISTED_SYNC_VERSION,
  PROTECTED_PROFILE_SOURCES: new Set(PROTECTED_PROFILE_SOURCES),
  buildListedSyncPatch,
  flushMatchedBatch,
  loadNewShareProfileRows,
  dedupeFinancingCompanies,
  runListedFinancingSync,
  countFinancingEvents,
  loadFinancingCompanyRows,
};
