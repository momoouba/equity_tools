/**
 * 竞品分析异步任务进度：按流水线步骤权重估算百分比与 ETA（供说明弹窗轮询展示）。
 */

const STEP_PIPELINE = [
  { code: 'S0_profile', label: '准备主体画像', weight: 5 },
  { code: 'S1_recall', label: '内部数据召回', weight: 10 },
  { code: 'S2_rule', label: '规则打分', weight: 5 },
  { code: 'S3_llm', label: 'LLM 产品对标', weight: 35 },
  { code: 'S4_web', label: '联网发现', weight: 12 },
  { code: 'S5_validate', label: '竞品校验', weight: 15 },
  { code: 'S5_filter', label: '初筛与打分', weight: 10 },
  { code: 'S5_expand', label: '扩召回（若触发）', weight: 3, optional: true },
  { code: 'S6_done', label: '写入结果', weight: 5 },
];

const TERMINAL_STATUS = new Set(['success', 'failed']);

function latestStepMap(steps) {
  const m = new Map();
  for (const s of steps || []) {
    const code = String(s.step_code || '').trim();
    if (!code) continue;
    const prev = m.get(code);
    if (!prev || String(s.F_CreatorTime) > String(prev.F_CreatorTime)) {
      m.set(code, s);
    }
  }
  return m;
}

/**
 * @param {object|null} run sourcing_*_competitor_run 一行
 * @param {object[]} steps sourcing_competitor_run_step_log 列表
 */
function computeRunProgress(run, steps) {
  const status = String(run?.status || '').trim() || 'unknown';
  const isRunning = status === 'queued' || status === 'running';
  const isDone = status === 'success';
  const isFailed = status === 'failed';
  const byCode = latestStepMap(steps);

  let completedWeight = 0;
  let totalWeight = 0;
  let currentStep = null;
  let currentLabel = null;

  for (const step of STEP_PIPELINE) {
    if (step.optional && !byCode.has(step.code)) continue;
    totalWeight += step.weight;
    if (byCode.has(step.code)) {
      completedWeight += step.weight;
    } else if (!currentStep && isRunning) {
      currentStep = step.code;
      currentLabel = step.label;
    }
  }

  let percent = totalWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 0;
  if (isDone) {
    percent = 100;
  } else if (isRunning && byCode.size === 0) {
    percent = status === 'queued' ? 2 : 5;
    currentStep = 'S0_profile';
    currentLabel = status === 'queued' ? '排队等待执行' : '启动分析任务';
  } else if (isRunning) {
    percent = Math.min(98, Math.max(percent, 8));
  }
  if (isFailed && percent === 0 && byCode.size > 0) percent = Math.min(95, completedWeight > 0 ? Math.round((completedWeight / totalWeight) * 100) : 10);

  const startedAt = run?.started_at ? new Date(run.started_at) : null;
  let etaHint = null;
  if (isRunning) {
    if (byCode.has('S3_llm') && !byCode.has('S5_validate')) {
      etaHint = '当前为 LLM 对标/校验阶段，通常最耗时（约 2–8 分钟，视候选数量而定）';
    } else if (startedAt && percent >= 10 && percent < 98) {
      const elapsedMs = Date.now() - startedAt.getTime();
      if (elapsedMs > 5000) {
        const estimatedTotalMs = (elapsedMs / percent) * 100;
        const remainMs = Math.max(0, estimatedTotalMs - elapsedMs);
        const remainMin = Math.ceil(remainMs / 60000);
        if (remainMin <= 1) etaHint = '预计不足 1 分钟';
        else if (remainMin <= 10) etaHint = `预计还需约 ${remainMin} 分钟`;
        else etaHint = '预计还需数分钟';
      }
    }
    if (!etaHint) {
      etaHint = '任务执行中，本页将每 3 秒自动刷新进度';
    }
  }

  const completedSteps = STEP_PIPELINE.filter((s) => byCode.has(s.code)).map((s) => {
    const row = byCode.get(s.code);
    return {
      code: s.code,
      label: s.label,
      message: row?.message || '',
      status: row?.status || 'ok',
    };
  });

  const statusLabel =
    status === 'queued'
      ? '排队中'
      : status === 'running'
        ? '分析中'
        : status === 'success'
          ? '已完成'
          : status === 'failed'
            ? '失败'
            : status;

  return {
    status,
    status_label: statusLabel,
    is_running: isRunning,
    is_terminal: TERMINAL_STATUS.has(status),
    percent,
    current_step: currentStep,
    current_step_label: currentLabel,
    eta_hint: etaHint,
    completed_steps: completedSteps,
    started_at: run?.started_at || null,
    finished_at: run?.finished_at || null,
    step_total: STEP_PIPELINE.filter((s) => !s.optional || byCode.has(s.code)).length,
    step_done: completedSteps.length,
  };
}

function buildProgressHeader(progress) {
  if (!progress) return '';
  if (!progress.is_running && progress.is_terminal) {
    return progress.status === 'success'
      ? '【执行进度】分析已完成（100%）\n'
      : `【执行进度】分析结束：${progress.status_label}\n`;
  }
  if (!progress.is_running) return '';
  const lines = [
    '【执行进度】',
    `状态：${progress.status_label}（约 ${progress.percent}%）`,
    progress.current_step_label ? `当前阶段：${progress.current_step_label}` : null,
    progress.eta_hint ? `时间参考：${progress.eta_hint}` : null,
    `已完成步骤：${progress.step_done} / ${progress.step_total}`,
    '说明：下方日志随分析推进自动更新；关闭弹窗后可再次打开「竞品分析说明」继续查看。',
    '',
  ];
  return lines.filter(Boolean).join('\n');
}

module.exports = {
  STEP_PIPELINE,
  computeRunProgress,
  buildProgressHeader,
};
