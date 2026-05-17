const db = require('../../db');
const { sanitizeQccCompanyIntroForMatching } = require('./qccCompanyIntroSanitizer');
const { isInvestedEnterpriseCompetitorAnalysisApp } = require('../applicationIdResolve');

function strTrim(v) {
  return v != null ? String(v).trim() : '';
}

function parseTagsFromRow(row) {
  const disp = strTrim(row.ai_industry_tags_display);
  if (disp) {
    const parts = disp
      .split(/[,，、]/g)
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length) return parts;
  }
  const j = row.ai_industry_tags_json;
  if (j == null) return [];
  try {
    const arr = typeof j === 'string' ? JSON.parse(j) : j;
    if (Array.isArray(arr)) {
      return arr.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function mergeTagArrays(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const t of list || []) {
      const s = String(t).trim();
      if (!s || s.length > 32) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 24) return out;
    }
  }
  return out;
}

/**
 * 读取该被投企业最近一次竞品补录（未删除）。
 * @param {string} investedEnterpriseId
 */
async function loadLatestSupplementTags(investedEnterpriseId) {
  const id = String(investedEnterpriseId || '').trim();
  if (!id) return [];
  const rows = await db.query(
    `SELECT user_tags_json, ai_extracted_tags_json
     FROM competitor_match_supplement
     WHERE invested_enterprise_id = ? AND delete_mark = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    [id]
  );
  if (!rows.length) return [];
  const r = rows[0];
  let userTags = [];
  let aiTags = [];
  try {
    const uj = r.user_tags_json;
    const parsed = typeof uj === 'string' ? JSON.parse(uj) : uj;
    if (Array.isArray(parsed)) userTags = parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* ignore */
  }
  try {
    const aj = r.ai_extracted_tags_json;
    const parsed = typeof aj === 'string' ? JSON.parse(aj) : aj;
    if (Array.isArray(parsed)) aiTags = parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    /* ignore */
  }
  return mergeTagArrays(userTags, aiTags);
}

/**
 * @param {object} row invested_enterprises 一行（须含 AI/企查查列）
 * @returns {Promise<{ ready: boolean, needSupplement: boolean, reasons: string[], sanitizedQcc: { effectiveText: string, rejectedAsNoise: boolean }, tags: string[] }>}
 */
async function evaluateInvestedEnterpriseCompetitorReadiness(row) {
  const productIntro = strTrim(row.ai_product_intro);
  const qccSan = sanitizeQccCompanyIntroForMatching(row.qcc_company_intro);
  const baseTags = parseTagsFromRow(row);
  const supTags = await loadLatestSupplementTags(row.id);
  const allTags = mergeTagArrays(baseTags, supTags);

  const hasProduct = productIntro.length > 0;
  const hasEffectiveQcc = qccSan.effectiveText.length >= 20;
  const hasTags = allTags.length >= 1;

  const reasons = [];
  if (!hasProduct) reasons.push('缺少产品介绍(AI)');
  if (!hasEffectiveQcc && strTrim(row.qcc_company_intro) && qccSan.rejectedAsNoise) {
    reasons.push('企查查企业介绍经清洗后为无效工商模版类内容');
  } else if (!hasEffectiveQcc && !strTrim(row.qcc_company_intro)) {
    reasons.push('无有效企查查业务介绍');
  } else if (!hasEffectiveQcc) {
    reasons.push('企查查企业介绍过短或不足以作业务语义');
  }
  if (!hasTags) reasons.push('无可用企业标签（含补录）');

  const needSupplement = !hasProduct && !hasEffectiveQcc && !hasTags;
  const ready = !needSupplement;

  return {
    ready,
    needSupplement,
    reasons,
    sanitizedQcc: qccSan,
    tags: allTags,
  };
}

async function getInvestedEnterpriseRowForCompetitor(enterpriseId) {
  const id = String(enterpriseId || '').trim();
  if (!id) {
    const e = new Error('无效的企业 id');
    e.code = 400;
    throw e;
  }
  const rows = await db.query(
    `SELECT id, enterprise_full_name, unified_credit_code, project_abbreviation, data_app_name, data_app_id,
            ai_product_intro, ai_industry_tags_display, ai_industry_tags_json, qcc_company_intro,
            exit_status, delete_mark, creator_user_id
     FROM invested_enterprises WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length || Number(rows[0].delete_mark) !== 0) {
    const e = new Error('被投企业不存在或已删除');
    e.code = 404;
    throw e;
  }
  if (!(await isInvestedEnterpriseCompetitorAnalysisApp(rows[0]))) {
    const e = new Error('仅支持竞品分析应用下的被投企业');
    e.code = 400;
    throw e;
  }
  return rows[0];
}

module.exports = {
  evaluateInvestedEnterpriseCompetitorReadiness,
  getInvestedEnterpriseRowForCompetitor,
  loadLatestSupplementTags,
  parseTagsFromRow,
};
