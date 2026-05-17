const db = require('../../db');
const { isIpoProjectCompetitorAnalysisApp } = require('../applicationIdResolve');
const { fetchCompanyBriefGetInfo } = require('../qichachaCompanyBrief');
const { buildProjectSourcingIpoWhereClause } = require('./ipoProjectSourcingListFilter');
const { isCrossTableUnifiedCredit, runUnifiedCreditQccSync } = require('./competitorQccCrossTableSync');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeCreditKey(code) {
  return String(code ?? '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

/**
 * 是否为可调用企查查 CompanyBrief 的统一社会信用代码（过滤明显错误值，避免浪费配额）。
 * 规则：规范化后恰好 18 位且为数字与大写字母（国标常见形态）。
 */
function isValidUnifiedCreditForQccSync(code) {
  const c = normalizeCreditKey(code);
  if (c.length !== 18) return false;
  return /^[0-9A-Z]{18}$/.test(c);
}

function pickQccSearchKey(row) {
  const credit = normalizeCreditKey(row.unified_credit_code);
  if (credit.length >= 8) return credit;
  const name = row.company != null ? String(row.company).trim() : '';
  if (name.length >= 2) return name;
  return '';
}

/**
 * 将多行按企查查查询键分组（优先统一社会信用代码，否则企业全称），同一键只调一次接口，再回写所有 f_id。
 */
function groupIpoRowsByQccSearchKey(rows) {
  /** @type {Map<string, { searchKey: string, fIdSet: Set<string> }>} */
  const map = new Map();
  for (const row of rows) {
    const sk = pickQccSearchKey(row);
    if (!sk) continue;
    const fid = String(row.f_id || '').trim();
    if (!fid) continue;
    if (!map.has(sk)) map.set(sk, { searchKey: sk, fIdSet: new Set() });
    map.get(sk).fIdSet.add(fid);
  }
  return [...map.values()].map((g) => ({ searchKey: g.searchKey, fIds: [...g.fIdSet] }));
}

async function applyQccIntroToFids(fIds, intro) {
  const uniq = [...new Set((fIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!uniq.length) return;
  const ph = uniq.map(() => '?').join(',');
  await db.execute(
    `UPDATE ipo_project SET
       qcc_company_intro = ?,
       qcc_sync_at = NOW(),
       qcc_sync_error = NULL
     WHERE f_id IN (${ph}) AND F_DeleteMark = 0`,
    [intro, ...uniq]
  );
}

async function markQccErrorOnFids(fIds, errMsg) {
  const short = String(errMsg || 'error').slice(0, 480);
  const uniq = [...new Set((fIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  for (const fid of uniq) {
    try {
      await db.execute(`UPDATE ipo_project SET qcc_sync_error = ? WHERE f_id = ? AND F_DeleteMark = 0`, [
        short,
        fid,
      ]);
    } catch {
      /* ignore */
    }
  }
}

/**
 * 单条：拉取企查查企业简介并写入 ipo_project（仅竞品分析 data_app_id）。
 * @param {string|number} fId ipo_project.f_id
 */
async function syncIpoProjectQccCompanyBrief(fId) {
  const id = String(fId || '').trim();
  if (!id) {
    const e = new Error('无效的底层项目 f_id');
    e.code = 400;
    throw e;
  }
  const rows = await db.query(
    `SELECT f_id, company, unified_credit_code, data_app_id, F_DeleteMark
     FROM ipo_project WHERE f_id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].F_DeleteMark) !== 0) {
    const e = new Error('底层项目不存在或已删除');
    e.code = 404;
    throw e;
  }
  if (!(await isIpoProjectCompetitorAnalysisApp(rows[0]))) {
    const e = new Error('仅支持竞品分析应用下的底层项目');
    e.code = 400;
    throw e;
  }
  const searchKey = pickQccSearchKey(rows[0]);
  if (!searchKey) {
    const e = new Error('统一社会信用代码或企业全称至少 2 个字符方可查询企查查企业简介');
    e.code = 400;
    throw e;
  }

  const credit = normalizeCreditKey(rows[0].unified_credit_code);
  if (isCrossTableUnifiedCredit(credit)) {
    const one = await runUnifiedCreditQccSync(credit);
    const hint =
      searchKey.length > 18 ? `${searchKey.slice(0, 10)}…(${searchKey.length}字)` : searchKey;
    return {
      ok: true,
      desc_len: one.desc_len,
      search_key_hint: hint,
    };
  }

  const r = await fetchCompanyBriefGetInfo(searchKey);
  const desc = r.desc;
  const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;

  await applyQccIntroToFids([id], intro);

  const hint =
    searchKey.length > 18 ? `${searchKey.slice(0, 10)}…(${searchKey.length}字)` : searchKey;
  return {
    ok: true,
    desc_len: intro ? intro.length : 0,
    search_key_hint: hint,
  };
}

/**
 * 批量（勾选行）：按统一社会信用代码（或企业全称）去重后查询，再按相同键回写所有相关 f_id。
 * @param {(string|number)[]} fIds
 * @param {{ gapMs?: number }} [opts]
 */
async function batchSyncIpoProjectQccCompanyBrief(fIds, opts = {}) {
  const gapMs = Math.max(0, Math.min(5000, parseInt(opts.gapMs ?? '400', 10) || 400));
  const ids = [...new Set((fIds || []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!ids.length) {
    return { ok: false, code: 400, message: '请提供至少一个底层项目 f_id' };
  }
  if (ids.length > 2000) {
    return { ok: false, code: 400, message: '单次勾选最多 2000 条，请分批操作' };
  }

  const ph = ids.map(() => '?').join(',');
  const rows = await db.query(
    `SELECT f_id, company, unified_credit_code, data_app_id, F_DeleteMark
     FROM ipo_project WHERE f_id IN (${ph})`,
    ids
  );

  const valid = [];
  for (const r of rows) {
    if (Number(r.F_DeleteMark) !== 0) continue;
    if (!(await isIpoProjectCompetitorAnalysisApp(r))) continue;
    valid.push(r);
  }

  const groups = groupIpoRowsByQccSearchKey(valid);
  if (!groups.length) {
    return {
      ok: false,
      code: 400,
      message: '勾选行中无可同步的底层项目（需为竞品分析应用且具备统一社会信用代码或企业全称）',
    };
  }

  const results = [];
  let successRows = 0;
  let failedRows = 0;
  for (let i = 0; i < groups.length; i++) {
    const { searchKey, fIds } = groups[i];
    try {
      if (isCrossTableUnifiedCredit(searchKey)) {
        await runUnifiedCreditQccSync(searchKey);
        successRows += fIds.length;
        results.push({ search_key: searchKey, f_ids: fIds, success: true, count: fIds.length });
      } else {
        const r = await fetchCompanyBriefGetInfo(searchKey);
        const desc = r.desc;
        const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;
        await applyQccIntroToFids(fIds, intro);
        successRows += fIds.length;
        results.push({ search_key: searchKey, f_ids: fIds, success: true, count: fIds.length });
      }
    } catch (err) {
      failedRows += fIds.length;
      const msg = (err && err.message) || String(err);
      if (!isCrossTableUnifiedCredit(searchKey)) {
        await markQccErrorOnFids(fIds, msg);
      }
      results.push({ search_key: searchKey, f_ids: fIds, success: false, error: msg });
    }
    if (i + 1 < groups.length && gapMs > 0) await sleep(gapMs);
  }

  return {
    ok: true,
    data: {
      total_f_ids: ids.length,
      unique_queries: groups.length,
      success: successRows,
      failed: failedRows,
      results,
    },
  };
}

/**
 * 企查查全部同步：与列表相同筛选条件下拉取全部底层项目，去重后依次调用企查查并回写。
 */
async function syncAllIpoProjectQccCompanyBriefFiltered({ psUser, keyword, creatorUserId, gapMs } = {}) {
  const g = Math.max(0, Math.min(5000, parseInt(gapMs ?? '400', 10) || 400));
  const { whereSql, params } = await buildProjectSourcingIpoWhereClause({
    psUser,
    keyword: keyword != null ? String(keyword) : '',
    creatorUserId: creatorUserId != null ? String(creatorUserId) : '',
  });
  const rows = await db.query(
    `SELECT p.f_id, p.company, p.unified_credit_code, p.data_app_id, p.F_DeleteMark
     FROM ipo_project p
     ${whereSql}
     ORDER BY p.F_CreatorTime DESC
     LIMIT 50000`,
    params
  );

  const valid = [];
  for (const r of rows) {
    if (Number(r.F_DeleteMark) !== 0) continue;
    if (!(await isIpoProjectCompetitorAnalysisApp(r))) continue;
    valid.push(r);
  }

  const groups = groupIpoRowsByQccSearchKey(valid);
  if (!groups.length) {
    return {
      ok: false,
      code: 400,
      message: '当前筛选下没有可同步企查查的底层项目（需具备统一社会信用代码或企业全称）',
    };
  }
  if (groups.length > 5000) {
    return {
      ok: false,
      code: 400,
      message: `去重后仍有 ${groups.length} 个不同查询主体，超过单次上限 5000，请缩小筛选范围后分批执行`,
    };
  }

  const results = [];
  let successRows = 0;
  let failedRows = 0;
  for (let i = 0; i < groups.length; i++) {
    const { searchKey, fIds } = groups[i];
    try {
      if (isCrossTableUnifiedCredit(searchKey)) {
        await runUnifiedCreditQccSync(searchKey);
        successRows += fIds.length;
        results.push({ search_key: searchKey, f_ids: fIds, success: true, count: fIds.length });
      } else {
        const r = await fetchCompanyBriefGetInfo(searchKey);
        const desc = r.desc;
        const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;
        await applyQccIntroToFids(fIds, intro);
        successRows += fIds.length;
        results.push({ search_key: searchKey, f_ids: fIds, success: true, count: fIds.length });
      }
    } catch (err) {
      failedRows += fIds.length;
      const msg = (err && err.message) || String(err);
      if (!isCrossTableUnifiedCredit(searchKey)) {
        await markQccErrorOnFids(fIds, msg);
      }
      results.push({ search_key: searchKey, f_ids: fIds, success: false, error: msg });
    }
    if (i + 1 < groups.length && g > 0) await sleep(g);
  }

  return {
    ok: true,
    data: {
      total_rows: valid.length,
      unique_queries: groups.length,
      success: successRows,
      failed: failedRows,
      results,
    },
  };
}

/**
 * 底层项目 SQL 全量同步提交后：仅竞品分析应用下、且统一社会信用代码通过校验的行，按代码去重调用企查查写简介。
 * @param {{ userId: string, psAppId: string, gapMs?: number }} p
 */
async function runPostSqlSyncQccBriefsForProjectSourcingUser({ userId, psAppId, gapMs = 400 } = {}) {
  const uid = String(userId || '').trim();
  const appId = String(psAppId || '').trim();
  if (!uid || !appId) {
    return { ok: false, message: '缺少 userId 或 psAppId' };
  }
  const g = Math.max(0, Math.min(5000, parseInt(gapMs ?? '400', 10) || 400));
  const rows = await db.query(
    `SELECT f_id, company, unified_credit_code, data_app_id, F_DeleteMark
     FROM ipo_project
     WHERE F_CreatorUserId = ? AND data_app_id <=> ? AND F_DeleteMark = 0`,
    [uid, appId]
  );
  let totalRows = 0;
  let skippedInvalidCredit = 0;
  const creditToFids = new Map();
  for (const r of rows) {
    if (!(await isIpoProjectCompetitorAnalysisApp(r))) continue;
    totalRows += 1;
    const fid = String(r.f_id || '').trim();
    if (!fid) continue;
    const credit = normalizeCreditKey(r.unified_credit_code);
    if (!isValidUnifiedCreditForQccSync(credit)) {
      skippedInvalidCredit += 1;
      continue;
    }
    if (!creditToFids.has(credit)) creditToFids.set(credit, []);
    creditToFids.get(credit).push(fid);
  }
  const groups = [...creditToFids.entries()].map(([searchKey, fIds]) => ({ searchKey, fIds }));
  if (!groups.length) {
    console.log(
      `[ipoProjectSqlSync][postQcc] user=${uid} 无有效统一社会信用代码可拉取企查查（总行=${totalRows}，跳过无效码=${skippedInvalidCredit}）`
    );
    return {
      ok: true,
      unique_queries: 0,
      success_fids: 0,
      failed_fids: 0,
      skipped_invalid_credit: skippedInvalidCredit,
      total_rows: totalRows,
    };
  }
  let successFids = 0;
  let failedFids = 0;
  for (let i = 0; i < groups.length; i++) {
    const { searchKey, fIds } = groups[i];
    try {
      if (isCrossTableUnifiedCredit(searchKey)) {
        await runUnifiedCreditQccSync(searchKey);
        successFids += fIds.length;
      } else {
        const r = await fetchCompanyBriefGetInfo(searchKey);
        const desc = r.desc;
        const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;
        await applyQccIntroToFids(fIds, intro);
        successFids += fIds.length;
      }
    } catch (err) {
      failedFids += fIds.length;
      const msg = (err && err.message) || String(err);
      if (!isCrossTableUnifiedCredit(searchKey)) {
        await markQccErrorOnFids(fIds, msg);
      }
      console.warn(`[ipoProjectSqlSync][postQcc] 信用码=${searchKey.slice(0, 8)}… 失败:`, msg);
    }
    if (i + 1 < groups.length && g > 0) await sleep(g);
  }
  console.log(
    `[ipoProjectSqlSync][postQcc] user=${uid} 完成 去重查询=${groups.length} 成功行≈${successFids} 失败行≈${failedFids} 跳过无效统一码=${skippedInvalidCredit}`
  );
  return {
    ok: true,
    unique_queries: groups.length,
    success_fids: successFids,
    failed_fids: failedFids,
    skipped_invalid_credit: skippedInvalidCredit,
    total_rows: totalRows,
  };
}

module.exports = {
  syncIpoProjectQccCompanyBrief,
  batchSyncIpoProjectQccCompanyBrief,
  syncAllIpoProjectQccCompanyBriefFiltered,
  runPostSqlSyncQccBriefsForProjectSourcingUser,
  isValidUnifiedCreditForQccSync,
};
