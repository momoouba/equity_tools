/**
 * IPO 审核进展筛选：从 ipo_progress 去重后的选项排序（交易所 / 板块 / 审核状态）。
 * 审核状态按常见审核流程排序（港交所递表在前，其次 A 股受理→发行，再次终止类）。
 */

/** @type {string[]} 出现越早表示流程越靠前（同一阶段内细项按常见顺序） */
const IPO_PROGRESS_STATUS_ORDER = [
  // —— 港交所：递表 → 聆讯 → 招股 → 上市 ——
  '递交A1',
  '聆讯',
  '通过聆讯',
  '聆讯通过',
  '已通过聆讯',
  '招股中',
  '开启招股',
  '暗盘',
  '定价',
  '新上市',
  // —— A 股（沪/深/北映射后中文）：受理 → 问询 → 上市委 → 注册 → 发行 ——
  '已受理',
  '已问询',
  '待上会',
  '上市委会议',
  '上市委会议通过',
  '有条件通过',
  '上市委会议未通过',
  '暂缓审议',
  '提交注册',
  '注册',
  '注册生效',
  '不予注册',
  '终止注册',
  '注册结果',
  '已发行',
  '补充审核',
  '中止',
  '中止(财报更新)',
  '中止(其他事项)',
  '中止及财报更新',
  '复议委会议',
  '复议委会议通过',
  '复议委会议未通过',
  '复审委会议通过',
  '复审委会议未通过',
  '终止',
  '终止审查',
  '不予核准',
  // —— 港股负面终态 ——
  '失效',
  '撤回',
  '拒绝',
  '发回',
  // —— 辅导 / 其他 ——
  '辅导备案',
  '受理',
  '反馈',
  '-',
];

const IPO_PROGRESS_EXCHANGE_ORDER = ['深交所', '上交所', '北交所', '港交所', '证监会辅导备案'];

const IPO_PROGRESS_BOARD_ORDER = [
  '主板',
  '科创板',
  '创业板',
  'GEM',
  '北交所',
  '上交所',
  '深交所',
  '境外发行备案',
];

/** 长关键词优先，避免「注册」吞掉「注册生效」 */
const STATUS_PATTERN_ENTRIES = IPO_PROGRESS_STATUS_ORDER.map((t, i) => ({ t, i })).sort(
  (a, b) => b.t.length - a.t.length
);

function dedupeTrimmed(values) {
  const set = new Set();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) set.add(s);
  }
  return Array.from(set);
}

function sortByPreferredThenZh(values, preferredOrder) {
  const rank = new Map();
  preferredOrder.forEach((x, i) => rank.set(x, i));
  const uniq = dedupeTrimmed(values);
  const known = [];
  const unknown = [];
  for (const v of uniq) {
    if (rank.has(v)) known.push(v);
    else unknown.push(v);
  }
  known.sort((a, b) => rank.get(a) - rank.get(b));
  unknown.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  return [...known, ...unknown];
}

/**
 * @param {string} s
 * @returns {number} 越小越靠前；未匹配时统一大块区间，再按中文排序
 */
function ipoProgressStatusRank(s) {
  const raw = String(s || '').trim();
  if (!raw) return 200000;
  const norm = raw.replace(/（[^）]*）/g, '').trim();
  for (const { t, i } of STATUS_PATTERN_ENTRIES) {
    if (raw === t || norm === t || raw.startsWith(t) || norm.startsWith(t)) {
      return i;
    }
  }
  return 100000;
}

function sortIpoProgressStatuses(values) {
  const uniq = dedupeTrimmed(values);
  return uniq.sort((a, b) => {
    const ra = ipoProgressStatusRank(a);
    const rb = ipoProgressStatusRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'zh-Hans-CN');
  });
}

function sortIpoProgressExchanges(values) {
  return sortByPreferredThenZh(values, IPO_PROGRESS_EXCHANGE_ORDER);
}

function sortIpoProgressBoards(values) {
  return sortByPreferredThenZh(values, IPO_PROGRESS_BOARD_ORDER);
}

module.exports = {
  IPO_PROGRESS_STATUS_ORDER,
  IPO_PROGRESS_EXCHANGE_ORDER,
  IPO_PROGRESS_BOARD_ORDER,
  sortIpoProgressStatuses,
  sortIpoProgressExchanges,
  sortIpoProgressBoards,
};
