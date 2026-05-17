'use strict';

const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { fetchCompanyBriefGetInfo } = require('../qichachaCompanyBrief');

function creditNormalizeSql(columnExpr) {
  return `UPPER(REPLACE(REPLACE(IFNULL(${columnExpr},''),' ',''),'　',''))`;
}

function normalizeUnifiedCreditCode(code) {
  return String(code ?? '')
    .replace(/\s+/g, '')
    .trim()
    .toUpperCase();
}

function isCrossTableUnifiedCredit(code) {
  return normalizeUnifiedCreditCode(code).length >= 8;
}

function pickBestIntro(intros) {
  let best = '';
  for (const raw of intros) {
    const t = raw == null ? '' : String(raw).trim();
    if (!t) continue;
    if (t.length > best.length) best = t;
  }
  return best || null;
}

/**
 * 同一信用码下所有「项目挖掘」被投行：写入最近一次同步来源（含已有简介的行，便于列表展示）。
 */
async function markAllInvestedEnterprisesQccSyncViaForCredit(creditNorm, psAppId, appName, via) {
  const expr = creditNormalizeSql('ie.unified_credit_code');
  await db.execute(
    `UPDATE invested_enterprises ie SET
       ie.qcc_sync_via = ?,
       ie.qcc_sync_at = NOW(),
       ie.updated_at = NOW()
     WHERE ie.delete_mark = 0 AND ${expr} = ?
       AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))`,
    [via, creditNorm, psAppId, appName]
  );
}

/**
 * 三表（被投 / 底层 / 投前）在「项目挖掘」范围内、同一规范化统一社会信用代码：
 * 1）先用任一侧已有非空简介补全他侧空行；
 * 2）若仍有空行，按信用代码只调一次企查查，成功后写回所有匹配行。
 *
 * @param {string} creditRaw
 * @returns {Promise<{ ok: true, source: 'cross_table_propagate'|'qcc_api', desc_len: number }>}
 */
async function runUnifiedCreditQccSync(creditRaw) {
  const creditNorm = normalizeUnifiedCreditCode(creditRaw);
  if (creditNorm.length < 8) {
    const e = new Error('统一社会信用代码有效长度不足，无法走三表对齐同步');
    e.code = 400;
    throw e;
  }
  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!psAppId) {
    const e = new Error('未解析到「竞品分析」应用 id，无法三表对齐');
    e.code = 500;
    throw e;
  }
  const appName = DATA_APP_COMPETITOR_ANALYSIS;
  const ieCredit = creditNormalizeSql('ie.unified_credit_code');
  const ipoCredit = creditNormalizeSql('p.unified_credit_code');
  const preCredit = creditNormalizeSql('pr.unified_credit_code');

  const snap = await db.query(
    `SELECT qcc FROM (
       SELECT ie.qcc_company_intro AS qcc FROM invested_enterprises ie
        WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
          AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))
       UNION ALL
       SELECT p.qcc_company_intro AS qcc FROM ipo_project p
        WHERE p.F_DeleteMark = 0 AND p.data_app_id <=> ? AND ${ipoCredit} = ?
       UNION ALL
       SELECT pr.qcc_company_intro AS qcc FROM pre_investment_project pr
        WHERE pr.delete_mark = 0 AND pr.data_app_name = ? AND ${preCredit} = ?
     ) t`,
    [creditNorm, psAppId, appName, psAppId, creditNorm, appName, creditNorm]
  );
  const best0 = pickBestIntro(snap.map((r) => r.qcc));

  if (best0) {
      await db.execute(
      `UPDATE invested_enterprises ie SET
         ie.qcc_company_intro = ?,
         ie.qcc_sync_at = NOW(),
         ie.qcc_sync_error = NULL,
         ie.qcc_sync_via = 'cross_table_propagate',
         ie.updated_at = NOW()
       WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
         AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))
         AND (ie.qcc_company_intro IS NULL OR TRIM(ie.qcc_company_intro) = '')`,
      [best0, creditNorm, psAppId, appName]
    );
    await db.execute(
      `UPDATE ipo_project p SET
         p.qcc_company_intro = ?,
         p.qcc_sync_at = NOW(),
         p.qcc_sync_error = NULL
       WHERE p.F_DeleteMark = 0 AND p.data_app_id <=> ? AND ${ipoCredit} = ?
         AND (p.qcc_company_intro IS NULL OR TRIM(p.qcc_company_intro) = '')`,
      [best0, psAppId, creditNorm]
    );
    await db.execute(
      `UPDATE pre_investment_project pr SET
         pr.qcc_company_intro = ?,
         pr.qcc_sync_at = NOW(),
         pr.qcc_sync_error = NULL,
         pr.pipeline_status = 'qcc_done',
         pr.pipeline_error = NULL,
         pr.updated_at = NOW()
       WHERE pr.delete_mark = 0 AND pr.data_app_name = ? AND ${preCredit} = ?
         AND (pr.qcc_company_intro IS NULL OR TRIM(pr.qcc_company_intro) = '')`,
      [best0, appName, creditNorm]
    );
  }

  const still = await db.query(
    `SELECT 1 AS x FROM (
       SELECT ie.id FROM invested_enterprises ie
        WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
          AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))
          AND (ie.qcc_company_intro IS NULL OR TRIM(ie.qcc_company_intro) = '')
       UNION ALL
       SELECT p.f_id FROM ipo_project p
        WHERE p.F_DeleteMark = 0 AND p.data_app_id <=> ? AND ${ipoCredit} = ?
          AND (p.qcc_company_intro IS NULL OR TRIM(p.qcc_company_intro) = '')
       UNION ALL
       SELECT pr.id FROM pre_investment_project pr
        WHERE pr.delete_mark = 0 AND pr.data_app_name = ? AND ${preCredit} = ?
          AND (pr.qcc_company_intro IS NULL OR TRIM(pr.qcc_company_intro) = '')
     ) u LIMIT 1`,
    [creditNorm, psAppId, appName, psAppId, creditNorm, appName, creditNorm]
  );
  if (!still.length) {
    const filled = await db.query(
      `SELECT ie.qcc_company_intro AS qcc FROM invested_enterprises ie
        WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
          AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))
        LIMIT 1`,
      [creditNorm, psAppId, appName]
    );
    const intro = filled[0] && filled[0].qcc != null ? String(filled[0].qcc).trim() : '';
    await markAllInvestedEnterprisesQccSyncViaForCredit(
      creditNorm,
      psAppId,
      appName,
      'cross_table_propagate'
    );
    return { ok: true, source: 'cross_table_propagate', desc_len: intro.length };
  }

  const shortErr = (msg) => String(msg || 'error').slice(0, 480);
  try {
    const r = await fetchCompanyBriefGetInfo(creditNorm);
    const desc = r.desc;
    const intro = desc != null && String(desc).trim() !== '' ? String(desc).trim() : null;

    await db.execute(
      `UPDATE invested_enterprises ie SET
         ie.qcc_company_intro = ?,
         ie.qcc_sync_at = NOW(),
         ie.qcc_sync_error = NULL,
         ie.qcc_sync_via = 'qcc_api',
         ie.updated_at = NOW()
       WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
         AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))`,
      [intro, creditNorm, psAppId, appName]
    );
    await db.execute(
      `UPDATE ipo_project p SET
         p.qcc_company_intro = ?,
         p.qcc_sync_at = NOW(),
         p.qcc_sync_error = NULL
       WHERE p.F_DeleteMark = 0 AND p.data_app_id <=> ? AND ${ipoCredit} = ?`,
      [intro, psAppId, creditNorm]
    );
    await db.execute(
      `UPDATE pre_investment_project pr SET
         pr.qcc_company_intro = ?,
         pr.qcc_sync_at = NOW(),
         pr.qcc_sync_error = NULL,
         pr.pipeline_status = 'qcc_done',
         pr.pipeline_error = NULL,
         pr.updated_at = NOW()
       WHERE pr.delete_mark = 0 AND pr.data_app_name = ? AND ${preCredit} = ?`,
      [intro, appName, creditNorm]
    );
    return { ok: true, source: 'qcc_api', desc_len: intro ? intro.length : 0 };
  } catch (err) {
    const msg = shortErr(err && err.message);
    try {
      await db.execute(
        `UPDATE invested_enterprises ie SET ie.qcc_sync_error = ?, ie.updated_at = NOW()
         WHERE ie.delete_mark = 0 AND ${ieCredit} = ?
           AND (ie.data_app_id <=> ? OR (ie.data_app_id IS NULL AND ie.data_app_name = ?))`,
        [msg, creditNorm, psAppId, appName]
      );
    } catch {
      /* ignore */
    }
    try {
      await db.execute(
        `UPDATE ipo_project p SET p.qcc_sync_error = ?
         WHERE p.F_DeleteMark = 0 AND p.data_app_id <=> ? AND ${ipoCredit} = ?`,
        [msg, psAppId, creditNorm]
      );
    } catch {
      /* ignore */
    }
    try {
      await db.execute(
        `UPDATE pre_investment_project pr SET
           pr.qcc_sync_error = ?,
           pr.pipeline_error = ?,
           pr.updated_at = NOW()
         WHERE pr.delete_mark = 0 AND pr.data_app_name = ? AND ${preCredit} = ?`,
        [msg, msg, appName, creditNorm]
      );
    } catch {
      /* ignore */
    }
    throw err;
  }
}

module.exports = {
  normalizeUnifiedCreditCode,
  isCrossTableUnifiedCredit,
  runUnifiedCreditQccSync,
};
