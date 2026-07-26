'use strict';

/**
 * Stage 4：赛道策略路由（§7.4 / §8.2）
 * Runner：规则分微调 + Prompt 附录；按目标 category_4（及 semi_mfg sub_track）分流。
 */

const { AiStrategy } = require('./aiStrategy');
const { BioPharmaStrategy } = require('./bioStrategy');
const { SemiAdvancedMfgStrategy } = require('./semiAdvancedMfgStrategy');
const { DefaultStrategy } = require('./defaultStrategy');
const { inferSubTrack, resolveCategory4FromDb } = require('../../project-sourcing/industryCategory4Map');
const { strTrim } = require('../competitorMatchUtils');
const db = require('../../../db');

const STRATEGY_BY_CATEGORY = {
  ai: AiStrategy,
  bio: BioPharmaStrategy,
  semi_mfg: SemiAdvancedMfgStrategy,
  other: DefaultStrategy,
};

const HEURISTIC_CATEGORY_RES = [
  { category_4: 'bio', re: /生物医药|生物制药|医疗器械|过滤膜|层析|细胞治疗|抗体|创新药|耗材.*生物|诊断试剂/i },
  {
    category_4: 'semi_mfg',
    re: /半导体|芯片|晶圆|光刻|先进制造|新能源|动力电池|智能硬件|汽车出行|封装测试/i,
  },
  { category_4: 'ai', re: /人工智能|大模型|机器学习|企业服务|大数据|云计算|物联网|区块链|AIGC/i },
];

function parseStructuredJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

function resolveSubTrackFromProfile(category4, profile, structured) {
  if (category4 !== 'semi_mfg') return null;
  const fromStruct = strTrim(structured?.sub_track);
  if (fromStruct === 'semi' || fromStruct === 'advanced_mfg') return fromStruct;
  const fromProf = strTrim(profile?.sub_track);
  if (fromProf === 'semi' || fromProf === 'advanced_mfg') return fromProf;
  const lv1 =
    strTrim(profile?.industry_source_lv1) ||
    strTrim(profile?.industry_l1) ||
    strTrim(structured?.industry_source_lv1);
  return inferSubTrack(category4, lv1);
}

/**
 * 推断目标 category_4（优先显式字段 → 映射表 → 启发式）
 */
async function resolveTargetCategory4(profile, row = {}) {
  const explicit =
    strTrim(row.industry_category_4) ||
    strTrim(profile?.industry_category_4) ||
    strTrim(parseStructuredJson(row.structured_profile_json)?.category_4);
  if (explicit === 'ai' || explicit === 'bio' || explicit === 'semi_mfg' || explicit === 'other') {
    return {
      category_4: explicit,
      match_level: 'explicit',
      category_display: null,
      sub_track: resolveSubTrackFromProfile(explicit, { ...profile, ...row }, parseStructuredJson(row.structured_profile_json)),
    };
  }

  const lv1 =
    strTrim(row.industry_source_lv1) ||
    strTrim(row.industry_std_lv1) ||
    strTrim(profile?.industry_l1);
  const lv2 =
    strTrim(row.industry_source_lv2) ||
    strTrim(row.industry_std_lv2) ||
    strTrim(profile?.industry_l2);

  if (lv1) {
    try {
      const mapped = await resolveCategory4FromDb(db, lv1, lv2);
      if (mapped?.category_4 && mapped.category_4 !== 'other') {
        return {
          category_4: mapped.category_4,
          category_display: mapped.category_display,
          match_level: mapped.match_level || 'map',
          sub_track: mapped.sub_track || inferSubTrack(mapped.category_4, lv1),
        };
      }
    } catch {
      /* map 表不可用时走启发式 */
    }
  }

  // 信用代码从融资池借 category_4
  const credit = strTrim(profile?.unified_credit_code || row.unified_credit_code);
  if (credit) {
    try {
      const rows = await db.query(
        `SELECT industry_category_4, industry_source_lv1, industry_source_lv2
         FROM sourcing_financing_event
         WHERE F_DeleteMark = 0 AND TRIM(company_credit_code) = ?
           AND industry_category_4 IN ('ai','bio','semi_mfg')
         ORDER BY event_date DESC
         LIMIT 1`,
        [credit]
      );
      if (rows.length && strTrim(rows[0].industry_category_4)) {
        const cat = strTrim(rows[0].industry_category_4);
        return {
          category_4: cat,
          match_level: 'financing_donor',
          category_display: null,
          sub_track: inferSubTrack(cat, rows[0].industry_source_lv1),
        };
      }
    } catch {
      /* ignore */
    }
  }

  const blob = [
    lv1,
    lv2,
    ...(profile?.tags || []),
    profile?.product_intro,
    profile?.qcc_intro_effective,
    row.ai_product_intro,
  ]
    .filter(Boolean)
    .join('\n');
  for (const h of HEURISTIC_CATEGORY_RES) {
    if (h.re.test(blob)) {
      return {
        category_4: h.category_4,
        match_level: 'heuristic',
        category_display: null,
        sub_track: inferSubTrack(h.category_4, lv1),
      };
    }
  }

  return { category_4: 'other', match_level: 'fallback', category_display: null, sub_track: null };
}

/**
 * @returns {{ id: string, label: string, category_4: string, sub_track: string|null, match_level?: string, strategy: object, buildPromptAppendix: Function, adjustRuleScore: Function }}
 */
function getIndustryStrategy(target, candidate = null, opts = {}) {
  const category4 =
    strTrim(opts.category_4) ||
    strTrim(target?.industry_category_4) ||
    strTrim(candidate?.industry_category_4) ||
    'other';
  const impl = STRATEGY_BY_CATEGORY[category4] || DefaultStrategy;
  const subTrack =
    opts.sub_track != null
      ? opts.sub_track
      : resolveSubTrackFromProfile(category4, target, target?.structured_profile);

  const strategy = {
    id: impl.id,
    label: impl.label,
    category_4: category4,
    sub_track: subTrack,
    match_level: opts.match_level || null,
    buildPromptAppendix: () => impl.buildPromptAppendix({ subTrack, target, candidate }),
    adjustRuleScore: (ctx) =>
      impl.adjustRuleScore({
        ...ctx,
        subTrack,
        target: ctx.target || target,
        cand: ctx.cand || candidate,
      }),
    getDiscoveryPolicy: () =>
      typeof impl.getDiscoveryPolicy === 'function'
        ? impl.getDiscoveryPolicy({ target, subTrack })
        : require('./baseStrategy').defaultDiscoveryPolicy(),
  };
  return strategy;
}

async function attachStrategyToTarget(target, row = {}) {
  const resolved = await resolveTargetCategory4(target, row);
  target.industry_category_4 = resolved.category_4;
  target.sub_track = resolved.sub_track;
  target.category_match_level = resolved.match_level;
  if (row.structured_profile_json) {
    target.structured_profile = parseStructuredJson(row.structured_profile_json);
  }
  target.strategy = getIndustryStrategy(target, null, {
    category_4: resolved.category_4,
    sub_track: resolved.sub_track,
    match_level: resolved.match_level,
  });
  return target.strategy;
}

function listIndustryStrategies() {
  return Object.values(STRATEGY_BY_CATEGORY).map((s) => ({
    id: s.id,
    label: s.label,
    category_4: s.category_4,
  }));
}

module.exports = {
  STRATEGY_BY_CATEGORY,
  getIndustryStrategy,
  listIndustryStrategies,
  resolveTargetCategory4,
  attachStrategyToTarget,
  resolveSubTrackFromProfile,
  parseStructuredJson,
  // 兼容旧导出
  resolveCategory4: (target, candidate) =>
    strTrim(target?.industry_category_4) || strTrim(candidate?.industry_category_4) || 'other',
  resolveSubTrack: (candidate) => resolveSubTrackFromProfile('semi_mfg', candidate, null),
};
