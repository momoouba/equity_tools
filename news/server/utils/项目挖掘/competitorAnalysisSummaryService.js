const db = require('../../db');
const { listCompetitorRunStepLogs } = require('./competitorAnalysisRunner');
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
    if (richness(r) > richness(prev) || String(r.created_at) > String(prev.created_at)) {
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

function buildProcessNarrative(steps, run) {
  const lines = [];
  if (run) {
    lines.push(
      `最近一次分析运行：${run.id}，状态 ${run.status || '—'}，完成时间 ${run.finished_at || run.updated_at || '—'}。`
    );
    if (run.message) lines.push(run.message);
  }
  const order = ['S0_profile', 'S1_recall', 'S2_rule', 'S3_llm', 'S4_web', 'S5_validate', 'S5_filter', 'S5_expand', 'S6_persist', 'S6_done'];
  const byCode = new Map();
  for (const s of steps) {
    if (!byCode.has(s.step_code) || String(s.created_at) > String(byCode.get(s.step_code).created_at)) {
      byCode.set(s.step_code, s);
    }
  }
  lines.push('', '【流水线步骤】');
  for (const code of order) {
    const s = byCode.get(code);
    if (!s) continue;
    lines.push(`• ${code}：${s.message || ''}`);
  }
  lines.push(
    '',
    '【保留规则】',
    `综合分 ≥ ${SCORE_THRESHOLD} 的候选进入落库；LLM≥80 且校验为直接竞品时，综合分 ≥ 55 亦可落库。`,
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
  const { subjectType = 'invested_enterprise', investedEnterpriseId, preInvestmentProjectId } = opts;

  let run = null;
  if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
    const runs = await db.query(
      `SELECT id, status, message, started_at, finished_at, updated_at
       FROM sourcing_competitor_run
       WHERE delete_mark = 0 AND invested_enterprise_id = ?
       ORDER BY COALESCE(finished_at, updated_at, started_at) DESC
       LIMIT 1`,
      [investedEnterpriseId]
    );
    run = runs[0] || null;
  } else if (preInvestmentProjectId) {
    const runs = await db.query(
      `SELECT id, status, message, started_at, finished_at, updated_at
       FROM sourcing_pre_investment_competitor_run
       WHERE delete_mark = 0 AND pre_investment_project_id = ?
       ORDER BY COALESCE(finished_at, updated_at, started_at) DESC
       LIMIT 1`,
      [preInvestmentProjectId]
    );
    run = runs[0] || null;
  }

  const steps = run ? await listCompetitorRunStepLogs(run.id) : [];
  const process_text = buildProcessNarrative(steps, run);

  let relRows = [];
  if (subjectType === 'invested_enterprise' && investedEnterpriseId) {
    relRows = await db.query(
      `SELECT id, competitor_display_name, unified_credit_code, competitor_weak_key,
              relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
              competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
              created_at, run_id
       FROM sourcing_competitor_relation
       WHERE delete_mark = 0 AND invested_enterprise_id = ?
         AND (subject_type = 'invested_enterprise' OR subject_type IS NULL)
       ORDER BY relevance_score DESC, created_at DESC
       LIMIT 200`,
      [investedEnterpriseId]
    );
  } else if (preInvestmentProjectId) {
    relRows = await db.query(
      `SELECT id, competitor_display_name, unified_credit_code, competitor_weak_key,
              relevance_score, confidence_grade, score_breakdown_json, data_sources_json,
              competitor_product_intro, competitor_tags_display, competitor_tags_json, sub_fund_names,
              created_at, run_id
       FROM sourcing_competitor_relation
       WHERE delete_mark = 0 AND pre_investment_project_id = ?
         AND subject_type = 'pre_investment_project'
       ORDER BY relevance_score DESC, created_at DESC
       LIMIT 200`,
      [preInvestmentProjectId]
    );
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
  if (!retained.length) {
    why_lines.push('当前无落库竞品，请在被投企业列表发起「竞品分析」后查看。');
  } else {
    retained.forEach((item, i) => {
      why_lines.push(
        `${i + 1}. ${item.competitor_display_name}（${item.confidence_grade || '-'}级，${item.relevance_score}分，来源：${item.data_sources.join('、') || '—'}）`
      );
      why_lines.push(`   ${item.retain_reason}`);
    });
  }

  return {
    run_id: run?.id || null,
    run_status: run?.status || null,
    run_message: run?.message || null,
    finished_at: run?.finished_at || null,
    process_text,
    why_text: why_lines.join('\n'),
    full_text: `${process_text}\n\n${why_lines.join('\n')}`,
    steps,
    retained,
  };
}

module.exports = {
  buildCompetitorAnalysisSummary,
  dedupeRelations,
  hydrateRelationRow,
};
