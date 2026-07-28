const db = require('../../db');
const axios = require('axios');
const { normalizeDashScopeChatEndpoint, formatDashScopeHttpError } = require('../dashScopeOpenAICompat');
const { createShanghaiDate, formatDateOnly } = require('./listingBeijingDate');
const { runNewShareAkSync, runIpoApplyBackfillByCode, runHkIssueTotalWanFetch } = require('./newShareAkSync');
const { runNewShareMetricsSyncWithFallback } = require('./newShareMetricsSync');
const { warmEtnetHkIpoInfoCache, wasEtnetWarmRecentlyFailed } = require('./etnetHkIpoInfoMetrics');
const { NEW_SHARE_ENTERPRISE_FULL_NAME_PROMPT_BODY } = require('./newShareEnterpriseFullNamePrompt');

const NEW_SHARE_MIN_SYNC_DATE = '2026-01-01';

/** 把 Python traceback / 长错误压成前端可读短句 */
function shortenNewShareSyncError(err) {
  const raw = String((err && err.message) || err || '').trim();
  if (!raw) return '打新日历同步失败';
  const lines = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (/^(requests\.exceptions\.|urllib3\.exceptions\.|TimeoutError|ConnectionError|ReadTimeout)/.test(line)) {
      return line.slice(0, 280);
    }
    if (/^[A-Za-z][\w.]*Error:|^[A-Za-z][\w.]*Exception:/.test(line)) {
      return line.slice(0, 280);
    }
  }
  if (/etnet\.com\.hk/i.test(raw)) {
    return '港股源 etnet.com.hk 请求失败（超时或连接重置），已尝试降级；若仍失败请稍后重试';
  }
  if (raw.length > 280) return `${raw.slice(0, 280)}…`;
  return raw;
}

function weekdayZh(ymd) {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return null;
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return names[d.getDay()] || null;
}

/** MySQL DATE / DATETIME / 'YYYY-MM-DD' → 日历日 YYYY-MM-DD（与抓取侧一致） */
function toYmdDb(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const s = v.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    try {
      return formatDateOnly(v);
    } catch {
      return '';
    }
  }
  return '';
}

function isProvidedOptionalString(v) {
  if (v === undefined || v === null) return false;
  return String(v).trim() !== '';
}

function isProvidedNumber(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string' && v.trim() === '') return false;
  return Number.isFinite(Number(v));
}

function numClose(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) && !Number.isFinite(nb)) return true;
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  return Math.abs(na - nb) < 1e-6;
}

function pickFiniteNumberOrNull(rowVal, oldVal) {
  if (!isProvidedNumber(rowVal)) {
    const o = Number(oldVal);
    return Number.isFinite(o) ? o : null;
  }
  const n = Number(rowVal);
  return Number.isFinite(n) ? n : null;
}

function pickPositiveOrNullFromRow(rowVal, oldVal) {
  if (rowVal === undefined || rowVal === null || (typeof rowVal === 'string' && rowVal.trim() === '')) {
    return normalizePositiveOrNull(oldVal);
  }
  const fromRow = normalizePositiveOrNull(rowVal);
  if (fromRow !== null) return fromRow;
  return normalizePositiveOrNull(oldVal);
}

async function upsertNewShareRow(row) {
  const rowIssueSlice = String(row.issue_date || '').slice(0, 10);
  const existing = await db.query(
    `SELECT F_Id, stock_name, issue_date, issue_weekday, issue_price, offer_pe, limit_shares,
            issue_total_wan, expected_raise_amount, total_issued_shares,
            public_date, win_rate, first_day_close, first_day_chg_pct, first_day_market_cap
     FROM ipo_new_share
     WHERE stock_code = ? AND exchange = ?
     LIMIT 1`,
    [row.stock_code, row.exchange]
  );

  if (!existing.length) {
    const issueDate = isYmd(rowIssueSlice) ? rowIssueSlice : '';
    const issueWeekday = weekdayZh(issueDate);
    const insertIssuePrice = row.issue_price ?? null;
    const resolvedShares = resolveIssueTotalWanAndShares(row.issue_total_wan, row.total_issued_shares);
    const insertIssueTotalWan = resolvedShares.issueTotalWan;
    const insertTotalIssuedShares = resolvedShares.totalIssuedShares;
    const insertExpectedRaise = calcExpectedRaiseAmountYi(insertIssuePrice, insertIssueTotalWan);
    await db.execute(
      `INSERT INTO ipo_new_share
      (stock_code, stock_name, issue_date, issue_weekday, issue_price, offer_pe, limit_shares,
       issue_total_wan, expected_raise_amount, total_issued_shares, exchange, public_date, win_rate,
       first_day_close, first_day_chg_pct, first_day_market_cap)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.stock_code,
        row.stock_name,
        issueDate,
        issueWeekday,
        insertIssuePrice,
        row.offer_pe ?? null,
        row.limit_shares ?? null,
        insertIssueTotalWan,
        insertExpectedRaise,
        insertTotalIssuedShares,
        row.exchange,
        row.public_date || null,
        row.win_rate ?? null,
        row.first_day_close ?? null,
        row.first_day_chg_pct ?? null,
        row.first_day_market_cap ?? null,
      ]
    );
    return 'inserted';
  }

  const old = existing[0];
  const oldIssueYmd = toYmdDb(old.issue_date);
  const issueDate = isYmd(rowIssueSlice) ? rowIssueSlice : oldIssueYmd;
  const issueWeekday = weekdayZh(issueDate);

  const nextStockName = isProvidedOptionalString(row.stock_name)
    ? String(row.stock_name).trim()
    : String(old.stock_name || '');

  const nextIssuePrice = pickFiniteNumberOrNull(row.issue_price, old.issue_price);
  const nextOfferPe = pickFiniteNumberOrNull(row.offer_pe, old.offer_pe);
  const nextLimitShares = pickFiniteNumberOrNull(row.limit_shares, old.limit_shares);
  const resolvedShares = resolveIssueTotalWanAndShares(
    pickPositiveOrNullFromRow(row.issue_total_wan, old.issue_total_wan),
    pickPositiveOrNullFromRow(row.total_issued_shares, old.total_issued_shares)
  );
  const nextIssueTotalWan = resolvedShares.issueTotalWan;
  const nextTotalIssuedShares = resolvedShares.totalIssuedShares;
  const nextExpectedRaiseAmount = calcExpectedRaiseAmountYi(nextIssuePrice, nextIssueTotalWan);

  const rowPubSlice = String(row.public_date || '').trim().slice(0, 10);
  const nextPublicDate = isYmd(rowPubSlice) ? rowPubSlice : toYmdDb(old.public_date) || null;

  const nextWinRate = pickFiniteNumberOrNull(row.win_rate, old.win_rate);

  const nextFirstDayClose = pickPositiveOrNullFromRow(row.first_day_close, old.first_day_close);
  const nextFirstDayChgPct =
    row.first_day_chg_pct === undefined || row.first_day_chg_pct === null || (typeof row.first_day_chg_pct === 'string' && row.first_day_chg_pct.trim() === '')
      ? (old.first_day_chg_pct != null && old.first_day_chg_pct !== '' ? Number(old.first_day_chg_pct) : null)
      : Number(row.first_day_chg_pct);
  const nextFirstDayMarketCap = pickPositiveOrNullFromRow(row.first_day_market_cap, old.first_day_market_cap);

  const changed =
    String(old.stock_name || '') !== nextStockName ||
    toYmdDb(old.issue_date) !== issueDate ||
    String(old.issue_weekday || '') !== String(issueWeekday || '') ||
    !numClose(old.issue_price, nextIssuePrice) ||
    !numClose(old.offer_pe, nextOfferPe) ||
    !numClose(old.limit_shares, nextLimitShares) ||
    !numClose(old.issue_total_wan, nextIssueTotalWan) ||
    !numClose(old.expected_raise_amount, nextExpectedRaiseAmount) ||
    !numClose(old.total_issued_shares, nextTotalIssuedShares) ||
    toYmdDb(old.public_date) !== (nextPublicDate || '') ||
    !numClose(old.win_rate, nextWinRate) ||
    !numClose(old.first_day_close, nextFirstDayClose) ||
    !numClose(old.first_day_chg_pct, nextFirstDayChgPct) ||
    !numClose(old.first_day_market_cap, nextFirstDayMarketCap);

  if (!changed) return 'skipped';

  await db.execute(
    `UPDATE ipo_new_share
      SET stock_name = ?, issue_date = ?, issue_weekday = ?, issue_price = ?, offer_pe = ?,
          limit_shares = ?, issue_total_wan = ?, expected_raise_amount = ?, total_issued_shares = ?,
          public_date = ?, win_rate = ?,
          first_day_close = ?, first_day_chg_pct = ?, first_day_market_cap = ?
      WHERE F_Id = ?`,
    [
      nextStockName,
      issueDate,
      issueWeekday,
      nextIssuePrice,
      nextOfferPe,
      nextLimitShares,
      nextIssueTotalWan,
      nextExpectedRaiseAmount,
      nextTotalIssuedShares,
      nextPublicDate,
      nextWinRate,
      nextFirstDayClose,
      Number.isFinite(nextFirstDayChgPct) ? nextFirstDayChgPct : null,
      nextFirstDayMarketCap,
      old.F_Id,
    ]
  );
  return 'updated';
}

function isYmd(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').slice(0, 10));
}

function maxYmd(a, b) {
  const aa = String(a || '').slice(0, 10);
  const bb = String(b || '').slice(0, 10);
  if (!isYmd(aa)) return bb;
  if (!isYmd(bb)) return aa;
  return aa >= bb ? aa : bb;
}

function calcFirstDayMarketCap(close, totalIssuedShares) {
  const c = Number(close);
  const ts = Number(totalIssuedShares);
  if (!Number.isFinite(c) || !Number.isFinite(ts)) return null;
  if (c <= 0 || ts <= 0) return null;
  return Math.round(c * ts * 100) / 100;
}

/** 预计募资规模（亿元）= 发行价 × 发行总数（万股） / 10000 */
function calcExpectedRaiseAmountYi(issuePrice, issueTotalWan) {
  const p = Number(issuePrice);
  const w = Number(issueTotalWan);
  if (!Number.isFinite(p) || !Number.isFinite(w) || p <= 0 || w <= 0) return null;
  return Math.round((p * w / 10000) * 100) / 100;
}

/** 发行总数（万股）与总发行数量（股）互推，保证入库成对 */
function resolveIssueTotalWanAndShares(issueTotalWan, totalIssuedShares) {
  let wan = normalizePositiveOrNull(issueTotalWan);
  let shares = normalizePositiveOrNull(totalIssuedShares);
  if (wan == null && shares != null) {
    wan = Math.round((shares / 10000) * 100) / 100;
  }
  if (shares == null && wan != null) {
    shares = Math.round(wan * 10000 * 100) / 100;
  }
  if (wan != null && shares != null && shares <= wan * 100) {
    shares = Math.round(wan * 10000 * 100) / 100;
  }
  return { issueTotalWan: wan, totalIssuedShares: shares };
}

function normalizePositiveOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** 首日涨幅可为 0 或负数，不可使用 normalizePositiveOrNull */
function normalizeChgPctOrNull(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function computeFirstDayChgPctFromPrices(close, issuePrice) {
  const c = Number(close);
  const p = Number(issuePrice);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return Math.round(((c - p) / p) * 10000) / 100;
}

function hasChineseText(v) {
  return /[\u4e00-\u9fa5]/.test(String(v || ''));
}

function normalizeFullNamePair(rawCn, rawEn) {
  const cn = String(rawCn || '').trim();
  const en = String(rawEn || '').trim();
  const finalCn = hasChineseText(cn) ? cn : '';
  const finalEn = finalCn ? en : (en || (cn && !hasChineseText(cn) ? cn : ''));
  const display = finalCn && finalEn ? `${finalCn} / ${finalEn}` : (finalCn || finalEn || '');
  return { cn: finalCn, en: finalEn, display };
}

function stripCodeFence(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseNamePairFromModelOutput(outputText) {
  const text = stripCodeFence(outputText);
  if (!text) return { cn: '', en: '', display: '' };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return normalizeFullNamePair(parsed.cn, parsed.en);
    }
  } catch (_) {
    // ignore
  }
  // 非JSON兜底：模型只返回一个全称时，按中英文特征归类
  if (hasChineseText(text)) {
    return normalizeFullNamePair(text, '');
  }
  return normalizeFullNamePair('', text);
}

function buildNewShareFullNameAppendix(stockCode, stockName, exchange) {
  const code = String(stockCode || '').trim();
  const name = String(stockName || '').trim();
  const ex = String(exchange || '').trim();
  const lines = [`股票代码：${code}`, `股票简称：${name}`];
  if (ex) {
    lines.push(`交易所：${ex}`);
  }
  if (ex === '港交所' || /港交所|香港联合|HKEX/i.test(ex)) {
    lines.push(
      '【执行提示】本证券在港交所上市：请用联网检索披露易（HKEXnews）上与该代码对应的招股章程、聆讯后资料集或全球发售文件及「公司资料」页，摘录法定中文全称与官方英文全称填入 cn、en。请勿在本 JSON 中输出或改写「股票简称」（简称仍以交易所/系统数据为准）。'
    );
  }
  return lines.join('\n');
}

function buildNewShareFullNameFallbackPrompt(stockCode, stockName, exchange = '') {
  return `${NEW_SHARE_ENTERPRISE_FULL_NAME_PROMPT_BODY}

输入：
${buildNewShareFullNameAppendix(stockCode, stockName, exchange)}`;
}

function composeNewShareFullNamePrompt(promptTemplate, stockCode, stockName, exchange = '') {
  const base = String(promptTemplate || '').trim();
  const appendix = buildNewShareFullNameAppendix(stockCode, stockName, exchange);
  if (base) return `${base}\n\n${appendix}`;
  return buildNewShareFullNameFallbackPrompt(stockCode, stockName, exchange);
}

function applyNewShareNameOverrides(stockCode, normalizedPair) {
  const code = String(stockCode || '').trim();
  const pair = normalizedPair || { cn: '', en: '', display: '' };
  if (code === '688820') {
    return normalizeFullNamePair(
      '盛合晶微半导体（江阴）有限公司',
      'SJ Semiconductor(Jiangyin) Corp.'
    );
  }
  return pair;
}

function truncateForLog(text, maxLen = 500) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function mapAiModelConfigRow(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    config_name: row.config_name,
    provider: row.provider,
    model_name: row.model_name,
    api_type: row.api_type,
    api_key: row.api_key,
    api_endpoint: row.api_endpoint,
    temperature: row.temperature,
    max_tokens: row.max_tokens,
    top_p: row.top_p,
    application_type: row.application_type,
    usage_type: row.usage_type,
  };
}

async function fetchActiveAiModelRow(whereSql, params = []) {
  const rows = await db.query(
    `SELECT F_Id AS id, config_name, provider, model_name, api_type, api_key, api_endpoint,
            temperature, max_tokens, top_p, application_type, usage_type
     FROM ai_model_config
     WHERE is_active = 1 AND F_DeleteMark = 0 ${whereSql}
     ORDER BY F_CreatorTime DESC
     LIMIT 1`,
    params
  );
  return rows.length ? rows[0] : null;
}

async function getPromptAndModelConfigForNewShareName() {
  const prompts = await db.query(
    `SELECT
       p.prompt_content,
       p.ai_model_config_id,
       m.F_Id as model_id, m.config_name, m.provider, m.model_name, m.api_type,
       m.api_key, m.api_endpoint, m.temperature, m.max_tokens, m.top_p,
       m.application_type as bound_application_type, m.usage_type as bound_usage_type
     FROM ai_prompt_config p
     LEFT JOIN ai_model_config m ON p.ai_model_config_id = m.F_Id AND m.is_active = 1 AND m.F_DeleteMark = 0
     WHERE p.interface_type = '打新接口'
       AND p.prompt_type = 'enterprise_full_name'
       AND p.is_active = 1
       AND p.F_DeleteMark = 0
     ORDER BY p.F_CreatorTime DESC
     LIMIT 1`
  );

  let promptTemplate = '';
  let model = null;
  let modelSource = 'none';

  if (prompts.length > 0) {
    const p = prompts[0];
    promptTemplate = String(p.prompt_content || '').trim();
    if (p.model_id) {
      model = mapAiModelConfigRow({
        id: p.model_id,
        config_name: p.config_name,
        provider: p.provider,
        model_name: p.model_name,
        api_type: p.api_type,
        api_key: p.api_key,
        api_endpoint: p.api_endpoint,
        temperature: p.temperature,
        max_tokens: p.max_tokens,
        top_p: p.top_p,
        application_type: p.bound_application_type,
        usage_type: p.bound_usage_type,
      });
      if (model) modelSource = 'prompt_bind';
    } else if (p.ai_model_config_id) {
      const rebound = await fetchActiveAiModelRow('AND F_Id = ?', [p.ai_model_config_id]);
      if (rebound) {
        model = mapAiModelConfigRow(rebound);
        modelSource = 'prompt_bind';
      }
    }
  }

  if (!model) {
    const listingRow = await fetchActiveAiModelRow(`AND usage_type = 'listing_data'`);
    if (listingRow) {
      model = mapAiModelConfigRow(listingRow);
      modelSource = 'listing_data';
    }
  }

  if (!model) {
    const legacyRow = await fetchActiveAiModelRow(`AND application_type IN ('general', 'news_analysis')`);
    if (legacyRow) {
      model = mapAiModelConfigRow(legacyRow);
      modelSource = 'legacy_news_general';
    }
  }

  return { promptTemplate, model, modelSource };
}

async function callAiModelForFullName(prompt, modelConfig) {
  if (!modelConfig || !modelConfig.api_endpoint || !modelConfig.api_key || !modelConfig.model_name) {
    throw new Error('AI模型配置不完整');
  }
  const provider = String(modelConfig.provider || '').toLowerCase();
  const rawEndpoint = String(modelConfig.api_endpoint || '').trim();
  const apiTypeLc = String(modelConfig.api_type || '').toLowerCase();
  /** 与 DashScope OpenAI 兼容 /chat/completions 契约一致 */
  const isAlibabaCompatibleUrl =
    provider === 'alibaba' &&
    (rawEndpoint.includes('/compatible-mode/v1') || rawEndpoint.includes('/v1/chat/completions'));
  /**
   * 使用顶层 messages 的 OpenAI 兼容请求体。
   * 注意：若 API 类型选「Chat Completion」但端点填的是原生 …/text-generation/generation，
   * 必须把 URL 规范到 compatible-mode，否则会 400（原生接口要 input.messages，不接受顶层 messages）。
   */
  const useOpenAiChatCompletionsBody =
    provider === 'openai' ||
    isAlibabaCompatibleUrl ||
    (provider === 'alibaba' && apiTypeLc === 'chat_completion');

  const temperature = typeof modelConfig.temperature === 'string' ? parseFloat(modelConfig.temperature) : Number(modelConfig.temperature);
  let topP = typeof modelConfig.top_p === 'string' ? parseFloat(modelConfig.top_p) : Number(modelConfig.top_p);
  const maxTokens = typeof modelConfig.max_tokens === 'string' ? parseInt(modelConfig.max_tokens, 10) : Number(modelConfig.max_tokens);

  if (useOpenAiChatCompletionsBody) {
    const endpoint =
      provider === 'alibaba' ? normalizeDashScopeChatEndpoint(modelConfig.api_endpoint) : rawEndpoint;
    if (!endpoint) {
      throw new Error('API端点为空');
    }
    let requestTopP = Number.isFinite(topP) ? topP : 1;
    if (provider === 'alibaba' && (!Number.isFinite(topP) || topP > 0.999)) {
      requestTopP = 0.95;
    }
    const requestData = {
      model: modelConfig.model_name,
      messages: [{ role: 'user', content: prompt }],
      temperature: Number.isFinite(temperature) ? temperature : 0.2,
      max_tokens: Number.isFinite(maxTokens) ? Math.min(Math.max(maxTokens, 64), 2000) : 800,
      top_p: requestTopP,
    };
    const postCompat = (body) =>
      axios.post(endpoint, body, {
        headers: { Authorization: `Bearer ${modelConfig.api_key}`, 'Content-Type': 'application/json' },
        timeout: 90000,
      });
    try {
      const useDashSearch =
        provider === 'alibaba' &&
        /dashscope/i.test(endpoint) &&
        String(process.env.NEW_SHARE_FULLNAME_ENABLE_SEARCH || '1') !== '0';
      if (useDashSearch) {
        try {
          const resp = await postCompat({ ...requestData, enable_search: true });
          return resp.data?.choices?.[0]?.message?.content || '';
        } catch (e1) {
          const st = e1.response?.status;
          if (st === 400) {
            console.warn(
              `[打新日历AI] DashScope enable_search 被拒(400)，将不带联网参数重试: ${formatDashScopeHttpError(e1)}`
            );
            const resp2 = await postCompat({ ...requestData });
            return resp2.data?.choices?.[0]?.message?.content || '';
          }
          throw e1;
        }
      }
      const resp = await postCompat(requestData);
      return resp.data?.choices?.[0]?.message?.content || '';
    } catch (e) {
      throw new Error(formatDashScopeHttpError(e));
    }
  }

  if (provider === 'alibaba') {
    const requestData = {
      model: modelConfig.model_name,
      input: { messages: [{ role: 'user', content: prompt }] },
      parameters: {
        temperature: Number.isFinite(temperature) ? temperature : 0.2,
        max_tokens: Number.isFinite(maxTokens) ? Math.min(Math.max(maxTokens, 64), 2000) : 800,
        top_p: Number.isFinite(topP) && topP <= 0.999 ? topP : 0.95,
      },
    };
    try {
      const resp = await axios.post(rawEndpoint || modelConfig.api_endpoint, requestData, {
        headers: { Authorization: `Bearer ${modelConfig.api_key}`, 'Content-Type': 'application/json' },
        timeout: 60000,
      });
      return resp.data?.output?.text || resp.data?.output?.choices?.[0]?.message?.content || '';
    } catch (e) {
      throw new Error(formatDashScopeHttpError(e));
    }
  }

  throw new Error(`不支持的AI提供商: ${modelConfig.provider}`);
}

async function runWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const c = Math.max(1, Math.min(32, Number(concurrency || 1)));
  const results = new Array(list.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(c, list.length || 1) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= list.length) break;
      results[i] = await worker(list[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  const ms = Math.max(1000, Number(timeoutMs || 1000));
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage || `timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function reportProgress(progressReporter, message) {
  if (typeof progressReporter !== 'function' || !message) return;
  try {
    await progressReporter(String(message));
  } catch (_) {
    // progress reporter failure should not break sync flow
  }
}

async function refreshNewShareDailyMetrics(rows, logTag, minSyncDate, progressReporter) {
  const todayYmd = formatDateOnly(createShanghaiDate());
  const lookbackDays = Math.max(30, Math.min(3650, Number(process.env.NEW_SHARE_METRICS_LOOKBACK_DAYS || 3650)));
  const recentListedRows = await db.query(
    `SELECT stock_code, stock_name, exchange, DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
            DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date, issue_weekday, issue_price, offer_pe, limit_shares, win_rate, total_issued_shares,
            first_day_close, first_day_chg_pct, first_day_market_cap
     FROM ipo_new_share
     WHERE public_date IS NOT NULL
       AND public_date <= CURDATE()
       AND public_date >= ?
       AND public_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND (
         first_day_close IS NULL OR first_day_close <= 0
         OR first_day_chg_pct IS NULL
         OR first_day_market_cap IS NULL OR first_day_market_cap <= 0
         OR total_issued_shares IS NULL OR total_issued_shares <= 0
       )
     ORDER BY public_date DESC
     LIMIT 5000`
    ,
    [minSyncDate, lookbackDays]
  );
  const uniq = new Map();
  [...rows, ...recentListedRows].forEach((r) => {
    const key = `${r.stock_code}|${r.exchange || ''}`;
    if (!uniq.has(key)) uniq.set(key, r);
  });
  const candidates = Array.from(uniq.values());
  console.log(`${logTag} 首日指标候选 total=${candidates.length} fetchedRows=${rows.length} dbMissing=${recentListedRows.length}`);
  await reportProgress(
    progressReporter,
    `阶段3/4 首日指标候选 total=${candidates.length} fetchedRows=${rows.length} dbMissing=${recentListedRows.length}`
  );
  let refreshed = 0;
  let refreshedUpdated = 0;
  let failed = 0;
  let skippedNoListDate = 0;
  const failedItems = [];
  const refreshedItems = [];
  // A股和港股分开处理，使用不同的并发和超时配置
  const metricsConcurrencyA = Math.max(1, Math.min(32, Number(process.env.NEW_SHARE_METRICS_CONCURRENCY || 8)));
  const metricsConcurrencyHk = Math.max(1, Math.min(16, Number(process.env.NEW_SHARE_METRICS_HK_CONCURRENCY || 3)));
  const metricsItemTimeoutMsA = Math.max(10000, Number(process.env.NEW_SHARE_METRICS_ITEM_TIMEOUT_MS || 70000));
  const metricsItemTimeoutMsHk = Math.max(30000, Number(process.env.NEW_SHARE_METRICS_ITEM_TIMEOUT_MS_HK || 120000));

  // 分离港股和A股候选
  const hkCandidates = candidates.filter(r => r.exchange === '港交所');
  const aCandidates = candidates.filter(r => r.exchange !== '港交所');

  console.log(`${logTag} 首日指标候选分离: A股=${aCandidates.length} 港股=${hkCandidates.length}`);
  console.log(`${logTag} A股配置: concurrency=${metricsConcurrencyA} timeout=${metricsItemTimeoutMsA}ms`);
  console.log(`${logTag} 港股配置: concurrency=${metricsConcurrencyHk} timeout=${metricsItemTimeoutMsHk}ms`);

  // 处理单个股票的通用函数
  const processMetricsRow = async (row, market, timeoutMs, extraOpts = {}) => {
    const listDate = String(row.public_date || '').slice(0, 10);
    if (!isYmd(listDate) || listDate > todayYmd) {
      return { status: 'skipped', row, listDate };
    }
    console.log(
      `${logTag} 首日指标开始 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} timeoutMs=${timeoutMs}`
    );
    let fetched;
    try {
      fetched = await withTimeout(
        runNewShareMetricsSyncWithFallback({
          stockCode: row.stock_code,
          listDate,
          market,
          logTag: `${logTag}[${row.stock_code}][首日指标]`,
          skipEtnet: !!extraOpts.skipEtnet,
        }),
        timeoutMs,
        `首日指标超时(${timeoutMs}ms)`
      );
    } catch (timeoutErr) {
      const failMsg = String(timeoutErr?.message || timeoutErr || 'metrics timeout').slice(0, 500);
      const failedItem = {
        stockCode: row.stock_code,
        exchange: row.exchange || '',
        listDate,
        reason: failMsg,
      };
      console.warn(
        `${logTag} 首日指标抓取失败 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} reason=${failMsg}`
      );
      return { status: 'failed', row, listDate, failedItem };
    }
    if (!fetched.ok || !fetched.firstRow) {
      const failMsg = String(fetched.stderr || 'firstRow missing').slice(0, 500);
      const failedItem = {
        stockCode: row.stock_code,
        exchange: row.exchange || '',
        listDate,
        reason: failMsg,
      };
      console.warn(
        `${logTag} 首日指标抓取失败 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} reason=${failMsg}`
      );
      return { status: 'failed', row, listDate, failedItem };
    }
    const first = fetched.firstRow || {};
    const totalIssuedShares =
      row.total_issued_shares != null && Number.isFinite(Number(row.total_issued_shares)) && Number(row.total_issued_shares) > 0
        ? Number(row.total_issued_shares)
        : fetched.totalShares != null && Number.isFinite(Number(fetched.totalShares))
          ? Number(fetched.totalShares)
          : null;
    const close = first.close != null && Number.isFinite(Number(first.close)) ? Number(first.close) : null;
    let chgPct = first.chg_pct != null && Number.isFinite(Number(first.chg_pct)) ? Number(first.chg_pct) : null;
    const fetchedIssuePrice =
      fetched.issuePrice != null && Number.isFinite(Number(fetched.issuePrice)) ? Number(fetched.issuePrice) : null;
    const fetchedWinRate = fetched.winRate != null && Number.isFinite(Number(fetched.winRate)) ? Number(fetched.winRate) : null;
    if (chgPct == null && close != null) {
      const issuePx =
        fetchedIssuePrice != null && Number.isFinite(fetchedIssuePrice)
          ? fetchedIssuePrice
          : row.issue_price != null && Number.isFinite(Number(row.issue_price))
            ? Number(row.issue_price)
            : null;
      chgPct = computeFirstDayChgPctFromPrices(close, issuePx);
    }
    const marketCap = calcFirstDayMarketCap(close, totalIssuedShares);

    const result = await upsertNewShareRow({
      ...row,
      issue_price:
        row.issue_price != null && Number.isFinite(Number(row.issue_price)) && Number(row.issue_price) > 0
          ? Number(row.issue_price)
          : fetchedIssuePrice,
      win_rate:
        row.win_rate != null && Number.isFinite(Number(row.win_rate)) && Number(row.win_rate) > 0
          ? Number(row.win_rate)
          : fetchedWinRate,
      total_issued_shares: normalizePositiveOrNull(totalIssuedShares ?? row.total_issued_shares ?? null),
      first_day_close: normalizePositiveOrNull(close),
      first_day_chg_pct: normalizeChgPctOrNull(chgPct),
      first_day_market_cap: normalizePositiveOrNull(marketCap),
    });
    const refreshedItem = {
      stockCode: row.stock_code,
      exchange: row.exchange || '',
      listDate,
      tradeDate: first.trade_date || null,
      close: close ?? null,
      chgPct: chgPct ?? null,
      totalIssuedShares: totalIssuedShares ?? null,
      marketCap: marketCap ?? null,
      source: fetched.source || null,
      state: result,
    };
    console.log(
      `${logTag} 首日指标抓取成功 stock=${row.stock_code} exchange=${row.exchange || ''} listDate=${listDate} tradeDate=${
        first.trade_date || '-'
      } close=${close ?? 'null'} chgPct=${chgPct ?? 'null'} totalShares=${totalIssuedShares ?? 'null'} marketCap=${
        marketCap ?? 'null'
      } issuePrice=${fetchedIssuePrice ?? 'null'} winRate=${fetchedWinRate ?? 'null'} source=${fetched.source || '-'} state=${result}`
    );
    return { status: 'refreshed', result, refreshedItem };
  };

  // 先处理A股（并发高，超时短）
  let aTaskResults = [];
  if (aCandidates.length > 0) {
    console.log(`${logTag} 开始处理A股首日指标 count=${aCandidates.length}`);
    aTaskResults = await runWithConcurrency(aCandidates, metricsConcurrencyA, async (row) => {
      return processMetricsRow(row, 'a', metricsItemTimeoutMsA);
    });
  }

  // 再处理港股（并发低，超时长）
  let hkTaskResults = [];
  if (hkCandidates.length > 0) {
    console.log(`${logTag} 开始处理港股首日指标 count=${hkCandidates.length}`);
    let etnetWarmFailed = false;
    if (String(process.env.NEW_SHARE_METRICS_HK_ETNET_FIRST || '1') !== '0') {
      try {
        await warmEtnetHkIpoInfoCache({ logTag });
      } catch (warmErr) {
        etnetWarmFailed = true;
        console.warn(
          `${logTag} 经济通新股信息预热失败（将走近期页/东财/Python回退，不再重复全表翻页）: ${String(warmErr?.message || warmErr)}`
        );
      }
    }
    const skipEtnetFullWarm = etnetWarmFailed || wasEtnetWarmRecentlyFailed();
    hkTaskResults = await runWithConcurrency(hkCandidates, metricsConcurrencyHk, async (row) => {
      return processMetricsRow(row, 'hk', metricsItemTimeoutMsHk, { skipEtnet: skipEtnetFullWarm });
    });
  }

  // 合并结果
  const taskResults = [...aTaskResults, ...hkTaskResults];

  for (const tr of taskResults) {
    if (!tr) continue;
    if (tr.status === 'skipped') {
      skippedNoListDate += 1;
      continue;
    }
    if (tr.status === 'failed') {
      failed += 1;
      if (tr.failedItem) failedItems.push(tr.failedItem);
      continue;
    }
    if (tr.status === 'refreshed') {
      refreshed += 1;
      if (tr.refreshedItem) refreshedItems.push(tr.refreshedItem);
      if (tr.result === 'updated') refreshedUpdated += 1;
    }
  }
  await reportProgress(
    progressReporter,
    `阶段3/4 首日指标进度完成 refreshed=${refreshed} updated=${refreshedUpdated} failed=${failed} skipped=${skippedNoListDate}`
  );

  if (refreshedItems.length) {
    console.log(`${logTag} 首日指标抓取明细`, refreshedItems);
  }
  if (failedItems.length) {
    console.warn(`${logTag} 首日指标失败明细`, failedItems);
  }
  console.log(`${logTag} 首日指标补抓完成 refreshed=${refreshed} updated=${refreshedUpdated} failed=${failed} skipped=${skippedNoListDate}`);
  return { refreshed, refreshedUpdated, failed, candidates: candidates.length, skippedNoListDate };
}

async function backfillIncompleteNewShareRows(logTag, minSyncDate, progressReporter) {
  const limit = Math.max(50, Math.min(800, Number(process.env.NEW_SHARE_BACKFILL_LIMIT || 400)));
  const todayYmd = formatDateOnly(createShanghaiDate());
  const candidates = await db.query(
    `SELECT F_Id, stock_code, stock_name, exchange, issue_price,
            DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
            DATE_FORMAT(public_date, '%Y-%m-%d') AS public_date,
            issue_total_wan, expected_raise_amount,
            first_day_close, first_day_chg_pct, first_day_market_cap, total_issued_shares
     FROM ipo_new_share
     WHERE (
       (exchange != '港交所' AND public_date IS NULL)
       OR (
         exchange != '港交所'
         AND (issue_total_wan IS NULL OR issue_total_wan <= 0 OR total_issued_shares IS NULL OR total_issued_shares <= 0)
       )
       OR (
         exchange = '港交所'
         AND (issue_total_wan IS NULL OR issue_total_wan <= 0 OR expected_raise_amount IS NULL OR expected_raise_amount <= 0)
       )
       OR (
         public_date IS NOT NULL AND public_date <= ?
         AND (
           first_day_close IS NULL OR first_day_close <= 0
           OR first_day_chg_pct IS NULL
           OR first_day_market_cap IS NULL OR first_day_market_cap <= 0
         )
       )
     )
     AND (
       (issue_date IS NOT NULL AND DATE(issue_date) >= ?)
       OR (public_date IS NOT NULL AND DATE(public_date) >= ?)
     )
     ORDER BY F_LastModifyTime DESC, F_Id DESC
     LIMIT ?`,
    [todayYmd, minSyncDate, minSyncDate, limit]
  );
  if (!candidates.length) {
    console.log(`${logTag} 库内补全：无待补全记录`);
    return { total: 0, updated: 0, skipped: 0, failed: 0 };
  }
  console.log(`${logTag} 库内补全开始 total=${candidates.length} limit=${limit}`);
  await reportProgress(progressReporter, `阶段2b/4 库内补全开始 total=${candidates.length}`);
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const hkIntervalMs = Math.max(0, Number(process.env.HK_IPO_DETAIL_INTERVAL_MS || 150));
  let hkFetched = 0;
  for (const row of candidates) {
    const exchange = String(row.exchange || '').trim();
    const stockCode = String(row.stock_code || '').trim();
    try {
      if (exchange === '港交所') {
        if (hkFetched > 0 && hkIntervalMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, hkIntervalMs));
        }
        hkFetched += 1;
        const fetched = runHkIssueTotalWanFetch(stockCode, logTag);
        if (!fetched.ok || fetched.wan == null) {
          skipped += 1;
          continue;
        }
        const issuePrice =
          row.issue_price != null && Number.isFinite(Number(row.issue_price)) && Number(row.issue_price) > 0
            ? Number(row.issue_price)
            : null;
        const era = calcExpectedRaiseAmountYi(issuePrice, fetched.wan);
        const state = await upsertNewShareRow({
          stock_code: stockCode,
          stock_name: row.stock_name,
          exchange,
          issue_price: issuePrice,
          issue_total_wan: fetched.wan,
          expected_raise_amount: era,
          total_issued_shares: Math.round(fetched.wan * 10000 * 100) / 100,
        });
        if (state === 'updated' || state === 'inserted') updated += 1;
        else skipped += 1;
        continue;
      }
      const derived = resolveIssueTotalWanAndShares(row.issue_total_wan, row.total_issued_shares);
      const missingWan = normalizePositiveOrNull(row.issue_total_wan) == null;
      const missingShares = normalizePositiveOrNull(row.total_issued_shares) == null;
      if ((missingWan || missingShares) && derived.issueTotalWan != null) {
        const state = await upsertNewShareRow({
          stock_code: stockCode,
          stock_name: row.stock_name,
          exchange,
          issue_price: row.issue_price,
          issue_total_wan: derived.issueTotalWan,
          total_issued_shares: derived.totalIssuedShares,
        });
        if (state === 'updated' || state === 'inserted') {
          updated += 1;
          continue;
        }
      }
      const fetched = runIpoApplyBackfillByCode(stockCode, logTag);
      if (!fetched.ok || !fetched.row) {
        skipped += 1;
        continue;
      }
      const state = await upsertNewShareRow(fetched.row);
      if (state === 'updated' || state === 'inserted') updated += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `${logTag} 库内补全失败 stock=${stockCode} exchange=${exchange} err=${String(err.message || err)}`
      );
    }
  }
  console.log(`${logTag} 库内补全完成 total=${candidates.length} updated=${updated} skipped=${skipped} failed=${failed}`);
  await reportProgress(
    progressReporter,
    `阶段2b/4 库内补全完成 updated=${updated} skipped=${skipped} failed=${failed}`
  );
  return { total: candidates.length, updated, skipped, failed };
}

async function backfillNewShareEnterpriseFullNamesForCandidates(candidates, logTag) {
  if (!candidates.length) {
    console.log(`${logTag} 企业全称补齐：无待补齐记录`);
    return { total: 0, updated: 0, failed: 0, skipped: 0 };
  }

  const concurrency = Math.max(1, Math.min(16, Number(process.env.NEW_SHARE_FULLNAME_BACKFILL_CONCURRENCY || 3)));
  const cfg = await getPromptAndModelConfigForNewShareName();
  if (!cfg.model) {
    console.warn(`${logTag} 企业全称补齐：未找到可用AI模型配置，跳过`);
    return { total: candidates.length, updated: 0, failed: candidates.length, skipped: 0 };
  }

  console.log(
    `${logTag} 选用模型 source=${cfg.modelSource || '-'} id=${cfg.model.id} name=${cfg.model.config_name || '-'} application_type=${cfg.model.application_type || '-'} usage_type=${cfg.model.usage_type || '-'}`
  );

  let updated = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;
  const progressStep = Math.max(1, Math.min(50, Number(process.env.NEW_SHARE_FULLNAME_PROGRESS_STEP || 10)));
  console.log(
    `${logTag} 企业全称补齐开始 total=${candidates.length} concurrency=${concurrency} step=${progressStep}`
  );
  await runWithConcurrency(candidates, concurrency, async (row) => {
    const stockCode = String(row.stock_code || '').trim();
    const stockName = String(row.stock_name || '').trim();
    try {
      const prompt = composeNewShareFullNamePrompt(cfg.promptTemplate, stockCode, stockName, row.exchange);
      const modelOut = await callAiModelForFullName(prompt, cfg.model);
      console.log(
        `${logTag} 模型已调用并返回 stock=${stockCode} outputChars=${String(modelOut ?? '').length}`
      );
      const rawLog = truncateForLog(stripCodeFence(modelOut), 600);
      const parsed = applyNewShareNameOverrides(stockCode, parseNamePairFromModelOutput(modelOut));
      if (!parsed.display) {
        skipped += 1;
        console.log(
          `${logTag} 企业全称补齐跳过(解析为空) stock=${stockCode} name=${stockName} raw=${JSON.stringify(rawLog)}`
        );
        return;
      }

      const before = normalizeFullNamePair(row.enterprise_full_name_cn, row.enterprise_full_name_en);
      const noChange =
        before.cn === parsed.cn &&
        before.en === parsed.en &&
        String(row.enterprise_full_name_display || '').trim() === parsed.display;
      if (noChange) {
        skipped += 1;
        console.log(
          `${logTag} 企业全称补齐跳过(无变化) stock=${stockCode} name=${stockName} parsed_cn=${JSON.stringify(parsed.cn)} parsed_en=${JSON.stringify(parsed.en)} parsed_display=${JSON.stringify(parsed.display)} raw=${JSON.stringify(rawLog)}`
        );
        return;
      }

      await db.execute(
        `UPDATE ipo_new_share
         SET enterprise_full_name_cn = ?, enterprise_full_name_en = ?, enterprise_full_name_display = ?,
             profile_source = COALESCE(profile_source, 'llm_web')
         WHERE F_Id = ?`,
        [parsed.cn || null, parsed.en || null, parsed.display || null, row.F_Id]
      );
      updated += 1;
      console.log(
        `${logTag} 企业全称补齐成功 stock=${stockCode} name=${stockName} source=${cfg.modelSource} model=${cfg.model.config_name || cfg.model.id} parsed_cn=${JSON.stringify(parsed.cn)} parsed_en=${JSON.stringify(parsed.en)} parsed_display=${JSON.stringify(parsed.display)} raw=${JSON.stringify(rawLog)}`
      );
    } catch (err) {
      failed += 1;
      console.warn(
        `${logTag} 企业全称补齐失败 stock=${stockCode} name=${stockName} err=${String(err.message || err)}`
      );
    } finally {
      processed += 1;
      if (processed === candidates.length || processed % progressStep === 0) {
        console.log(
          `${logTag} 企业全称补齐进度 ${processed}/${candidates.length}（updated=${updated} skipped=${skipped} failed=${failed}）`
        );
      }
    }
  });

  console.log(
    `${logTag} 企业全称补齐完成 total=${candidates.length} updated=${updated} skipped=${skipped} failed=${failed}`
  );
  return { total: candidates.length, updated, skipped, failed };
}

async function backfillNewShareEnterpriseFullNames(logTag, minSyncDate) {
  const limit = Math.max(1, Math.min(1000, Number(process.env.NEW_SHARE_FULLNAME_BACKFILL_LIMIT || 300)));
  const candidates = await db.query(
    `SELECT F_Id, stock_code, stock_name, exchange, enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display
     FROM ipo_new_share
     WHERE (enterprise_full_name_display IS NULL OR TRIM(enterprise_full_name_display) = '')
       AND (
         (issue_date IS NOT NULL AND DATE(issue_date) >= ?)
         OR (public_date IS NOT NULL AND DATE(public_date) >= ?)
       )
       AND stock_code IS NOT NULL AND TRIM(stock_code) != ''
       AND stock_name IS NOT NULL AND TRIM(stock_name) != ''
     ORDER BY F_LastModifyTime DESC, F_Id DESC
     LIMIT ?`,
    [minSyncDate, minSyncDate, limit]
  );
  return backfillNewShareEnterpriseFullNamesForCandidates(candidates, logTag);
}

/** Stage 1b：境内主池缺全称的记录 AI 补齐（不限打新日历日期） */
async function backfillNewShareEnterpriseFullNamesDomesticPool(options = {}) {
  const logTag = options.logTag || '[Stage1b-AI全称]';
  const limit = Math.max(1, Math.min(2000, Number(options.limit || process.env.STAGE1B_AI_NAME_LIMIT || 500)));
  const candidates = await db.query(
    `SELECT F_Id, stock_code, stock_name, exchange, enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display
     FROM ipo_new_share
     WHERE exchange IN ('上交所', '深交所', '北交所')
       AND (enterprise_full_name_display IS NULL OR TRIM(enterprise_full_name_display) = '')
       AND (enterprise_full_name_cn IS NULL OR TRIM(enterprise_full_name_cn) = '')
       AND stock_code IS NOT NULL AND TRIM(stock_code) <> ''
       AND stock_name IS NOT NULL AND TRIM(stock_name) <> ''
     ORDER BY F_Id ASC
     LIMIT ?`,
    [limit]
  );
  return backfillNewShareEnterpriseFullNamesForCandidates(candidates, logTag);
}

async function refreshNewShareEnterpriseFullNamesByIds(rowIds, options = {}) {
  const ids = Array.from(
    new Set(
      (Array.isArray(rowIds) ? rowIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
  if (!ids.length) {
    return { total: 0, updated: 0, skipped: 0, failed: 0 };
  }

  const logTag = options.logTag || '[打新日历AI查名]';
  const concurrency = Math.max(1, Math.min(16, Number(options.concurrency || process.env.NEW_SHARE_FULLNAME_BACKFILL_CONCURRENCY || 3)));
  const MAX_IN_CHUNK = 500;
  let candidates = [];
  for (let i = 0; i < ids.length; i += MAX_IN_CHUNK) {
    const chunk = ids.slice(i, i + MAX_IN_CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.query(
      `SELECT F_Id, stock_code, stock_name, exchange, enterprise_full_name_cn, enterprise_full_name_en, enterprise_full_name_display
       FROM ipo_new_share
       WHERE F_Id IN (${placeholders})
       ORDER BY F_Id DESC`,
      chunk
    );
    candidates = candidates.concat(rows);
  }

  if (!candidates.length) {
    return { total: 0, updated: 0, skipped: 0, failed: 0 };
  }

  const cfg = await getPromptAndModelConfigForNewShareName();
  if (!cfg.model) {
    throw new Error('未找到可用AI模型配置');
  }

  console.log(
    `${logTag} 选用模型 source=${cfg.modelSource || '-'} id=${cfg.model.id} name=${cfg.model.config_name || '-'} application_type=${cfg.model.application_type || '-'} usage_type=${cfg.model.usage_type || '-'}`
  );

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  console.log(`${logTag} 执行开始 total=${candidates.length} concurrency=${concurrency}`);

  await runWithConcurrency(candidates, concurrency, async (row) => {
    const stockCode = String(row.stock_code || '').trim();
    const stockName = String(row.stock_name || '').trim();
    if (!stockCode || !stockName) {
      skipped += 1;
      return;
    }
    try {
      const prompt = composeNewShareFullNamePrompt(cfg.promptTemplate, stockCode, stockName, row.exchange);
      const modelOut = await callAiModelForFullName(prompt, cfg.model);
      console.log(
        `${logTag} 模型已调用并返回 id=${row.F_Id} stock=${stockCode} outputChars=${String(modelOut ?? '').length}`
      );
      const rawLog = truncateForLog(stripCodeFence(modelOut), 600);
      const parsed = applyNewShareNameOverrides(stockCode, parseNamePairFromModelOutput(modelOut));
      if (!parsed.display) {
        const hadStale =
          String(row.enterprise_full_name_display || '').trim() ||
          String(row.enterprise_full_name_cn || '').trim() ||
          String(row.enterprise_full_name_en || '').trim();
        const clearStale = String(process.env.NEW_SHARE_AI_NAME_CLEAR_STALE_ON_EMPTY || '1') !== '0';
        if (clearStale && hadStale) {
          await db.execute(
            `UPDATE ipo_new_share
             SET enterprise_full_name_cn = NULL, enterprise_full_name_en = NULL, enterprise_full_name_display = NULL
             WHERE F_Id = ?`,
            [row.F_Id]
          );
          updated += 1;
          console.log(
            `${logTag} 查名已清空旧全称(模型未给出可核验全称) id=${row.F_Id} stock=${stockCode} name=${stockName} raw=${JSON.stringify(rawLog)}`
          );
          return;
        }
        skipped += 1;
        console.log(
          `${logTag} 查名跳过(解析为空) id=${row.F_Id} stock=${stockCode} name=${stockName} raw=${JSON.stringify(rawLog)}`
        );
        return;
      }
      const before = normalizeFullNamePair(row.enterprise_full_name_cn, row.enterprise_full_name_en);
      const noChange =
        before.cn === parsed.cn &&
        before.en === parsed.en &&
        String(row.enterprise_full_name_display || '').trim() === parsed.display;
      if (noChange) {
        skipped += 1;
        console.log(
          `${logTag} 查名跳过(无变化) id=${row.F_Id} stock=${stockCode} name=${stockName} parsed_cn=${JSON.stringify(parsed.cn)} parsed_en=${JSON.stringify(parsed.en)} parsed_display=${JSON.stringify(parsed.display)} raw=${JSON.stringify(rawLog)}`
        );
        return;
      }
      await db.execute(
        `UPDATE ipo_new_share
         SET enterprise_full_name_cn = ?, enterprise_full_name_en = ?, enterprise_full_name_display = ?
         WHERE F_Id = ?`,
        [parsed.cn || null, parsed.en || null, parsed.display || null, row.F_Id]
      );
      updated += 1;
      console.log(
        `${logTag} 查名成功 id=${row.F_Id} stock=${stockCode} name=${stockName} source=${cfg.modelSource} model=${cfg.model.config_name || cfg.model.id} parsed_cn=${JSON.stringify(parsed.cn)} parsed_en=${JSON.stringify(parsed.en)} parsed_display=${JSON.stringify(parsed.display)} raw=${JSON.stringify(rawLog)}`
      );
    } catch (err) {
      failed += 1;
      console.warn(`${logTag} 查名失败 id=${row.F_Id} stock=${stockCode} name=${stockName} err=${String(err.message || err)}`);
    }
  });

  console.log(`${logTag} 执行完成 total=${candidates.length} updated=${updated} skipped=${skipped} failed=${failed}`);
  return { total: candidates.length, updated, skipped, failed };
}

async function syncNewShareCalendar(options = {}) {
  const now = createShanghaiDate();
  let from = options.from || formatDateOnly(now);
  const to = options.to || formatDateOnly(now);
  const triggerType = options.triggerType || 'manual';
  const logTag = options.logTag || '[打新日历同步]';
  const issueAfterRaw = String(options.issueDateAfterExclusive || '').trim().slice(0, 10) || null;
  const updateAfter = String(options.updateDateAfterExclusive || '').trim().slice(0, 10) || null;
  const progressReporter = options.progressReporter;
  const minSyncDate = isYmd(options.minSyncDate) ? String(options.minSyncDate).slice(0, 10) : NEW_SHARE_MIN_SYNC_DATE;
  from = maxYmd(from, minSyncDate);
  const issueAfter = issueAfterRaw ? maxYmd(issueAfterRaw, minSyncDate) : null;
  const listingDateLookbackDays =
    Math.max(0, Number(options.listingDateLookbackDays || process.env.NEW_SHARE_LISTING_DATE_LOOKBACK_DAYS || 14));
  const hkRecentDays =
    triggerType === 'scheduled' && !issueAfter ? 7 : 0;
  let syncError = null;
  let fullNameResult = { total: 0, updated: 0, skipped: 0, failed: 0 };
  let backfillResult = { total: 0, updated: 0, skipped: 0, failed: 0 };

  console.log(
    `${logTag} 执行开始 from=${from} to=${to} trigger=${triggerType}` +
      (issueAfter ? ` issueDate>${issueAfter}` : '') +
      (updateAfter ? ` upDate>=${updateAfter}` : '') +
      (issueAfter ? ` listingDateLookbackDays=${listingDateLookbackDays}` : '')
  );
  await reportProgress(
    progressReporter,
    `执行开始 from=${from} to=${to} trigger=${triggerType}${issueAfter ? ` issueDate>${issueAfter}` : ''}${updateAfter ? ` upDate>=${updateAfter}` : ''}`
  );
  console.log(`${logTag} 阶段1/4 开始抓取源数据（AkShare + 港交所）`);
  await reportProgress(progressReporter, '阶段1/4 开始抓取源数据（AkShare + 港交所）');
  let result = null;
  try {
    const fetched = runNewShareAkSync({
      startDate: from,
      endDate: to,
      hkRecentDays,
      issueDateAfterExclusive: issueAfter,
      updateDateAfterExclusive: updateAfter,
      listingDateLookbackDays: issueAfter ? listingDateLookbackDays : 0,
      logTag,
    });
    if (!fetched.ok) {
      const err = new Error(shortenNewShareSyncError(fetched.stderr || '打新日历抓取失败'));
      err.causeDetail = String(fetched.stderr || '').slice(0, 4000);
      throw err;
    }
    if (fetched.hkWarning) {
      console.warn(`${logTag} 阶段1/4 港股源告警（已继续A股流程）: ${String(fetched.hkWarning).slice(0, 500)}`);
    }
    console.log(
      `${logTag} 阶段1/4 抓取完成 sourceRows=${Number((fetched.summary && fetched.summary.sourceRows) || 0)}`
    );
    await reportProgress(
      progressReporter,
      `阶段1/4 抓取完成 sourceRows=${Number((fetched.summary && fetched.summary.sourceRows) || 0)}`
    );
    const rows = fetched.rows || [];
    const filteredRows = rows.filter((row) => {
      const issueDate = String(row.issue_date || '').slice(0, 10);
      const publicDate = String(row.public_date || '').slice(0, 10);
      // 任一业务日期达到下限即可入库；两者都早于下限时丢弃
      if (
        String(issueDate || '').slice(0, 10) < minSyncDate &&
        String(publicDate || '').slice(0, 10) < minSyncDate
      ) {
        return false;
      }
      return true;
    });
    const droppedByMinDate = Math.max(0, rows.length - filteredRows.length);
    if (droppedByMinDate > 0) {
      console.log(`${logTag} 已按最早同步边界 ${minSyncDate} 过滤历史记录 ${droppedByMinDate} 条`);
      await reportProgress(progressReporter, `最早同步日期过滤 ${droppedByMinDate} 条（minSyncDate=${minSyncDate}）`);
    }
    console.log(`${logTag} 阶段2/4 开始入库（候选=${filteredRows.length}）`);
    await reportProgress(progressReporter, `阶段2/4 开始入库（候选=${filteredRows.length}）`);
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const upsertTotal = filteredRows.length;
    const upsertProgressStep = Math.max(1, Math.min(200, Number(process.env.NEW_SHARE_UPSERT_PROGRESS_STEP || 50)));
    let upsertProcessed = 0;
    for (const row of filteredRows) {
      const state = await upsertNewShareRow(row);
      if (state === 'inserted') inserted += 1;
      else if (state === 'updated') updated += 1;
      else skipped += 1;
      upsertProcessed += 1;
      if (upsertProcessed === upsertTotal || upsertProcessed % upsertProgressStep === 0) {
        console.log(
          `${logTag} 入库进度 ${upsertProcessed}/${upsertTotal}（inserted=${inserted} updated=${updated} skipped=${skipped}）`
        );
        await reportProgress(
          progressReporter,
          `阶段2/4 入库进度 ${upsertProcessed}/${upsertTotal}（inserted=${inserted} updated=${updated} skipped=${skipped}）`
        );
      }
    }
    console.log(`${logTag} 阶段2/4 入库完成`);
    await reportProgress(progressReporter, '阶段2/4 入库完成');
    backfillResult = await backfillIncompleteNewShareRows(logTag, minSyncDate, progressReporter);
    console.log(
      `${logTag} 阶段2b/4 库内补全 updated=${Number(backfillResult.updated || 0)} skipped=${Number(backfillResult.skipped || 0)} failed=${Number(backfillResult.failed || 0)}`
    );
    console.log(`${logTag} 阶段3/4 开始补抓首日指标`);
    await reportProgress(progressReporter, '阶段3/4 开始补抓首日指标');
    const refreshResult = await refreshNewShareDailyMetrics(filteredRows, logTag, minSyncDate, progressReporter);
    console.log(
      `${logTag} 阶段3/4 完成 refreshed=${refreshResult.refreshed} updated=${refreshResult.refreshedUpdated} failed=${Number(refreshResult.failed || 0)}`
    );
    result = {
      from,
      to,
      minSyncDate,
      triggerType,
      fetched: filteredRows.length,
      filteredOutByMinDate: droppedByMinDate,
      inserted,
      updated,
      skipped,
      sourceRows: Number((fetched.summary && fetched.summary.sourceRows) || 0),
      dailyMetricsRefreshed: refreshResult.refreshed,
      dailyMetricsUpdated: refreshResult.refreshedUpdated,
      dailyMetricsFailed: Number(refreshResult.failed || 0),
      dailyMetricsCandidates: Number(refreshResult.candidates || 0),
      backfillTotal: Number(backfillResult.total || 0),
      backfillUpdated: Number(backfillResult.updated || 0),
      backfillSkipped: Number(backfillResult.skipped || 0),
      backfillFailed: Number(backfillResult.failed || 0),
      message: '打新日历同步完成',
      executedAt: new Date().toISOString(),
    };
  } catch (err) {
    syncError = err;
    const shortMsg = shortenNewShareSyncError(err);
    const continueHint = options.skipFullNameBackfill
      ? '主流程失败（已跳过AI全称补齐）'
      : '主流程失败，仍将继续执行AI全称补齐';
    console.warn(`${logTag} ${continueHint} err=${shortMsg}`);
    await reportProgress(progressReporter, `${continueHint}：${shortMsg}`);
  } finally {
    if (options.skipFullNameBackfill) {
      console.log(`${logTag} 阶段4/4 跳过企业全称AI补齐（skipFullNameBackfill=1）`);
      await reportProgress(progressReporter, '阶段4/4 跳过企业全称AI补齐');
    } else {
      console.log(`${logTag} 阶段4/4 开始企业全称AI补齐`);
      await reportProgress(progressReporter, '阶段4/4 开始企业全称AI补齐');
      try {
        fullNameResult = await backfillNewShareEnterpriseFullNames(logTag, minSyncDate);
        console.log(
          `${logTag} 阶段4/4 完成 total=${Number(fullNameResult.total || 0)} updated=${Number(fullNameResult.updated || 0)} skipped=${Number(fullNameResult.skipped || 0)} failed=${Number(fullNameResult.failed || 0)}`
        );
        await reportProgress(
          progressReporter,
          `阶段4/4 完成 total=${Number(fullNameResult.total || 0)} updated=${Number(fullNameResult.updated || 0)} skipped=${Number(fullNameResult.skipped || 0)} failed=${Number(fullNameResult.failed || 0)}`
        );
      } catch (fullNameErr) {
        console.warn(`${logTag} AI全称补齐执行失败 err=${String(fullNameErr.message || fullNameErr)}`);
        await reportProgress(progressReporter, `AI全称补齐执行失败：${String(fullNameErr.message || fullNameErr)}`);
        if (!syncError) syncError = fullNameErr;
      }
    }
  }
  if (syncError) {
    const short = new Error(shortenNewShareSyncError(syncError));
    short.causeDetail = String(syncError.message || syncError).slice(0, 4000);
    throw short;
  }
  result.fullNameBackfillTotal = Number(fullNameResult.total || 0);
  result.fullNameBackfillUpdated = Number(fullNameResult.updated || 0);
  result.fullNameBackfillSkipped = Number(fullNameResult.skipped || 0);
  result.fullNameBackfillFailed = Number(fullNameResult.failed || 0);
  console.log(`${logTag} 执行完成`, result);
  await reportProgress(
    progressReporter,
    `执行完成 fetched=${result.fetched} inserted=${result.inserted} updated=${result.updated} skipped=${result.skipped}`
  );
  return result;
}

/**
 * 定向补抓首日指标（邮件保底二次重试用）。
 * 港股默认 skipEtnet，优先东财 K 线，避免经济通再次拖死。
 */
async function refreshFirstDayMetricsForRows(rows, options = {}) {
  const logTag = options.logTag || '[打新日历-首日指标定向补齐]';
  const forceSkipEtnet = options.forceSkipEtnet !== false;
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  let updated = 0;
  let failed = 0;
  let skipped = 0;
  for (const row of list) {
    const listDate = String(row.public_date || '').slice(0, 10);
    if (!isYmd(listDate)) {
      skipped += 1;
      continue;
    }
    const market = String(row.exchange || '').trim() === '港交所' ? 'hk' : 'a';
    const timeoutMs =
      market === 'hk'
        ? Math.max(30000, Number(process.env.NEW_SHARE_METRICS_ITEM_TIMEOUT_MS_HK || 120000))
        : Math.max(10000, Number(process.env.NEW_SHARE_METRICS_ITEM_TIMEOUT_MS || 70000));
    try {
      const fetched = await withTimeout(
        runNewShareMetricsSyncWithFallback({
          stockCode: row.stock_code,
          listDate,
          market,
          logTag: `${logTag}[${row.stock_code}]`,
          skipEtnet: forceSkipEtnet && market === 'hk',
        }),
        timeoutMs,
        `首日指标超时(${timeoutMs}ms)`
      );
      if (!fetched.ok || !fetched.firstRow) {
        failed += 1;
        console.warn(
          `${logTag} 失败 stock=${row.stock_code} exchange=${row.exchange || ''} reason=${String(fetched.stderr || 'missing').slice(0, 200)}`
        );
        continue;
      }
      const first = fetched.firstRow || {};
      const close = first.close != null && Number.isFinite(Number(first.close)) ? Number(first.close) : null;
      let chgPct = first.chg_pct != null && Number.isFinite(Number(first.chg_pct)) ? Number(first.chg_pct) : null;
      const fetchedIssuePrice =
        fetched.issuePrice != null && Number.isFinite(Number(fetched.issuePrice)) ? Number(fetched.issuePrice) : null;
      if (chgPct == null && close != null) {
        const issuePx =
          fetchedIssuePrice != null
            ? fetchedIssuePrice
            : row.issue_price != null && Number.isFinite(Number(row.issue_price))
              ? Number(row.issue_price)
              : null;
        chgPct = computeFirstDayChgPctFromPrices(close, issuePx);
      }
      const totalIssuedShares =
        row.total_issued_shares != null && Number.isFinite(Number(row.total_issued_shares)) && Number(row.total_issued_shares) > 0
          ? Number(row.total_issued_shares)
          : fetched.totalShares != null && Number.isFinite(Number(fetched.totalShares))
            ? Number(fetched.totalShares)
            : null;
      const state = await upsertNewShareRow({
        ...row,
        issue_price:
          row.issue_price != null && Number.isFinite(Number(row.issue_price)) && Number(row.issue_price) > 0
            ? Number(row.issue_price)
            : fetchedIssuePrice,
        total_issued_shares: normalizePositiveOrNull(totalIssuedShares ?? row.total_issued_shares ?? null),
        first_day_close: normalizePositiveOrNull(close),
        first_day_chg_pct: normalizeChgPctOrNull(chgPct),
        first_day_market_cap: normalizePositiveOrNull(calcFirstDayMarketCap(close, totalIssuedShares)),
      });
      if (state === 'updated' || state === 'inserted') updated += 1;
      else skipped += 1;
      console.log(
        `${logTag} 成功 stock=${row.stock_code} close=${close ?? 'null'} chgPct=${chgPct ?? 'null'} source=${fetched.source || '-'} state=${state}`
      );
    } catch (err) {
      failed += 1;
      console.warn(
        `${logTag} 失败 stock=${row.stock_code} exchange=${row.exchange || ''} reason=${String(err.message || err).slice(0, 200)}`
      );
    }
  }
  return { total: list.length, updated, failed, skipped };
}

module.exports = {
  syncNewShareCalendar,
  shortenNewShareSyncError,
  refreshFirstDayMetricsForRows,
  refreshNewShareEnterpriseFullNamesByIds,
  backfillNewShareEnterpriseFullNamesDomesticPool,
};

