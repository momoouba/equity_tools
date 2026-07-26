'use strict';

/**
 * 竞争透镜（competition_lens）：从目标画像提取「对标时应重点关注」的因素，
 * 供用户勾选 / 编辑描述 / 补充关键词后锁定；确认版本落库，重跑默认带回。
 */

const db = require('../../db');
const { generateId } = require('../idGenerator');
const {
  extractCoreProductLines,
  isGenericIndustryTag,
  isTechBuzzwordTag,
  isFormOrCustomerTag,
  scoreFormCustomerAlignment,
} = require('./competitorProductLineUtils');
const { strTrim } = require('./competitorMatchUtils');

const DIMENSION_LABEL = Object.freeze({
  primary_product: '核心产品',
  product_form: '产品形态',
  customer: '服务对象',
  scenario: '使用场景',
  delivery: '交付层',
  tech_stack: '技术栈（参考）',
  product_line: '产品线',
  custom: '自定义',
});

const FORM_OR_CUSTOMER_HINT_RE =
  /消费级|C端|B端|家庭|家用|商用|工业|企业服务|运营商|开发者|整机|耗材|SaaS|硬件|交付/;

const FACTOR_TEXT_MAX = 300;
const KEYWORD_MAX = 48;

function clipText(s, max = FACTOR_TEXT_MAX) {
  const t = strTrim(s);
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

/** 稳定 id：同源同维同基线文本 → 重跑可对齐上次编辑 */
function factorStableId(item) {
  const raw = [
    item.source || '',
    item.dimension || '',
    item.reason || '',
    clipText(item.base_text || item.text || '', 80).toLowerCase(),
  ].join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `f_${h.toString(36)}`;
}

function pushFactor(list, seen, item) {
  const baseText = clipText(item.base_text || item.text);
  if (!baseText || baseText.length < 2) return;
  if (isGenericIndustryTag(baseText) || isTechBuzzwordTag(baseText)) return;
  const id = item.id || factorStableId({ ...item, base_text: baseText, text: baseText });
  if (seen.has(id)) return;
  seen.add(id);
  const text = clipText(item.text || baseText);
  list.push({
    id,
    text,
    base_text: baseText,
    edited: !!(item.edited || (text && text !== baseText)),
    dimension: item.dimension || 'product_line',
    dimension_label: DIMENSION_LABEL[item.dimension] || DIMENSION_LABEL.product_line,
    source: item.source || 'profile',
    reason: item.reason || '',
    default_selected: !!item.default_selected,
  });
}

function factorsFromStructured(structured) {
  const out = [];
  if (!structured || typeof structured !== 'object') return out;
  const sp = structured;
  if (sp.primary_product) {
    out.push({
      text: sp.primary_product,
      dimension: 'primary_product',
      source: 'structured',
      reason: '结构化画像·核心产品',
      default_selected: true,
    });
  }
  if (sp.target_customer || sp.customer_type) {
    out.push({
      text: sp.target_customer || sp.customer_type,
      dimension: 'customer',
      source: 'structured',
      reason: '结构化画像·服务对象',
      default_selected: true,
    });
  }
  if (sp.delivery) {
    out.push({
      text: sp.delivery,
      dimension: 'delivery',
      source: 'structured',
      reason: '结构化画像·交付层',
      default_selected: true,
    });
  }
  if (sp.value_chain) {
    out.push({
      text: sp.value_chain,
      dimension: 'delivery',
      source: 'structured',
      reason: '结构化画像·价值链位置',
      default_selected: true,
    });
  }
  if (sp.modality) {
    out.push({
      text: sp.modality,
      dimension: 'product_form',
      source: 'structured',
      reason: '结构化画像·模态/形态',
      default_selected: true,
    });
  }
  if (sp.product_class) {
    out.push({
      text: sp.product_class,
      dimension: 'product_form',
      source: 'structured',
      reason: '结构化画像·产品类别',
      default_selected: true,
    });
  }
  if (sp.chain_position) {
    out.push({
      text: sp.chain_position,
      dimension: 'delivery',
      source: 'structured',
      reason: '结构化画像·产业链位置',
      default_selected: false,
    });
  }
  if (Array.isArray(sp.tech_stack)) {
    for (const t of sp.tech_stack.slice(0, 3)) {
      out.push({
        text: t,
        dimension: 'tech_stack',
        source: 'structured',
        reason: '结构化画像·技术栈（默认不强制）',
        default_selected: false,
      });
    }
  }
  if (Array.isArray(sp.core_skus)) {
    for (const t of sp.core_skus.slice(0, 4)) {
      out.push({
        text: t,
        dimension: 'product_line',
        source: 'structured',
        reason: '结构化画像·核心 SKU',
        default_selected: true,
      });
    }
  }
  return out;
}

function proposeCompetitionLens(profile) {
  const displayName = strTrim(profile?.display_name) || '目标企业';
  const factors = [];
  const seen = new Set();

  for (const raw of factorsFromStructured(profile?.structured_profile)) {
    pushFactor(factors, seen, raw);
  }

  const coreLines =
    profile?.core_product_lines?.length > 0
      ? profile.core_product_lines
      : extractCoreProductLines(profile || {});
  for (const line of coreLines.slice(0, 8)) {
    const prefer = strTrim(line).length >= 5;
    pushFactor(factors, seen, {
      text: line,
      dimension: 'product_line',
      source: 'core_product_lines',
      reason: '画像核心产品线',
      default_selected: prefer,
    });
  }

  for (const t of profile?.tags || []) {
    const s = strTrim(t);
    if (!s || isTechBuzzwordTag(s) || isGenericIndustryTag(s)) continue;
    const formish = isFormOrCustomerTag(s);
    const strongForm = FORM_OR_CUSTOMER_HINT_RE.test(s);
    pushFactor(factors, seen, {
      text: s,
      dimension: formish ? 'product_form' : 'product_line',
      source: 'tags',
      reason: formish ? '形态/服务对象相关标签' : '业务标签',
      default_selected: strongForm || (formish && s.length >= 6),
    });
  }

  const selectedCount = factors.filter((f) => f.default_selected).length;
  if (selectedCount === 0) {
    for (const f of factors.slice(0, 4)) f.default_selected = true;
  } else if (selectedCount > 5) {
    let keep = 0;
    for (const f of factors) {
      if (!f.default_selected) continue;
      keep += 1;
      if (keep > 5) f.default_selected = false;
    }
  }

  return {
    display_name: displayName,
    factors,
    tip: '勾选本次对标最重要的因素（建议 2～5 项）；可点「编辑」修改描述，也可自行输入关键词。系统将优先按所选焦点召回与排序。',
    saved_lens: null,
  };
}

/**
 * 将上次保存版本合并进提案：沿用勾选与已编辑描述，并补回上次独有因素
 */
function mergeProposalWithSaved(proposal, saved) {
  if (!proposal) return proposal;
  if (!saved || typeof saved !== 'object') {
    return { ...proposal, saved_lens: null };
  }

  const savedFactors = Array.isArray(saved.factors) ? saved.factors : [];
  const byId = new Map(savedFactors.map((f) => [String(f.id), f]));
  const selectedSet = new Set(
    (Array.isArray(saved.selected_factor_ids) ? saved.selected_factor_ids : [])
      .map((x) => String(x))
      .concat(savedFactors.filter((f) => f.selected).map((f) => String(f.id)))
  );

  const factors = (proposal.factors || []).map((f) => {
    const prev = byId.get(String(f.id));
    if (!prev) {
      return {
        ...f,
        default_selected: selectedSet.size ? selectedSet.has(String(f.id)) : f.default_selected,
      };
    }
    const editedText = clipText(prev.text || f.text);
    const baseText = clipText(prev.base_text || f.base_text || f.text);
    return {
      ...f,
      base_text: baseText,
      text: editedText || f.text,
      edited: !!(prev.edited || (editedText && editedText !== baseText)),
      default_selected: selectedSet.size ? selectedSet.has(String(f.id)) : !!prev.selected || f.default_selected,
    };
  });

  const seenIds = new Set(factors.map((f) => String(f.id)));
  for (const prev of savedFactors) {
    const id = String(prev.id || '');
    if (!id || seenIds.has(id)) continue;
    const text = clipText(prev.text);
    if (!text || text.length < 2) continue;
    factors.push({
      id,
      text,
      base_text: clipText(prev.base_text || text),
      edited: true,
      dimension: prev.dimension || 'custom',
      dimension_label: prev.dimension_label || DIMENSION_LABEL.custom,
      source: prev.source || 'user_saved',
      reason: prev.reason || '上次保存·自定义',
      default_selected: selectedSet.has(id) || !!prev.selected,
    });
    seenIds.add(id);
  }

  return {
    ...proposal,
    factors,
    tip: proposal.tip,
    saved_lens: {
      version: saved.version || null,
      saved_at: saved.saved_at || null,
      custom_keywords: Array.isArray(saved.custom_keywords) ? saved.custom_keywords : [],
    },
    default_custom_keywords: Array.isArray(saved.custom_keywords) ? saved.custom_keywords : [],
  };
}

function normalizePhraseList(arr, max = 14, maxLen = FACTOR_TEXT_MAX) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const t = clipText(x, maxLen);
    if (!t || t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function looksLikeFactorId(s) {
  const t = strTrim(s);
  // 旧版顺序 id：f1；稳定 hash：f_1cjt8kh
  return /^f_?[a-z0-9]+$/i.test(t) && t.length <= 24 && !/[\u4e00-\u9fff]/.test(t);
}

function resolveCompetitionLens(userInput, factors = []) {
  const input = userInput && typeof userInput === 'object' ? userInput : {};
  const factorById = new Map((factors || []).map((f) => [String(f.id), { ...f }]));

  // 客户端提交的 factors 为准：即使 id 不在本次提案中也并入（防提案重算 id 漂移）
  const edits = Array.isArray(input.factors) ? input.factors : [];
  for (const e of edits) {
    const id = String(e?.id || '').trim();
    const nextText = clipText(e?.text);
    if (!id || !nextText) continue;
    const prev = factorById.get(id);
    const baseText = clipText(e.base_text || prev?.base_text || nextText);
    factorById.set(id, {
      id,
      text: nextText,
      base_text: baseText,
      edited: !!(e.edited || nextText !== baseText),
      dimension: e.dimension || prev?.dimension || 'custom',
      dimension_label:
        e.dimension_label || prev?.dimension_label || DIMENSION_LABEL.custom,
      source: e.source || prev?.source || 'user',
      reason: e.reason || prev?.reason || '用户确认',
      default_selected: prev?.default_selected,
    });
  }
  if (input.factor_edits && typeof input.factor_edits === 'object') {
    for (const [id, text] of Object.entries(input.factor_edits)) {
      const nextText = clipText(text);
      if (!nextText) continue;
      const cur = factorById.get(String(id)) || {
        id: String(id),
        base_text: nextText,
        dimension: 'custom',
        dimension_label: DIMENSION_LABEL.custom,
        source: 'user',
        reason: '用户确认',
      };
      cur.text = nextText;
      cur.edited = nextText !== clipText(cur.base_text || '');
      factorById.set(String(id), cur);
    }
  }

  const mergedFactors = [...factorById.values()];

  // must_align 若误传成因子 id，当作 selected_factor_ids
  let selectedIds = Array.isArray(input.selected_factor_ids)
    ? input.selected_factor_ids.map((x) => String(x))
    : null;
  let mustAlignRaw = Array.isArray(input.must_align) ? input.must_align : null;
  if (mustAlignRaw?.length && mustAlignRaw.every((x) => looksLikeFactorId(x))) {
    selectedIds = selectedIds?.length ? selectedIds : mustAlignRaw.map((x) => String(x));
    mustAlignRaw = null;
  }

  let selectedTexts = [];
  if (mustAlignRaw?.length) {
    selectedTexts = normalizePhraseList(mustAlignRaw);
  }
  if (!selectedTexts.length && selectedIds?.length) {
    for (const id of selectedIds) {
      const f = factorById.get(id);
      if (f?.text) selectedTexts.push(f.text);
    }
    selectedTexts = normalizePhraseList(selectedTexts);
  }
  // 仍为空：直接用客户端 factors 全文（按勾选；无勾选则全部）
  if (!selectedTexts.length && edits.length) {
    const pick = selectedIds?.length
      ? edits.filter((e) => selectedIds.includes(String(e.id)))
      : edits;
    selectedTexts = normalizePhraseList(pick.map((e) => e.text));
  }
  if (!selectedTexts.length) {
    selectedTexts = normalizePhraseList(
      mergedFactors.filter((f) => f.default_selected).map((f) => f.text)
    );
  }

  const custom = normalizePhraseList(
    Array.isArray(input.custom_keywords)
      ? input.custom_keywords
      : String(input.custom_keywords_text || '')
          .split(/[,，、;\s]+/)
          .filter(Boolean),
    12,
    KEYWORD_MAX
  );

  const excludeHints = normalizePhraseList(input.exclude_hints || [], 8, KEYWORD_MAX);
  const confirmed = input.confirmed === true || input.source === 'user';
  const mustAlign = normalizePhraseList([...selectedTexts, ...custom], 14);
  const resolvedSelectedIds =
    selectedIds?.length && selectedTexts.length
      ? selectedIds
      : mergedFactors.filter((f) => f.default_selected).map((f) => f.id);

  // 确认态若仍无 must_align，降为 auto，避免写入空透镜版本污染重跑
  const effectiveConfirmed = confirmed && mustAlign.length > 0;

  const factorsSnapshot = mergedFactors.map((f) => ({
    id: f.id,
    text: f.text,
    base_text: f.base_text || f.text,
    edited: !!f.edited,
    dimension: f.dimension,
    dimension_label: f.dimension_label,
    source: f.source,
    reason: f.reason,
    selected: resolvedSelectedIds.map(String).includes(String(f.id)),
  }));

  return {
    must_align: mustAlign,
    prefer_align: [],
    custom_keywords: custom,
    exclude_hints: excludeHints,
    confirmed: effectiveConfirmed,
    source: effectiveConfirmed ? 'user' : confirmed ? 'user_empty' : 'auto',
    selected_factor_ids: resolvedSelectedIds,
    factors: factorsSnapshot,
    factors_used: mustAlign,
    resolve_warning:
      confirmed && !mustAlign.length
        ? 'selected_factor_ids 无法映射到因素文本，must_align 为空'
        : null,
  };
}

function applyCompetitionLensToTarget(target, lens) {
  if (!target || !lens) return target;
  target.competition_lens = lens;
  if (lens.must_align?.length) {
    // 保留原始产品线，便于恢复
    if (!target._original_product_lines) {
      target._original_product_lines = [...(target.core_product_lines || [])];
    }
    // 用户确认后：产品线锚点仅认透镜，禁止把未勾选的旧 buzz/「人形」等再合并回来
    const merged = [];
    const seen = new Set();
    const seed =
      lens.confirmed || lens.source === 'user'
        ? [...lens.must_align, ...(lens.custom_keywords || [])]
        : [...lens.must_align, ...(target.core_product_lines || [])];
    for (const t of seed) {
      const s = strTrim(t);
      if (!s) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(s);
    }
    target.core_product_lines = merged.slice(0, 12);
  }
  return target;
}

/**
 * 从长描述抽短检索/形态锚点（通用截断，非赛道词表）
 */
function shortenLensAnchors(phrases, max = 10) {
  const out = [];
  const seen = new Set();
  const push = (raw) => {
    const t = strTrim(raw);
    if (!t || t.length < 3 || t.length > 20) return;
    if (/^(专注于|公司|在|助力|方面|以及|进行)/.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  for (const line of phrases || []) {
    const s = strTrim(line);
    if (!s) continue;
    if (s.length <= 20) {
      push(s);
      continue;
    }
    for (const part of s.split(/[，,。；;、\n]/)) {
      push(part.slice(0, 20));
      if (out.length >= max) break;
    }
    const hits = s.match(/[\u4e00-\u9fffA-Za-z0-9]{2,12}(?:服务机器人|管家|陪玩|机器人|用户|双臂|夹爪)/g);
    if (hits) {
      for (const h of hits) push(h);
    }
    if (out.length >= max) break;
  }
  return out.slice(0, max);
}

function buildLensPromptAppendix(lens) {
  if (!lens?.must_align?.length) return '';
  const lines = [
    '# 用户确认的对标焦点（竞争透镜）',
    `必对齐焦点：${lens.must_align.join('、')}`,
  ];
  if (lens.custom_keywords?.length) {
    lines.push(`用户补充关键词：${lens.custom_keywords.join('、')}`);
  }
  if (lens.exclude_hints?.length) {
    lines.push(`明确降权/排除倾向：${lens.exclude_hints.join('、')}`);
  }
  lines.push(
    '判定时须优先满足上述焦点；仅因宽泛行业/技术大标签重合，不得标为 direct。',
    '焦点明显错位时最高 same_track，并降低 validated_score。'
  );
  /* ── 机器人/清洁电器专属 prompt：仅当透镜涉及相关关键词时注入 ── */
  const lensTextBlob = [
    ...(lens.must_align || []),
    ...(lens.custom_keywords || []),
    ...(lens.exclude_hints || []),
  ].join(' ');
  const ROBOT_CLEAN_RE = /机器人|清洁|扫地|扫拖|擦窗|管家|机械臂|夹爪|人形|服务机器人|具身/i;
  if (ROBOT_CLEAN_RE.test(lensTextBlob)) {
    lines.push(
      '**产品形态同层**：若目标焦点强调「通用/服务/操作（含臂、夹爪、管家、长程家务）」等，而候选仅为单一任务清洁电器（扫地/扫拖/擦窗等）且无操作/服务扩展能力 → 最高 same_track 或 indirect，validated_score≤45，不得判 direct。',
      '**联网发现专令（有透镜时）**：除境内上市配额外，须主动检索与焦点同层的**未上市/早期**公司（种子/天使/Pre-A 优先），检索式须组合焦点短语 + 「创业公司/融资/天使轮/未上市」；禁止用单任务清洁电器或仅大赛道人形明星凑满候选。'
    );
  }
  if (lens.source === 'auto') {
    lines.push('（本透镜为系统默认自动采纳，未经用户勾选确认）');
  }
  return lines.join('\n');
}

function mergePromptAppendix(strategyAppendix, lens) {
  const parts = [strTrim(strategyAppendix), buildLensPromptAppendix(lens)].filter(Boolean);
  return parts.length ? parts.join('\n\n') : null;
}

function candidateTextForLens(candidate) {
  return [
    candidate?.display_name,
    candidate?.product_intro,
    candidate?.qcc_intro,
    candidate?.qcc_intro_effective,
    ...(candidate?.tags || []),
  ]
    .filter(Boolean)
    .join('\n');
}

/** 目标透镜是否指向「可操作/通用家庭服务」形态（由透镜短语自身触发） */
function lensImpliesGeneralOrManipService(lens) {
  const blob = [...(lens?.must_align || []), ...(lens?.custom_keywords || [])].join('\n');
  return /臂|夹爪|操作|管家|陪玩|通用|长程|家务|具身智能服务|服务机器人/.test(blob);
}

/** 候选是否呈现为「专用清洁电器」而缺少操作/通用服务信号 */
function candidateLooksLikeSpecializedCleaner(candidate, evidenceExtra = '') {
  const blob = `${candidateTextForLens(candidate)}\n${evidenceExtra || ''}`;
  if (!/(扫地|扫拖|擦窗|洗地|吸尘器|清洁机器人|扫地机器人)/.test(blob)) return false;
  if (/(双臂|机械臂|夹爪|灵巧手|操作臂|家庭管家|通用服务机器人|教育陪玩|全能管家)/.test(blob)) {
    return false;
  }
  return true;
}

function scoreLensAlignment(lens, candidate) {
  if (!lens?.must_align?.length || !candidate) return 0;
  const { buildLensScoringAnchors } = require('./competitorProductLineUtils');
  const anchors = buildLensScoringAnchors(
    [...(lens.must_align || []), ...(lens.custom_keywords || [])],
    12
  );
  return scoreFormCustomerAlignment(
    {
      core_product_lines: anchors.length ? anchors : lens.must_align,
      tags: lens.custom_keywords || [],
      competition_lens: lens,
    },
    candidate
  );
}

function isLensSpecializedCleanerMismatch(lens, cand, evidenceExtra = '') {
  return (
    lensImpliesGeneralOrManipService(lens) && candidateLooksLikeSpecializedCleaner(cand, evidenceExtra)
  );
}

function applyLensRuleAdjust(scores, lens, cand) {
  if (!lens?.must_align?.length) return scores;
  const next = { ...scores };
  const lensScore = scoreLensAlignment(lens, cand);
  next.lensAlignScore = lensScore;
  if (lensScore < 22) {
    next.internalScore = Math.min(next.internalScore || 0, 38);
  } else if (lensScore >= 45) {
    next.internalScore = Math.min(100, (next.internalScore || 0) + Math.min(14, Math.round(lensScore * 0.12)));
  }
  // 通用/可操作服务焦点 vs 专用扫地电器：形态跨层压分（由透镜与候选文本共同判定）
  if (isLensSpecializedCleanerMismatch(lens, cand)) {
    next.internalScore = Math.min(next.internalScore || 0, 34);
    next.strategy_cap_reason = next.strategy_cap_reason || 'lens_form_cleaner_vs_service';
    next.lens_form_mismatch = 'specialized_cleaner';
  }
  return next;
}

/** 校验后硬压：形态跨层不得高分落库 / 不得占上市配额 */
function applyLensValidationCap(validation, lens, candidate) {
  const evidenceExtra = [
    validation?.rationale,
    validation?.key_differences,
    validation?.reject_reason,
    validation?.evidence_summary,
  ]
    .filter(Boolean)
    .map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
    .join('\n');
  if (
    !validation ||
    validation.ai_failed ||
    !isLensSpecializedCleanerMismatch(lens, candidate, evidenceExtra)
  ) {
    return validation;
  }
  const next = { ...validation };
  const vs = Number(next.validated_score);
  if (Number.isFinite(vs) && vs > 42) {
    next.validated_score = 42;
  }
  if (next.competitor_type === 'direct') {
    next.competitor_type = 'indirect';
  }
  next.lens_form_mismatch = 'specialized_cleaner';
  const tip = '目标为可操作/通用家庭服务机器人，候选为专用清洁电器，形态跨层压分';
  next.rationale = strTrim(
    `${next.rationale ? `${next.rationale}；` : ''}${tip}`
  ).slice(0, 500);
  if (!next.reject_reason) {
    next.reject_reason = tip;
  }
  return next;
}

function parseJsonMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

async function loadSavedCompetitionLens(subjectType, subjectId) {
  const id = String(subjectId || '').trim();
  if (!id) return null;
  if (subjectType === 'pre_investment_project') {
    const rows = await db.query(
      `SELECT competition_lens_json, competition_lens_version, competition_lens_at
       FROM pre_investment_project WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    const raw = parseJsonMaybe(rows[0].competition_lens_json);
    if (!raw) return null;
    return {
      ...raw,
      version: rows[0].competition_lens_version || raw.version || null,
      saved_at: rows[0].competition_lens_at || raw.saved_at || null,
    };
  }
  if (subjectType === 'invested_enterprise') {
    const rows = await db.query(
      `SELECT competition_lens_json, competition_lens_version, competition_lens_at
       FROM invested_enterprises WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [id]
    );
    if (!rows.length) return null;
    const raw = parseJsonMaybe(rows[0].competition_lens_json);
    if (!raw) return null;
    return {
      ...raw,
      version: rows[0].competition_lens_version || raw.version || null,
      saved_at: rows[0].competition_lens_at || raw.saved_at || null,
    };
  }
  return null;
}

/**
 * 写入主体最新快照 + 版本历史表
 * @returns {{ version: number, saved_at: string }}
 */
async function saveCompetitionLensVersion({ subjectType, subjectId, lens, userId }) {
  const id = String(subjectId || '').trim();
  if (!id || !lens) throw new Error('缺少主体或透镜');
  if (!['pre_investment_project', 'invested_enterprise'].includes(subjectType)) {
    throw new Error('不支持的主体类型');
  }

  const savedAt = new Date();
  const payload = {
    version: null, // filled after atomic increment
    saved_at: savedAt.toISOString(),
    must_align: lens.must_align || [],
    custom_keywords: lens.custom_keywords || [],
    exclude_hints: lens.exclude_hints || [],
    selected_factor_ids: lens.selected_factor_ids || [],
    factors: lens.factors || [],
    confirmed: !!lens.confirmed,
    source: lens.source || 'user',
  };
  const uid = userId ? String(userId) : null;

  /* ── 原子递增版本号，消除 TOCTOU 竞态 ── */
  const tableName = subjectType === 'pre_investment_project' ? 'pre_investment_project' : 'invested_enterprises';
  await db.execute(
    `UPDATE ${tableName}
     SET competition_lens_version = COALESCE(competition_lens_version, 0) + 1,
         competition_lens_at = ?,
         F_LastModifyTime = NOW()
     WHERE F_Id = ?`,
    [savedAt, id]
  );
  const verRows = await db.query(
    `SELECT competition_lens_version AS v FROM ${tableName} WHERE F_Id = ? LIMIT 1`,
    [id]
  );
  const nextVersion = Math.max(1, Number(verRows[0]?.v || 1));
  payload.version = nextVersion;

  const json = JSON.stringify(payload);

  if (subjectType === 'pre_investment_project') {
    await db.execute(
      `UPDATE pre_investment_project
       SET competition_lens_json = ?
       WHERE F_Id = ?`,
      [json, id]
    );
  } else {
    await db.execute(
      `UPDATE invested_enterprises
       SET competition_lens_json = ?
       WHERE F_Id = ?`,
      [json, id]
    );
  }

  const verId = await generateId('sourcing_competition_lens_version');
  try {
    await db.execute(
      `INSERT INTO sourcing_competition_lens_version (
         F_Id, subject_type, subject_id, version, lens_json, F_CreatorUserId, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,NOW())`,
      [verId, subjectType, id, nextVersion, json, uid]
    );
  } catch (e) {
    console.warn('[competitionLens] version history insert failed', e.message);
  }

  return { version: nextVersion, saved_at: savedAt.toISOString() };
}

module.exports = {
  DIMENSION_LABEL,
  proposeCompetitionLens,
  mergeProposalWithSaved,
  resolveCompetitionLens,
  applyCompetitionLensToTarget,
  shortenLensAnchors,
  buildLensPromptAppendix,
  mergePromptAppendix,
  scoreLensAlignment,
  isLensSpecializedCleanerMismatch,
  applyLensRuleAdjust,
  applyLensValidationCap,
  loadSavedCompetitionLens,
  saveCompetitionLensVersion,
};
