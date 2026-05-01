/**
 * 繁简转换工具模块（用于港股公司名统一为简体）
 *
 * 使用内置映射表进行繁简转换（覆盖港股公司名高频字）
 * 无需外部依赖，轻量级实现
 *
 * @module zhconvUtils
 */

/**
 * 内置常用繁简映射表（覆盖港股公司名高频字）
 * @type {Object.<string, string>}
 */
const BUILTIN_TRADITIONAL_TO_SIMPLIFIED = {
  // 高频公司名繁体字
  術: '术',
  體: '体',
  團: '团',
  發: '发',
  資: '资',
  創: '创',
  業: '业',
  電: '电',
  網: '网',
  絡: '络',
  險: '险',
  證: '证',
  銀: '银',
  經: '经',
  濟: '济',
  貿: '贸',
  務: '务',
  築: '筑',
  產: '产',
  運: '运',
  輸: '输',
  儲: '储',
  裝: '装',
  備: '备',
  醫: '医',
  藥: '药',
  療: '疗',
  養: '养',
  護: '护',
  訓: '训',
  練: '练',
  傳: '传',
  體: '体',
  娛: '娱',
  樂: '乐',
  遊: '游',
  飯: '饭',
  飲: '饮',
  農: '农',
  漁: '渔',
  礦: '矿',
  機: '机',
  車: '车',
  鐵: '铁',
  軌: '轨',
  環: '环',
  護: '护',
  汙: '污',
  處: '处',
  氣: '气',
  熱: '热',
  應: '应',
  陽: '阳',
  風: '风',
  聯: '联',
  國: '国',
  際: '际',
  華: '华',
  東: '东',
  蘇: '苏',
  寧: '宁',
  溫: '温',
  門: '门',
  廈: '厦',
  龍: '龙',
  長: '长',
  漢: '汉',
  慶: '庆',
  莊: '庄',
  島: '岛',
  連: '连',
  煙: '烟',
  臺: '台',
  灣: '湾',
  馬: '马',
  來: '来',
  亞: '亚',
  韓: '韩',
  羅: '罗',
  荷: '荷',
  蘭: '兰',
  時: '时',
  實: '实',
  營: '营',
  銷: '销',
  飾: '饰',
  質: '质',
  數: '数',
  據: '据',
  統: '统',
  雲: '云',
  計: '计',
  識: '识',
  別: '别',
  視: '视',
  覺: '觉',
  聽: '听',
  語: '语',
  頻: '频',
  圖: '图',
  虛: '虚',
  擬: '拟',
  擴: '扩',
  強: '强',
  進: '进',
  優: '优',
  調: '调',
  測: '测',
  試: '试',
  驗: '验',
  證: '证',
  審: '审',
  許: '许',
  權: '权',
  專: '专',
  標: '标',
  註: '注',
  冊: '册',
  記: '记',
  報: '报',
  單: '单',
  張: '张',
  條: '条',
  項: '项',
  錄: '录',
  檔: '档',
  資: '资',
  庫: '库',
  讀: '读',
  寫: '写',
  傳: '传',
  輸: '输',
  處: '处',
  統: '统',
  計: '计',
  匯: '汇',
  總: '总',
  結: '结',
  財: '财',
  務: '务',
  潤: '润',
  損: '损',
  資: '资',
  產: '产',
  負: '负',
  債: '债',
  現: '现',
  變: '变',
  動: '动',
  週: '周',
  間: '间',
  約: '约',
  協: '协',
  議: '议',
  契: '契',
  書: '书',
  郵: '邮',
  鏈: '链',
  戶: '户',
  瀏: '浏',
  覽: '览',
  尋: '寻',
  導: '导',
  頁: '页',
  鈕: '钮',
  選: '选',
  號: '号',
  碼: '码',
  編: '编',
  轉: '转',
  換: '换',
  畫: '画',
  戲: '戏',
};

/**
 * 全角字符到半角字符的映射
 * @param {string} char 单个字符
 * @returns {string} 转换后的字符
 */
function fullwidthToHalfwidth(char) {
  const code = char.charCodeAt(0);
  // 全角数字和字母范围：FF01-FF5E
  if (code >= 0xFF01 && code <= 0xFF5E) {
    return String.fromCharCode(code - 0xFEE0);
  }
  // 全角空格
  if (code === 0x3000) {
    return ' ';
  }
  return char;
}

/**
 * 使用内置映射表进行繁简转换
 * @param {string} text 输入文本
 * @returns {string} 简体文本
 */
function builtinToSimplified(text) {
  if (!text) return text;
  const result = [];
  for (const char of text) {
    if (BUILTIN_TRADITIONAL_TO_SIMPLIFIED[char]) {
      result.push(BUILTIN_TRADITIONAL_TO_SIMPLIFIED[char]);
    } else {
      result.push(char);
    }
  }
  return result.join('');
}

/**
 * 将繁体中文文本转换为简体（优先用于港股公司名统一）
 *
 * @param {string} text - 输入文本（可能包含繁体字）
 * @returns {string} 简体中文文本
 *
 * @example
 * toSimplified("上海新榜信息技術股份有限公司")
 * // 返回: "上海新榜信息技术股份有限公司"
 *
 * @example
 * toSimplified("騰訊控股有限公司")
 * // 返回: "腾讯控股有限公司"
 */
function toSimplified(text) {
  if (!text) return text;

  // 清理空白和异常字符
  const cleaned = String(text).trim();
  if (!cleaned) return cleaned;

  // 使用内置映射表（针对港股公司名高频字优化）
  return builtinToSimplified(cleaned);
}

/**
 * 规范化港股公司名称（去除多余空白、统一为简体）
 *
 * @param {string} name - 公司名称（可能包含繁体字、多余空白、全角字符）
 * @returns {string} 规范化后的简体公司名称
 *
 * @example
 * normalizeCompanyName("上海新榜信息技術股份有限公司")
 * // 返回: "上海新榜信息技术股份有限公司"
 *
 * @example
 * normalizeCompanyName("騰訊控股有限公司")
 * // 返回: "腾讯控股有限公司"
 */
function normalizeCompanyName(name) {
  if (!name) return name;

  // 1. 清理空白
  let cleaned = String(name).trim();
  cleaned = cleaned.replace(/\s+/g, ''); // 去除所有空白字符

  // 2. 全角字符转半角（数字、字母）
  cleaned = Array.from(cleaned).map(fullwidthToHalfwidth).join('');

  // 3. 繁体转简体
  const simplified = toSimplified(cleaned);

  // 4. 再次清理空白（转换后可能有新空白）
  return simplified.replace(/\s+/g, '');
}

/**
 * 批量规范化公司名称（用于数据清洗）
 *
 * @param {Array<{company: string}>} rows - 数据行数组
 * @param {string} [field='company'] - 公司名称字段名
 * @returns {Array<{company: string, normalizedCompany: string}>} 包含规范化公司名的数据行
 */
function normalizeCompanyNamesBatch(rows, field = 'company') {
  if (!Array.isArray(rows)) return [];

  return rows.map((row) => {
    const company = String(row[field] || '').trim();
    const normalizedCompany = normalizeCompanyName(company);
    return { ...row, normalizedCompany };
  });
}

/**
 * 检测文本是否包含繁体字
 *
 * @param {string} text - 输入文本
 * @returns {boolean} 是否包含繁体字
 */
function containsTraditional(text) {
  if (!text) return false;
  for (const char of text) {
    if (BUILTIN_TRADITIONAL_TO_SIMPLIFIED[char]) {
      return true;
    }
  }
  return false;
}

module.exports = {
  toSimplified,
  normalizeCompanyName,
  normalizeCompanyNamesBatch,
  containsTraditional,
  BUILTIN_TRADITIONAL_TO_SIMPLIFIED,
};