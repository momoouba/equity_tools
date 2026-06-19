/**
 * 企查查「企业介绍」清洗：剔除与经营范围雷同、纯工商模版类无效内容（竞品匹配等场景）。
 * 规则可迭代；返回 effectiveText 供匹配上下文使用，raw 原文仍可由调用方保留展示。
 */

function normalizeWs(s) {
  return String(s ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\t\v\f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 典型工商经营范围式开头/高频片段（命中多条则倾向判无效） */
const SCOPE_HINT_PATTERNS = [
  /^一般项目[:：]/,
  /^许可项目[:：]/,
  /^一般经营项目[:：]/,
  /^经营范围[:：]/,
  /依法须经批准的项目/,
  /经相关部门批准后方可开展经营活动/,
  /市场主体登记/,
  /除依法须经批准的项目外/,
  /凭营业执照依法自主开展经营活动/,
];

function scoreScopeLikeness(text) {
  const t = text;
  if (!t || t.length < 24) return 0;
  let score = 0;
  for (const re of SCOPE_HINT_PATTERNS) {
    if (re.test(t)) score += 1;
  }
  // 分号/顿号密度高、句子极长且缺少产品动词
  const seps = (t.match(/[；;]/g) || []).length;
  if (seps >= 4 && t.length > 120) score += 1;
  const productVerbs = /(产品|解决方案|平台|SaaS|软件|系统|服务|研发|客户|医院|学校|跨境|智能|模型|数据)/;
  if (!productVerbs.test(t) && t.length > 80) score += 1;
  return score;
}

/**
 * @param {string|null|undefined} rawIntro 企查查写入的原文
 * @returns {{ effectiveText: string, rejectedAsNoise: boolean, reason: string|null }}
 */
function sanitizeQccCompanyIntroForMatching(rawIntro) {
  const raw = normalizeWs(rawIntro);
  if (!raw) {
    return { effectiveText: '', rejectedAsNoise: false, reason: 'empty' };
  }
  if (raw.length < 28) {
    return { effectiveText: '', rejectedAsNoise: true, reason: 'too_short' };
  }
  const lik = scoreScopeLikeness(raw);
  if (lik >= 2) {
    return { effectiveText: '', rejectedAsNoise: true, reason: 'scope_like' };
  }
  // 单条强命中且全文较短 → 仍视为噪声
  if (lik >= 1 && raw.length < 90) {
    return { effectiveText: '', rejectedAsNoise: true, reason: 'scope_like_short' };
  }
  return { effectiveText: raw, rejectedAsNoise: false, reason: null };
}

module.exports = {
  sanitizeQccCompanyIntroForMatching,
  normalizeWs,
};
