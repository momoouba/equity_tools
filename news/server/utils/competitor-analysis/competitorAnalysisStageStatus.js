/**
 * 投前竞品分析列表状态，以及点击后的阶段完成时间。
 * 完成时间取 sourcing_competitor_run_step_log 的写入时间。
 */

const STAGES = [
  { label: '准备画像', doneCodes: ['S0_profile'] },
  { label: '内部召回', doneCodes: ['S1_recall'] },
  { label: '规则打分', doneCodes: ['S2_rule'] },
  { label: 'LLM 对标', doneCodes: ['S3_llm'] },
  { label: '联网发现', doneCodes: ['S4_web'] },
  { label: '校验与写入', doneCodes: ['S6_done'] },
];

const ACTIVE_RUN = new Set(['queued', 'running']);
const MEANINGFUL_RUN = new Set(['queued', 'running', 'success', 'failed']);

function toEpochMs(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const t = new Date(`${s.replace(' ', 'T')}+08:00`).getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function formatBeijingDateTime(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ').slice(0, 19);
}

/** 去掉为 0 的单位。不满 1 小时用「分」，有小时用「分钟」。 */
function formatStageDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    const parts = [`${hours}小时`];
    if (minutes > 0) parts.push(`${minutes}分钟`);
    if (seconds > 0) parts.push(`${seconds}秒`);
    return parts.join('');
  }
  if (minutes > 0) {
    const parts = [`${minutes}分`];
    if (seconds > 0) parts.push(`${seconds}秒`);
    return parts.join('');
  }
  return `${seconds}秒`;
}

function latestOkMs(logs, codes) {
  let best = null;
  for (const log of logs || []) {
    const code = String(log.step_code || '').trim();
    if (!codes.includes(code)) continue;
    if (String(log.status || '').toLowerCase() === 'failed') continue;
    const ms = toEpochMs(log.created_at);
    if (ms == null) continue;
    if (best == null || ms >= best) best = ms;
  }
  return best;
}

/**
 * @param {{ status?: string, startedAt?: *, logs?: object[], nowMs?: number }} input
 */
function buildStageTimeline({ status, startedAt, logs, nowMs }) {
  const runStatus = String(status || '').toLowerCase();
  const running = ACTIVE_RUN.has(runStatus);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let prevMs = toEpochMs(startedAt);
  let markedCurrent = false;
  const stages = STAGES.map((stage) => {
    const doneMs = latestOkMs(logs, stage.doneCodes);
    if (doneMs != null) {
      const durationMs = prevMs != null ? doneMs - prevMs : null;
      prevMs = doneMs;
      return {
        label: stage.label,
        state: 'done',
        finished_at: formatBeijingDateTime(doneMs),
        duration_text: formatStageDuration(durationMs),
      };
    }
    if (running && !markedCurrent) {
      markedCurrent = true;
      const durationMs = prevMs != null ? now - prevMs : null;
      prevMs = null;
      return {
        label: stage.label,
        state: 'running',
        finished_at: '',
        duration_text: formatStageDuration(durationMs),
      };
    }
    prevMs = null;
    return {
      label: stage.label,
      state: 'pending',
      finished_at: '',
      duration_text: '',
    };
  });
  const hasDone = stages.some((s) => s.state === 'done');
  const hint = !running && !hasDone ? '这次分析没有留下阶段日志' : '';
  return { stages, hint };
}

function currentStageLabel(timeline) {
  const running = timeline.stages.find((s) => s.state === 'running');
  if (running) return running.label;
  const lastDone = [...timeline.stages].reverse().find((s) => s.state === 'done');
  return lastDone ? lastDone.label : STAGES[0].label;
}

function resolveListStatus(pipelineStatus, run, logs, nowMs) {
  const fallback = pipelineStatus != null ? String(pipelineStatus) : '';
  if (!run) return { label: fallback, clickable: false, runId: '' };
  const status = String(run.status || '').toLowerCase();
  if (!MEANINGFUL_RUN.has(status)) return { label: fallback, clickable: false, runId: '' };
  if (ACTIVE_RUN.has(status)) {
    const timeline = buildStageTimeline({
      status,
      startedAt: run.started_at || run.created_at,
      logs,
      nowMs,
    });
    return { label: currentStageLabel(timeline), clickable: true, runId: String(run.id || '') };
  }
  if (status === 'success') return { label: '已完成分析', clickable: true, runId: String(run.id || '') };
  if (status === 'failed') return { label: '分析失败', clickable: true, runId: String(run.id || '') };
  return { label: fallback, clickable: false, runId: '' };
}

function pickLatestMeaningfulRun(runs) {
  const list = Array.isArray(runs) ? runs : [];
  return (
    list.find((run) => MEANINGFUL_RUN.has(String(run.status || '').toLowerCase())) || null
  );
}

async function attachPreInvestmentAnalysisStatus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = list.map((row) => String(row.id || '').trim()).filter(Boolean);
  for (const row of list) {
    row.analysis_status_label = row.pipeline_status != null ? String(row.pipeline_status) : '';
    row.analysis_status_clickable = false;
  }
  if (!ids.length) return list;

  const db = require('../../db');
  const runs = await db.query(
    `SELECT F_Id AS id, pre_investment_project_id AS project_id, status, started_at, F_CreatorTime AS created_at
     FROM sourcing_pre_investment_competitor_run
     WHERE pre_investment_project_id IN (?) AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC, F_Id DESC`,
    [ids]
  );
  const latestByProject = new Map();
  for (const run of runs) {
    const projectId = String(run.project_id || '');
    if (!projectId || latestByProject.has(projectId)) continue;
    if (!MEANINGFUL_RUN.has(String(run.status || '').toLowerCase())) continue;
    latestByProject.set(projectId, run);
  }

  const activeIds = [...latestByProject.values()]
    .filter((run) => ACTIVE_RUN.has(String(run.status || '').toLowerCase()))
    .map((run) => String(run.id));
  const logsByRun = new Map();
  if (activeIds.length) {
    const logs = await db.query(
      `SELECT run_id, step_code, status, F_CreatorTime AS created_at
       FROM sourcing_competitor_run_step_log
       WHERE run_id IN (?) AND subject_type = 'pre_investment_project'
       ORDER BY F_CreatorTime ASC, F_Id ASC`,
      [activeIds]
    );
    for (const log of logs) {
      const runId = String(log.run_id || '');
      if (!logsByRun.has(runId)) logsByRun.set(runId, []);
      logsByRun.get(runId).push(log);
    }
  }

  for (const row of list) {
    const run = latestByProject.get(String(row.id || ''));
    const resolved = resolveListStatus(
      row.pipeline_status,
      run,
      run ? logsByRun.get(String(run.id)) || [] : []
    );
    row.analysis_status_label = resolved.label;
    row.analysis_status_clickable = resolved.clickable;
  }
  return list;
}

async function loadPreInvestmentAnalysisStages(projectId) {
  const id = String(projectId || '').trim();
  const db = require('../../db');
  const runs = await db.query(
    `SELECT F_Id AS id, status, started_at, F_CreatorTime AS created_at
     FROM sourcing_pre_investment_competitor_run
     WHERE pre_investment_project_id = ? AND F_DeleteMark = 0
     ORDER BY F_CreatorTime DESC, F_Id DESC`,
    [id]
  );
  const run = pickLatestMeaningfulRun(runs);
  if (!run) {
    return { run_id: '', run_status: '', stages: [], hint: '' };
  }
  const logs = await db.query(
    `SELECT step_code, status, F_CreatorTime AS created_at
     FROM sourcing_competitor_run_step_log
     WHERE run_id = ? AND subject_type = 'pre_investment_project'
     ORDER BY F_CreatorTime ASC, F_Id ASC`,
    [String(run.id)]
  );
  const timeline = buildStageTimeline({
    status: run.status,
    startedAt: run.started_at || run.created_at,
    logs,
  });
  return {
    run_id: String(run.id),
    run_status: String(run.status || ''),
    stages: timeline.stages,
    hint: timeline.hint,
  };
}

module.exports = {
  STAGES,
  formatStageDuration,
  buildStageTimeline,
  resolveListStatus,
  pickLatestMeaningfulRun,
  attachPreInvestmentAnalysisStatus,
  loadPreInvestmentAnalysisStages,
};
