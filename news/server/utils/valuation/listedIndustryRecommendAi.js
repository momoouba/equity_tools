'use strict';

const db = require('../../db');
const { llmInvoke } = require('../llm/llmInvoke');
const { extractJsonObject } = require('../competitor-analysis/competitorMatchUtils');
const C = require('./constants');
const {
  PROMPT_TYPE_BUSINESS_REASON,
  PROMPT_TYPE_LISTED_PROPOSE,
  loadValuationRecommendPromptBundle,
  renderUserPrompt,
  jsonBlock,
  sliceTargetForAi,
  sliceCandidateForAi,
} = require('./listedIndustryRecommendPrompt');

const AI_UNAVAILABLE = '业务理由暂不可用';
const CONCURRENCY = Math.max(1, parseInt(process.env.VALUATION_RECOMMEND_AI_CONCURRENCY || '3', 10) || 3);

async function getBoundModel(id) {
  if (!id) return null;
  const rows = await db.query(
    `SELECT * FROM ai_model_config
     WHERE F_Id = ? AND F_DeleteMark = 0 AND is_active = 1
       AND api_key IS NOT NULL AND TRIM(api_key) != ''
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getFallbackValuationModel() {
  const rows = await db.query(
    `SELECT * FROM ai_model_config
     WHERE F_DeleteMark = 0 AND is_active = 1
       AND application_type = ? AND usage_type = ?
       AND api_key IS NOT NULL AND TRIM(api_key) != ''
     ORDER BY F_LastModifyTime DESC
     LIMIT 1`,
    [C.AI_APPLICATION_TYPE_VALUATION, C.AI_USAGE_TYPE_VALUATION]
  );
  return rows[0] || null;
}

async function resolveValuationRecommendModel(bundle) {
  const bound = await getBoundModel(bundle?.ai_model_config_id);
  if (bound) return bound;
  return getFallbackValuationModel();
}

async function mapPool(items, limit, fn) {
  const ret = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      ret[idx] = await fn(items[idx], idx);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return ret;
}

async function enrichOne(config, bundle, profile, candidate) {
  const userContent = renderUserPrompt(bundle.userTemplate, {
    TARGET_JSON: jsonBlock(sliceTargetForAi(profile)),
    CANDIDATE_JSON: jsonBlock(sliceCandidateForAi(candidate)),
    RULE_REASON_JSON: jsonBlock(candidate.reason || { summary: candidate.match_reason, score: candidate.score }),
  });
  const result = await llmInvoke(config, {
    systemContent: bundle.system,
    userContent,
    wantSearch: false,
    searchRequired: false,
    logPrefix: '[valuationRecommendAi]',
    timeout: 60000,
  });
  const text = typeof result === 'string' ? result : result?.content || result?.text || '';
  const parsed = extractJsonObject(text);
  const reason = parsed?.business_reason != null ? String(parsed.business_reason).trim() : '';
  const confidence = ['high', 'medium', 'low'].includes(parsed?.confidence) ? parsed.confidence : 'medium';
  if (!reason) {
    return { business_reason: AI_UNAVAILABLE, business_confidence: 'low', ai_ok: false };
  }
  return { business_reason: reason, business_confidence: confidence, ai_ok: true };
}

function hasUsableBusinessReason(candidate) {
  const reason = String(candidate?.business_reason || '').trim();
  return !!(reason && reason !== AI_UNAVAILABLE);
}

function attachBusinessDimension(candidate, reason, confidence) {
  return {
    ...candidate,
    business_reason: reason,
    business_confidence: confidence || candidate.business_confidence || 'medium',
    reason: {
      ...(candidate.reason || {}),
      dimensions: { ...(candidate.reason?.dimensions || {}), business: reason },
    },
  };
}

function parseProposedCandidates(parsed) {
  const raw = Array.isArray(parsed?.candidates)
    ? parsed.candidates
    : Array.isArray(parsed)
      ? parsed
      : [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const stock_name = String(item.stock_name || item.name || '').trim();
    const stock_code = String(item.stock_code || item.code || '').trim();
    if (!stock_name && !stock_code) continue;
    const key = `${stock_code}|${stock_name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const confidence = ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'medium';
    out.push({
      stock_code,
      stock_name,
      unified_credit_code: String(item.unified_credit_code || '').replace(/\s+/g, '').trim(),
      business_reason: String(item.business_reason || item.reason || '').trim(),
      confidence,
    });
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * AI 提名境内上市可比；不打分。核实与规则分在 recommend 侧完成。
 */
async function proposeListedPeers(profile, { limit = 20, excludeCodes = [], excludeCredits = [] } = {}) {
  const cap = Math.min(20, Math.max(8, Number(limit) || 20));
  let bundle;
  let config;
  try {
    bundle = await loadValuationRecommendPromptBundle(PROMPT_TYPE_LISTED_PROPOSE);
    config = await resolveValuationRecommendModel(bundle);
  } catch (e) {
    return { candidates: [], status: 'failed', message: e.message, nominated: 0 };
  }
  if (!config) {
    return { candidates: [], status: 'failed', message: '无可用项目估值模型', nominated: 0 };
  }
  try {
    const userContent = renderUserPrompt(bundle.userTemplate, {
      TARGET_JSON: jsonBlock(sliceTargetForAi(profile)),
      EXCLUDE_JSON: jsonBlock({
        stock_codes: excludeCodes,
        unified_credit_codes: excludeCredits,
        display_name: profile?.display_name || null,
      }),
      LIMIT: String(cap),
    });
    const result = await llmInvoke(config, {
      systemContent: bundle.system,
      userContent,
      wantSearch: false,
      searchRequired: false,
      logPrefix: '[valuationListedPropose]',
      timeout: 120000,
    });
    const text = typeof result === 'string' ? result : result?.content || result?.text || '';
    const parsed = extractJsonObject(text);
    const candidates = parseProposedCandidates(parsed);
    if (!candidates.length) {
      return { candidates: [], status: 'failed', message: 'AI 未返回可核验候选', nominated: 0 };
    }
    return { candidates, status: 'success', message: null, nominated: candidates.length };
  } catch (e) {
    return { candidates: [], status: 'failed', message: e.message, nominated: 0 };
  }
}

/**
 * 对预览列表补业务理由。已有 AI 提名理由的行跳过。整版失败时仍返回原候选。
 */
async function enrichBusinessReasons(profile, candidates) {
  if (!candidates?.length) {
    return { candidates: [], ai_status: 'skipped', ai_message: null };
  }
  const prepared = candidates.map((c) => (
    hasUsableBusinessReason(c)
      ? attachBusinessDimension(c, String(c.business_reason).trim(), c.business_confidence)
      : { ...c }
  ));
  const need = prepared.filter((c) => !hasUsableBusinessReason(c));
  if (!need.length) {
    return { candidates: prepared, ai_status: 'success', ai_message: null };
  }
  let bundle;
  let config;
  try {
    bundle = await loadValuationRecommendPromptBundle(PROMPT_TYPE_BUSINESS_REASON);
    config = await resolveValuationRecommendModel(bundle);
  } catch (e) {
    return {
      candidates: prepared.map((c) => (
        hasUsableBusinessReason(c) ? c : attachBusinessDimension(c, AI_UNAVAILABLE, 'low')
      )),
      ai_status: 'failed',
      ai_message: e.message,
    };
  }
  if (!config) {
    return {
      candidates: prepared.map((c) => (
        hasUsableBusinessReason(c) ? c : attachBusinessDimension(c, AI_UNAVAILABLE, 'low')
      )),
      ai_status: 'failed',
      ai_message: '无可用项目估值模型',
    };
  }

  let failCount = 0;
  const enrichedNeed = await mapPool(need, CONCURRENCY, async (cand) => {
    try {
      const ai = await enrichOne(config, bundle, profile, cand);
      if (!ai.ai_ok) failCount += 1;
      return attachBusinessDimension(cand, ai.business_reason, ai.business_confidence);
    } catch (e) {
      failCount += 1;
      return attachBusinessDimension(cand, AI_UNAVAILABLE, 'low');
    }
  });
  const byKey = new Map(enrichedNeed.map((c) => [String(c.stock_code), c]));
  const out = prepared.map((c) => (hasUsableBusinessReason(c) ? c : byKey.get(String(c.stock_code)) || c));
  const ai_status = failCount === need.length ? 'failed' : failCount ? 'partial' : 'success';
  return {
    candidates: out,
    ai_status,
    ai_message: ai_status === 'failed' ? '业务理由暂不可用' : null,
  };
}

module.exports = {
  enrichBusinessReasons,
  proposeListedPeers,
  resolveValuationRecommendModel,
  AI_UNAVAILABLE,
};
