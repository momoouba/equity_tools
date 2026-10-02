/**
 * 节日新闻：法定节假日，以及母亲节、圣诞等纪念日/商业节日。
 * 五一劳动奖章/奖状、三八红旗手是荣誉，不按节日新闻处理。
 * 推送过滤与打标共用同一套判定。
 */

const CHINESE_STATUTORY_HOLIDAY_KEYWORDS = [
  '元旦',
  '春节',
  '除夕',
  '大年初',
  '清明',
  '劳动节',
  '端午',
  '中秋',
  '国庆',
  '法定节假日',
  '法定假期',
  '母亲节',
  '父亲节',
  '情人节',
  '七夕',
  '妇女节',
  '三八',
  '女神节',
  '女王节',
  '圣诞',
  '感恩节',
  '万圣节',
  '愚人节',
  '护士节',
  '教师节',
  '儿童节',
  '六一',
  '公祭日',
  '纪念日',
  '节日',
  '节假日'
];

const WUYI_HOLIDAY_RE = /五一假期|五一放假|五一快乐|迎五一|欢度五一|喜迎五一|五一期间|五一调休|五一黄金周/;
const HONOR_NOT_HOLIDAY_RE = /五一劳动奖章|五一劳动奖状|全国五一劳动奖|三八红旗手/g;

function parseKeywords(rawKeywords) {
  if (!rawKeywords) return [];
  if (Array.isArray(rawKeywords)) {
    return rawKeywords.map((k) => String(k || '').trim()).filter(Boolean);
  }
  if (typeof rawKeywords === 'string') {
    const s = rawKeywords.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed.map((k) => String(k || '').trim()).filter(Boolean);
      }
      if (typeof parsed === 'string' && parsed.trim()) return [parsed.trim()];
    } catch (e) {
      // 非 JSON
    }
    return s.split(/[,\uFF0C\u3001;；|]/).map((k) => k.trim()).filter(Boolean);
  }
  return [];
}

function holidayCheckText(news) {
  const title = String(news?.title || '');
  const abstract = String(news?.news_abstract || '');
  const summary = String(news?.summary || '');
  const keywords = parseKeywords(news?.keywords).join(' ');
  const contentHead = String(news?.content || '')
    .replace(/<[^>]+>/g, ' ')
    .slice(0, 500);
  return `${title}\n${abstract}\n${summary}\n${keywords}\n${contentHead}`;
}

/** 年会/论坛议程。开头用「值此中秋、国庆」起兴时，主体仍是会议，不是节日新闻。 */
function isConferenceAgendaNews(news) {
  const title = String(news?.title || '');
  const content = String(news?.content || '').replace(/<[^>]+>/g, ' ');
  const text = `${title}\n${content.slice(0, 1500)}`;
  if (!text.trim()) return false;
  if (/年会全议程|全议程|会议议程|议程重磅发布|议程发布/.test(text)) return true;
  const hits = (text.match(/年会|主论坛|分论坛|议程|圆桌|峰会/g) || []).length;
  return hits >= 3 && /年会|议程|主论坛|分论坛/.test(text);
}

/**
 * 标题、摘要、关键词或正文开头涉及节日（含法定节假日与母亲节、圣诞等）。
 * @param {object} news
 * @returns {boolean}
 */
function isChineseStatutoryHolidayNews(news) {
  if (isConferenceAgendaNews(news)) return false;
  const raw = holidayCheckText(news);
  if (!raw.trim()) return false;
  const text = raw.replace(HONOR_NOT_HOLIDAY_RE, '');
  HONOR_NOT_HOLIDAY_RE.lastIndex = 0;
  if (CHINESE_STATUTORY_HOLIDAY_KEYWORDS.some((k) => text.includes(k))) return true;
  return WUYI_HOLIDAY_RE.test(text);
}

/**
 * 节日新闻只保留「节假日」一个标签。
 * @param {string[]} keywords
 * @param {object} news
 * @returns {string[]}
 */
function forceStatutoryHolidayKeywords(keywords, news) {
  if (isConferenceAgendaNews(news)) {
    const list = parseKeywords(keywords).filter((k) => k !== '节假日');
    if (!list.includes('会议事项')) list.unshift('会议事项');
    return list.length ? list : ['会议事项'];
  }
  if (!isChineseStatutoryHolidayNews(news)) return keywords;
  return ['节假日'];
}

const STATUTORY_HOLIDAY_TAG_RULE = `
**节日打标（硬性约束，优先于政策信息）：**
标题、摘要或正文的主题是节日祝福、放假安排、调休时，news_type 只能返回 ["节假日"]。范围包括：元旦、春节（含除夕）、清明、劳动节（含五一放假/假期）、端午、中秋、国庆，以及母亲节、父亲节、情人节、七夕、妇女节、女神节、圣诞节、感恩节、万圣节、愚人节、护士节、教师节、儿童节、国家公祭日等纪念日和节日祝福、放假安排、调休。
不要标成"政策信息""广告推广""商业广告"或"营销推广"。
「五一劳动奖章」「五一劳动奖状」「三八红旗手」是荣誉奖项，不要标成"节假日"。
年会、论坛、峰会的议程发布如果只在开头写「值此中秋、国庆」之类时机，主体是会议议程，不要标"节假日"，应标"会议事项"。
`;

module.exports = {
  isChineseStatutoryHolidayNews,
  forceStatutoryHolidayKeywords,
  STATUTORY_HOLIDAY_TAG_RULE
};
