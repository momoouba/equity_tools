'use strict';

const db = require('../../db');
const C = require('./constants');
const {
  padStockCode,
  listingMarketFromExchange,
  listingMarketFromCode,
  isAllowedListingMarket,
  isLikelyHkOrUs,
} = require('./marketUtils');
const {
  resolveStockFromNewShare,
  listCaseComparables,
  listDeletedCodes,
  latestSuccessRun,
  findCompetitorInvestedEnterprise,
  parseJson,
} = require('./comparableService');
const { resolveCategory4FromSw } = require('../project-sourcing/swIndustryCategoryMap');
const { proposeListedPeers } = require('./listedIndustryRecommendAi');
const {
  strTrim,
  parseTags,
  scoreCandidate,
  buildRuleReason,
  companyIntroFallback,
  pickBestByCredit,
  enabledRecallLayers,
  defaultCheckedCodes,
  isUsableCategory4,
  lensPhrases,
} = require('./listedIndustryRecommendScore');

const PER_LAYER_CAP = Math.max(
  20,
  parseInt(process.env.VALUATION_RECOMMEND_PER_LAYER_CAP || '100', 10) || 100
);
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const EXCHANGES_CORE = ['上交所', '深交所', '北交所'];
const EXCHANGE_NEEQ = '新三板';

function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return true;
    if (v.must_align || v.custom_keywords) {
      return !((v.must_align || []).length || (v.custom_keywords || []).length);
    }
  }
  return strTrim(v) === '';
}

function fillEmpty(target, src, keys) {
  if (!src) return;
  for (const k of keys) {
    if (isEmpty(target[k]) && !isEmpty(src[k])) target[k] = src[k];
  }
}

function pickLens(raw) {
  const obj = parseJson(raw, raw && typeof raw === 'object' ? raw : null) || raw || {};
  const lens = obj.competition_lens || obj;
  return {
    must_align: Array.isArray(lens.must_align) ? lens.must_align.filter(Boolean) : [],
    custom_keywords: Array.isArray(lens.custom_keywords) ? lens.custom_keywords.filter(Boolean) : [],
  };
}

async function lookupSwParents(l3) {
  const name = strTrim(l3);
  if (!name) return { sw_industry_l1: '', sw_industry_l2: '' };
  const rows = await db.query(
    `SELECT sw_industry_l1, sw_industry_l2 FROM valuation_sw_industry
     WHERE sw_industry_l3 = ? LIMIT 1`,
    [name]
  );
  return {
    sw_industry_l1: strTrim(rows[0]?.sw_industry_l1),
    sw_industry_l2: strTrim(rows[0]?.sw_industry_l2),
  };
}

async function queryRowById(table, id) {
  if (!id) return null;
  try {
    const rows = await db.query(
      `SELECT * FROM ${table} WHERE F_Id = ? AND F_DeleteMark = 0 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  } catch (e) {
    console.warn('[listedIndustryRecommend] query', table, e.message);
    return null;
  }
}

function metaFromSubjectRow(row) {
  if (!row) return {};
  const tags = parseTags(row.ai_industry_tags_json || row.ai_industry_tags_display);
  const lens = pickLens(row.competition_lens_json);
  return {
    display_name: strTrim(row.enterprise_full_name || row.project_abbreviation || row.display_name),
    unified_credit_code: strTrim(row.unified_credit_code).replace(/\s+/g, ''),
    industry_category_4: strTrim(row.industry_category_4),
    sw_industry_l1: strTrim(row.sw_industry_l1),
    sw_industry_l2: strTrim(row.sw_industry_l2),
    sub_track: strTrim(row.sub_track),
    tags,
    competition_lens: lens,
    product_intro: strTrim(row.ai_product_intro || row.product_intro),
    qcc_intro: strTrim(row.qcc_company_intro || row.company_intro),
    listed_stock_code: strTrim(row.listed_stock_code),
  };
}

function metaFromS0(detail) {
  const d = parseJson(detail, detail) || {};
  const lens = pickLens(d.competition_lens);
  return {
    display_name: strTrim(d.display_name),
    unified_credit_code: strTrim(d.unified_credit_code).replace(/\s+/g, ''),
    industry_category_4: strTrim(d.industry_category_4),
    sw_industry_l1: strTrim(d.sw_industry_l1 || d.industry_l1),
    sw_industry_l2: strTrim(d.sw_industry_l2 || d.industry_l2),
    sub_track: strTrim(d.sub_track),
    tags: parseTags(d.tags),
    competition_lens: lens,
    product_intro: strTrim(d.product_intro),
    qcc_intro: strTrim(d.qcc_intro_effective),
  };
}

async function loadS0Detail(cse) {
  let subjectType;
  let ieId = cse.invested_enterprise_id;
  let pipId = cse.subject?.competitor_pre_project_id;
  if (cse.case_type === C.CASE_TYPE_PRE) {
    subjectType = 'pre_investment_project';
  } else {
    subjectType = 'invested_enterprise';
    if (!ieId) {
      const matched = await findCompetitorInvestedEnterprise({
        creditCode: cse.subject?.unified_credit_code,
        fullName: cse.subject?.enterprise_full_name || cse.subject?.display_name,
      });
      ieId = matched?.id || null;
    } else {
      const matched = await findCompetitorInvestedEnterprise({
        creditCode: cse.subject?.unified_credit_code,
        fullName: cse.subject?.enterprise_full_name || cse.subject?.display_name,
      });
      if (matched?.id) ieId = matched.id;
    }
  }
  const run = await latestSuccessRun({
    subjectType,
    investedEnterpriseId: ieId,
    preInvestmentProjectId: pipId,
  });
  if (!run) return null;
  const rows = await db.query(
    `SELECT detail_json FROM sourcing_competitor_run_step_log
     WHERE run_id = ? AND step_code = 'S0_profile'
     ORDER BY F_CreatorTime DESC LIMIT 1`,
    [run.run_id]
  );
  return rows[0]?.detail_json || null;
}

async function loadFinancingMeta(credit) {
  const c = strTrim(credit).replace(/\s+/g, '');
  if (!c) return null;
  const rows = await db.query(
    `SELECT industry_category_4, industry_std_lv1, industry_std_lv2,
            listed_stock_code, ai_product_intro, company_intro, company_name
     FROM sourcing_financing_event
     WHERE F_DeleteMark = 0 AND REPLACE(IFNULL(company_credit_code,''), ' ', '') = ?
     ORDER BY F_LastModifyTime DESC LIMIT 1`,
    [c]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    industry_category_4: strTrim(r.industry_category_4),
    sw_industry_l1: strTrim(r.industry_std_lv1),
    sw_industry_l2: strTrim(r.industry_std_lv2),
    listed_stock_code: strTrim(r.listed_stock_code),
    product_intro: strTrim(r.ai_product_intro),
    qcc_intro: strTrim(r.company_intro),
    display_name: strTrim(r.company_name),
  };
}

async function assembleProfile(cse, draft) {
  const warnings = [];
  const sources = {};
  const profile = {
    display_name: strTrim(cse.subject?.display_name || cse.subject_display_name),
    unified_credit_code: strTrim(cse.subject?.unified_credit_code).replace(/\s+/g, ''),
    industry_category_4: '',
    sw_industry_l1: '',
    sw_industry_l2: '',
    sw_industry_l3: strTrim(draft?.payload?.sw_industry_l3),
    sub_track: '',
    tags: [],
    competition_lens: { must_align: [], custom_keywords: [] },
    product_intro: '',
    qcc_intro: '',
    exclude_credits: [],
    exclude_codes: [],
  };
  if (profile.sw_industry_l3) sources.sw_industry_l3 = 'draft_method';

  let subjectRow = null;
  if (cse.case_type === C.CASE_TYPE_PRE && cse.subject?.competitor_pre_project_id) {
    subjectRow = await queryRowById('pre_investment_project', cse.subject.competitor_pre_project_id);
  } else if (cse.invested_enterprise_id) {
    subjectRow = await queryRowById('invested_enterprises', cse.invested_enterprise_id);
    const ca = await findCompetitorInvestedEnterprise({
      creditCode: profile.unified_credit_code,
      fullName: profile.display_name,
    });
    if (ca?.id && ca.id !== cse.invested_enterprise_id) {
      const caRow = await queryRowById('invested_enterprises', ca.id);
      if (caRow) {
        fillEmpty(subjectRow || {}, metaFromSubjectRow(caRow), []);
        const merged = { ...(subjectRow || {}), ...caRow };
        for (const k of Object.keys(caRow)) {
          if (isEmpty(merged[k])) merged[k] = caRow[k];
          if (isEmpty(subjectRow?.[k]) && !isEmpty(caRow[k])) {
            if (!subjectRow) subjectRow = {};
            subjectRow[k] = caRow[k];
          }
        }
        if (!subjectRow) subjectRow = caRow;
      }
    }
  }
  const fromSubject = metaFromSubjectRow(subjectRow);
  fillEmpty(profile, fromSubject, [
    'display_name', 'unified_credit_code', 'industry_category_4',
    'sw_industry_l1', 'sw_industry_l2', 'sub_track', 'tags',
    'competition_lens', 'product_intro', 'qcc_intro',
  ]);
  if (fromSubject.industry_category_4) sources.industry_category_4 = sources.industry_category_4 || 'subject';

  const s0 = metaFromS0(await loadS0Detail(cse));
  fillEmpty(profile, s0, [
    'display_name', 'unified_credit_code', 'industry_category_4',
    'sw_industry_l1', 'sw_industry_l2', 'sub_track', 'tags',
    'competition_lens', 'product_intro', 'qcc_intro',
  ]);
  if (s0.industry_category_4 && !sources.industry_category_4) sources.industry_category_4 = 's0_profile';

  const lensFromSubject = pickLens(subjectRow?.competition_lens_json);
  fillEmpty(profile, { competition_lens: lensFromSubject }, ['competition_lens']);

  const fin = await loadFinancingMeta(profile.unified_credit_code);
  if (fin) {
    fillEmpty(profile, fin, ['industry_category_4', 'product_intro', 'qcc_intro', 'display_name']);
  }

  if (profile.sw_industry_l3 && (!profile.sw_industry_l1 || !profile.sw_industry_l2)) {
    const parents = await lookupSwParents(profile.sw_industry_l3);
    fillEmpty(profile, parents, ['sw_industry_l1', 'sw_industry_l2']);
  }

  if (!profile.sub_track && (profile.sw_industry_l1 || profile.sw_industry_l2)) {
    try {
      const mapped = await resolveCategory4FromSw(db, profile.sw_industry_l1, profile.sw_industry_l2);
      if (mapped?.sub_track) profile.sub_track = mapped.sub_track;
      if (!profile.industry_category_4 && mapped?.category_4) {
        profile.industry_category_4 = mapped.category_4;
        sources.industry_category_4 = sources.industry_category_4 || 'sw_map';
      }
    } catch (e) {
      warnings.push(`赛道映射失败：${e.message}`);
    }
  }

  const excludeCredits = new Set();
  const excludeCodes = new Set();
  if (profile.unified_credit_code) excludeCredits.add(profile.unified_credit_code);
  const listing = await resolveStockFromNewShare({
    creditCode: profile.unified_credit_code,
    displayName: profile.display_name,
  });
  if (listing?.stock_code) excludeCodes.add(padStockCode(listing.stock_code));
  if (fromSubject.listed_stock_code) excludeCodes.add(padStockCode(fromSubject.listed_stock_code));
  if (fin?.listed_stock_code) excludeCodes.add(padStockCode(fin.listed_stock_code));
  profile.exclude_credits = [...excludeCredits];
  profile.exclude_codes = [...excludeCodes].filter(Boolean);
  profile.sources = sources;
  profile.warnings = warnings;

  const thin = !isUsableCategory4(profile.industry_category_4)
    && !profile.sw_industry_l3 && !profile.sw_industry_l1 && !profile.tags.length
    && !lensPhrases(profile).length;
  if (thin) {
    profile.cold_start_message = '标的缺少行业/赛道信息，无法推荐。可在方法配置填写申万三级，或完善主体行业标签后重试。';
  }
  return profile;
}

function universeWhere({ includeNeeq }) {
  const exchanges = includeNeeq ? [...EXCHANGES_CORE, EXCHANGE_NEEQ] : EXCHANGES_CORE;
  return {
    sql: `n.exchange IN (${exchanges.map(() => '?').join(',')})
       AND IFNULL(n.stock_name,'') NOT LIKE '%退市%'
       AND IFNULL(n.enterprise_full_name_cn,'') NOT LIKE '%退市%'
       AND IFNULL(n.enterprise_full_name_display,'') NOT LIKE '%退市%'`,
    params: exchanges,
  };
}

function recallPhrases(profile) {
  const raw = [...parseTags(profile.tags), ...lensPhrases(profile)];
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const s = strTrim(p);
    if (s.length < 2) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 8) break;
  }
  return out;
}

function layerWhere(layer, profile) {
  if (layer === 1) {
    return {
      sql: 'n.industry_category_4 = ? AND IFNULL(vsc.sw_industry_l3, \'\') = ?',
      params: [profile.industry_category_4, profile.sw_industry_l3],
    };
  }
  if (layer === 2) {
    return {
      sql: 'n.industry_category_4 = ? AND IFNULL(n.sw_industry_l2, \'\') = ?',
      params: [profile.industry_category_4, profile.sw_industry_l2],
    };
  }
  if (layer === 3) {
    return {
      sql: 'n.industry_category_4 = ?',
      params: [profile.industry_category_4],
    };
  }
  if (layer === 5) {
    const phrases = recallPhrases(profile);
    if (!phrases.length) {
      return { sql: '1=0', params: [] };
    }
    const clause = phrases
      .map(() => `(IFNULL(n.industry_tags_display,'') LIKE ? OR IFNULL(n.product_intro,'') LIKE ? OR IFNULL(n.company_intro,'') LIKE ?)`)
      .join(' OR ');
    const params = [];
    for (const p of phrases) {
      const like = `%${p}%`;
      params.push(like, like, like);
    }
    return { sql: clause, params };
  }
  return {
    sql: 'IFNULL(n.sw_industry_l1, \'\') = ?',
    params: [profile.sw_industry_l1],
  };
}

function coarseOrderSql(profile) {
  const tagLikes = recallPhrases(profile).slice(0, 5);
  const tagSql = tagLikes.length
    ? tagLikes
      .map(() => `(IFNULL(n.industry_tags_display,'') LIKE ? OR IFNULL(n.product_intro,'') LIKE ? OR IFNULL(n.company_intro,'') LIKE ?)`)
      .join(' OR ')
    : '0';
  const catParam = isUsableCategory4(profile.industry_category_4) ? profile.industry_category_4 : '';
  const likeParams = [];
  for (const t of tagLikes) {
    const like = `%${t}%`;
    likeParams.push(like, like, like);
  }
  return {
    sql: `(CASE WHEN n.industry_category_4 = ? THEN 10 ELSE 0 END)
       + (CASE
            WHEN IFNULL(vsc.sw_industry_l3,'') = ? THEN 6
            WHEN IFNULL(n.sw_industry_l2,'') = ? THEN 4
            WHEN IFNULL(n.sw_industry_l1,'') = ? THEN 2
            ELSE 0
          END)
       + (CASE WHEN (${tagSql}) THEN 8 ELSE 0 END)`,
    params: [
      catParam,
      profile.sw_industry_l3 || '',
      profile.sw_industry_l2 || '',
      profile.sw_industry_l1 || '',
      ...likeParams,
    ],
  };
}

const SELECT_LISTING = `n.stock_code, n.stock_name, n.exchange, n.unified_credit_code,
            n.industry_category_4, n.sw_industry_l1, n.sw_industry_l2,
            vsc.sw_industry_l3 AS constituent_l3,
            n.product_intro, n.company_intro, n.industry_tags_display, n.industry_tags_json`;

async function recallLayer(layer, profile, { includeNeeq }) {
  const uni = universeWhere({ includeNeeq });
  const lw = layerWhere(layer, profile);
  const fromSql = `FROM ipo_new_share n
     LEFT JOIN valuation_sw_constituent vsc ON vsc.stock_code = n.stock_code
     WHERE ${uni.sql} AND ${lw.sql}`;
  const countRows = await db.query(`SELECT COUNT(*) AS c ${fromSql}`, [...uni.params, ...lw.params]);
  const count = Number(countRows[0]?.c || 0);
  let sql = `SELECT ${SELECT_LISTING} ${fromSql}`;
  const params = [...uni.params, ...lw.params];
  if (count > PER_LAYER_CAP) {
    const coarse = coarseOrderSql(profile);
    sql += ` ORDER BY ${coarse.sql} DESC, n.stock_code ASC LIMIT ${PER_LAYER_CAP}`;
    params.push(...coarse.params);
  } else {
    sql += ' ORDER BY n.stock_code ASC';
  }
  return db.query(sql, params);
}

async function attachListingSubTrack(row) {
  const l1 = strTrim(row.sw_industry_l1);
  const l2 = strTrim(row.sw_industry_l2);
  if (!l1 && !l2) return { ...row, sub_track: null, sw_industry_l3: strTrim(row.constituent_l3) };
  try {
    const mapped = await resolveCategory4FromSw(db, l1, l2);
    return {
      ...row,
      sub_track: mapped?.sub_track || null,
      sw_industry_l3: strTrim(row.constituent_l3),
      industry_category_4: strTrim(row.industry_category_4) || mapped?.category_4 || null,
    };
  } catch {
    return { ...row, sub_track: null, sw_industry_l3: strTrim(row.constituent_l3) };
  }
}

async function loadListingByCode(code) {
  const padded = padStockCode(code);
  if (!padded) return null;
  const rows = await db.query(
    `SELECT ${SELECT_LISTING}
     FROM ipo_new_share n
     LEFT JOIN valuation_sw_constituent vsc ON vsc.stock_code = n.stock_code
     WHERE n.stock_code = ?
     LIMIT 1`,
    [padded]
  );
  return rows[0] || null;
}

function isDelistedName(row) {
  const blob = `${row?.stock_name || ''} ${row?.enterprise_full_name_cn || ''} ${row?.enterprise_full_name_display || ''}`;
  return blob.includes('退市');
}

function listingAllowed(row, { includeNeeq, profile }) {
  const code = padStockCode(row?.stock_code);
  if (!code) return { ok: false, reason: '无证券代码' };
  if (isLikelyHkOrUs(row.exchange) || isLikelyHkOrUs(code)) return { ok: false, reason: '港股美股不入池' };
  if (profile.exclude_codes.includes(code)) return { ok: false, reason: '标的自身' };
  const credit = strTrim(row.unified_credit_code).replace(/\s+/g, '');
  if (credit && profile.exclude_credits.includes(credit)) return { ok: false, reason: '标的自身' };
  if (isDelistedName(row)) return { ok: false, reason: '已退市' };
  const market = listingMarketFromExchange(row.exchange) || listingMarketFromCode(code);
  if (!isAllowedListingMarket(market)) return { ok: false, reason: '非境内上市板块' };
  if (!includeNeeq && market === 'neeq') return { ok: false, reason: '未勾选新三板' };
  return { ok: true, code, market, credit };
}

function mergeRecallSource(existing, incoming) {
  const parts = new Set(
    String(existing || '')
      .split(/[+,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  for (const p of String(incoming || '').split(/[+,]/).map((s) => s.trim()).filter(Boolean)) {
    parts.add(p);
  }
  return [...parts].join('+');
}

async function verifyAiProposals(rawList, { profile, includeNeeq }) {
  const skipped = [];
  const verified = [];
  const seen = new Set();
  for (const item of rawList || []) {
    const resolved = await resolveStockFromNewShare({
      stockCode: item.stock_code,
      creditCode: item.unified_credit_code,
      displayName: item.stock_name,
    });
    if (!resolved?.stock_code) {
      skipped.push({
        stock_code: item.stock_code || null,
        stock_name: item.stock_name || null,
        reason: '上市主档未核到',
      });
      continue;
    }
    const listing = await loadListingByCode(resolved.stock_code);
    if (!listing) {
      skipped.push({
        stock_code: padStockCode(resolved.stock_code),
        stock_name: resolved.stock_name || item.stock_name,
        reason: '上市主档未核到',
      });
      continue;
    }
    const gate = listingAllowed(listing, { includeNeeq, profile });
    if (!gate.ok) {
      skipped.push({
        stock_code: padStockCode(resolved.stock_code),
        stock_name: listing?.stock_name || resolved.stock_name || item.stock_name,
        reason: gate.reason,
      });
      continue;
    }
    if (seen.has(gate.code)) continue;
    seen.add(gate.code);
    verified.push({
      ...listing,
      stock_code: gate.code,
      listing_market: gate.market,
      recall_layer: null,
      recall_source: 'ai_propose',
      business_reason: strTrim(item.business_reason) || null,
      business_confidence: item.confidence || 'medium',
    });
  }
  return { verified, skipped };
}

function buildScoredRow(profile, row, { activeCodes, deletedCodes }) {
  const s = scoreCandidate(profile, row);
  const reason = buildRuleReason(profile, row, s);
  const intro = companyIntroFallback(row);
  let list_status = 'can_add';
  if (activeCodes.has(row.stock_code)) list_status = 'on_list';
  else if (deletedCodes.has(row.stock_code)) list_status = 'was_deleted';
  const recallSource = row.recall_source
    || (row.business_reason ? 'ai_propose' : 'rule');
  return {
    stock_code: row.stock_code,
    stock_name: row.stock_name,
    listing_market: row.listing_market,
    exchange: row.exchange,
    unified_credit_code: row.unified_credit_code || null,
    industry_category_4: row.industry_category_4 || null,
    sw_industry_l1: row.sw_industry_l1 || null,
    sw_industry_l2: row.sw_industry_l2 || null,
    sw_industry_l3: row.sw_industry_l3 || null,
    sub_track: row.sub_track || null,
    industry_tags_display: row.industry_tags_display || null,
    industry_tags_json: parseJson(row.industry_tags_json, null),
    product_intro: row.product_intro || null,
    company_intro: row.company_intro || null,
    company_intro_display: intro,
    relevance_score: s.score,
    score: s.score,
    comparability: s.comparability,
    match_reason: reason.summary,
    reason,
    list_status,
    recall_layer: row.recall_layer ?? null,
    recall_source: recallSource,
    business_reason: row.business_reason || null,
    business_confidence: row.business_confidence || null,
  };
}

function takeTopCandidates(scored, topN) {
  const ai = [];
  const rest = [];
  for (const c of scored) {
    if (String(c.recall_source || '').includes('ai_propose')) ai.push(c);
    else rest.push(c);
  }
  const out = [];
  const seen = new Set();
  for (const c of [...ai, ...rest]) {
    if (seen.has(c.stock_code)) continue;
    seen.add(c.stock_code);
    out.push(c);
    if (out.length >= topN) break;
  }
  out.sort((a, b) => (b.score - a.score) || String(a.stock_code).localeCompare(String(b.stock_code)));
  return out;
}

async function recommendListedComparables({ cse, draft, relax = false, includeNeeq = false, limit = DEFAULT_LIMIT }) {
  const profile = await assembleProfile(cse, draft);
  const topN = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT));
  const params = { relax: !!relax, include_neeq: !!includeNeeq, limit: topN, per_layer_cap: PER_LAYER_CAP };
  const warnings = [...(profile.warnings || [])];
  const canPropose = !!(profile.display_name || profile.product_intro || profile.qcc_intro || (profile.tags || []).length);
  if (profile.cold_start_message && canPropose) {
    warnings.push(profile.cold_start_message);
  }
  if (!canPropose) {
    return {
      profile,
      params,
      candidates: [],
      default_checked: [],
      message: profile.cold_start_message || '标的缺少名称与行业信息，无法推荐。',
      warnings,
      ai_propose: { status: 'skipped', nominated: 0, verified: 0, skipped: [], message: '缺少标的名称' },
    };
  }

  const layers = enabledRecallLayers(profile, { relax: !!relax });
  const byCode = new Map();
  for (const layer of layers) {
    const rows = await recallLayer(layer, profile, { includeNeeq: !!includeNeeq });
    for (const r of rows) {
      const gate = listingAllowed(r, { includeNeeq: !!includeNeeq, profile });
      if (!gate.ok || byCode.has(gate.code)) continue;
      byCode.set(gate.code, {
        ...r,
        stock_code: gate.code,
        listing_market: gate.market,
        recall_layer: layer,
        recall_source: 'rule',
      });
    }
  }

  const aiRaw = await proposeListedPeers(profile, {
    limit: Math.min(20, Math.max(15, topN)),
    excludeCodes: profile.exclude_codes,
    excludeCredits: profile.exclude_credits,
  });
  const verifiedPack = aiRaw.status === 'success'
    ? await verifyAiProposals(aiRaw.candidates, { profile, includeNeeq: !!includeNeeq })
    : { verified: [], skipped: [] };

  for (const row of verifiedPack.verified) {
    const existing = byCode.get(row.stock_code);
    if (existing) {
      existing.business_reason = row.business_reason || existing.business_reason;
      existing.business_confidence = row.business_confidence || existing.business_confidence;
      existing.recall_source = mergeRecallSource(existing.recall_source, 'ai_propose');
    } else {
      byCode.set(row.stock_code, row);
    }
  }

  const enriched = [];
  for (const row of byCode.values()) {
    enriched.push(await attachListingSubTrack(row));
  }

  const active = await listCaseComparables(cse.id);
  const activeCodes = new Set(active.map((r) => padStockCode(r.stock_code)));
  const deletedCodes = await listDeletedCodes(cse.id);

  let scored = enriched.map((row) => buildScoredRow(profile, row, { activeCodes, deletedCodes }));
  scored = pickBestByCredit(scored);
  scored.sort((a, b) => (b.score - a.score) || String(a.stock_code).localeCompare(String(b.stock_code)));
  const candidates = takeTopCandidates(scored, topN);
  const default_checked = defaultCheckedCodes(candidates);
  const ai_propose = {
    status: aiRaw.status,
    nominated: aiRaw.nominated || 0,
    verified: verifiedPack.verified.length,
    skipped: verifiedPack.skipped,
    message: aiRaw.message || null,
  };
  let message = null;
  if (!candidates.length) {
    message = ai_propose.status === 'failed'
      ? (ai_propose.message || 'AI 提名失败，且规则召回无匹配。')
      : '宇宙内无匹配。可勾选含新三板或放宽召回后重试。';
  }
  return {
    profile,
    params,
    candidates,
    default_checked,
    message,
    warnings,
    ai_propose,
  };
}

module.exports = {
  assembleProfile,
  recommendListedComparables,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
