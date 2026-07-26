const db = require('../../db');
const { listCompetitorRunStepLogs } = require('./competitorAnalysisRunner');
const { computeRunProgress, buildProgressHeader } = require('./competitorRunProgress');
const {
  candidateDedupeKey,
  strTrim,
  SCORE_THRESHOLD_PERSIST,
  SCORE_THRESHOLD_HIGH_LLM,
  LLM_HIGH_TRUST_THRESHOLD,
} = require('./competitorMatchUtils');
const { loadInternalDisplayFields } = require('./competitorInternalDisplayLoader');

const SOURCE_LABELS = {
  ipo_project: '底层项目',
  ipo_new_share: '上市主池',
  sourcing_financing_event: '融资事件',
  ai_web: '联网发现',
};

const SCORE_THRESHOLD = SCORE_THRESHOLD_PERSIST;

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parseSources(v) {
  const arr = parseJson(v);
  return Array.isArray(arr) ? arr : [];
}

function dedupeRelations(list) {
  const map = new Map();
  for (const r of list) {
    const key = candidateDedupeKey({
      unified_credit_code: r.unified_credit_code,
      display_name: r.competitor_display_name,
    });
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    const richness = (row) =>
      (strTrim(row.competitor_product_intro).length ? 4 : 0) +
      (strTrim(row.competitor_tags_display).length ? 2 : 0) +
      (Number(row.relevance_score) || 0) / 100;
    if (richness(r) > richness(prev) || new Date(r.F_CreatorTime).getTime() > new Date(prev.F_CreatorTime).getTime()) {
      map.set(key, r);
    }
  }
  return [...map.values()].sort((a, b) => (Number(b.relevance_score) || 0) - (Number(a.relevance_score) || 0));
}

function formatRetainReason(rel) {
  const bd = parseJson(rel.score_breakdown_json) || {};
  const finalScore = Number(bd.final_score ?? rel.relevance_score) || 0;
  const parts = [`综合分 ${finalScore} ≥ ${SCORE_THRESHOLD}（或 LLM 高信任路径 ≥ ${SCORE_THRESHOLD_HIGH_LLM}）`];
  const mode = bd.score_mode;
  if (mode === 'ai_only') parts.push('仅联网源：综合分取 AI 对标分');
  else if (mode === 'internal_0.2_ai_0.8') parts.push('LLM 高信任(≥80)：内部×0.2 + AI×0.8');
  else if (mode === 'internal_0.6_ai_0.4') parts.push('有内部源：内部规则×0.6 + AI×0.4');
  if (bd.internal_score != null) parts.push(`内部规则分 ${bd.internal_score}`);
  if (bd.ai_score != null) parts.push(`AI 对标分 ${bd.ai_score}`);
  if (bd.llm_product_score != null) parts.push(`LLM 产品对标 ${bd.llm_product_score}`);
  const val = bd.validation;
  if (val && val.is_competitor === false) parts.push('（校验标记非竞品，若仍落库请检查历史数据）');
  return parts.join('；');
}

const FINANCING_SKIP_LABELS = {
  config_disabled: '融资事件源已在系统配置中关闭',
  no_project_sourcing_permission: '当前用户无项目挖掘权限，未拉取融资事件',
};

function latestStepByCode(steps, code) {
  let best = null;
  for (const s of steps) {
    if (s.step_code !== code) continue;
    if (!best || String(s.F_CreatorTime) > String(best.F_CreatorTime)) best = s;
  }
  return best;
}

function parseStepDetail(step) {
  if (!step?.detail_json) return null;
  return parseJson(step.detail_json);
}

function formatSourceList(sources) {
  if (!Array.isArray(sources) || !sources.length) return '—';
  return sources.map((x) => SOURCE_LABELS[x] || x).join('、');
}

function formatSummarizedCandidates(arr, max = 12) {
  if (!Array.isArray(arr) || !arr.length) return ['  （无）'];
  return arr.slice(0, max).map((c, i) => {
    const src = formatSourceList(c.sources);
    const scores = [
      c.internal != null ? `规则${c.internal}` : null,
      c.llm != null ? `LLM${c.llm}` : null,
      c.final != null ? `综合${c.final}` : null,
    ]
      .filter(Boolean)
      .join('，');
    const grade = c.grade ? `，${c.grade}级` : '';
    return `  ${i + 1}. ${c.name || '—'}（${scores || '—'}${grade}；来源：${src}）`;
  });
}

function formatRejectedSamples(arr, max = 20) {
  if (!Array.isArray(arr) || !arr.length) return ['  （日志未记录排除样本，见上方统计）'];
  return arr.slice(0, max).map((c, i) => {
    const src = formatSourceList(c.sources);
    const scores = [
      c.internal != null ? `规则${c.internal}` : null,
      c.llm != null ? `LLM${c.llm}` : null,
      c.final != null ? `综合${c.final}` : null,
    ]
      .filter(Boolean)
      .join('，');
    return `  ${i + 1}. ${c.name || '—'}（${scores || '—'}；来源：${src}）\n     排除原因：${c.reason || '—'}`;
  });
}

/** 从步骤日志 detail_json 拼装可读分析过程（召回 / 排除 / 保留） */
function buildProcessNarrative(steps, run) {
  const lines = [];
  if (run) {
    lines.push(
      `最近一次分析运行：${run.F_Id}，状态 ${run.status || '—'}，完成时间 ${run.finished_at || run.F_LastModifyTime || '—'}。`
    );
    if (run.message) lines.push(run.message);
  } else {
    lines.push('尚未找到竞品分析运行记录，请先发起「竞品分析」任务。');
    return lines.join('\n');
  }

  const s0 = parseStepDetail(latestStepByCode(steps, 'S0_profile'));
  if (s0) {
    lines.push('', '【分析主体画像】');
    lines.push(`  企业：${s0.display_name || '—'}`);
    if (s0.unified_credit_code) lines.push(`  统一社会信用代码：${s0.unified_credit_code}`);
    lines.push(
      `  产品介绍 ${s0.product_intro_len || 0} 字；有效企查查介绍 ${s0.qcc_len || 0} 字；标签 ${s0.tag_count || 0} 个`
    );
    if (Array.isArray(s0.tags) && s0.tags.length) {
      lines.push(`  标签：${s0.tags.join('、')}`);
    }
  }

  const s1 = parseStepDetail(latestStepByCode(steps, 'S1_recall'));
  if (s1) {
    lines.push('', '【数据召回】');
    lines.push(`  底层项目池：${s1.ipo ?? 0} 条`);
    if (s1.financing_skipped) {
      lines.push(
        `  融资事件池：未拉取（${FINANCING_SKIP_LABELS[s1.financing_skipped] || s1.financing_skipped}）`
      );
    } else {
      lines.push(`  融资事件池：${s1.financing ?? 0} 条`);
    }
    lines.push(`  合并去重后内部候选：${s1.merged ?? 0} 条`);
    lines.push('  召回样本（前若干条）：');
    lines.push(...formatSummarizedCandidates(s1.sample, 8));
  }

  const s2 = parseStepDetail(latestStepByCode(steps, 'S2_rule'));
  if (s2?.top) {
    lines.push('', '【规则打分（内部源）】');
    lines.push('  规则分 Top 候选：');
    lines.push(...formatSummarizedCandidates(s2.top, 10));
  }

  const s3 = parseStepDetail(latestStepByCode(steps, 'S3_llm'));
  if (s3) {
    lines.push('', '【LLM 产品对标】');
    lines.push(
      `  对标池 ${s3.pool_size ?? '—'} 条（规则 Top${s3.rule_top ?? 20} + 标签补充 ${s3.tag_supplement ?? 0} + 关键词 ${s3.keyword_supplement ?? 0}${s3.niche_track ? '，掩模/光罩赛道加宽' : ''}）`
    );
    if (s3.high_llm_count != null) lines.push(`  LLM 高信任（≥80）候选：${s3.high_llm_count} 条`);
    if (s3.top) {
      lines.push('  对标分 Top 候选：');
      lines.push(...formatSummarizedCandidates(s3.top, 10));
    }
  }

  const s4 = parseStepDetail(latestStepByCode(steps, 'S4_web'));
  if (s4) {
    lines.push('', '【联网发现】');
    if (s4.skipped === 'config_disabled') {
      lines.push('  已在系统配置中关闭联网发现源');
    } else {
      lines.push(`  新增联网候选：${s4.web_added ?? 0} 条`);
      if (s4.used_enable_search === true) lines.push('  已启用模型联网检索');
      if (s4.search_degraded === true) lines.push('  联网检索降级为无联网单次请求');
      if (s4.model_name) lines.push(`  使用模型：${s4.model_name}`);
    }
  }

  const s5v = parseStepDetail(latestStepByCode(steps, 'S5_validate'));
  if (s5v) {
    lines.push('', '【竞品校验（LLM）】');
    const vr = s5v.validateReasons || {};
    lines.push(
      `  进入校验池：${(s5v.passed ?? 0) + (s5v.rejected ?? 0) + (s5v.upstream_downstream ?? 0)} 条（规则≥阈值 ${vr.by_internal_rule ?? '—'}；高 LLM ${vr.by_high_llm ?? '—'}；联网 ${vr.by_ai_web ?? '—'}）`
    );
    lines.push(`  校验通过（视为竞品）：${s5v.passed ?? '—'} 条`);
    lines.push(`  校验排除（非竞品）：${s5v.rejected ?? '—'} 条`);
    lines.push(`  校验排除（上下游）：${s5v.upstream_downstream ?? '—'} 条`);
  }

  const s5f = parseStepDetail(latestStepByCode(steps, 'S5_filter'));
  if (s5f) {
    lines.push('', '【初筛与排除】');
    const fs = s5f.filterStats || {};
    lines.push(`  参与打分的候选总数：${fs.total_scored ?? '—'}`);
    lines.push(`  排除 — 非竞品：${fs.skip_not_competitor ?? 0} 条`);
    lines.push(`  排除 — 上下游：${fs.skip_upstream_downstream ?? 0} 条`);
    lines.push(`  排除 — 综合分未达阈值：${fs.skip_low_score ?? 0} 条`);
    lines.push(
      `  初筛通过：${(fs.accepted_internal ?? 0) + (fs.accepted_ai_only ?? 0)} 条（含内部源 ${fs.accepted_internal ?? 0}、仅联网/无内部 ${fs.accepted_ai_only ?? 0}）`
    );
    if (s5f.rejected_samples?.length) {
      lines.push('  未保留样本（原因）：');
      lines.push(...formatRejectedSamples(s5f.rejected_samples, 20));
    }
    if (s5f.candidates?.length) {
      lines.push('  初筛通过样本：');
      lines.push(...formatSummarizedCandidates(s5f.candidates, 12));
    }
  }

  const s5e = parseStepDetail(latestStepByCode(steps, 'S5_expand'));
  if (s5e) {
    lines.push('', '【扩召回】');
    lines.push('  因结果偏少触发放宽规则后合并的候选：');
    lines.push(...formatSummarizedCandidates(s5e.candidates, 12));
  }

  const order = [
    'S0_profile',
    'S1_recall',
    'S2_rule',
    'S3_llm',
    'S4_web',
    'S5_validate',
    'S5_filter',
    'S5_expand',
    'S6_persist',
    'S6_done',
  ];
  const byCode = new Map();
  for (const s of steps) {
    if (!byCode.has(s.step_code) || String(s.F_CreatorTime) > String(byCode.get(s.step_code).F_CreatorTime)) {
      byCode.set(s.step_code, s);
    }
  }
  lines.push('', '【流水线步骤（日志原文）】');
  for (const code of order) {
    const s = byCode.get(code);
    if (!s) continue;
    lines.push(`• ${code}：${s.message || ''}`);
  }
  lines.push(
    '',
    '【保留规则】',
    `综合分 ≥ ${SCORE_THRESHOLD} 的候选进入落库；LLM≥80 且校验为直接竞品时，综合分 ≥ ${SCORE_THRESHOLD_HIGH_LLM} 亦可落库。`,
    '排除校验为「非竞品」或「上下游」的条目。',
    'LLM 对标池 = 规则分 Top20 ∪ 标签相似 Top15（掩模/光罩赛道加宽至 Top28）。',
    '有底层/融资内部源时默认内部×0.6+AI×0.4；LLM≥80 时内部×0.2+AI×0.8；仅联网源时综合分=AI 分。',
    '联网发现默认 180s 超时、失败自动重试；对标请求间隔约 650ms 降低限流。'
  );
  return lines.join('\n');
}

async function hydrateRelationRow(rel) {
  const intro = strTrim(rel.competitor_product_intro);
  const tags = strTrim(rel.competitor_tags_display);
  if (intro && tags) return rel;
  const loaded = await loadInternalDisplayFields(rel.unified_credit_code, rel.competitor_display_name);
  const out = { ...rel };
  if (!intro && loaded.product_intro) {
    out.competitor_product_intro = loaded.product_intro;
  }
  if (!tags && loaded.tags?.length) {
    out.competitor_tags_display = loaded.tags.join('、');
    out.competitor_tags_json = JSON.stringify(loaded.tags);
  }
  if (!strTrim(rel.sub_fund_names) && loaded.ipo_sub_funds?.length) {
    out.sub_fund_names = loaded.ipo_sub_funds.join('、');
  }
  return out;
}

/**
 * 被投/投前：竞品分析说明（最近成功运行步骤 + 当前保留竞品及原因）
 */
async function buildCompetitorAnalysisSummary(opts) {
  const {
    subjectType = 'invested_enterprise',
    investedEnterpriseId,
    preInvestmentProjectId,
    runId: explicitRunId,
  } = opts;
  const runId = String(explicitRunId || '').trim();

  let run = null;
  if (runId) {
    if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
      const runs = await db.query(
        `SELECT F_Id, status, message, started_at, finished_at, F_LastModifyTime
         FROM sourcing_competitor_run
         WHERE F_DeleteMark = 0 AND F_Id = ? AND invested_enterprise_id = ?
         LIMIT 1`,
        [runId, investedEnterpriseId]
      );
      run = runs[0] || null;
    } else if (preInvestmentProjectId) {
      const runs = await db.query(
        `SELECT F_Id, status, message, started_at, finished_at, F_LastModifyTime
         FROM sourcing_pre_investment_competitor_run
         WHERE F_DeleteMark = 0 AND F_Id = ? AND pre_investment_project_id = ?
         LIMIT 1`,
        [runId, preInvestmentProjectId]
      );
      run = runs[0] || null;
    }
  } else if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
    const runs = await db.query(
      `SELECT F_Id, status, message, started_at, finished_at, F_LastModifyTime
       FROM sourcing_competitor_run
       WHERE F_DeleteMark = 0 AND invested_enterprise_id = ?
       ORDER BY COALESCE(finished_at, F_LastModifyTime, started_at) DESC
       LIMIT 1`,
      [investedEnterpriseId]
    );
    run = runs[0] || null;
  } else if (preInvestmentProjectId) {
    const runs = await db.query(
      `SELECT F_Id, status, message, started_at, finished_at, F_LastModifyTime
       FROM sourcing_pre_investment_competitor_run
       WHERE F_DeleteMark = 0 AND pre_investment_project_id = ?
       ORDER BY COALESCE(finished_at, F_LastModifyTime, started_at) DESC
       LIMIT 1`,
      [preInvestmentProjectId]
    );
    run = runs[0] || null;
  }

  const steps = run ? await listCompetitorRunStepLogs(run.F_Id) : [];
  const progress = computeRunProgress(run, steps);
  let process_text = buildProcessNarrative(steps, run);
  const progressHeader = buildProgressHeader(progress);
  if (progressHeader) {
    process_text = progressHeader + (process_text || '');
  }

  let relRows = [];
  if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
    if (runId) {
      relRows = await db.query(
        `SELECT F_Id, competitor_display_name, unified_credit_code, competitor_weak_key,
                relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
                competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                F_CreatorTime, run_id
         FROM sourcing_competitor_relation
         WHERE F_DeleteMark = 0 AND invested_enterprise_id = ? AND run_id = ?
           AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
         ORDER BY relevance_score DESC, F_CreatorTime DESC
         LIMIT 200`,
        [investedEnterpriseId, runId]
      );
    } else {
      relRows = await db.query(
        `SELECT F_Id, competitor_display_name, unified_credit_code, competitor_weak_key,
                relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
                competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                F_CreatorTime, run_id
         FROM sourcing_competitor_relation
         WHERE F_DeleteMark = 0 AND invested_enterprise_id = ?
           AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
         ORDER BY relevance_score DESC, F_CreatorTime DESC
         LIMIT 200`,
        [investedEnterpriseId]
      );
    }
  } else if (preInvestmentProjectId) {
    if (runId) {
      relRows = await db.query(
        `SELECT F_Id, competitor_display_name, unified_credit_code, competitor_weak_key,
                relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
                competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                F_CreatorTime, pre_investment_run_id
         FROM sourcing_competitor_relation
         WHERE F_DeleteMark = 0 AND pre_investment_project_id = ? AND pre_investment_run_id = ?
           AND subject_type = 'pre_investment_project'
         ORDER BY relevance_score DESC, F_CreatorTime DESC
         LIMIT 200`,
        [preInvestmentProjectId, runId]
      );
    } else {
      relRows = await db.query(
        `SELECT F_Id, competitor_display_name, unified_credit_code, competitor_weak_key,
                relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
                competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
                F_CreatorTime, pre_investment_run_id
         FROM sourcing_competitor_relation
         WHERE F_DeleteMark = 0 AND pre_investment_project_id = ?
           AND subject_type = 'pre_investment_project'
         ORDER BY relevance_score DESC, F_CreatorTime DESC
         LIMIT 200`,
        [preInvestmentProjectId]
      );
    }
  }

  const deduped = dedupeRelations(relRows);
  const hydrated = [];
  for (const r of deduped) {
    hydrated.push(await hydrateRelationRow(r));
  }

  const retained = hydrated.map((r) => {
    const sources = parseSources(r.data_sources_json);
    return {
      competitor_display_name: r.competitor_display_name,
      unified_credit_code: r.unified_credit_code,
      relevance_score: r.relevance_score,
      confidence_grade: r.confidence_grade,
      data_sources: sources.map((x) => SOURCE_LABELS[x] || x),
      retain_reason: formatRetainReason(r),
    };
  });

  const why_lines = ['【最终保留竞品及原因】'];
  const emptyHint =
    subjectType === 'pre_investment_project'
      ? '当前无落库竞品，请在本页发起「竞品分析」后刷新查看。'
      : '当前无落库竞品，请在被投企业列表发起「竞品分析」后查看。';
  if (!retained.length) {
    why_lines.push(emptyHint);
  } else {
    retained.forEach((item, i) => {
      why_lines.push(
        `${i + 1}. ${item.competitor_display_name}（${item.confidence_grade || '-'}级，${item.relevance_score}分，来源：${item.data_sources.join('、') || '—'}）`
      );
      why_lines.push(`   ${item.retain_reason}`);
    });
  }

  return {
    run_id: run?.F_Id || null,
    run_status: run?.status || null,
    run_message: run?.message || null,
    finished_at: run?.finished_at || null,
    progress,
    process_text,
    why_text: why_lines.join('\n'),
    full_text: progress.is_running
      ? `${process_text}\n\n【进行中】最终结果尚未落库，完成后将在此展示「最终保留竞品及原因」。`
      : `${process_text}\n\n${why_lines.join('\n')}`,
    steps,
    retained,
  };
}

module.exports = {
  buildCompetitorAnalysisSummary,
  dedupeRelations,
  hydrateRelationRow,
};
