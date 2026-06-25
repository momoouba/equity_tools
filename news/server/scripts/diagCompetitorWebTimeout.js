/**
 * 诊断 S4 联网超时配置
 * 用法: node server/scripts/diagCompetitorWebTimeout.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../db');
const { resolveLlmProfile } = require('../utils/llm/llmProfile');
const {
  isGatewayAsyncResponsesEnabled,
  getResponsesPollIntervalMs,
  getResponsesPollMaxMs,
} = require('../utils/llm/gatewayAsync');

async function main() {
  for (let i = 0; i < 30; i++) {
    try {
      await db.query('SELECT 1');
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const webTimeout = parseInt(process.env.COMPETITOR_WEB_TIMEOUT_MS || '180000', 10) || 180000;
  const asyncEnabled = isGatewayAsyncResponsesEnabled();

  console.log('=== 环境变量 ===');
  console.log('COMPETITOR_WEB_TIMEOUT_MS', process.env.COMPETITOR_WEB_TIMEOUT_MS || '(default 180000)', '→', webTimeout);
  console.log('COMPETITOR_WEB_RETRIES', process.env.COMPETITOR_WEB_RETRIES || '(default 3)');
  console.log('LLM_GATEWAY_ASYNC_RESPONSES', process.env.LLM_GATEWAY_ASYNC_RESPONSES ?? '(default 1)', '→ async=', asyncEnabled);
  console.log('LLM_RESPONSES_POLL_INTERVAL_MS', getResponsesPollIntervalMs());
  console.log('LLM_RESPONSES_POLL_MAX_MS', getResponsesPollMaxMs());

  console.log('\n=== openaiResponses 实际超时（代码逻辑）===');
  console.log('POST / poll GET 均使用传入 timeout（COMPETITOR_WEB_TIMEOUT_MS 等），默认 120000，竞品 S4 默认 180000');

  const rows = await db.query(
    `SELECT config_name, model_name, api_endpoint, provider, wire_protocol, web_search_mode, is_active
     FROM ai_model_config
     WHERE F_DeleteMark = 0 AND usage_type = 'competitor_match'
     ORDER BY is_active DESC, F_LastModifyTime DESC LIMIT 3`
  );

  console.log('\n=== 竞品 AI 模型配置 ===');
  for (const r of rows) {
    const p = resolveLlmProfile(r);
    const willAsync = p.is_gateway && asyncEnabled;
    const effectiveSubmit = webTimeout;
    console.log(`\n[${r.is_active ? 'ACTIVE' : 'inactive'}] ${r.config_name}`);
    console.log('  model:', r.model_name);
    console.log('  endpoint:', r.api_endpoint);
    console.log('  wire:', p.wire_protocol, '| search:', p.web_search_mode);
    console.log('  is_gateway:', p.is_gateway, '| S4 POST/poll 单次超时:', effectiveSubmit, 'ms');
    console.log('  background poll 上限:', getResponsesPollMaxMs(), 'ms');
  }

  const logs = await db.query(
    `SELECT run_id, step_code, status, message, detail_json, F_CreatorTime
     FROM sourcing_competitor_run_step_log
     WHERE step_code = 'S4_web'
     ORDER BY F_CreatorTime DESC LIMIT 5`
  );
  console.log('\n=== 最近 S4_web step log ===');
  for (const l of logs) {
    console.log(l.F_CreatorTime, l.status, l.message?.slice(0, 120));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
