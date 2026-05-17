/**
 * 竞品分析流水线：控制台过程日志（与 sourcing_competitor_run_step_log 双写，便于本地/服务器排查）。
 * 设置环境变量 COMPETITOR_ANALYSIS_LOG=0 可关闭控制台输出（仍写库）。
 */

const LOG_TAG = '[competitorRunner]';
const AI_TAG = '[competitorAi]';

function isConsoleEnabled() {
  const v = process.env.COMPETITOR_ANALYSIS_LOG;
  if (v === '0' || v === 'false') return false;
  return true;
}

function stringifyDetail(detail, maxLen = 2400) {
  if (detail == null) return '';
  try {
    const s = typeof detail === 'string' ? detail : JSON.stringify(detail);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(detail).slice(0, maxLen);
  }
}

function logCompetitorRun(runId, stepCode, message, detail) {
  if (!isConsoleEnabled()) return;
  const rid = runId || '-';
  const step = stepCode || 'step';
  const msg = message || '';
  if (detail != null && detail !== '') {
    console.log(`${LOG_TAG} run=${rid} [${step}] ${msg}`, stringifyDetail(detail));
  } else {
    console.log(`${LOG_TAG} run=${rid} [${step}] ${msg}`);
  }
}

function logCompetitorAi(runId, phase, message, detail) {
  if (!isConsoleEnabled()) return;
  const rid = runId || '-';
  const ph = phase || 'ai';
  const msg = message || '';
  if (detail != null && detail !== '') {
    console.log(`${AI_TAG} run=${rid} [${ph}] ${msg}`, stringifyDetail(detail));
  } else {
    console.log(`${AI_TAG} run=${rid} [${ph}] ${msg}`);
  }
}

/** 规则分/落库候选摘要（控制条数，避免刷屏） */
function summarizeCandidates(list, limit = 8) {
  return (list || []).slice(0, limit).map((c) => ({
    name: c.display_name,
    credit: c.unified_credit_code || null,
    internal: c.internalScore,
    llm: c.llmProductScore,
    final: c.finalScore,
    grade: c.grade,
    sources: c.sources || (c.source ? [c.source] : []),
    hasInternal: c.hasInternal,
  }));
}

module.exports = {
  LOG_TAG,
  AI_TAG,
  logCompetitorRun,
  logCompetitorAi,
  summarizeCandidates,
  isConsoleEnabled,
};
