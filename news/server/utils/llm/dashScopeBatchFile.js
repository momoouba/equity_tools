'use strict';

const axios = require('axios');
const FormDataMultipart = require('form-data');
const {
  compatibleModeV1BaseUrl,
  formatDashScopeHttpError,
} = require('../dashScopeOpenAICompat');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function executeWithDeadlockRetry(db, sql, params, retries = 8) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await db.execute(sql, params);
    } catch (err) {
      if (err && err.code === 'ER_LOCK_DEADLOCK' && attempt < retries) {
        await sleep(Math.min(3000, 200 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function dashScopeCompatibleFetchJson(url, apiKey, init = {}) {
  const headers = { Authorization: `Bearer ${apiKey}`, ...(init.headers || {}) };
  const r = await fetch(url, { ...init, headers });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _raw: text };
  }
  if (!r.ok) {
    const detail =
      (data &&
        typeof data === 'object' &&
        (data.error?.message ||
          data.message ||
          (typeof data.error === 'string' ? data.error : '') ||
          '')) ||
      text ||
      r.statusText;
    throw new Error(`HTTP ${r.status}: ${detail}`);
  }
  return data;
}

function isRetryableDashScopeUploadError(err) {
  const status = err?.response?.status;
  if (status === 429 || status === 502 || status === 503) return true;
  const msg = formatDashScopeHttpError(err);
  return /429|too many requests|rate limit/i.test(msg);
}

async function uploadDashScopeBatchJsonl(baseUrl, apiKey, jsonlUtf8, filename = 'batch-input.jsonl') {
  const buf = Buffer.from(jsonlUtf8, 'utf8');
  const maxAttempts = Math.max(1, parseInt(process.env.DASHSCOPE_BATCH_UPLOAD_RETRIES || '8', 10) || 8);
  const baseDelayMs = Math.max(
    5000,
    parseInt(process.env.DASHSCOPE_BATCH_UPLOAD_RETRY_MS || '30000', 10) || 30000
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const form = new FormDataMultipart();
    form.append('purpose', 'batch');
    form.append('file', buf, {
      filename,
      contentType: 'application/octet-stream',
    });
    let response;
    try {
      response = await axios.post(`${baseUrl}/files`, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 300000,
      });
    } catch (err) {
      if (attempt < maxAttempts && isRetryableDashScopeUploadError(err)) {
        const delayMs = Math.min(300000, baseDelayMs * attempt);
        console.warn(
          `[dashScopeBatchFile] upload retry ${attempt}/${maxAttempts} in ${delayMs}ms: ${formatDashScopeHttpError(err)}`
        );
        await sleep(delayMs);
        continue;
      }
      throw new Error(`上传 batch 输入文件失败：${formatDashScopeHttpError(err)}`);
    }
    const id = response.data && (response.data.id || response.data.file_id);
    if (!id) throw new Error('上传 batch 输入文件成功但未返回 file id');
    return String(id);
  }
  throw new Error('上传 batch 输入文件失败：重试次数已用尽');
}

async function createDashScopeChatBatch(baseUrl, apiKey, inputFileId) {
  const batchCreate = await dashScopeCompatibleFetchJson(`${baseUrl}/batches`, apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
    }),
  });
  const batchId =
    batchCreate.id || batchCreate.batch_id || batchCreate.batch?.id || batchCreate.data?.id;
  if (!batchId) {
    throw new Error(`创建 Batch 任务未返回 id: ${JSON.stringify(batchCreate).slice(0, 500)}`);
  }
  return String(batchId);
}

function extractBatchStatus(st) {
  return String(st?.status || st?.batch_status || st?.state || '').toLowerCase();
}

function extractOutputFileId(st) {
  return st?.output_file_id || st?.result?.output_file_id || st?.output_file?.id || st?.response?.output_file_id;
}

async function pollDashScopeBatchUntilDone({
  baseUrl,
  apiKey,
  batchId,
  pollMs = 10000,
  pollMaxMs = 4 * 3600 * 1000,
  onPoll,
}) {
  let waited = 0;
  let pollRound = 0;
  let st = null;
  while (waited < pollMaxMs) {
    await sleep(pollMs);
    waited += pollMs;
    pollRound += 1;
    st = await dashScopeCompatibleFetchJson(`${baseUrl}/batches/${batchId}`, apiKey, { method: 'GET' });
    const status = extractBatchStatus(st);
    if (onPoll) {
      onPoll({
        pollRound,
        waited,
        status,
        requestCounts: st?.request_counts || null,
        batch: st,
      });
    }
    if (status === 'completed' || status === 'complete') break;
    if (['failed', 'expired', 'cancelled', 'canceled', 'error'].includes(status)) {
      throw new Error(`Batch 任务结束状态异常: ${status} ${JSON.stringify(st).slice(0, 800)}`);
    }
  }
  const finalStatus = extractBatchStatus(st);
  if (finalStatus !== 'completed' && finalStatus !== 'complete') {
    throw new Error(`Batch 任务轮询超时（${pollMaxMs}ms）最后状态: ${JSON.stringify(st).slice(0, 800)}`);
  }
  const outputFileId = extractOutputFileId(st);
  if (!outputFileId) {
    throw new Error(`Batch 完成但未返回 output_file_id: ${JSON.stringify(st).slice(0, 800)}`);
  }
  return { outputFileId, pollRound, waited };
}

async function downloadDashScopeFileContent(baseUrl, apiKey, fileId) {
  const outResp = await fetch(`${baseUrl}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const outText = await outResp.text();
  if (!outResp.ok) {
    throw new Error(`下载 Batch 输出失败 HTTP ${outResp.status}: ${outText.slice(0, 500)}`);
  }
  return outText;
}

function parseDashScopeBatchOutputLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function extractChatCompletionContent(obj) {
  const errObj = obj.error || obj.response?.body?.error;
  if (errObj) {
    const em =
      typeof errObj === 'string'
        ? errObj
        : errObj.message || errObj.code || JSON.stringify(errObj).slice(0, 400);
    return { ok: false, error: String(em || 'Batch 行错误') };
  }
  const body = obj.response?.body;
  const raw =
    body?.choices?.[0]?.message?.content ?? obj.response?.choices?.[0]?.message?.content ?? null;
  if (raw == null || raw === '') {
    return { ok: false, error: 'Batch 输出缺少 choices[0].message.content' };
  }
  return { ok: true, content: raw };
}

function chatParamsFromConfig(config) {
  const temperature =
    typeof config.temperature === 'string' ? parseFloat(config.temperature) : config.temperature ?? 0.3;
  const maxTokensRaw =
    typeof config.max_tokens === 'string' ? parseInt(config.max_tokens, 10) : config.max_tokens;
  const max_tokens = Number.isFinite(maxTokensRaw) ? Math.min(8000, Math.max(512, maxTokensRaw)) : 4096;
  const top_p = typeof config.top_p === 'string' ? parseFloat(config.top_p) : config.top_p ?? 0.9;
  return { temperature, max_tokens, top_p };
}

/** Structured 抽取：低温 + 足够输出长度，避免 JSON 截断 */
function structuredChatParamsFromConfig(config) {
  const base = chatParamsFromConfig(config);
  return {
    temperature: 0.1,
    max_tokens: Math.max(2048, base.max_tokens),
    top_p: 0.8,
  };
}

/** qwen3.5/3.6/3.7 百炼 Batch 默认开思考模式，structured 需显式关闭 */
function defaultBatchBodyExtrasForModel(modelName) {
  if (/^qwen3\.(5|6|7)/i.test(String(modelName || ''))) {
    return { enable_thinking: false };
  }
  return {};
}

function structuredBatchBodyExtrasForModel(modelName) {
  return {
    ...defaultBatchBodyExtrasForModel(modelName),
    response_format: { type: 'json_object' },
  };
}

function buildChatCompletionsBatchJsonl(requests, modelName, chatParams, batchBodyExtras = null) {
  const extras = batchBodyExtras != null ? batchBodyExtras : defaultBatchBodyExtrasForModel(modelName);
  const lines = requests.map((req) =>
    JSON.stringify({
      custom_id: req.customId,
      method: 'POST',
      url: '/v1/chat/completions',
      body: {
        model: modelName,
        messages: [
          { role: 'system', content: req.systemContent },
          { role: 'user', content: req.userContent },
        ],
        temperature: chatParams.temperature,
        max_tokens: chatParams.max_tokens,
        top_p: chatParams.top_p,
        ...extras,
      },
    })
  );
  return lines.join('\n') + '\n';
}

async function submitDashScopeChatBatch({ config, requests, filename }) {
  if (!requests.length) {
    throw new Error('Batch 请求列表为空');
  }
  const baseUrl = compatibleModeV1BaseUrl(config.api_endpoint);
  const chatParams = chatParamsFromConfig(config);
  const jsonl = buildChatCompletionsBatchJsonl(requests, config.model_name, chatParams);
  const inputFileId = await uploadDashScopeBatchJsonl(baseUrl, config.api_key, jsonl, filename);
  const batchId = await createDashScopeChatBatch(baseUrl, config.api_key, inputFileId);
  return { baseUrl, batchId, inputFileId, requestCount: requests.length };
}

module.exports = {
  compatibleModeV1BaseUrl,
  dashScopeCompatibleFetchJson,
  uploadDashScopeBatchJsonl,
  createDashScopeChatBatch,
  pollDashScopeBatchUntilDone,
  downloadDashScopeFileContent,
  parseDashScopeBatchOutputLines,
  extractChatCompletionContent,
  chatParamsFromConfig,
  structuredChatParamsFromConfig,
  defaultBatchBodyExtrasForModel,
  structuredBatchBodyExtrasForModel,
  buildChatCompletionsBatchJsonl,
  submitDashScopeChatBatch,
};
