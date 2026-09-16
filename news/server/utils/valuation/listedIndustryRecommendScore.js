'use strict';

const C = require('./constants');
const { comparabilityFromScore } = require('./defaults');

const DEFAULT_CHECKED_MAX = 15;
const DEFAULT_MIN_SCORE = 60;
const MATCH_REASON_MAX = 255;

function strTrim(v) {
  return v == null ? '' : String(v).trim();
}

function parseTags(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => strTrim(x)).filter(Boolean))];
  }
  if (typeof raw === 'object') {
    if (Array.isArray(raw.tags)) return parseTags(raw.tags);
    return parseTags(JSON.stringify(raw));
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      return parseTags(JSON.parse(s));
    } catch {
      /* fall through */
    }
  }
  return [...new Set(s.split(/[、,，;/|]+/).map((x) => x.trim()).filter(Boolean))];
}

function jaccard(a, b) {
  const setA = new Set((a || []).map((x) => strTrim(x).toLowerCase()).filter(Boolean));
  const setB = new Set((b || []).map((x) => strTrim(x).toLowerCase()).filter(Boolean));
  if (!setA.size && !setB.size) return 0;
  let inter = 0;
  for (const x of setA) {
    if (setB.has(x)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function categoryLabel(code) {
  return C.CATEGORY_4_LABELS[code] || code || '';
}

/** 四大类 other 是兜底桶，不能当「同行业」硬过滤。 */
function isUsableCategory4(code) {
  const c = strTrim(code);
  return c === 'ai' || c === 'bio' || c === 'semi_mfg';
}

function isBShare(stockCode) {
  const code = String(stockCode || '').trim();
  return code.startsWith('900') || code.startsWith('200');
}

function lensPhrases(profile) {
  const lens = profile?.competition_lens || profile || {};
  const list = [...(lens.must_align || []), ...(lens.custom_keywords || [])];
  return [...new Set(list.map((x) => strTrim(x)).filter(Boolean))];
}

function hitLensPhrases(phrases, haystack) {
  const text = strTrim(haystack).toLowerCase();
  if (!text) return [];
  const hits = [];
  for (const p of phrases || []) {
    if (p && text.includes(p.toLowerCase())) hits.push(p);
  }
  return hits;
}

function scoreCandidate(profile, candidate) {
  const breakdown = {
    category: 0,
    sub_track: 0,
    sw: 0,
    tags: 0,
    lens: 0,
  };
  const hits = {
    category: false,
    sub_track: false,
    sw_l3: false,
    sw_l2: false,
    sw_l1: false,
    tag_overlap: [],
    lens: [],
  };

  const pCat = strTrim(profile?.industry_category_4);
  const cCat = strTrim(candidate?.industry_category_4);
  if (isUsableCategory4(pCat) && isUsableCategory4(cCat) && pCat === cCat) {
    breakdown.category = 25;
    hits.category = true;
  }

  const pTrack = strTrim(profile?.sub_track);
  const cTrack = strTrim(candidate?.sub_track);
  if (pTrack && cTrack && pTrack === cTrack) {
    breakdown.sub_track = 15;
    hits.sub_track = true;
  }

  const pL3 = strTrim(profile?.sw_industry_l3);
  if (pL3) {
    if (pL3 && strTrim(candidate?.sw_industry_l3) === pL3) {
      breakdown.sw = 30;
      hits.sw_l3 = true;
    } else if (strTrim(profile?.sw_industry_l2) && strTrim(candidate?.sw_industry_l2) === strTrim(profile.sw_industry_l2)) {
      breakdown.sw = 18;
      hits.sw_l2 = true;
    } else if (strTrim(profile?.sw_industry_l1) && strTrim(candidate?.sw_industry_l1) === strTrim(profile.sw_industry_l1)) {
      breakdown.sw = 8;
      hits.sw_l1 = true;
    }
  }

  const pTags = parseTags(profile?.tags || profile?.ai_industry_tags_json || profile?.ai_industry_tags_display);
  const cTags = parseTags(
    candidate?.tags || candidate?.industry_tags_json || candidate?.industry_tags_display
  );
  const jac = jaccard(pTags, cTags);
  breakdown.tags = Math.round(jac * 20);
  if (pTags.length && cTags.length) {
    const setC = new Set(cTags.map((x) => x.toLowerCase()));
    hits.tag_overlap = pTags.filter((t) => setC.has(t.toLowerCase()));
  }

  const phrases = lensPhrases(profile);
  const hay = [
    cTags.join('、'),
    candidate?.industry_tags_display,
    candidate?.product_intro,
    candidate?.company_intro,
  ]
    .filter(Boolean)
    .join('\n');
  hits.lens = hitLensPhrases(phrases, hay);
  if (phrases.length) {
    breakdown.lens = Math.min(15, hits.lens.length * 5);
  }

  const raw = breakdown.category + breakdown.sub_track + breakdown.sw + breakdown.tags + breakdown.lens;
  const score = Math.min(100, raw);
  return {
    score,
    breakdown,
    hits,
    comparability: comparabilityFromScore(score),
  };
}

function truncateReason(text, max = MATCH_REASON_MAX) {
  const s = strTrim(text);
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function buildRuleReason(profile, candidate, scored) {
  const parts = [];
  if (scored.hits.category) {
    parts.push(`行业一致·四大类${categoryLabel(profile.industry_category_4)}`);
  } else if (strTrim(profile?.industry_category_4)) {
    parts.push('四大类未命中');
  }
  if (scored.hits.sw_l3) parts.push(`申万三级${candidate.sw_industry_l3}`);
  else if (scored.hits.sw_l2) parts.push(`申万二级${candidate.sw_industry_l2}`);
  else if (scored.hits.sw_l1) parts.push(`申万一级${candidate.sw_industry_l1}`);
  else if (strTrim(profile?.sw_industry_l3)) parts.push('申万三级未命中');

  if (scored.hits.sub_track) parts.push(`赛道${candidate.sub_track}`);
  const overlap = scored.hits.tag_overlap || [];
  if (overlap.length) {
    const pTags = parseTags(profile?.tags || profile?.ai_industry_tags_display);
    parts.push(`标签重叠 ${overlap.length}/${pTags.length || overlap.length}`);
  }
  if (scored.hits.lens?.length) {
    parts.push(`透镜命中 ${scored.hits.lens.slice(0, 3).join('、')}`);
  }
  const summary = parts.length ? parts.join('；') : '规则未命中行业/赛道/标签';
  const dimensions = {
    industry: scored.hits.category
      ? `四大类相同（${categoryLabel(profile.industry_category_4)}）`
      : strTrim(profile?.industry_category_4)
        ? '四大类未相同'
        : '标的无四大类',
    sw: scored.hits.sw_l3
      ? `申万三级相同（${candidate.sw_industry_l3}）`
      : scored.hits.sw_l2
        ? `申万二级相同（${candidate.sw_industry_l2}）`
        : scored.hits.sw_l1
          ? `申万一级相同（${candidate.sw_industry_l1}）`
          : strTrim(profile?.sw_industry_l3)
            ? '申万一/二/三级均未命中'
            : '画像无申万三级，本项不计分',
    track: scored.hits.sub_track
      ? `sub_track 相同（${candidate.sub_track}）`
      : !strTrim(profile?.sub_track) || !strTrim(candidate?.sub_track)
        ? '任一侧赛道为空，不计分'
        : '赛道未相同',
    tags: overlap.length
      ? `重叠：${overlap.slice(0, 8).join('、')}`
      : '标签无重叠',
    lens: scored.hits.lens?.length
      ? `命中：${scored.hits.lens.join('、')}`
      : lensPhrases(profile).length
        ? '透镜短语未命中'
        : '无透镜短语',
  };
  return {
    summary: truncateReason(summary),
    dimensions,
    breakdown: scored.breakdown,
    score: scored.score,
  };
}

function companyIntroFallback(row) {
  const product = strTrim(row?.product_intro);
  if (product) return product;
  const company = strTrim(row?.company_intro);
  if (company) return company;
  const path = [row?.sw_industry_l1, row?.sw_industry_l2, row?.sw_industry_l3]
    .map((x) => strTrim(x))
    .filter(Boolean)
    .join(' / ');
  return path ? `${path}；暂无简介` : '暂无简介';
}

function pickBestByCredit(rows) {
  const groups = new Map();
  const noCredit = [];
  for (const row of rows || []) {
    const credit = strTrim(row.unified_credit_code).replace(/\s+/g, '');
    if (!credit) {
      noCredit.push(row);
      continue;
    }
    const prev = groups.get(credit);
    if (!prev) {
      groups.set(credit, row);
      continue;
    }
    const ps = Number(row.relevance_score ?? row.score) || 0;
    const os = Number(prev.relevance_score ?? prev.score) || 0;
    if (ps > os) {
      groups.set(credit, row);
      continue;
    }
    if (ps < os) continue;
    const rowB = isBShare(row.stock_code);
    const prevB = isBShare(prev.stock_code);
    if (prevB && !rowB) {
      groups.set(credit, row);
      continue;
    }
    if (!prevB && rowB) continue;
    if (String(row.stock_code || '') < String(prev.stock_code || '')) {
      groups.set(credit, row);
    }
  }
  return [...groups.values(), ...noCredit];
}

function defaultCheckedCodes(candidates, { max = DEFAULT_CHECKED_MAX, minScore = DEFAULT_MIN_SCORE } = {}) {
  const out = [];
  for (const c of candidates || []) {
    if (out.length >= max) break;
    const status = c.list_status || c.status;
    if (status && status !== 'can_add') continue;
    const score = Number(c.relevance_score ?? c.score);
    if (!Number.isFinite(score) || score < minScore) continue;
    if (c.stock_code) out.push(String(c.stock_code));
  }
  return out;
}

/**
 * 召回层：1 四大类+三级、2 四大类+二级、3 四大类、4 仅申万一级（无四大类才启用）。
 * relax 时从第 3 层（有四大类）或第 4 层（无四大类）起。
 */
function enabledRecallLayers(profile, { relax = false } = {}) {
  const hasCat4 = isUsableCategory4(profile?.industry_category_4);
  const hasL3 = !!strTrim(profile?.sw_industry_l3);
  const hasL2 = !!strTrim(profile?.sw_industry_l2);
  const hasL1 = !!strTrim(profile?.sw_industry_l1);
  const hasPhrases = parseTags(profile?.tags).length > 0 || lensPhrases(profile).length > 0;
  const layers = [];
  if (!relax) {
    if (hasCat4 && hasL3) layers.push(1);
    if (hasCat4 && hasL2) layers.push(2);
  }
  if (hasCat4) layers.push(3);
  else if (hasL1) layers.push(4);
  // 无有效四大类时，用标签/透镜在简介里召回；透镜仍只加分，不替代有四大类时的漏斗
  if (!hasCat4 && hasPhrases) layers.push(5);
  return layers;
}

function inPoolFromScore(score) {
  return Number(score) >= 60 ? 1 : 0;
}

function composeMatchReason(ruleSummary, businessReason) {
  const biz = strTrim(businessReason);
  if (!biz) return truncateReason(ruleSummary);
  return truncateReason(`${strTrim(ruleSummary)}；${biz}`);
}

module.exports = {
  DEFAULT_CHECKED_MAX,
  DEFAULT_MIN_SCORE,
  MATCH_REASON_MAX,
  strTrim,
  parseTags,
  jaccard,
  categoryLabel,
  isUsableCategory4,
  isBShare,
  lensPhrases,
  scoreCandidate,
  buildRuleReason,
  companyIntroFallback,
  pickBestByCredit,
  defaultCheckedCodes,
  enabledRecallLayers,
  inPoolFromScore,
  truncateReason,
  composeMatchReason,
  comparabilityFromScore,
};
