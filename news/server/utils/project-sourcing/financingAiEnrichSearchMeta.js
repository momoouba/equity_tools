/**
 * 融资/被投/投前/底层 — 联网 AI 增强日志：调用方式与联网状态（落库 + 接口展示）。
 */

const INVOKE_MODE = {
  CHAT_WITH_SEARCH: 'chat_with_search',
  CHAT_WITH_SEARCH_THINKING: 'chat_with_search_thinking',
  CHAT_NO_SEARCH: 'chat_no_search',
  BATCH_FILE: 'batch_file',
  REUSE_DONOR: 'reuse_donor',
  REUSE_EXISTING: 'reuse_existing',
};

function boolToDbTinyint(v) {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  return null;
}

/** @param {{ used_enable_search?: boolean, search_degraded?: boolean, used_enable_thinking?: boolean, thinking_degraded?: boolean }} llmOut */
function searchMetaFromLlmCall(llmOut) {
  const searchDegraded = !!(llmOut && llmOut.search_degraded);
  const thinkingDegraded = !!(llmOut && llmOut.thinking_degraded);
  const usedSearch = !!(llmOut && llmOut.used_enable_search);
  const usedThinking = !!(llmOut && llmOut.used_enable_thinking);

  let invoke_mode = INVOKE_MODE.CHAT_NO_SEARCH;
  if (usedSearch && usedThinking) {
    invoke_mode = INVOKE_MODE.CHAT_WITH_SEARCH_THINKING;
  } else if (usedSearch) {
    invoke_mode = INVOKE_MODE.CHAT_WITH_SEARCH;
  }

  return {
    invoke_mode,
    used_enable_search: usedSearch,
    search_degraded: searchDegraded,
    used_enable_thinking: usedThinking,
    thinking_degraded: thinkingDegraded,
  };
}

function searchMetaForBatchFile() {
  return {
    invoke_mode: INVOKE_MODE.BATCH_FILE,
    used_enable_search: false,
    search_degraded: false,
    used_enable_thinking: false,
    thinking_degraded: false,
  };
}

function searchMetaForReuseDonor() {
  return {
    invoke_mode: INVOKE_MODE.REUSE_DONOR,
    used_enable_search: null,
    search_degraded: null,
    used_enable_thinking: null,
    thinking_degraded: null,
  };
}

function searchMetaForReuseExisting() {
  return {
    invoke_mode: INVOKE_MODE.REUSE_EXISTING,
    used_enable_search: null,
    search_degraded: null,
    used_enable_thinking: null,
    thinking_degraded: null,
  };
}

/**
 * @param {{ invoke_mode?: string|null, used_enable_search?: number|boolean|null, search_degraded?: number|boolean|null, used_enable_thinking?: number|boolean|null, thinking_degraded?: number|boolean|null }} row
 */
function formatSearchStatusLabel(row) {
  const mode = row && row.invoke_mode != null ? String(row.invoke_mode) : '';
  const searchDegraded = row && (row.search_degraded === 1 || row.search_degraded === true);
  const thinkingDegraded = row && (row.thinking_degraded === 1 || row.thinking_degraded === true);
  const usedThinking = row && (row.used_enable_thinking === 1 || row.used_enable_thinking === true);

  if (mode === INVOKE_MODE.REUSE_DONOR) return '未调模型（复用同主体）';
  if (mode === INVOKE_MODE.REUSE_EXISTING) return '未调模型（本行已有AI）';
  if (mode === INVOKE_MODE.BATCH_FILE) return '批量Batch（未开联网）';
  if (mode === INVOKE_MODE.CHAT_WITH_SEARCH_THINKING) {
    if (thinkingDegraded) return '实时Chat（联网，深度思考已降级）';
    if (searchDegraded) return '实时Chat（深度思考，联网已降级）';
    return '实时Chat（联网+深度思考）';
  }
  if (mode === INVOKE_MODE.CHAT_WITH_SEARCH) {
    if (thinkingDegraded) return '实时Chat（已开联网，深度思考已降级）';
    return '实时Chat（已开联网）';
  }
  if (mode === INVOKE_MODE.CHAT_NO_SEARCH) {
    if (searchDegraded && thinkingDegraded) return '实时Chat（联网与思考均已降级）';
    if (searchDegraded) return '实时Chat（联网已降级）';
    if (usedThinking && thinkingDegraded) return '实时Chat（深度思考已降级）';
    return '实时Chat（未开联网）';
  }
  const used = row && row.used_enable_search;
  if (used === 1 || used === true) {
    if (usedThinking && !thinkingDegraded) return '联网+深度思考';
    if (thinkingDegraded) return '联网（思考已降级）';
    return searchDegraded ? '联网已降级' : '已开联网';
  }
  if (used === 0 || used === false) {
    return searchDegraded ? '联网已降级' : '未开联网';
  }
  return '—';
}

function attachSearchStatusLabel(rows) {
  return (rows || []).map((r) => ({
    ...r,
    search_status_label: formatSearchStatusLabel(r),
  }));
}

/** SQL 片段：success UPDATE 末尾追加三列 */
function searchMetaSqlAssignments() {
  return `invoke_mode = ?,
       used_enable_search = ?,
       search_degraded = ?,
       used_enable_thinking = ?,
       thinking_degraded = ?`;
}

function searchMetaSqlValues(meta) {
  const m = meta || {};
  return [
    m.invoke_mode != null ? String(m.invoke_mode) : null,
    boolToDbTinyint(m.used_enable_search),
    boolToDbTinyint(m.search_degraded),
    boolToDbTinyint(m.used_enable_thinking),
    boolToDbTinyint(m.thinking_degraded),
  ];
}

module.exports = {
  INVOKE_MODE,
  boolToDbTinyint,
  searchMetaFromLlmCall,
  searchMetaForBatchFile,
  searchMetaForReuseDonor,
  searchMetaForReuseExisting,
  formatSearchStatusLabel,
  attachSearchStatusLabel,
  searchMetaSqlAssignments,
  searchMetaSqlValues,
};
