const db = require('../../db');
const { getApplicationIdByAppName } = require('../applicationIdResolve');
const { DATA_APP_COMPETITOR_ANALYSIS } = require('../enterpriseDataApp');
const {
  runFinancingStyleWebEnrichLlmCall,
  withFinancingAiConcurrency,
} = require('../project-sourcing/financingAiEnrichService');
const { parseTagsFromJson, mergeTagArrays, strTrim, normalizeCreditCode } = require('./competitorMatchUtils');
const { logCompetitorRun } = require('./competitorAnalysisLogger');
const { loadInternalDisplayFields } = require('./competitorInternalDisplayLoader');
const { RADIOPHARMA_TRACK_RE } = require('./industry-strategies/baseStrategy');

function tagsToDisplay(tags) {
  return (tags || []).map((t) => strTrim(t)).filter(Boolean).join('、');
}

/** 简介偏 CRO/外包服务而非核药管线 */
const CRO_SERVICE_INTRO_RE =
  /\bCRO\b|合同研究组织|临床研究组织|临床试验服务|医药研发服务|医药外包|临床CRO|临床运营|SMO\b|药物警戒服务/i;

/**
 * 展示简介择优：若主简介偏 CRO、而 web/校验侧有核药信号，优先核药简介，避免落库误导。
 */
function pickPreferredProductIntro(candidate, primaryIntro) {
  const primary = strTrim(primaryIntro);
  const web = strTrim(candidate?.web_core_products);
  const qcc = strTrim(candidate?.qcc_intro);
  const structuredBits = [];
  const sp = candidate?.structured_profile;
  if (sp && typeof sp === 'object') {
    if (Array.isArray(sp.core_product_lines)) {
      structuredBits.push(sp.core_product_lines.map((x) => strTrim(x)).filter(Boolean).join('；'));
    }
    if (sp.modality) structuredBits.push(strTrim(sp.modality));
    if (sp.one_liner) structuredBits.push(strTrim(sp.one_liner));
  }
  const structured = structuredBits.filter(Boolean).join('；');
  const candidates = [primary, web, structured, qcc].filter((t) => t && t.length >= 12);

  const looksRadio = (t) => RADIOPHARMA_TRACK_RE.test(t);
  const looksCro = (t) => CRO_SERVICE_INTRO_RE.test(t) && !looksRadio(t);

  if (!primary) {
    return candidates.find((t) => looksRadio(t)) || candidates[0] || '';
  }
  if (looksCro(primary)) {
    const radioAlt = candidates.find((t) => t !== primary && looksRadio(t));
    if (radioAlt) return radioAlt;
  }
  // 主简介无核药信号、备选有：在核药目标场景下优先备选（由调用方在 need 时使用）
  if (!looksRadio(primary)) {
    const radioAlt = candidates.find((t) => t !== primary && looksRadio(t));
    if (radioAlt && looksCro(primary)) return radioAlt;
  }
  return primary;
}

/**
 * 落库展示是否仍偏 CRO、且候选侧已有核药信号 → 强制再联网补一次展示简介。
 */
function shouldForceRadiopharmaReenrich(candidate, productIntro) {
  const intro = strTrim(productIntro);
  if (!intro || !CRO_SERVICE_INTRO_RE.test(intro)) return false;
  if (RADIOPHARMA_TRACK_RE.test(intro)) return false;
  const blob = [
    candidate?.web_core_products,
    candidate?.validation?.rationale,
    candidate?.validation?.evidence_summary,
    ...(Array.isArray(candidate?.tags) ? candidate.tags : []),
  ]
    .map((x) => strTrim(x))
    .filter(Boolean)
    .join(' ');
  return RADIOPHARMA_TRACK_RE.test(blob) || candidate?.validation?.modality_match === true;
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

  let productIntro = pickPreferredProductIntro(candidate, candidate.product_intro);
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
  if (!productIntro && internal.product_intro) {
    productIntro = pickPreferredProductIntro(candidate, internal.product_intro);
  } else if (productIntro && internal.product_intro) {
    productIntro = pickPreferredProductIntro(
      { ...candidate, product_intro: productIntro, web_core_products: candidate.web_core_products || internal.product_intro },
      productIntro
    );
  }
  if (tags.length < 1 && internal.tags?.length) tags = [...internal.tags];
  if (!candidate.ipo_sub_funds?.length && internal.ipo_sub_funds?.length) {
    candidate.ipo_sub_funds = internal.ipo_sub_funds;
  }

  const needLlm = !productIntro || tags.length < 1 || shouldForceRadiopharmaReenrich(candidate, productIntro);
  if (needLlm && name) {
    // ── 持久化缓存：查数据库中已有富化结果，跳过 LLM 调用 ──
    if (credit && !shouldForceRadiopharmaReenrich(candidate, productIntro)) {
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
            productIntro = pickPreferredProductIntro(candidate, prev.competitor_product_intro);
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

  const stillNeedLlm =
    !productIntro || tags.length < 1 || shouldForceRadiopharmaReenrich(candidate, productIntro);
  if (stillNeedLlm && name) {
    try {
      logCompetitorRun(
        runId,
        'S6_enrich',
        `联网增强补齐 ${name}${shouldForceRadiopharmaReenrich(candidate, productIntro) ? '（CRO简介→核药重取）' : ''}`
      );
      const llm = await withFinancingAiConcurrency(() =>
        runFinancingStyleWebEnrichLlmCall({
          company_name: name,
          company_credit_code: credit || '',
          project_name: name,
        })
      );
      const llmIntro = strTrim(llm.productIntroStored);
      if (llmIntro) {
        const merged = pickPreferredProductIntro(
          { ...candidate, web_core_products: candidate.web_core_products || llmIntro },
          productIntro || llmIntro
        );
        // 强制重取时：若 LLM 仍偏 CRO 但 web 已有核药，保留核药；否则采用 LLM
        if (shouldForceRadiopharmaReenrich(candidate, productIntro)) {
          productIntro = RADIOPHARMA_TRACK_RE.test(llmIntro)
            ? llmIntro
            : merged || llmIntro;
        } else if (!productIntro) {
          productIntro = llmIntro;
        } else {
          productIntro = pickPreferredProductIntro(
            { ...candidate, web_core_products: llmIntro },
            productIntro
          );
        }
      }
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

  // 最终再择优一次（web_core / structured 可能更准）
  productIntro = pickPreferredProductIntro(candidate, productIntro) || productIntro;

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

/**
 * 候选有效简介长度：取 product_intro / web_core_products / qcc_intro 三者中最长。
 * 用于判断候选简介是否空/短到需要校验前联网补齐。
 */
function effectiveIntroLen(c) {
  return Math.max(
    strTrim(c?.product_intro).length,
    strTrim(c?.web_core_products).length,
    strTrim(c?.qcc_intro).length
  );
}

/**
 * 校验前定向联网增强：对空/短简介候选联网补齐产品简介与标签，
 * 直接写回 candidate.web_core_products / tags，使后续 S5 校验基于真实业务判断，
 * 而不是因为"企业业务信息缺失"被直接判死（web_search=0 的校验看不到联网信息）。
 * 返回 { enriched, introLen, tagCount, error? }。
 */
async function preValidateWebEnrichCandidate(candidate, { runId } = {}) {
  const name = strTrim(candidate.display_name);
  if (!name) return { enriched: false };
  const credit = normalizeCreditCode(candidate.unified_credit_code);
  const before = effectiveIntroLen(candidate);
  try {
    logCompetitorRun(
      runId,
      'S5_pre_enrich',
      `联网补齐简介 ${name}${candidate._fromGoldStandard ? '（金标优先）' : ''}`
    );
    const llm = await withFinancingAiConcurrency(() =>
      runFinancingStyleWebEnrichLlmCall({
        company_name: name,
        company_credit_code: credit || '',
        project_name: name,
      })
    );
    const intro = strTrim(llm.productIntroStored);
    // 提示词查不到主体时固定返回"公开信息不足，无法归纳"——这是废话而非业务画像，
    // 不写回 web_core_products，避免校验据此仍判 not_competitor 还误计一次"已补齐"。
    const isFailurePhrase = /公开信息不足|无法归纳|信息不足/.test(intro);
    if (intro && !isFailurePhrase) candidate.web_core_products = intro;
    let newTags = [];
    if (llm.display) {
      newTags = strTrim(llm.display)
        .split(/[,，、]/g)
        .map((x) => x.trim())
        .filter(Boolean);
    }
    if (!newTags.length && llm.tagsJson) newTags = parseTagsFromJson(llm.tagsJson);
    if (newTags.length) candidate.tags = mergeTagArrays(candidate.tags || [], newTags);
    const after = effectiveIntroLen(candidate);
    return { enriched: after > before, introLen: after, tagCount: (candidate.tags || []).length };
  } catch (e) {
    logCompetitorRun(runId, 'S5_pre_enrich', `联网补齐失败 ${name}: ${e.message}`);
    return { enriched: false, error: e.message };
  }
}

module.exports = {
  enrichCompetitorDisplayFields,
  clearEnrichCache,
  resolveSubFundNamesFromIpo,
  loadInternalDisplayFields,
  effectiveIntroLen,
  preValidateWebEnrichCandidate,
  pickPreferredProductIntro,
};
