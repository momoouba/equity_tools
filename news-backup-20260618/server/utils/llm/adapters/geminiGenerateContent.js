'use strict';

const axios = require('axios');
const { WIRE_PROTOCOL, WEB_SEARCH_MODE } = require('../llmConstants');
const { errorBlob } = require('./openaiResponses');

function buildGeminiContents(systemContent, userContent) {
  const sys = String(systemContent || '').trim();
  const usr = String(userContent || '').trim();
  const parts = [];
  if (sys) parts.push({ text: sys });
  if (usr) parts.push({ text: usr });
  if (!parts.length) parts.push({ text: '' });
  return [{ role: 'user', parts }];
}

function extractGeminiText(data) {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const parts = [];
  for (const cand of candidates) {
    const contentParts = cand?.content?.parts;
    if (!Array.isArray(contentParts)) continue;
    for (const p of contentParts) {
      if (typeof p?.text === 'string' && p.text.trim()) parts.push(p.text.trim());
    }
  }
  return parts.join('\n').trim();
}

function isGeminiSearchRejected(err) {
  const blob = errorBlob(err).toLowerCase();
  const status = err?.response?.status;
  return (
    status === 400 &&
    /google_search|tools|grounding|unsupported|invalid|not supported/i.test(blob)
  );
}

function geminiHeaders(apiKey) {
  const key = String(apiKey || '').trim();
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': key,
    Authorization: `Bearer ${key}`,
  };
}

/**
 * Google Gemini generateContent（DMGateway Gemini 分组）。
 */
async function invokeGeminiGenerateContent({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  maxOutputTokens,
  temperature,
  timeout,
  logPrefix = '[llmGemini]',
}) {
  const body = {
    contents: buildGeminiContents(systemContent, userContent),
  };
  const generationConfig = {};
  if (Number.isFinite(maxOutputTokens)) generationConfig.maxOutputTokens = maxOutputTokens;
  if (Number.isFinite(temperature)) generationConfig.temperature = temperature;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  if (wantSearch) {
    body.tools = [{ google_search: {} }];
  }

  console.log(
    `${logPrefix} POST ${endpoint} model=${model} gemini_generateContent google_search=${wantSearch ? 1 : 0}`
  );

  const response = await axios.post(endpoint, body, {
    headers: geminiHeaders(apiKey),
    timeout: timeout || 180000,
  });

  const grounding = response.data?.candidates?.[0]?.groundingMetadata;
  const hasGrounding =
    wantSearch &&
    (grounding?.webSearchQueries?.length > 0 ||
      grounding?.groundingChunks?.length > 0 ||
      grounding?.searchEntryPoint != null);

  return {
    content: extractGeminiText(response.data),
    raw: response.data,
    used_web_search: !!wantSearch,
    search_degraded: false,
    wire_protocol: WIRE_PROTOCOL.GEMINI_GENERATE_CONTENT,
    web_search_mode: wantSearch ? WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH : WEB_SEARCH_MODE.OFF,
    gemini_grounded: !!hasGrounding,
  };
}

/**
 * 带联网降级的 Gemini generateContent 出口。
 */
async function invokeGeminiGenerateContentWithFallback({
  endpoint,
  apiKey,
  model,
  systemContent,
  userContent,
  wantSearch,
  maxOutputTokens,
  temperature,
  timeout,
  logPrefix = '[llmGemini]',
}) {
  if (!wantSearch) {
    return invokeGeminiGenerateContent({
      endpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      wantSearch: false,
      maxOutputTokens,
      temperature,
      timeout,
      logPrefix,
    });
  }

  try {
    return await invokeGeminiGenerateContent({
      endpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      wantSearch: true,
      maxOutputTokens,
      temperature,
      timeout,
      logPrefix,
    });
  } catch (err) {
    if (!isGeminiSearchRejected(err)) throw err;
    console.warn(
      `${logPrefix} Gemini google_search 被拒，降级无联网 generateContent。详情: ${errorBlob(err)}`
    );
    const plain = await invokeGeminiGenerateContent({
      endpoint,
      apiKey,
      model,
      systemContent,
      userContent,
      wantSearch: false,
      maxOutputTokens,
      temperature,
      timeout,
      logPrefix,
    });
    plain.search_degraded = true;
    plain.used_web_search = false;
    plain.web_search_mode = WEB_SEARCH_MODE.GEMINI_GOOGLE_SEARCH;
    return plain;
  }
}

module.exports = {
  invokeGeminiGenerateContent,
  invokeGeminiGenerateContentWithFallback,
  extractGeminiText,
  buildGeminiContents,
};
