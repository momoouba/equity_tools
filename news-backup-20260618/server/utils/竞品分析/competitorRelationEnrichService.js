const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  runFinancingStyleWebEnrichLlmCall,
  withFinancingAiConcurrency,
} = require('../项目挖掘/financingAiEnrichService');
const { parseTagsFromJson, mergeTagArrays, strTrim, normalizeCreditCode } = require('./competitorMatchUtils');
const { logCompetitorRun } = require('./competitorAnalysisLogger');
const { loadInternalDisplayFields } = require('./competitorInternalDisplayLoader');

function tagsToDisplay(tags) {
  return (tags || []).map((t) => strTrim(t)).filter(Boolean).join('、');
}

// ── 运行级富化缓存：同一分析批次内相同竞品只调一次 LLM ──
const _enrichCache = new Map();

/** 清空富化缓存（每次分析运行开始时调用） */
function clearEnrichCache() { _enrichCache.clear(); }

/**
 * 从底层项目表聚合子基金名称（同一竞品企业信用代码/企业全称可能对应多行）。
 */
async function resolveSubFundNamesFromIpo(unifiedCreditCode, companyName) {
  const psAppId = await getApplicationIdByAppName(DATA_APP_COMPETITOR_ANALYSIS);
  if (!psAppId) return '';
  const credit = normalizeCreditCode(unifiedCreditCode);
  const name = strTrim(companyName);
  if (!credit && !name) return '';

  let rows = [];
  if (credit.length >= 15) {
    rows = await db.query(
      `SELECT DISTINCT TRIM(sub) AS sub_name
       FROM ipo_project
       WHERE F_DeleteMark = 0 AND data_app_id = ?
         AND unified_credit_code = ?
         AND sub IS NOT NULL AND TRIM(sub) <> ''`,
      [psAppId, credit]
    );
  }
  if (!rows.length && name) {
    rows = await db.query(
      `SELECT DISTINCT TRIM(sub) AS sub_name
       FROM ipo_project
       WHERE F_DeleteMark = 0 AND data_app_id = ?
         AND TRIM(company) = ?
         AND sub IS NOT NULL AND TRIM(sub) <> ''`,
      [psAppId, name]
    );
  }
  const subs = rows.map((r) => strTrim(r.sub_name)).filter(Boolean);
  return [...new Set(subs)].join('、');
}

/**
 * 竞品落库前补齐展示字段：产品介绍、企业标签（融资联网 AI 增强提示词）；子基金来自底层项目。
 */
async function enrichCompetitorDisplayFields(candidate, { runId } = {}) {
  const name = strTrim(candidate.display_name);
  const credit = normalizeCreditCode(candidate.unified_credit_code);

  // ── 缓存命中：同批次内相同竞品直接返回 ──
  const cacheKey = `${credit}|${name}`;
  const cached = _enrichCache.get(cacheKey);
  if (cached) return cached;

  let productIntro = strTrim(candidate.product_intro);
  let tags = Array.isArray(candidate.tags) ? [...candidate.tags] : [];
  if (!tags.length && candidate.ai_company_tags_display) {
    tags = strTrim(candidate.ai_company_tags_display)
      .split(/[,，、]/g)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (!tags.length && candidate.ai_company_tags_json) {
    tags = parseTagsFromJson(candidate.ai_company_tags_json);
  }

  const internal = await loadInternalDisplayFields(credit, name);
  if (!productIntro && internal.product_intro) productIntro = internal.product_intro;
  if (tags.length < 1 && internal.tags?.length) tags = [...internal.tags];
  if (!candidate.ipo_sub_funds?.length && internal.ipo_sub_funds?.length) {
    candidate.ipo_sub_funds = internal.ipo_sub_funds;
  }

  const needLlm = !productIntro || tags.length < 1;
  if (needLlm && name) {
    // ── 持久化缓存：查数据库中已有富化结果，跳过 LLM 调用 ──
    if (credit) {
      try {
        const prevRows = await db.query(
          `SELECT competitor_product_intro, competitor_tags_display, competitor_tags_json
           FROM sourcing_competitor_relation
           WHERE F_DeleteMark = 0 AND unified_credit_code = ?
             AND (competitor_product_intro IS NOT NULL OR competitor_tags_json IS NOT NULL)
           ORDER BY F_LastModifyTime DESC LIMIT 1`,
          [credit]
        );
        if (prevRows.length) {
          const prev = prevRows[0];
          if (!productIntro && prev.competitor_product_intro) {
            productIntro = strTrim(prev.competitor_product_intro);
          }
          if (tags.length < 1 && prev.competitor_tags_json) {
            tags = parseTagsFromJson(prev.competitor_tags_json);
          }
        }
      } catch (e) {
        // 缓存查询失败不阻断主流程
      }
    }
  }

  const stillNeedLlm = !productIntro || tags.length < 1;
  if (stillNeedLlm && name) {
    try {
      logCompetitorRun(runId, 'S6_enrich', `联网增强补齐 ${name}`);
      const llm = await withFinancingAiConcurrency(() =>
        runFinancingStyleWebEnrichLlmCall({
          company_name: name,
          company_credit_code: credit || '',
          project_name: name,
        })
      );
      if (!productIntro && llm.productIntroStored) productIntro = strTrim(llm.productIntroStored);
      if (tags.length < 1 && llm.display) {
        tags = strTrim(llm.display)
          .split(/[,，、]/g)
          .map((x) => x.trim())
          .filter(Boolean);
      }
      if (tags.length < 1 && llm.tagsJson) {
        tags = parseTagsFromJson(llm.tagsJson);
      }
    } catch (e) {
      logCompetitorRun(runId, 'S6_enrich', `补齐失败 ${name}: ${e.message}`);
    }
  }

  const sources = candidate.sources || (candidate.source ? [candidate.source] : []);
  let subFundNames = '';
  if (sources.includes('ipo_project')) {
    if (Array.isArray(candidate.ipo_sub_funds) && candidate.ipo_sub_funds.length) {
      subFundNames = [...new Set(candidate.ipo_sub_funds.map((s) => strTrim(s)).filter(Boolean))].join('、');
    } else {
      subFundNames = await resolveSubFundNamesFromIpo(credit, name);
    }
  }

  const result = {
    competitor_product_intro: productIntro || null,
    competitor_tags_display: tagsToDisplay(tags) || null,
    competitor_tags_json: tags.length ? JSON.stringify(tags) : null,
    sub_fund_names: subFundNames || null,
  };
  _enrichCache.set(cacheKey, result);
  return result;
}

module.exports = {
  enrichCompetitorDisplayFields,
  clearEnrichCache,
  resolveSubFundNamesFromIpo,
  loadInternalDisplayFields,
};
