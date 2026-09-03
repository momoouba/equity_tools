const db = require('../../db');
const { AI_APPLICATION_TYPE_COMPETITOR, AI_USAGE_TYPE_COMPETITOR_MATCH } = require('../competitor-analysis/constants');
const { llmInvoke, LlmSearchRequiredError } = require('../llm/llmInvoke');
const { extractJsonObject } = require('./competitorMatchUtils');
const { normalizeCompetitorValidation } = require('./competitorTypeUtils');
const { logCompetitorAi } = require('./competitorAnalysisLogger');
const {
  PROMPT_TYPES,
  loadCompetitorPromptBundle,
  renderCompetitorUserPrompt,
} = require('./competitorAnalysisPromptService');

const APP_TYPE_COMPETITOR = AI_APPLICATION_TYPE_COMPETITOR;
const USAGE_TYPE = AI_USAGE_TYPE_COMPETITOR_MATCH;

/** 截断 prompt 内容，防止超出模型上下文窗口 */
function truncatePromptContent(text, maxLen = 5000) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '\n...(truncated, original length=' + s.length + ')';
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 0);
}

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
  const code = String(err?.code || '').toUpperCase();
  return (
    msg.includes('throttl') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('524') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('econnaborted') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  );
}

function getWebRetrySleepMs(err, attempt) {
  const msg = String(err?.message || err || '');
  if (msg.includes('524')) {
    return Math.max(
      30000,
      parseInt(process.env.COMPETITOR_WEB_524_BACKOFF_MS || '120000', 10) || 120000
    );
  }
  return 800 * attempt;
}

/** 独立请求，无多轮上下文。
 * @param {{ allowDegradedFallback?: boolean }} [opts]
 */
async function invokeCompetitorChat(
  systemContent,
  userContent,
  { enableSearch = false, timeout, allowDegradedFallback = false, returnMeta = false } = {}
) {
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
    ? parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '600000', 10) || 600000
    : parseInt(process.env.COMPETITOR_LLM_TIMEOUT_MS || '90000', 10) || 90000;

  const maxAttempts = wantSearch
    ? Math.max(1, parseInt(process.env.COMPETITOR_WEB_RETRIES || '3', 10) || 3)
    : Math.max(1, parseInt(process.env.COMPETITOR_LLM_RETRIES || '3', 10) || 3);

  const wrapResult = (content, meta = {}) => (returnMeta ? { content, ...meta } : content);

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
      return wrapResult(result.content, {
        usedWebSearch: !!(result.used_web_search || result.used_enable_search),
        searchDegraded: !!result.search_degraded,
      });
    } catch (err) {
      lastErr = err;
      if (wantSearch && err instanceof LlmSearchRequiredError) {
        console.warn(
          '[projectSourcingCompetitorAi] 联网调用失败（本场景要求联网）:',
          err.message
        );
      }
      if (attempt < maxAttempts && isRetryableLlmError(lastErr)) {
        const sleepMs = getWebRetrySleepMs(lastErr, attempt);
        console.warn(
          `[projectSourcingCompetitorAi] 联网/LLM 调用失败，${sleepMs}ms 后重试 (${attempt}/${maxAttempts})：${err.message}`
        );
        await sleep(sleepMs);
        continue;
      }
      break;
    }
  }

  if (allowDegradedFallback && wantSearch) {
    const noSearchTimeout = Math.max(
      timeout ?? defaultTimeout,
      parseInt(process.env.COMPETITOR_WEB_NO_SEARCH_TIMEOUT_MS || '300000', 10) || 300000
    );
    console.warn(
      `[projectSourcingCompetitorAi] 联网 ${maxAttempts} 次仍失败，降级为无联网单次请求（timeout=${noSearchTimeout}ms）`
    );
    try {
      const result = await llmInvoke(config, {
        systemContent: String(systemContent || '').trim(),
        userContent: userTrimmed,
        wantSearch: false,
        searchRequired: false,
        timeout: noSearchTimeout,
        logPrefix: '[projectSourcingCompetitorAi]',
      });
      return wrapResult(result.content, {
        usedWebSearch: false,
        searchDegraded: true,
      });
    } catch (degradedErr) {
      throw new Error(degradedErr.message || String(degradedErr));
    }
  }

  throw new Error(lastErr?.message || String(lastErr));
}

function withStrategyAppendix(systemPrompt, strategyAppendix) {
  const appendix = strTrim(strategyAppendix);
  if (!appendix) return systemPrompt;
  return `${systemPrompt}\n\n${appendix}`;
}

function strTrim(v) {
  return v == null ? '' : String(v).trim();
}

async function scorePairSimilarity(targetSlice, candidateSlice, logCtx = {}) {
  const { runId, candidateName, strategyAppendix } = logCtx;
  const label = candidateName || candidateSlice?.display_name || '候选';
  logCompetitorAi(runId, 'pair_similarity', `开始 ${label}`);
  try {
    const bundle = await loadCompetitorPromptBundle(PROMPT_TYPES.PAIR_SIMILARITY);
    const system = withStrategyAppendix(bundle.system, strategyAppendix);
    const userContent = renderCompetitorUserPrompt(bundle.userTemplate, {
      TARGET_JSON: jsonBlock(targetSlice),
      CANDIDATE_JSON: jsonBlock(candidateSlice),
    });
    const raw = await invokeCompetitorChat(system, userContent, {
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

async function discoverWebCompetitorsViaDashScope(system, userContent, logCtx = {}) {
  const { runId } = logCtx;
  const rows = await db.query(
    `SELECT * FROM ai_model_config
     WHERE F_DeleteMark = 0 AND is_active = 1
       AND application_type IN ('project_sourcing_analysis', 'financing_ai_enrich', 'project_sourcing')
       AND api_key IS NOT NULL AND TRIM(api_key) != ''
     ORDER BY
       CASE application_type
         WHEN 'project_sourcing_analysis' THEN 0
         WHEN 'financing_ai_enrich' THEN 1
         ELSE 2
       END,
       F_LastModifyTime DESC
     LIMIT 1`
  );
  const config = rows[0];
  if (!config) {
    logCompetitorAi(runId, 'web_discover_dashscope', '无可用融资/DashScope 模型配置，跳过备份');
    return null;
  }
  const timeout = Math.min(
    parseInt(process.env.COMPETITOR_WEB_DASHSCOPE_TIMEOUT_MS || '180000', 10) || 180000,
    parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '600000', 10) || 600000
  );
  logCompetitorAi(runId, 'web_discover_dashscope', '启用 DashScope 联网备份', {
    model_name: config.model_name,
    timeout_ms: timeout,
  });
  const llmOut = await llmInvoke(config, {
    systemContent: String(system || '').trim(),
    userContent: String(userContent || '').trim(),
    wantSearch: true,
    searchRequired: true,
    timeout,
    logPrefix: '[competitorWebDashScopeFallback]',
  });
  const parsed = extractJsonObject(llmOut?.content);
  if (!parsed || !Array.isArray(parsed.candidates)) {
    logCompetitorAi(runId, 'web_discover_dashscope', '备份无有效 candidates JSON');
    return {
      candidates: [],
      meta: {
        used_enable_search: !!(llmOut?.used_web_search || llmOut?.used_enable_search),
        search_degraded: false,
        model_name: config.model_name || null,
        dashscope_fallback: true,
      },
    };
  }
  const list = parsed.candidates.slice(0, 20);
  logCompetitorAi(runId, 'web_discover_dashscope', `备份完成，候选 ${list.length} 条`, {
    names: list.map((x) => x.company_name).filter(Boolean).slice(0, 10),
  });
  return {
    candidates: list,
    meta: {
      used_enable_search: !!(llmOut?.used_web_search || llmOut?.used_enable_search),
      search_degraded: false,
      model_name: config.model_name || null,
      dashscope_fallback: true,
    },
  };
}

function dashScopeFallbackEnabled() {
  return String(process.env.COMPETITOR_WEB_DASHSCOPE_FALLBACK || '1').trim() !== '0';
}

async function discoverWebCompetitors(profile, keywords, excludeNames, logCtx = {}) {
  const { runId, strategyAppendix, relaxListedMandate } = logCtx;
  const cfg = await getActiveCompetitorModelConfig();
  const webTimeout = parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '600000', 10) || 600000;
  const noSearchTimeout = Math.max(
    webTimeout,
    parseInt(process.env.COMPETITOR_WEB_NO_SEARCH_TIMEOUT_MS || '300000', 10) || 300000
  );
  let searchUnsupportedDegraded = false;
  let usedWebSearch = false;
  logCompetitorAi(runId, 'web_discover', '开始联网发现', {
    keywords,
    exclude_count: (excludeNames || []).length,
    target: profile?.display_name,
    model_name: cfg?.model_name,
    timeout_ms: webTimeout,
    no_search_timeout_ms: noSearchTimeout,
    retries: parseInt(process.env.COMPETITOR_WEB_RETRIES || '2', 10) || 2,
    relax_listed_mandate: !!relaxListedMandate,
    dashscope_fallback: dashScopeFallbackEnabled(),
    note:
      '联网机制：由 AI 模型配置的 web_search_mode 驱动（如 Anthropic web_search / OpenAI web_search_tool）；模型按提示词中的检索词与目标画像自主检索，非固定搜索引擎 API。',
  });
  const bundle = await loadCompetitorPromptBundle(PROMPT_TYPES.WEB_DISCOVER);
  let system = withStrategyAppendix(bundle.system, strategyAppendix);
  if (relaxListedMandate) {
    system = withStrategyAppendix(
      system,
      `# 发现配额覆盖（本目标生效）
- **取消**「境内上市公司硬性至少 3 家」要求；不得为凑上市名额塞入工业人形/纯大脑/晚期独角兽。
- 优先：同场景、同产品形态、相近融资阶段的未上市或早期公司；品牌名可先返回再核验工商。
- 仍鼓励返回可核验信用代码的境内公司，但不因缺代码整条丢弃极早期竞品。`
    );
  }
  const userContent = renderCompetitorUserPrompt(bundle.userTemplate, {
    TARGET_PROFILE_JSON: jsonBlock(profile),
    KEYWORDS_JSON: jsonBlock(keywords),
    EXCLUDE_NAMES_JSON: jsonBlock(excludeNames || []),
  });

  let primaryErr = null;
  let list = [];
  let webMeta = {
    used_enable_search: false,
    search_degraded: false,
    model_name: cfg?.model_name || null,
    relax_listed_mandate: !!relaxListedMandate,
  };

  try {
    const invokeRes = await invokeCompetitorChat(system, userContent, {
      enableSearch: true,
      timeout: webTimeout,
      allowDegradedFallback: true,
      returnMeta: true,
    });
    const raw = invokeRes.content;
    searchUnsupportedDegraded = invokeRes.searchDegraded === true;
    usedWebSearch = invokeRes.usedWebSearch === true;
    webMeta = {
      used_enable_search: usedWebSearch,
      search_degraded: searchUnsupportedDegraded,
      model_name: cfg?.model_name || null,
      relax_listed_mandate: !!relaxListedMandate,
    };
    const parsed = extractJsonObject(raw);
    if (!parsed || !Array.isArray(parsed.candidates)) {
      if (!raw || (typeof raw === 'string' && !raw.trim())) {
        primaryErr = new Error(
          `竞品发现 AI 返回空响应（search_degraded=${searchUnsupportedDegraded}），无法区分"无竞品"与"调用失败"`
        );
      } else {
        logCompetitorAi(runId, 'web_discover', '无有效 candidates JSON', {
          used_enable_search: usedWebSearch,
          search_degraded_no_api: searchUnsupportedDegraded,
        });
      }
    } else {
      list = parsed.candidates.slice(0, 20);
    }
  } catch (e) {
    primaryErr = e;
    logCompetitorAi(runId, 'web_discover', `主路径失败: ${e.message}`);
  }

  const needFallback =
    dashScopeFallbackEnabled() &&
    (primaryErr || !list.length || searchUnsupportedDegraded);
  if (needFallback) {
    try {
      const fb = await discoverWebCompetitorsViaDashScope(system, userContent, logCtx);
      if (fb && Array.isArray(fb.candidates) && fb.candidates.length) {
        list = fb.candidates;
        webMeta = {
          ...webMeta,
          ...(fb.meta || {}),
          primary_error: primaryErr ? String(primaryErr.message || primaryErr) : null,
          primary_empty_or_degraded: !primaryErr,
        };
        primaryErr = null;
      } else if (fb) {
        webMeta = {
          ...webMeta,
          ...(fb.meta || {}),
          primary_error: primaryErr ? String(primaryErr.message || primaryErr) : null,
        };
      }
    } catch (fbErr) {
      logCompetitorAi(runId, 'web_discover_dashscope', `备份失败: ${fbErr.message}`);
      webMeta.dashscope_fallback_error = fbErr.message;
    }
  }

  if (primaryErr && !list.length) throw primaryErr;

  logCompetitorAi(runId, 'web_discover', `完成，候选 ${list.length} 条`, {
    names: list.map((x) => x.company_name).filter(Boolean).slice(0, 10),
    used_enable_search: webMeta.used_enable_search === true,
    search_degraded_no_api: webMeta.search_degraded === true,
    dashscope_fallback: webMeta.dashscope_fallback === true,
  });
  return {
    candidates: list,
    meta: webMeta,
  };
}

const LISTED_MANDATE_USER_SUFFIX = `

【A股/北交所上市硬性要求（仅补足境内名额，境外不计入）】
本次检索须专门补足中国大陆境内上市公司：上交所（SSE）、深交所（SZSE）、北交所（BSE）、新三板（NEEQ）。
必须返回至少 3 家 is_listed=true 且 listing_market 为 sse/szse/bse/neeq 的公司，按 ai_relevance_score 降序（最相似优先）。
每家企业须提供 18 位统一社会信用代码与**当前最新工商注册全称**（勿用曾用名）。
禁止用境外企业、港股（listing_market=hk）、美股凑「境内上市至少 3 家」的名额；境外竞品可另列但不计入上述 3 家。`;

/** 专项联网：补足国内 A 股/北交所/新三板上市公司（至少 3 家） */
async function discoverDomesticListedCompetitors(profile, keywords, excludeNames, logCtx = {}) {
  const { runId, strategyAppendix } = logCtx;
  const cfg = await getActiveCompetitorModelConfig();
  const webTimeout = parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '600000', 10) || 600000;
  let searchUnsupportedDegraded = false;
  logCompetitorAi(runId, 'web_discover_listed', '开始 A股/北交所上市专项联网', {
    keywords,
    exclude_count: (excludeNames || []).length,
    target: profile?.display_name,
    model_name: cfg?.model_name,
    min_domestic_listed: parseInt(process.env.COMPETITOR_MIN_DOMESTIC_LISTED || '5', 10) || 5,
  });
  const bundle = await loadCompetitorPromptBundle(PROMPT_TYPES.WEB_DISCOVER);
  const system = withStrategyAppendix(bundle.system, strategyAppendix);
  const userContent =
    renderCompetitorUserPrompt(bundle.userTemplate, {
      TARGET_PROFILE_JSON: jsonBlock(profile),
      KEYWORDS_JSON: jsonBlock(keywords),
      EXCLUDE_NAMES_JSON: jsonBlock(excludeNames || []),
    }) + LISTED_MANDATE_USER_SUFFIX;
  const listedInvokeRes = await invokeCompetitorChat(system, userContent, {
    enableSearch: true,
    timeout: webTimeout,
    allowDegradedFallback: true,
    returnMeta: true,
  });
  const raw = listedInvokeRes.content;
  searchUnsupportedDegraded = listedInvokeRes.searchDegraded === true;
  const usedWebSearch = listedInvokeRes.usedWebSearch === true;
  const parsed = extractJsonObject(raw);
  if (!parsed || !Array.isArray(parsed.candidates)) {
    logCompetitorAi(runId, 'web_discover_listed', '无有效 candidates JSON', {
      search_degraded: searchUnsupportedDegraded,
    });
    return {
      candidates: [],
      meta: {
        used_enable_search: usedWebSearch,
        search_degraded: searchUnsupportedDegraded,
        model_name: cfg?.model_name || null,
      },
    };
  }
  const list = parsed.candidates.slice(0, 20);
  logCompetitorAi(runId, 'web_discover_listed', `完成，候选 ${list.length} 条`, {
    listed_names: list
      .filter((x) => x.is_listed)
      .map((x) => x.company_name)
      .filter(Boolean)
      .slice(0, 8),
  });
  return {
    candidates: list,
    meta: {
      used_enable_search: usedWebSearch,
      search_degraded: searchUnsupportedDegraded,
      model_name: cfg?.model_name || null,
    },
  };
}

async function validateCandidate(targetSlice, candidateSlice, logCtx = {}) {
  const { runId, candidateName, strategyAppendix } = logCtx;
  const label = candidateName || candidateSlice?.display_name || '候选';
  logCompetitorAi(runId, 'validate', `开始 ${label}`);
  try {
    const bundle = await loadCompetitorPromptBundle(PROMPT_TYPES.VALIDATE);
    const system = withStrategyAppendix(bundle.system, strategyAppendix);
    const userContent = renderCompetitorUserPrompt(bundle.userTemplate, {
      TARGET_JSON: jsonBlock(targetSlice),
      CANDIDATE_JSON: jsonBlock(candidateSlice),
    });
    const raw = await invokeCompetitorChat(system, userContent, {
      enableSearch: false,
    });
    const parsed = extractJsonObject(raw);
    if (parsed && typeof parsed === 'object') {
    const normalized = normalizeCompetitorValidation(parsed, {
      display_name: candidateSlice?.display_name,
      candidateProductIntro: candidateSlice?.product_intro,
      candidateQccIntro: candidateSlice?.qcc_intro_effective,
      candidateTags: candidateSlice?.tags,
      webCoreProducts: candidateSlice?.web_core_products,
      candidateFinancingText:
        logCtx.candidateFinancingText || candidateSlice?.financing_amount_text || null,
      candidateLatestRound: logCtx.candidateLatestRound || candidateSlice?.latest_round || null,
      subjectTrackHint: targetSlice?.subject_track_hint,
      subjectDisplayName: targetSlice?.display_name,
      subjectProductIntro: targetSlice?.product_intro,
      subjectFinancingText: logCtx.subjectFinancingText || targetSlice?.financing_amount_text || null,
      subjectLatestRound: logCtx.subjectLatestRound || targetSlice?.latest_round || null,
      subjectTags: targetSlice?.tags,
      subjectCoreLines: targetSlice?.core_product_lines,
      ruleProductScore: logCtx.ruleProductScore,
      coreLineScore: logCtx.coreLineScore,
      specificTagScore: logCtx.specificTagScore,
      fromAiWeb: logCtx.fromAiWeb === true,
      fromGoldStandard: logCtx.fromGoldStandard === true || logCtx._fromGoldStandard === true,
    });
      logCompetitorAi(runId, 'validate', `完成 ${label}`, {
        is_competitor: normalized.is_competitor,
        competitor_type: normalized.competitor_type,
        validated_score: normalized.validated_score,
        is_upstream_downstream: normalized.is_upstream_downstream,
        reject_reason: normalized.reject_reason,
      });
      return normalized;
    }
  } catch (e) {
    logCompetitorAi(runId, 'validate', `失败 ${label}，标记为非竞品: ${e.message}`);
    return normalizeCompetitorValidation({
      is_competitor: false,
      industry_match: false,
      core_overlap_percent: 0,
      is_upstream_downstream: false,
      validated_score: 0,
      reject_reason: `AI 校验失败: ${e.message}`,
      ai_failed: true,
    });
  }
  logCompetitorAi(runId, 'validate', `空响应 ${label}，标记为非竞品`);
  return normalizeCompetitorValidation({
    is_competitor: false,
    industry_match: false,
    core_overlap_percent: 0,
    is_upstream_downstream: false,
    validated_score: 0,
    reject_reason: 'AI 返回空响应或无法解析',
    ai_failed: true,
  });
}

module.exports = {
  getActiveCompetitorModelConfig,
  invokeCompetitorChat,
  scorePairSimilarity,
  discoverWebCompetitors,
  discoverDomesticListedCompetitors,
  validateCandidate,
};
