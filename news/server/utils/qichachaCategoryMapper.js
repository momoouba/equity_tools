/**
 * 企查查新闻类别编码到中文的映射
 * 优先从数据库加载，如果数据库中没有数据则使用默认映射
 */

const db = require('../db');

// 默认类别映射（作为后备）
const defaultCategoryMap = {
  '00000': '其他',
  '1000': '高管信息',
  '10000': '信用预警',
  '10001': '承诺失信',
  '10002': '兑付/偿付不确定',
  '10003': '债券/债务违约',
  '10004': '中债隐含评级',
  '10005': '信用评级下调',
  '10006': '评级展望负面',
  '10007': '列入评级观察',
  '10008': '推迟评级',
  '10009': '责令改正',
  '10010': '信披问题',
  '1100': '高管违法',
  '11000': '管理相关',
  '11001': '高管变动',
  '11002': '股权激励',
  '11003': '员工持股计划',
  '1200': '高管变动',
  '12000': '经营相关',
  '12001': '经营业绩',
  '12002': '战略合作',
  '12003': '兼并收购',
  '12004': '股权质押',
  '12005': '增资募资',
  '12006': '投融资',
  '12007': '招投标',
  '12008': '资产重组',
  '12009': '对外投资',
  '12010': '利润分配',
  '12011': '接管托管',
  '12012': '生产产能',
  '12013': '关联交易',
  '12014': '产品信息',
  '12015': '项目签约',
  '12016': '税务注销登记',
  '12017': '新增分支机构/全资子公司',
  '12018': '参与公益',
  '12019': '纳税百强',
  '13000': '市场相关',
  '13001': '增持减持',
  '13002': '股份回购',
  '13003': '股权转让',
  '13004': '新股发行',
  '13005': '股价下跌',
  '13006': '大宗交易',
  '13007': '上市退市',
  '13008': '借壳保壳',
  '13009': '停复牌',
  '13010': '限售股解禁',
  '13011': '订单交易',
  '13012': '上市',
  '13013': '退市',
  '13014': '债券发行失败',
  '14000': '其他相关',
  '14001': '信贷业务',
  '14002': '股东大会',
  '14003': '评级信息',
  '14004': '荣誉奖项',
  '14005': '政策影响',
  '14006': '考察调研',
  '14007': '牌照',
  '14008': '专利',
  '14009': '公示公告',
  '14010': '会议相关',
  '14011': '比赛竞赛',
  '14012': '区块链',
  '14013': '竣工投用',
  '14014': '组织成立',
  '14015': '5G',
  '14016': '自动驾驶',
  '14017': '私募失联',
  '2000': '违法违纪',
  '20000': '财务预警',
  '20001': '财务造假',
  '20002': '审计意见',
  '20003': '担保预警',
  '20004': '资金风险',
  '20005': '计提坏账准备',
  '20006': '财报延期披露',
  '2100': '造假欺诈',
  '2200': '贪污受贿',
  '2300': '违纪违规',
  '2400': '垄断信息',
  '2500': '环保处罚',
  '2600': '安全事故',
  '2700': '司法纠纷',
  '2800': '侵权抄袭',
  '2900': '偷税漏税',
  '3000': '财务经营',
  '30000': '管理预警',
  '30001': '高层被查',
  '30002': '高管违法',
  '30003': '高管失联/无法履职',
  '30004': '贪污受贿',
  '30005': '裁员相关',
  '30006': '拖欠薪资',
  '30007': '员工罢工',
  '30008': '自杀猝死',
  '30009': '欠缴社保',
  '30010': '商业机密被泄露',
  '30011': '实控人变更',
  '3100': '上市退市',
  '3200': '亏损盈利',
  '3300': '投资融资',
  '3400': '收购重组',
  '3500': '停业破产',
  '3600': '股权变动',
  '3700': '增持减持',
  '3800': '债务抵押',
  '4000': '成果信誉',
  '40000': '经营预警',
  '40001': '停工停产',
  '40002': '生产事故',
  '40003': '拖欠货款',
  '40004': '偷税漏税',
  '40005': '资产出售',
  '40006': '诉讼纠纷',
  '40007': '股权冻结',
  '40008': '破产清算',
  '40009': '合作终止',
  '40010': '业绩下降',
  '40011': '垄断信息',
  '40012': '侵权抄袭',
  '40013': '环保问题',
  '40014': '资金挪用/占用',
  '40015': '经营失联(异常)',
  '40016': '减资/分立/合并',
  '40017': '资产查封/扣押/冻结',
  '40018': '合同纠纷',
  '40019': '客户投诉',
  '40020': '维权',
  '40021': '业绩亏损',
  '40022': '丧失经销商资质',
  '40023': '非法集资',
  '40024': '股东利益斗争',
  '40025': '体制改革',
  '40026': '竞争力份额下降',
  '40027': '环保信用行为排名',
  '40028': '关联方不利变化',
  '40029': '关联方人事变动',
  '40030': '重大经济损失',
  '5000': '产品相关',
  '50000': '监管预警',
  '50001': '监管关注',
  '50002': '监管谈话',
  '50003': '警示',
  '50004': '公开谴责',
  '50005': '通报批评',
  '50006': '市场禁入',
  '60000': '产品预警',
  '60001': '产品召回',
  '60002': '产品问题',
  '60003': '虚假宣传',
  '70000': '项目预警',
  '70001': '项目通报',
  '70002': '终止项目',
  '70003': '无证施工',
  '70004': '坍塌事故',
  '80000': '其他预警',
  '80001': '违法违规',
  '80002': '立案调查',
  '80003': '市/估值下降',
  '80004': '推迟/取消发行',
  '80005': '爆仓',
  '80006': '暴雷事件',
  '80007': '中毒事故',
  '80008': '其他'
};

// 缓存数据库中的类别映射（避免每次都查询数据库）
let dbCategoryMapCache = null;
let dbCategoryMapCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 缓存5分钟

/**
 * 从数据库加载类别映射
 * @returns {Promise<Object>} 类别映射对象
 */
async function loadCategoryMapFromDB() {
  try {
    const categories = await db.query(
      'SELECT category_code, category_name FROM qichacha_news_categories ORDER BY category_code'
    );
    const map = {};
    categories.forEach(cat => {
      map[cat.category_code] = cat.category_name;
    });
    return map;
  } catch (error) {
    console.error('从数据库加载企查查类别映射失败:', error);
    return null;
  }
}

/**
 * 获取类别映射（优先使用数据库，如果失败则使用默认映射）
 * @returns {Promise<Object>} 类别映射对象
 */
async function getCategoryMap() {
  // 检查缓存是否有效
  const now = Date.now();
  if (dbCategoryMapCache && dbCategoryMapCacheTime && (now - dbCategoryMapCacheTime) < CACHE_DURATION) {
    return dbCategoryMapCache;
  }

  // 尝试从数据库加载
  const dbMap = await loadCategoryMapFromDB();
  if (dbMap && Object.keys(dbMap).length > 0) {
    dbCategoryMapCache = dbMap;
    dbCategoryMapCacheTime = now;
    return dbMap;
  }

  // 如果数据库中没有数据，使用默认映射
  return defaultCategoryMap;
}

/**
 * 同步获取类别映射（使用缓存或默认映射）
 * 注意：首次调用时可能返回默认映射，直到数据库数据被加载
 * @returns {Object} 类别映射对象
 */
function getCategoryMapSync() {
  if (dbCategoryMapCache) {
    return dbCategoryMapCache;
  }
  return defaultCategoryMap;
}

/**
 * 清除类别映射缓存（当类别数据更新时调用）
 */
function clearCategoryMapCache() {
  dbCategoryMapCache = null;
  dbCategoryMapCacheTime = null;
}

/**
 * 将企查查新闻类别编码转换为中文（异步版本）
 * @param {string|number|array} categoryCode - 类别编码，可能是字符串、数字或数组
 * @returns {Promise<string>} - 中文类别名称，如果找不到则返回原值
 */
async function convertCategoryCodeToChineseAsync(categoryCode) {
  if (!categoryCode) {
    return null;
  }

  // 如果是数组，取第一个元素
  if (Array.isArray(categoryCode)) {
    if (categoryCode.length === 0) {
      return null;
    }
    categoryCode = categoryCode[0];
  }

  // 转换为字符串并去除空格
  let codeStr = String(categoryCode).trim();

  // 如果是空字符串，返回null
  if (!codeStr) {
    return null;
  }

  // 如果包含逗号，取第一个编码（多个类别的情况）
  if (codeStr.includes(',')) {
    codeStr = codeStr.split(',')[0].trim();
  }

  // 获取类别映射
  const categoryMap = await getCategoryMap();

  // 查找映射
  if (categoryMap[codeStr]) {
    return categoryMap[codeStr];
  }

  // 如果找不到映射，检查是否是数字格式（可能需要补零）
  const numCode = String(parseInt(codeStr, 10));
  if (numCode !== 'NaN' && categoryMap[numCode]) {
    return categoryMap[numCode];
  }

  // 如果找不到映射，返回原值（可能是中文或其他格式）
  console.warn(`未找到类别编码映射: ${codeStr}`);
  return codeStr;
}

/**
 * 将企查查新闻类别编码转换为中文（同步版本）
 * @param {string|number|array} categoryCode - 类别编码，可能是字符串、数字或数组
 * @returns {string} - 中文类别名称，如果找不到则返回原值或"其他"
 */
function convertCategoryCodeToChinese(categoryCode) {
  if (!categoryCode) {
    return null;
  }

  // 如果是数组，取第一个元素
  if (Array.isArray(categoryCode)) {
    if (categoryCode.length === 0) {
      return null;
    }
    categoryCode = categoryCode[0];
  }

  // 转换为字符串并去除空格
  let codeStr = String(categoryCode).trim();

  // 如果是空字符串，返回null
  if (!codeStr) {
    return null;
  }

  // 如果包含逗号，取第一个编码（多个类别的情况）
  if (codeStr.includes(',')) {
    codeStr = codeStr.split(',')[0].trim();
  }

  // 获取类别映射（同步版本，使用缓存或默认映射）
  const categoryMap = getCategoryMapSync();

  // 查找映射
  if (categoryMap[codeStr]) {
    return categoryMap[codeStr];
  }

  // 如果找不到映射，检查是否是数字格式（可能需要补零）
  const numCode = String(parseInt(codeStr, 10));
  if (numCode !== 'NaN' && categoryMap[numCode]) {
    return categoryMap[numCode];
  }

  // 如果找不到映射，返回原值（可能是中文或其他格式）
  console.warn(`未找到类别编码映射: ${codeStr}`);
  return codeStr;
}

/**
 * 将多个类别编码转换为中文数组（同步版本）
 * @param {string|number|array} categoryCodes - 类别编码，可能是字符串、数字或数组
 * @returns {array} - 中文类别名称数组
 */
function convertCategoryCodesToChinese(categoryCodes) {
  if (!categoryCodes) {
    return [];
  }

  // 如果不是数组，转换为数组
  const codes = Array.isArray(categoryCodes) ? categoryCodes : [categoryCodes];

  // 转换每个编码并过滤掉null值
  const chineseCategories = codes
    .map(code => convertCategoryCodeToChinese(code))
    .filter(category => category !== null && category !== undefined);

  return chineseCategories;
}

/**
 * 将多个类别编码转换为中文数组（异步版本）
 * @param {string|number|array} categoryCodes - 类别编码，可能是字符串、数字或数组
 * @returns {Promise<array>} - 中文类别名称数组
 */
async function convertCategoryCodesToChineseAsync(categoryCodes) {
  if (!categoryCodes) {
    return [];
  }

  // 如果不是数组，转换为数组
  const codes = Array.isArray(categoryCodes) ? categoryCodes : [categoryCodes];

  // 转换每个编码并过滤掉null值
  const chineseCategories = await Promise.all(
    codes.map(code => convertCategoryCodeToChineseAsync(code))
  );
  
  return chineseCategories.filter(category => category !== null && category !== undefined);
}

module.exports = {
  convertCategoryCodeToChinese,
  convertCategoryCodesToChinese,
  convertCategoryCodeToChineseAsync,
  convertCategoryCodesToChineseAsync,
  getCategoryMap,
  getCategoryMapSync,
  clearCategoryMapCache,
  categoryMap: defaultCategoryMap // 保持向后兼容
};

