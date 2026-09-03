'use strict';

const { strTrim, jaccardSimilarity, textOverlapScore } = require('./competitorMatchUtils');

/** 过宽的行业/赛道标签，不宜单独作为竞品对齐依据 */
const GENERIC_INDUSTRY_TAG_RE =
  /^(生物制药|生命科学|生物医药|医疗健康|医疗器械|生物技术|制药|医疗|健康|科技|创新|服务|领域|行业|企业|公司|平台|解决方案|综合服务|整体解决方案|生物|细胞与基因治疗)$/i;

const GENERIC_INDUSTRY_PHRASE_RE =
  /生物制药与生命科学|生命科学领域|生物医药领域|医疗健康领域|聚焦生物制药|生物制药服务|同属.*领域|客户有交集|下游客户|行业相近/i;

/**
 * 技术 buzzword：作背景权重低，不得主导规则分
 *（抽象技术词，不含具体细分赛道产品名）
 */
const TECH_BUZZWORD_TAG_RE =
  /^(具身智能|人工智能|AI|AIGC|大模型|VLA大模型|VLA|AVLA|世界模型|多模态大模型|多模态|全栈自研|数据飞轮|Sim-to-Real|Sim2Real|情感计算|强化学习|端到端|AGI|物理AGI|机器学习|深度学习|计算机视觉|物联网|区块链|云计算)$/i;

/** C 端 / 家庭场景正向信号（目标透镜强调 C端家庭用户） */
const C_END_FAMILY_SIGNAL_RE =
  /家庭|家用|C端|消费级|个人用户|家庭用户|教育陪玩|陪玩|全能管家|家庭管家|家庭服务|儿童陪伴|家用机器人|家庭场景/;

/** 通用工商注册/经营范围描述，命中则降低对该段 intro 的信任 */
const GENERIC_BIZ_REG_RE = /成立于|法定代表人|注册资本|注册地址|统一社会信用代码|经营范围|一般项目|许可项目|公司类型|登记机关|营业期限|成立日期|注册号|自然人股东|企业类型|所属行业|注册地址位于/;

function isGenericBusinessRegistrationText(text) {
  if (!text || typeof text !== 'string') return false;
  const s = strTrim(text);
  if (s.length < 20) return false;
  const hits = (s.match(GENERIC_BIZ_REG_RE) || []).length;
  // 出现 2 处及以上工商注册关键词，或短文本中 1 处即认为属于注册信息
  return hits >= 2 || (hits >= 1 && s.length < 80);
}

/** B 端 / 企业 / 工业场景反向信号，命中则压低形态分 */
const B_END_SIGNAL_RE =
  /工业|商用|商业|企业级|B端|ToB|To.?B|B2B|物流|仓储|配送|巡检|安防|清洁|消毒|迎宾|零售|餐饮|酒店|医疗|医院|农业|制造|车间|生产线|工厂|园区|楼宇|物业|政企|政务|金融|矿业|建筑|施工|外卖|快递|环卫|安保|安检|分拣|搬运|行业应用|行业解决方案|企业数字化|SaaS|企业软件|营销工具|客服|电商|私域|渠道|供应链|ERP|CRM|HIS|MES|WMS|OA|RPA|行业客户|企业客户|B端客户/g;

/** 教育 / 编程 / 玩具 / 培训类反向信号：仅有教育陪玩、缺乏家庭服务/管家场景 */
const EDUCATION_TOY_RE =
  /编程|积木|STEAM|steam|玩具|早教|培训|课程|教育平台|开发套件|机器人套件|创客|编程教育|幼儿|少儿|儿童编程|教育机器人|编程机器人|积木机器人|套件|机器人教育|K12|k12|图形化编程|教学平台|培训机构|校外培训|STEM|STEM教育|人工智能教育|少儿编程|青少年科技|科技培训|教育硬件|互动教育|教育科技/g;

/** 专用清洁电器 / 单一功能家用机器人反向信号：与家庭通用服务机器人形态跨层 */
const SPECIALIZED_CLEANER_RE =
  /扫地|擦窗|清洁机器人|拖地|洗地|吸尘器|地面清洁|清洁电器|扫地机器人|擦窗机器人|生活电器|智能家用设备/g;

/** 真正的通用家庭服务信号（管家/陪伴/家务/照护等），有此信号时清洁关键词不做反向惩罚 */
const GENERAL_SERVICE_SIGNAL_RE = /管家|全能|陪伴|家务|照护|养老|具身智能服务/;

/**
 * 抽象「产品形态 / 服务对象」标签（通用交付与客户维度，不绑细分赛道）
 */
const FORM_OR_CUSTOMER_TAG_RE =
  /硬件|整机|耗材|设备|仪器|部件|组件|模组|SKU|SaaS|应用软件|应用层|平台产品|终端|穿戴|消费级|C端|B端|企业服务|运营商|开发者|客户|用户|交付/;

function isGenericIndustryTag(tag) {
  const s = strTrim(tag);
  if (!s || s.length <= 2) return true;
  if (GENERIC_INDUSTRY_TAG_RE.test(s)) return true;
  if (/^(提供|从事|专注|面向).{0,4}(领域|行业|服务)$/.test(s)) return true;
  return false;
}

function isTechBuzzwordTag(tag) {
  const s = strTrim(tag);
  if (!s) return false;
  if (TECH_BUZZWORD_TAG_RE.test(s)) return true;
  if (/^[A-Z]{2,6}$/.test(s) && !/SKU|API|SaaS|HIS|ERP/.test(s)) return true;
  return false;
}

function isFormOrCustomerTag(tag) {
  const s = strTrim(tag);
  if (!s || isGenericIndustryTag(s) || isTechBuzzwordTag(s)) return false;
  if (FORM_OR_CUSTOMER_TAG_RE.test(s)) return true;
  // 非 buzz、长度足够的具体产品词也视为形态相关（由画像自身产生，非定向词表）
  return s.length >= 4;
}

function tagWeight(tag) {
  if (isTechBuzzwordTag(tag) || isGenericIndustryTag(tag)) return 0.2;
  if (FORM_OR_CUSTOMER_TAG_RE.test(tag)) return 1.6;
  return 1.2;
}

function extractPhrasesFromIntro(intro, max = 8) {
  const s = strTrim(intro);
  if (!s) return [];
  const terms = [];
  // 抽取「…产品形态尾缀」短语；尾缀保持交付/品类抽象，不含细分赛道专名表
  const phraseRe =
    /[\u4e00-\u9fff]{2,16}(?:装备|设备|系统|平台|耗材|材料|整机|终端|模组|解决方案|应用|服务)/g;
  let m;
  while ((m = phraseRe.exec(s)) !== null && terms.length < max) {
    const t = m[0].trim();
    if (t.length >= 4 && !terms.includes(t) && !isGenericIndustryTag(t) && !isTechBuzzwordTag(t)) {
      terms.push(t);
    }
  }
  return terms;
}

/**
 * 从目标画像提取核心产品线：降 buzzword 权重，优先具体产品词
 * @returns {string[]}
 */
function extractCoreProductLines(profile) {
  const rawTags = (profile?.tags || []).map((t) => strTrim(t)).filter((t) => t && !isGenericIndustryTag(t));
  const preferred = rawTags.filter((t) => !isTechBuzzwordTag(t));
  const buzzTags = rawTags.filter((t) => isTechBuzzwordTag(t));
  const intro = [profile?.product_intro, profile?.qcc_intro_effective].filter(Boolean).join('\n');
  const fromIntro = extractPhrasesFromIntro(intro, 6);

  const merged = [];
  const seen = new Set();
  const push = (t) => {
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(t);
  };
  // 先画像具体词与 intro 短语，再 buzz（仅补足）
  for (const t of [...preferred, ...fromIntro]) {
    push(t);
    if (merged.length >= 10) break;
  }
  if (merged.length < 4) {
    for (const t of buzzTags) {
      push(t);
      if (merged.length >= 8) break;
    }
  }
  return merged;
}

function candidateTextBlob(row) {
  return [
    row?.display_name,
    row?.product_intro,
    row?.qcc_intro,
    row?.qcc_intro_effective,
    ...(row?.tags || []),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * 核心产品线在候选文本中的加权命中（0~100）
 */
function scoreCoreProductLineOverlap(coreLines, candidateBlob) {
  const lines = (coreLines || []).map((x) => strTrim(x)).filter(Boolean);
  const blob = strTrim(candidateBlob);
  if (!lines.length || !blob) return 0;
  let hitW = 0;
  let totalW = 0;
  for (const line of lines) {
    const w = tagWeight(line);
    totalW += w;
    let hit = false;
    if (line.length >= 3 && blob.includes(line)) hit = true;
    else {
      const grams = line.split(/[/、，,\s]+/).filter((g) => g.length >= 3);
      if (grams.length >= 2 && grams.every((g) => blob.includes(g))) hit = true;
      else if (softPhraseHitStrength(line, blob) >= 0.5) hit = true;
    }
    if (hit) hitW += w;
  }
  if (totalW <= 0) return 0;
  return Math.round((hitW / totalW) * 100);
}

function scoreSpecificTagOverlap(targetTags, candidateTags, trustedTerms = []) {
  const a = (targetTags || []).filter((t) => !isGenericIndustryTag(t));
  const b = (candidateTags || []).filter((t) => !isGenericIndustryTag(t));
  if (!a.length || !b.length) return 0;
  const trustedSet = new Set((trustedTerms || []).map((t) => strTrim(t).toLowerCase()));
  const aSet = new Set(a.map((x) => x.toLowerCase()));
  const bSet = new Set(b.map((x) => x.toLowerCase()));
  // 信任术语：候选标签若包含或等于任一信任术语，视为命中
  const isTrusted = (t) => {
    const s = strTrim(t).toLowerCase();
    if (trustedSet.has(s)) return true;
    for (const tr of trustedSet) {
      if (s.includes(tr) || tr.includes(s)) return true;
    }
    return false;
  };
  // 标签匹配：精确或双向子串（target 包含 candidate / candidate 包含 target）
  const tagsMatch = (targetTag, candTag) => {
    const tl = targetTag.toLowerCase();
    const cl = candTag.toLowerCase();
    if (tl === cl) return true;
    if (cl.includes(tl) || tl.includes(cl)) return true;
    return false;
  };
  let inter = 0;
  let union = 0;
  for (const t of a) {
    const w = isTrusted(t) ? Math.max(tagWeight(t), 1.0) : tagWeight(t);
    union += w;
    if (b.some((c) => tagsMatch(t, c))) inter += w;
  }
  for (const t of b) {
    if (!a.some((targetTag) => tagsMatch(targetTag, t))) {
      union += isTrusted(t) ? Math.max(tagWeight(t), 1.0) : tagWeight(t);
    }
  }
  if (union <= 0) return 0;
  return Math.round((inter / union) * 100);
}

/**
 * 目标短语对候选文本的软命中强度 0~1。
 * 规则（通用、无赛道词表）：
 * - 整句命中 = 1
 * - 否则按「连续子串覆盖」：最短有效窗口 3 字；禁止单靠过短公共尾（如仅「机器人」）抬分
 * - 单段须连续 ≥4 且覆盖 ≥50%；多段须覆盖 ≥50%
 */
function softPhraseHitStrength(line, blob) {
  const s = strTrim(line);
  const b = strTrim(blob);
  if (!s || !b) return 0;
  if (b.includes(s)) return 1;
  if (s.length <= 2) return 0;
  if (s.length === 3) return b.includes(s) ? 0.85 : 0;

  const parts = s
    .split(/[/、，,\s]+/)
    .map((g) => strTrim(g))
    .filter((g) => g.length >= 3);
  if (parts.length >= 2 && parts.every((g) => b.includes(g))) {
    return Math.min(0.9, 0.55 + (parts.reduce((n, g) => n + g.length, 0) / s.length) * 0.35);
  }

  // 先用 ≥3 字窗口铺覆盖；2 字仅补短语首尾（避免无关 2-gram 把长句刷满）
  const covered = new Array(s.length).fill(false);
  let longest = 0;
  for (let len = Math.min(s.length, 12); len >= 3; len -= 1) {
    for (let i = 0; i <= s.length - len; i += 1) {
      if (b.includes(s.slice(i, i + len))) {
        longest = Math.max(longest, len);
        for (let j = i; j < i + len; j += 1) covered[j] = true;
      }
    }
  }
  for (const i of [0, Math.max(0, s.length - 2)]) {
    if (i + 2 > s.length) continue;
    const sub = s.slice(i, i + 2);
    if (!b.includes(sub)) continue;
    longest = Math.max(longest, 2);
    covered[i] = true;
    covered[i + 1] = true;
  }
  if (longest < 2) return 0;

  const coveredCount = covered.filter(Boolean).length;
  const coverage = coveredCount / s.length;
  let regions = 0;
  let inRun = false;
  for (let i = 0; i < covered.length; i += 1) {
    if (covered[i]) {
      if (!inRun) {
        regions += 1;
        inRun = true;
      }
    } else {
      inRun = false;
    }
  }

  // 单段：须连续 ≥4 且覆盖一半以上（杜绝仅「机器人」）
  if (regions === 1) {
    if (longest < 4 || coverage < 0.5) return 0;
    return Math.min(0.92, 0.45 + coverage * 0.5);
  }
  // 多段：至少有一段 ≥3，总覆盖 ≥50%（如「家庭」+「机器人」对「家庭服务机器人」）
  if (coverage < 0.5 || longest < 3) return 0;
  return Math.min(0.95, 0.5 + coverage * 0.45);
}

function phraseStructuralWeight(line) {
  const s = strTrim(line);
  const base = tagWeight(s);
  if (s.length >= 6) return base * 1.35;
  if (s.length <= 3) return base * 0.45;
  return base;
}

/**
 * 从目标画像提取「可信领域锚点」—— 来自确认透镜、核心产品线、标签的短术语。
 * 这些术语在后续打分中不被视为 buzzword，且可用于形态/服务对象对齐的短锚匹配。
 */
function extractDomainAnchors(target) {
  const lens = target?.competition_lens;
  const lensLines = [
    ...(lens?.must_align || []),
    ...(lens?.custom_keywords || []),
    ...(lens?.prefer_align || []),
  ];
  const coreLines = (target?.core_product_lines || []).map((x) => strTrim(x)).filter(Boolean);
  const rawTags = (target?.tags || []).map((t) => strTrim(t)).filter(Boolean);
  const source = [...lensLines, ...coreLines, ...rawTags].filter(Boolean).join('\n');

  const base = new Set();
  // 1) 短于 14 字的透镜/核心产品线片段（按标点/连接词切分）
  for (const line of [...lensLines, ...coreLines]) {
    const s = strTrim(line);
    if (!s) continue;
    if (s.length >= 2 && s.length <= 14 && !isGenericIndustryTag(s)) base.add(s);
    for (const part of s.split(/[，,。；;、]/)) {
      const p = strTrim(part);
      if (p.length >= 2 && p.length <= 14 && !isGenericIndustryTag(p)) base.add(p);
    }
  }
  // 2) 目标自身标签：若标签出现在透镜/核心产品线语境中，则视为领域术语而非 buzzword
  for (const t of rawTags) {
    if (isGenericIndustryTag(t)) continue;
    if (isTechBuzzwordTag(t)) {
      if (source.includes(t)) base.add(t);
    } else {
      base.add(t);
    }
  }
  // 3) 从较长术语中抽取 3~4 字尾部后缀作为短锚点（如 家庭服务机器人 -> 机器人）
  // 仅对非 buzzword、非 generic 的核心产品线/透镜短语抽取，避免 '智能' 等后缀误伤精度
  const out = new Set(base);
  for (const term of base) {
    if (term.length < 4) continue;
    if (isTechBuzzwordTag(term) || isGenericIndustryTag(term)) continue;
    for (const len of [4, 3]) {
      if (term.length < len) continue;
      const suffix = term.slice(-len);
      if (suffix.length < len) continue;
      if (/^[\dA-Za-z]+$/.test(suffix)) continue; // 避免纯英文/数字后缀
      if (isGenericIndustryTag(suffix)) continue;
      out.add(suffix);
    }
  }
  return [...out].filter((x) => x.length >= 2 && x.length <= 14);
}

function isDomainAnchorHit(anchor, candidateBlob) {
  const a = strTrim(anchor);
  const b = strTrim(candidateBlob);
  if (!a || !b) return false;
  if (b.includes(a)) return true;
  const grams = a.split(/[/、，,\s]+/).filter((g) => g.length >= 2);
  if (grams.length >= 2 && grams.some((g) => b.includes(g))) return true;
  return false;
}

function weightedSoftHit(anchors, blob) {
  let hitW = 0;
  let totalW = 0;
  for (const line of anchors) {
    if (!line || line.length < 2) continue;
    const w = phraseStructuralWeight(line);
    totalW += w;
    hitW += w * softPhraseHitStrength(line, blob);
  }
  if (totalW <= 0) return 0;
  return hitW / totalW;
}

/**
 * 从透镜长句抽可软匹配的短锚点（通用截断/子串，无赛道名单）。
 * 长句整句覆盖率门槛过高时，金标早期公司会被压成 form=0。
 */
function buildLensScoringAnchors(phrases, max = 10) {
  const out = [];
  const seen = new Set();
  const push = (raw, priority = false) => {
    const t = strTrim(raw);
    if (!t || t.length < 3 || t.length > 14) return;
    if (/^(专注于|公司|在|助力|方面|以及|进行|初期|后续|覆盖|面向|拓展至)/.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ t, priority: !!priority });
  };
  for (const line of phrases || []) {
    const s = strTrim(line);
    if (!s) continue;
    if (s.length <= 14) {
      push(s, true);
      continue;
    }
    for (const part of s.split(/[，,。；;、\n]/)) {
      const p = strTrim(part);
      if (p.length >= 4 && p.length <= 14) push(p, p.length <= 10);
    }
  }
  out.sort((a, b) => Number(b.priority) - Number(a.priority) || a.t.length - b.t.length);
  return out.map((x) => x.t).slice(0, max);
}

/**
 * 形态/服务对象对齐分（0~100）
 * 仅用目标画像自身短语软匹配；长锚点（≥6）主导，短标签不能单独拉高。
 */
function scoreFormCustomerAlignment(target, candidate) {
  const lens = target?.competition_lens;
  const lensLines = [
    ...(lens?.must_align || []),
    ...(lens?.custom_keywords || []),
    ...(lens?.prefer_align || []),
  ]
    .map((x) => strTrim(x))
    .filter(Boolean);
  const coreLines = (target?.core_product_lines || []).map((x) => strTrim(x)).filter(Boolean);
  const tTags = (target?.tags || [])
    .map((t) => strTrim(t))
    .filter((t) => t && !isGenericIndustryTag(t) && !isTechBuzzwordTag(t));
  const seen = new Set();
  const anchors = [];
  // 有竞争透镜时：以短化焦点为主，避免长句软匹配覆盖不足把同层早期公司打成 0
  const seed = lensLines.length
    ? [...buildLensScoringAnchors(lensLines, 10), ...lensLines.filter((x) => x.length <= 16), ...coreLines]
    : [...coreLines, ...tTags];
  for (const line of seed) {
    if (!line || seen.has(line)) continue;
    seen.add(line);
    anchors.push(line);
  }
  let cBlob = candidateTextBlob(candidate);
  if (!anchors.length || !cBlob) return 0;

  // 若候选 intro 只是工商注册/经营范围描述，则剔除该噪声，仅用名称+标签做形态对齐
  const hasGenericIntro = isGenericBusinessRegistrationText(candidate?.product_intro || candidate?.qcc_intro);
  if (hasGenericIntro) {
    cBlob = [candidate?.display_name, ...(candidate?.tags || [])].filter(Boolean).join('\n');
  }

  // 透镜短锚点：加权命中，C端/家庭锚点权重高，通用机器人锚点权重低，并惩罚B端信号
  if (lensLines.length) {
    const compact = buildLensScoringAnchors(lensLines, 8);
    const domainAnchors = extractDomainAnchors(target)
      .sort((a, b) => a.length - b.length || a.localeCompare(b))
      .slice(0, 16);
    const domainSet = new Set(domainAnchors.map((a) => a.toLowerCase()));
    const pool = [
      ...domainAnchors,
      ...(compact.length ? compact : anchors.filter((a) => a.length <= 14)),
    ].filter((a, i, arr) => {
      const key = a.toLowerCase();
      if (domainSet.has(key)) return true;
      return arr.findIndex((x) => x.toLowerCase() === key) === i;
    });

    // 正向锚点：家庭/C端锚点可满血，通用机器人/具身锚点最高 40%
    let familyBest = 0;
    let genericBest = 0;
    let hitCount = 0;
    for (const a of pool) {
      const s = softPhraseHitStrength(a, cBlob);
      if (s >= 0.45) hitCount += 1;
      if (C_END_FAMILY_SIGNAL_RE.test(a)) {
        familyBest = Math.max(familyBest, s);
      } else {
        genericBest = Math.max(genericBest, s);
      }
    }
    if (familyBest <= 0 && genericBest <= 0) return 0;
    const multi = Math.min(0.18, hitCount * 0.06);
    // 通用锚点单独封顶 40%，避免只写了“机器人”的 B 端公司形态分过高
    let score = Math.max(familyBest, genericBest * 0.4) * 0.88 + multi;

    // B 端 / 企业场景反向惩罚（越强越重）
    const bEndHits = (cBlob.match(B_END_SIGNAL_RE) || []).length;
    if (bEndHits > 0) {
      // 1 处 B端信号约扣 25 分，2 处及以上约扣 45 分
      const penalty = Math.min(0.55, bEndHits >= 2 ? 0.45 : 0.25);
      score = Math.max(0, score - penalty);
    }

    // 教育 / 编程 / 玩具 / 培训类反向惩罚：仅有教育陪玩、缺乏家庭服务/管家场景
    const toyHits = (cBlob.match(EDUCATION_TOY_RE) || []).length;
    if (toyHits > 0) {
      // 1 处约扣 35 分，2 处及以上约扣 65 分
      const toyPenalty = Math.min(0.65, toyHits >= 2 ? 0.5 : 0.35);
      score = score * (1 - toyPenalty);
    }

    // 专用清洁电器 / 单一功能家用机器人反向惩罚（仅当缺乏通用家庭服务信号时生效）
    const cleanerHits = (cBlob.match(SPECIALIZED_CLEANER_RE) || []).length;
    const hasGeneralServiceSignal = GENERAL_SERVICE_SIGNAL_RE.test(cBlob);
    if (cleanerHits > 0 && !hasGeneralServiceSignal) {
      // 1 处约扣 30 分，2 处及以上约扣 55 分
      const cleanerPenalty = Math.min(0.55, cleanerHits >= 2 ? 0.45 : 0.3);
      score = score * (1 - cleanerPenalty);
    }

    // 工商注册文本可信度低，额外衰减
    if (hasGenericIntro) {
      score = score * 0.85;
    }

    return Math.min(100, Math.round(score * 100));
  }

  const longAnchors = anchors.filter((a) => a.length >= 6);
  const shortAnchors = anchors.filter((a) => a.length < 6);
  const longScore = longAnchors.length ? weightedSoftHit(longAnchors, cBlob) : 0;
  const shortScore = shortAnchors.length ? weightedSoftHit(shortAnchors, cBlob) : 0;

  if (longAnchors.length) {
    // 长锚点弱时，短标签最多贡献少量分，避免「人形机器人」 alone 抬过高
    if (longScore < 0.4) {
      return Math.min(100, Math.round(longScore * 100 + shortScore * 18));
    }
    return Math.min(100, Math.round((longScore * 0.78 + shortScore * 0.22) * 100));
  }
  return Math.min(100, Math.round(shortScore * 100));
}

/**
 * 目标-候选的产品线精度得分（规则分与校验后处理共用）
 */
function computeProductPrecisionScores(target, candidate) {
  const coreLines =
    target?.core_product_lines?.length > 0
      ? target.core_product_lines
      : extractCoreProductLines(target);
  const introA = [target?.product_intro, target?.qcc_intro_effective].filter(Boolean).join('\n');
  const introB = [candidate?.product_intro, candidate?.qcc_intro, candidate?.qcc_intro_effective]
    .filter(Boolean)
    .join('\n');
  const productScore = Math.round(textOverlapScore(introA, introB) * 100);
  const coreLineScore = scoreCoreProductLineOverlap(coreLines, candidateTextBlob(candidate));
  const trustedTerms = extractDomainAnchors({ ...target, core_product_lines: coreLines });
  const specificTagScore = scoreSpecificTagOverlap(target?.tags, candidate?.tags, trustedTerms);
  const formCustomerScore = scoreFormCustomerAlignment(
    { ...target, core_product_lines: coreLines },
    candidate
  );
  const onlyBroadIndustry =
    (productScore < 22 && coreLineScore < 18 && specificTagScore < 20 && formCustomerScore < 25) ||
    (GENERIC_INDUSTRY_PHRASE_RE.test(introB) && coreLineScore < 25);
  return {
    core_product_lines: coreLines,
    productScore,
    coreLineScore,
    specificTagScore,
    formCustomerScore,
    onlyBroadIndustry,
  };
}

function attachCoreProductLines(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const lines = extractCoreProductLines(profile);
  return { ...profile, core_product_lines: lines };
}

/** 产品线定向召回用检索词（含层析/纯化/过滤等同义扩展） */
function expandProductLineSearchTerms(coreLines, introBlob) {
  const terms = (coreLines || []).map((t) => strTrim(t)).filter((t) => t.length >= 3);
  const blob = [introBlob, ...terms].filter(Boolean).join('\n');
  if (/层析|色谱|填料|纯化|分离介质|微球|树脂/.test(blob)) {
    terms.push('层析填料', '色谱填料', '纯化填料', '色谱介质', '层析介质', '工业制备色谱');
  }
  if (/过滤|滤芯|膜|超滤|微滤|除菌/.test(blob)) {
    terms.push('过滤系统', '除菌过滤', '超滤膜', '微滤膜');
  }
  if (/反应器|培养|生物反应|一次性/.test(blob)) {
    terms.push('生物反应器', '细胞培养', '一次性生物反应器');
  }
  if (/核药|放射性|核素偶联|RDC|PET成像|PET显像|诊疗一体化核药|α核素|砹-211|Lu-177|Ac-225/.test(blob)) {
    terms.push(
      '核药',
      'RDC药物',
      '核素偶联',
      '放射性药物',
      'α核素',
      '砹-211',
      'Lu-177',
      '镥-177',
      'Ac-225',
      '锕-225',
      'PET显像剂'
    );
  }
  const termCap = /核药|放射性|核素偶联|RDC/.test(blob) ? 18 : 14;
  const seen = new Set();
  const out = [];
  for (const t of terms) {
    if (isTechBuzzwordTag(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= termCap) break;
  }
  if (out.length < 3) {
    for (const t of terms) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
      if (out.length >= 8) break;
    }
  }
  return out;
}

/** 判断候选是否带有较强的「非目标」信号（教育/玩具/编程培训、专用清洁电器、B端/工业） */
function hasStrongOffTargetSignals(candidate) {
  const blob = candidateTextBlob(candidate);
  if (!blob) return false;
  const toyHits = (blob.match(EDUCATION_TOY_RE) || []).length;
  const cleanerHits = (blob.match(SPECIALIZED_CLEANER_RE) || []).length;
  const bEndHits = (blob.match(B_END_SIGNAL_RE) || []).length;
  return toyHits >= 2 || cleanerHits >= 1 || bEndHits >= 2;
}

module.exports = {
  buildLensScoringAnchors,
  isGenericIndustryTag,
  isTechBuzzwordTag,
  isFormOrCustomerTag,
  extractCoreProductLines,
  scoreCoreProductLineOverlap,
  scoreSpecificTagOverlap,
  scoreFormCustomerAlignment,
  computeProductPrecisionScores,
  attachCoreProductLines,
  expandProductLineSearchTerms,
  hasStrongOffTargetSignals,
};
