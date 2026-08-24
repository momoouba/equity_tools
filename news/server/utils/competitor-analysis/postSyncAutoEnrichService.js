'use strict';

/**
 * 竞品分析：SQL 全量同步提交后的空值自动补全。
 *
 * 适用链路：
 * - 被投企业：routes/enterprises.js 的 executeSyncTask（快照→硬删→重写→回填之后）
 * - 底层项目：utils/listing/ipoProjectSqlSyncRunner.js 的 runIpoProjectSqlSyncForUser（提交之后）
 *
 * 规则：
 * - 企查查介绍为空 且 统一社会信用代码非空 → 按信用代码走三表（被投/底层/投前）对齐同步；
 * - 产品简介(AI) 或 企业标签(AI) 为空 → 按信用代码去重后逐条触发 AI 取数（成功时按信用码回写同源行）；
 * - 无统一社会信用代码的行跳过。
 *
 * 补全在后台串行队列执行，不阻塞同步任务本身的返回。
 */

const db = require('../../db');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const {
  normalizeUnifiedCreditCode,
  isCrossTableUnifiedCredit,
  runUnifiedCreditQccSync,
} = require('./competitorQccCrossTableSync');

const QCC_GAP_MS = Math.max(
  0,
  Math.min(5000, parseInt(process.env.POST_SYNC_QCC_GAP_MS || '400', 10) || 400)
);
const AI_GAP_MS = Math.max(
  0,
  Math.min(60000, parseInt(process.env.POST_SYNC_AI_GAP_MS || '500', 10) || 500)
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isDisabled() {
  return process.env.POST_SYNC_AUTO_ENRICH_DISABLED === '1';
}

/** 多条同步同时完成时串行执行补全，避免企查查配额与 LLM 并发瞬时打满 */
let postSyncEnrichChain = Promise.resolve();
function enqueuePostSyncEnrich(fn) {
  const run = postSyncEnrichChain.then(fn, fn);
  postSyncEnrichChain = run.catch(() => {});
  return run;
}

/** 竞品分析应用范围匹配（被投企业：data_app_id 优先，兼容旧行仅有 data_app_name） */
const IE_APP_MATCH_SQL = `(data_app_id <=> ? OR (data_app_id IS NULL AND data_app_name = ?))`;

/**
 * 企查查补全：被投企业（竞品分析、本用户）中简介为空且信用代码有效的行。
 * 同一信用代码只调一次，runUnifiedCreditQccSync 会写回三表所有匹配行。
 */
async function fillQccForCompetitorInvestedEnterprises({ userId, caAppId }) {
  const rows = await db.query(
    `SELECT F_Id, unified_credit_code
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
       AND ${IE_APP_MATCH_SQL}
       AND (qcc_company_intro IS NULL OR TRIM(qcc_company_intro) = '')`,
    [userId, caAppId, DATA_APP_COMPETITOR_ANALYSIS]
  );
  let skippedNoCredit = 0;
  const seen = new Set();
  const credits = [];
  for (const r of rows) {
    const credit = normalizeUnifiedCreditCode(r.unified_credit_code);
    if (!credit || !isCrossTableUnifiedCredit(credit)) {
      skippedNoCredit += 1;
      continue;
    }
    if (seen.has(credit)) continue;
    seen.add(credit);
    credits.push(credit);
  }
  const stats = {
    total_empty: rows.length,
    skipped_no_credit: skippedNoCredit,
    unique_queries: credits.length,
    success: 0,
    failed: 0,
  };
  for (let i = 0; i < credits.length; i++) {
    try {
      await runUnifiedCreditQccSync(credits[i]);
      stats.success += 1;
    } catch (err) {
      stats.failed += 1;
      console.warn(
        `[postSyncEnrich][ieQcc] 信用码=${credits[i].slice(0, 8)}… 失败: ${(err && err.message) || err}`
      );
    }
    if (i + 1 < credits.length && QCC_GAP_MS > 0) await sleep(QCC_GAP_MS);
  }
  return stats;
}

/** 企查查补全：底层项目（竞品分析、本用户）中简介为空且信用代码有效的行 */
async function fillQccForCompetitorIpoProjects({ userId, caAppId }) {
  const rows = await db.query(
    `SELECT F_Id, unified_credit_code
     FROM ipo_project
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
       AND data_app_id <=> ?
       AND (qcc_company_intro IS NULL OR TRIM(qcc_company_intro) = '')`,
    [userId, caAppId]
  );
  let skippedNoCredit = 0;
  const seen = new Set();
  const credits = [];
  for (const r of rows) {
    const credit = normalizeUnifiedCreditCode(r.unified_credit_code);
    if (!credit || !isCrossTableUnifiedCredit(credit)) {
      skippedNoCredit += 1;
      continue;
    }
    if (seen.has(credit)) continue;
    seen.add(credit);
    credits.push(credit);
  }
  const stats = {
    total_empty: rows.length,
    skipped_no_credit: skippedNoCredit,
    unique_queries: credits.length,
    success: 0,
    failed: 0,
  };
  for (let i = 0; i < credits.length; i++) {
    try {
      await runUnifiedCreditQccSync(credits[i]);
      stats.success += 1;
    } catch (err) {
      stats.failed += 1;
      console.warn(
        `[postSyncEnrich][ipoQcc] 信用码=${credits[i].slice(0, 8)}… 失败: ${(err && err.message) || err}`
      );
    }
    if (i + 1 < credits.length && QCC_GAP_MS > 0) await sleep(QCC_GAP_MS);
  }
  return stats;
}

/**
 * AI 补全：被投企业（竞品分析、本用户）中产品简介或标签为空的行。
 * 按信用代码去重取代表行执行；任务成功时服务内部按信用码回写同源行。无信用代码的行跳过。
 */
async function fillAiForCompetitorInvestedEnterprises({ userId, caAppId }) {
  const {
    prepareInvestedEnterpriseAiJob,
    runInvestedEnterpriseAiEnrichTask,
  } = require('./investedEnterpriseAiEnrichService');
  const rows = await db.query(
    `SELECT F_Id, unified_credit_code
     FROM invested_enterprises
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
       AND ${IE_APP_MATCH_SQL}
       AND (
         (ai_product_intro IS NULL OR TRIM(ai_product_intro) = '')
         OR (ai_industry_tags_display IS NULL OR TRIM(ai_industry_tags_display) = '')
       )
     ORDER BY F_Id DESC`,
    [userId, caAppId, DATA_APP_COMPETITOR_ANALYSIS]
  );
  let skippedNoCredit = 0;
  const seen = new Set();
  const representativeIds = [];
  for (const r of rows) {
    const credit = normalizeUnifiedCreditCode(r.unified_credit_code);
    if (!credit) {
      skippedNoCredit += 1;
      continue;
    }
    if (seen.has(credit)) continue;
    seen.add(credit);
    representativeIds.push(String(r.F_Id));
  }
  const stats = {
    total_empty: rows.length,
    skipped_no_credit: skippedNoCredit,
    queued: representativeIds.length,
    success: 0,
    failed_or_skipped: 0,
  };
  for (let i = 0; i < representativeIds.length; i++) {
    const eid = representativeIds[i];
    try {
      const prep = await prepareInvestedEnterpriseAiJob({
        enterpriseId: eid,
        triggerType: 'post_sync_auto',
        triggeredByUserId: userId,
        clientIp: null,
      });
      if (!prep.ok) {
        stats.failed_or_skipped += 1;
        console.warn(`[postSyncEnrich][ieAi] skip enterprise_id=${eid}: ${prep.message}`);
      } else {
        await runInvestedEnterpriseAiEnrichTask({
          enterpriseId: prep.enterpriseId,
          logId: prep.logId,
          triggerType: 'post_sync_auto',
          triggeredByUserId: userId,
          clientIp: null,
        });
        stats.success += 1;
      }
    } catch (err) {
      stats.failed_or_skipped += 1;
      console.error(`[postSyncEnrich][ieAi] enterprise_id=${eid} 异常`, err);
    }
    if (i + 1 < representativeIds.length && AI_GAP_MS > 0) await sleep(AI_GAP_MS);
  }
  return stats;
}

/** AI 补全：底层项目（竞品分析、本用户）中产品简介或标签为空的行 */
async function fillAiForCompetitorIpoProjects({ userId, caAppId }) {
  const {
    prepareIpoProjectAiJob,
    runIpoProjectAiEnrichTask,
  } = require('./ipoProjectAiEnrichService');
  const rows = await db.query(
    `SELECT F_Id, unified_credit_code
     FROM ipo_project
     WHERE F_DeleteMark = 0 AND F_CreatorUserId = ?
       AND data_app_id <=> ?
       AND (
         (ai_product_intro IS NULL OR TRIM(ai_product_intro) = '')
         OR (ai_industry_tags_display IS NULL OR TRIM(ai_industry_tags_display) = '')
       )
     ORDER BY F_Id DESC`,
    [userId, caAppId]
  );
  let skippedNoCredit = 0;
  const seen = new Set();
  const representativeIds = [];
  for (const r of rows) {
    const credit = normalizeUnifiedCreditCode(r.unified_credit_code);
    if (!credit) {
      skippedNoCredit += 1;
      continue;
    }
    if (seen.has(credit)) continue;
    seen.add(credit);
    representativeIds.push(String(r.F_Id));
  }
  const stats = {
    total_empty: rows.length,
    skipped_no_credit: skippedNoCredit,
    queued: representativeIds.length,
    success: 0,
    failed_or_skipped: 0,
  };
  for (let i = 0; i < representativeIds.length; i++) {
    const fid = representativeIds[i];
    try {
      const prep = await prepareIpoProjectAiJob({
        fId: fid,
        triggerType: 'post_sync_auto',
        triggeredByUserId: userId,
        clientIp: null,
      });
      if (!prep.ok) {
        stats.failed_or_skipped += 1;
        console.warn(`[postSyncEnrich][ipoAi] skip f_id=${fid}: ${prep.message}`);
      } else {
        await runIpoProjectAiEnrichTask({
          fId: prep.fId,
          logId: prep.logId,
          triggerType: 'post_sync_auto',
          triggeredByUserId: userId,
          clientIp: null,
        });
        stats.success += 1;
      }
    } catch (err) {
      stats.failed_or_skipped += 1;
      console.error(`[postSyncEnrich][ipoAi] f_id=${fid} 异常`, err);
    }
    if (i + 1 < representativeIds.length && AI_GAP_MS > 0) await sleep(AI_GAP_MS);
  }
  return stats;
}

async function runPostSyncAutoEnrichForInvestedEnterprises(userId) {
  const caAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!caAppId) {
    console.warn('[postSyncEnrich] 未解析到「竞品分析」应用 id，跳过被投企业同步后自动补全');
    return;
  }
  console.log(`[postSyncEnrich][invested_enterprises] 开始 user=${userId}`);
  // 先企查查（AI 提示词会参考企查查简介），再 AI
  const qcc = await fillQccForCompetitorInvestedEnterprises({ userId, caAppId });
  const ai = await fillAiForCompetitorInvestedEnterprises({ userId, caAppId });
  console.log(
    `[postSyncEnrich][invested_enterprises] 完成 user=${userId} ` +
      `企查查: 空值=${qcc.total_empty} 跳过无信用码=${qcc.skipped_no_credit} 查询=${qcc.unique_queries} 成功=${qcc.success} 失败=${qcc.failed} | ` +
      `AI: 空值=${ai.total_empty} 跳过无信用码=${ai.skipped_no_credit} 任务=${ai.queued} 成功=${ai.success} 失败或跳过=${ai.failed_or_skipped}`
  );
}

async function runPostSyncAutoEnrichForIpoProjects(userId) {
  const caAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!caAppId) {
    console.warn('[postSyncEnrich] 未解析到「竞品分析」应用 id，跳过底层项目同步后自动补全');
    return;
  }
  console.log(`[postSyncEnrich][ipo_project] 开始 user=${userId}`);
  const qcc = await fillQccForCompetitorIpoProjects({ userId, caAppId });
  const ai = await fillAiForCompetitorIpoProjects({ userId, caAppId });
  console.log(
    `[postSyncEnrich][ipo_project] 完成 user=${userId} ` +
      `企查查: 空值=${qcc.total_empty} 跳过无信用码=${qcc.skipped_no_credit} 查询=${qcc.unique_queries} 成功=${qcc.success} 失败=${qcc.failed} | ` +
      `AI: 空值=${ai.total_empty} 跳过无信用码=${ai.skipped_no_credit} 任务=${ai.queued} 成功=${ai.success} 失败或跳过=${ai.failed_or_skipped}`
  );
}

/**
 * 调度：被投企业 SQL 同步完成后调用。立即返回，补全在后台串行执行。
 * @param {{ userId: string }} p
 */
function schedulePostSyncAutoEnrichForCompetitorInvestedEnterprises({ userId } = {}) {
  if (isDisabled()) {
    console.log('[postSyncEnrich] 已通过 POST_SYNC_AUTO_ENRICH_DISABLED=1 禁用，跳过');
    return false;
  }
  const uid = String(userId || '').trim();
  if (!uid) return false;
  enqueuePostSyncEnrich(() => runPostSyncAutoEnrichForInvestedEnterprises(uid));
  return true;
}

/**
 * 调度：底层项目 SQL 同步完成后调用。立即返回，补全在后台串行执行。
 * @param {{ userId: string }} p
 */
function schedulePostSyncAutoEnrichForCompetitorIpoProjects({ userId } = {}) {
  if (isDisabled()) {
    console.log('[postSyncEnrich] 已通过 POST_SYNC_AUTO_ENRICH_DISABLED=1 禁用，跳过');
    return false;
  }
  const uid = String(userId || '').trim();
  if (!uid) return false;
  enqueuePostSyncEnrich(() => runPostSyncAutoEnrichForIpoProjects(uid));
  return true;
}

module.exports = {
  schedulePostSyncAutoEnrichForCompetitorInvestedEnterprises,
  schedulePostSyncAutoEnrichForCompetitorIpoProjects,
};
