const db = require('../../db');
const { AI_APPLICATION_TYPE_COMPETITOR, AI_USAGE_TYPE_COMPETITOR_MATCH } = require('../竞品分析/constants');
const { llmInvoke, LlmSearchRequiredError } = require('../llm/llmInvoke');
const { extractJsonObject } = require('./competitorMatchUtils');
const { logCompetitorAi } = require('./competitorAnalysisLogger');

const APP_TYPE_COMPETITOR = AI_APPLICATION_TYPE_COMPETITOR;
const USAGE_TYPE = AI_USAGE_TYPE_COMPETITOR_MATCH;

/** 截断 prompt 内容，防止超出模型上下文窗口 */
function truncatePromptContent(text, maxLen = 5000) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\n...(truncated, original length=' + s.length + ')';
}

const PROMPTS = {
  pair_similarity: {
    system: `你是企业产品对标分析助手。根据目标企业与候选企业的产品简介与业务介绍，评估产品/业务相似度。
仅输出 JSON：{"similarity_score":0-100的整数,"rationale":"一句中文"}
禁止 Markdown 与 JSON 外文字。`,
    buildUser: (target, candidate) =>
      `目标企业：\n${JSON.stringify(target, null, 0)}\n\n候选企业：\n${JSON.stringify(candidate, null, 0)}`,
  },
  web_discover: {
    system: `你是竞品研究助理。在允许联网时优先用联网检索；若无法联网则根据公开知识与检索词，列出与目标企业存在直接竞争关系的公司（同类产品/服务），不是上下游。
仅输出 JSON：{"candidates":[{"company_name":"","unified_credit_code":"","is_listed":true/false,"core_products":"","business_domain":"","ai_relevance_score":0}]}
is_listed：新三板、拟上市、A股/港股(含仅H股)等已上市或处于上市进程为 true；无法判断则为 false。
禁止 Markdown。候选不超过 20 条。`,
    buildUser: (profile, keywords, excludeNames) =>
      `目标画像：\n${JSON.stringify(profile, null, 0)}\n\n检索词：${JSON.stringify(keywords)}\n\n排除公司：${JSON.stringify(excludeNames || [])}`,
  },
  validate: {
    system: `你是竞品校验助手。判断候选是否为目标的直接竞品。
仅输出 JSON：{"is_competitor":true/false,"is_listed":true/false,"industry_match":true/false,"core_overlap_percent":0-100,"is_upstream_downstream":false,"validated_score":0-100,"reject_reason":""}
is_listed：新三板、拟上市、A股/港股(含仅H股)等已上市或处于上市进程为 true；无法判断则为 false。`,
    buildUser: (target, candidate) =>
      `目标：\n${JSON.stringify(target, null, 0)}\n\n候选：\n${JSON.stringify(candidate, null, 0)}`,
  },
};

/** 历史 ENUM 名，迁移前可能仍写在库中 */
const LEGACY_APP_TYPE_COMPETITOR = 'project_sourcing_competitor';

async function getActiveCompetitorModelConfig() {
  const rows = await db.query(
    `SELECT * FROM ai_model_config
     WHERE F_DeleteMark = 0 AND is_active = 1
       AND usage_type = ?
       AND application_type IN (?, ?)
       AND api_key IS NOT NULL AND TRIM(api_key) != ''
     ORDER BY
       CASE application_type WHEN ? THEN 0 ELSE 1 END,
       F_LastModifyTime DESC
     LIMIT 1`,
    [USAGE_TYPE, APP_TYPE_COMPETITOR, LEGACY_APP_TYPE_COMPETITOR, APP_TYPE_COMPETITOR]
  );
  if (rows.length) return rows[0];

  const diag = await db.query(
    `SELECT F_Id AS id, config_name, application_type, usage_type, is_active,
            (api_key IS NOT NULL AND TRIM(api_key) != '') AS has_api_key
     FROM ai_model_config
     WHERE F_DeleteMark = 0
       AND (usage_type = ? OR application_type IN (?, ?))
     ORDER BY F_LastModifyTime DESC
     LIMIT 8`,
    [USAGE_TYPE, APP_TYPE_COMPETITOR, LEGACY_APP_TYPE_COMPETITOR]
  );
  if (diag.length) {
    console.warn(
      '[competitorAnalysisAi] 未命中可用竞品模型（须 is_active=1、usage_type=competitor_match、application_type=competitor_analysis 且 api_key 非空）。库内相关行:',
      JSON.stringify(diag)
    );
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableLlmError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('throttl') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('econnaborted')
  );
}

/** 独立请求，无多轮上下文。
 * @param {{ onSearchUnsupported?: () => void }} [opts]
 */
async function invokeCompetitorChat(systemContent, userContent, { enableSearch = false, timeout, onSearchUnsupported } = {}) {
  const config = await getActiveCompetitorModelConfig();
  if (!config || !String(config.api_key || '').trim()) {
    throw new Error(
      '未配置可用的竞品分析大模型：请在「AI 模型配置」新增或编辑一条——应用类型=竞品分析应用(competitor_analysis)、使用类型=竞品匹配(competitor_match)、已启用，并填写有效 API Key（编辑时勿留空密钥）。若刚改过类型请重启后端以执行库表迁移。'
    );
  }

  const wantSearch =
    enableSearch && String(process.env.COMPETITOR_WEB_FORCE_NO_SEARCH || '').trim() !== '1';
  const userTrimmed = truncatePromptContent(String(userContent || '').trim());
  const defaultTimeout = wantSearch
    ? parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '180000', 10) || 180000
    : parseInt(process.env.COMPETITOR_LLM_TIMEOUT_MS || '90000', 10) || 90000;

  const maxAttempts = wantSearch
    ? Math.max(1, parseInt(process.env.COMPETITOR_WEB_RETRIES || '2', 10) || 2)
    : Math.max(1, parseInt(process.env.COMPETITOR_LLM_RETRIES || '3', 10) || 3);

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await llmInvoke(config, {
        systemContent: String(systemContent || '').trim(),
        userContent: userTrimmed,
        wantSearch,
        searchRequired: wantSearch,
        timeout: timeout ?? defaultTimeout,
        logPrefix: '[projectSourcingCompetitorAi]',
      });
      return result.content;
    } catch (err) {
      lastErr = err;
      if (wantSearch && err instanceof LlmSearchRequiredError) {
        console.warn(
          '[projectSourcingCompetitorAi] 联网调用失败（本场景要求联网）:',
          err.message
        );
        onSearchUnsupported?.();
      }
      if (attempt < maxAttempts && isRetryableLlmError(lastErr)) {
        await sleep(800 * attempt);
        continue;
      }
      throw new Error(err.message || String(err));
    }
  }
  throw new Error(lastErr?.message || String(lastErr));
}

async function scorePairSimilarity(targetSlice, candidateSlice, logCtx = {}) {
  const { runId, candidateName } = logCtx;
  const label = candidateName || candidateSlice?.display_name || '候选';
  logCompetitorAi(runId, 'pair_similarity', `开始 ${label}`);
  try {
    const p = PROMPTS.pair_similarity;
    const raw = await invokeCompetitorChat(p.system, p.buildUser(targetSlice, candidateSlice), {
      enableSearch: false,
    });
    const parsed = extractJsonObject(raw);
    const n = parsed && parsed.similarity_score != null ? Number(parsed.similarity_score) : NaN;
    if (Number.isFinite(n)) {
      const score = Math.min(100, Math.max(0, Math.round(n)));
      logCompetitorAi(runId, 'pair_similarity', `完成 ${label} score=${score}`, parsed?.rationale);
      return score;
    }
  } catch (e) {
    logCompetitorAi(runId, 'pair_similarity', `失败 ${label}，回退文本重叠: ${e.message}`);
  }
  const introA = [targetSlice.product_intro, targetSlice.qcc_intro_effective].filter(Boolean).join('\n');
  const introB = [candidateSlice.product_intro, candidateSlice.qcc_intro_effective].filter(Boolean).join('\n');
  const fallback = Math.round(textOverlapFallback(introA, introB) * 100);
  logCompetitorAi(runId, 'pair_similarity', `文本重叠(降级) ${label} score=${fallback}（AI 未返回有效分数，使用 bigram 文本重叠近似，仅供参考）`);
  return { score: fallback, degraded: true };
}

function textOverlapFallback(a, b) {
  const { textOverlapScore } = require('./competitorMatchUtils');
  return textOverlapScore(a, b);
}

async function discoverWebCompetitors(profile, keywords, excludeNames, logCtx = {}) {
  const { runId } = logCtx;
  const cfg = await getActiveCompetitorModelConfig();
  const webTimeout = parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '180000', 10) || 180000;
  const noSearchTimeout = Math.max(
    webTimeout,
    parseInt(process.env.COMPETITOR_WEB_NO_SEARCH_TIMEOUT_MS || '300000', 10) || 300000
  );
  let searchUnsupportedDegraded = false;
  logCompetitorAi(runId, 'web_discover', '开始联网发现', {
    keywords,
    exclude_count: (excludeNames || []).length,
    target: profile?.display_name,
    model_name: cfg?.model_name,
    timeout_ms: webTimeout,
    no_search_timeout_ms: noSearchTimeout,
    retries: parseInt(process.env.COMPETITOR_WEB_RETRIES || '2', 10) || 2,
    note:
      '若模型不支持 enable_search，将降级为无联网 chat；真正联网仅当请求体带 enable_search 且接口成功。',
  });
  const p = PROMPTS.web_discover;
  const raw = await invokeCompetitorChat(p.system, p.buildUser(profile, keywords, excludeNames), {
    enableSearch: true,
    timeout: webTimeout,
    onSearchUnsupported: () => {
      searchUnsupportedDegraded = true;
    },
  });
  const parsed = extractJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.candidates)) {
    if (!raw || (typeof raw === 'string' && !raw.trim())) {
      throw new Error(`竞品发现 AI 返回空响应（search_degraded=${searchUnsupportedDegraded}），无法区分"无竞品"与"调用失败"`);
    }
    logCompetitorAi(runId, 'web_discover', '无有效 candidates JSON', {
      used_enable_search: !searchUnsupportedDegraded,
      search_degraded_no_api: searchUnsupportedDegraded,
    });
    return {
      candidates: [],
      meta: {
        used_enable_search: false,
        search_degraded: searchUnsupportedDegraded,
        model_name: cfg?.model_name || null,
      },
    };
  }
  const list = parsed.candidates.slice(0, 20);
  logCompetitorAi(runId, 'web_discover', `完成，候选 ${list.length} 条`, {
    names: list.map((x) => x.company_name).filter(Boolean).slice(0, 10),
    used_enable_search: !searchUnsupportedDegraded,
    search_degraded_no_api: searchUnsupportedDegraded,
  });
  return {
    candidates: list,
    meta: {
      used_enable_search: !searchUnsupportedDegraded,
      search_degraded: searchUnsupportedDegraded,
      model_name: cfg?.model_name || null,
    },
  };
}

async function validateCandidate(targetSlice, candidateSlice, logCtx = {}) {
  const { runId, candidateName } = logCtx;
  const label = candidateName || candidateSlice?.display_name || '候选';
  logCompetitorAi(runId, 'validate', `开始 ${label}`);
  try {
    const p = PROMPTS.validate;
    const raw = await invokeCompetitorChat(p.system, p.buildUser(targetSlice, candidateSlice), {
      enableSearch: false,
    });
    const parsed = extractJsonObject(raw);
    if (parsed && typeof parsed === 'object') {
      logCompetitorAi(runId, 'validate', `完成 ${label}`, {
        is_competitor: parsed.is_competitor,
        validated_score: parsed.validated_score,
        is_upstream_downstream: parsed.is_upstream_downstream,
        reject_reason: parsed.reject_reason,
      });
      return parsed;
    }
  } catch (e) {
    logCompetitorAi(runId, 'validate', `失败 ${label}，标记为非竞品: ${e.message}`);
    return {
      is_competitor: false,
      industry_match: false,
      core_overlap_percent: 0,
      is_upstream_downstream: false,
      validated_score: 0,
      reject_reason: `AI 校验失败: ${e.message}`,
      ai_failed: true,
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    logCompetitorAi(runId, 'validate', `空响应 ${label}，标记为非竞品`);
    return {
      is_competitor: false,
      industry_match: false,
      core_overlap_percent: 0,
      is_upstream_downstream: false,
      validated_score: 0,
      reject_reason: 'AI 返回空响应或无法解析',
      ai_failed: true,
    };
  }
}

module.exports = {
  getActiveCompetitorModelConfig,
  invokeCompetitorChat,
  scorePairSimilarity,
  discoverWebCompetitors,
  validateCandidate,
};
