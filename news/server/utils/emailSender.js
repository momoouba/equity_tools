const db = require('../db');
const nodemailer = require('nodemailer');
const { generateId } = require('./idGenerator');

/** APItype 为上海国际/企查查且 account_name 为以下类型时：邮件正文与附件均不显示原文链接 */
const NO_LINK_ACCOUNT_NAMES = ['裁判文书', '法院公告', '送达公告', '开庭公告', '立案信息', '破产重整', '被执行人', '失信被执行人', '限制高消费', '行政处罚', '终本案件'];

/** 司法诉讼类 public_time 在邮件中的日期标注（相对入库创建时间） */
const LITIGATION_PUBLIC_DATE_LABELS = {
  '开庭公告': '开庭日期',
  '裁判文书': '裁判日期',
  '法院公告': '公告日期',
  '送达公告': '送达日期',
  '立案信息': '立案日期',
  '破产重整': '公告日期',
  '破产重组': '公告日期',
  '被执行人': '执行日期',
  '失信被执行人': '列入日期',
  '限制高消费': '限制日期',
  '行政处罚': '处罚日期',
  '终本案件': '终本日期'
};

function isNoLinkType(news) {
  if (!news) return false;
  const apiType = (news.APItype && String(news.APItype).trim()) || '';
  const isApi = apiType === '上海国际' || apiType === '上海国际集团' || apiType === '企查查' || apiType === 'qichacha';
  if (!isApi) return false;
  const name = (news.account_name && String(news.account_name).trim()) || '';
  return NO_LINK_ACCOUNT_NAMES.includes(name) || name === '破产重组';
}

function getLitigationPublicDateLabel(accountName) {
  const name = String(accountName || '').trim();
  return LITIGATION_PUBLIC_DATE_LABELS[name] || '事件日期';
}

/**
 * 格式化日期为 yyyy-MM-dd HH:mm:ss
 */
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 获取邮件发送的时间范围（基于创建时间：今天获取到的新闻）
 */
async function getEmailTimeRange() {
  const { getEmailTimeRange: getEmailTimeRangeFromScheduled } = require('./scheduledEmailTasks');
  return await getEmailTimeRangeFromScheduled();
}

/**
 * 获取前一天的开始和结束时间（保留用于兼容性）
 * @deprecated 使用 getEmailTimeRange 代替，以保持与新闻同步一致
 */
function getYesterdayTimeRange() {
  const now = new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  // 创建Asia/Shanghai时区的今天00:00:00（使用ISO字符串方式，确保时区正确）
  const localDateTimeStr = now.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const [datePart] = localDateTimeStr.split(' ');
  const [localYear, localMonth, localDay] = datePart.split('/').map(Number);
  const todayStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T00:00:00+08:00`;
  const today = new Date(todayStr);
  
  // 创建本地时区的昨天00:00:00
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  return {
    from: formatDate(yesterday),
    to: formatDate(today)
  };
}

/**
 * 查询新闻，按企业分组（时间范围：基于创建时间，今天获取到的新闻）
 */
async function getYesterdayNewsByEnterprise() {
  const { from, to } = await getEmailTimeRange();
  
  console.log(`查询新闻（基于创建时间，今天获取到的新闻）: ${from} 到 ${to}`);
  
  // 查询今天获取的所有新闻（有企业全称的）
  const newsList = await db.query(
    `SELECT F_Id AS id, title, enterprise_full_name, news_sentiment, keywords, 
            news_abstract, public_time, account_name, source_url, F_CreatorTime
     FROM news_detail 
     WHERE enterprise_full_name IS NOT NULL 
     AND enterprise_full_name != ''
     AND F_CreatorTime >= ? 
     AND F_CreatorTime < ?
     AND F_DeleteMark = 0
     ORDER BY enterprise_full_name, public_time DESC`,
    [from, to]
  );
  
  // 按企业分组（过滤掉企业名称为null或空字符串的新闻）
  const newsByEnterprise = {};
  for (const news of newsList) {
    const enterpriseName = news.enterprise_full_name;
    // 确保企业名称不为null、不为空字符串
    if (enterpriseName && enterpriseName.trim() !== '') {
    if (!newsByEnterprise[enterpriseName]) {
      newsByEnterprise[enterpriseName] = [];
    }
    newsByEnterprise[enterpriseName].push(news);
    } else {
      // 记录被过滤掉的新闻（用于调试）
      console.log(`[邮件发送] 过滤掉企业名称为空的新闻: ${news.id} - ${news.title}`);
    }
  }
  
  return newsByEnterprise;
}

/**
 * 解析关键词（可能是JSON字符串或数组）
 */
function parseKeywords(keywords) {
  if (!keywords) return [];
  if (typeof keywords === 'string') {
    try {
      const parsed = JSON.parse(keywords);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return Array.isArray(keywords) ? keywords : [];
}

/**
 * 格式化新闻标签（返回HTML格式的圆角色块）
 */
function formatNewsTags(keywords) {
  const tags = parseKeywords(keywords);
  if (tags.length === 0) {
    return '';
  }
  
  // 为每个标签生成圆角色块
  return tags.map(tag => {
    return `<span style="display: inline-block; background-color: #e3f2fd; color: #1976d2; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-right: 6px; margin-bottom: 4px; font-weight: 500;">${tag}</span>`;
  }).join('');
}

/**
 * 格式化新闻情绪（返回HTML格式的圆角色块）
 */
function formatNewsSentiment(sentiment) {
  const sentimentMap = {
    'positive': { text: '正面', color: '#4caf50', bgColor: '#e8f5e9' },
    'negative': { text: '负面', color: '#f44336', bgColor: '#ffebee' },
    'neutral': { text: '中性', color: '#757575', bgColor: '#f5f5f5' }
  };
  
  const sentimentInfo = sentimentMap[sentiment] || { text: sentiment || '未知', color: '#9e9e9e', bgColor: '#f5f5f5' };
  
  return `<span style="display: inline-block; background-color: ${sentimentInfo.bgColor}; color: ${sentimentInfo.color}; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">${sentimentInfo.text}</span>`;
}

/**
 * 格式化发布时间（北京时区）
 */
function formatPublicTime(timeStr) {
  if (!timeStr) return '未知时间';
  try {
    const date = new Date(timeStr);
    if (Number.isNaN(date.getTime())) return String(timeStr);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch (e) {
    return String(timeStr);
  }
}

/**
 * 格式化日期为 YYYY-MM-DD（北京时区，用于开庭日等）
 */
function formatPublicDateOnly(timeStr) {
  if (!timeStr) return '';
  try {
    const date = new Date(timeStr);
    if (Number.isNaN(date.getTime())) {
      const s = String(timeStr).trim();
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
    }
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
        .formatToParts(date)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value])
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch (e) {
    return String(timeStr).slice(0, 10);
  }
}

/**
 * 邮件单条新闻底部元信息：
 * - 普通新闻：发布时间 + 公众号
 * - 司法诉讼：创建时间 + 类型名 + public_time 标注（如开庭日期）
 */
function formatNewsFooterMeta(news) {
  const accountName = news.account_name || '未知公众号';
  if (isNoLinkType(news)) {
    const createdTime = formatPublicTime(news.F_CreatorTime || news.created_at || news.public_time);
    const eventDate = formatPublicDateOnly(news.public_time);
    const label = getLitigationPublicDateLabel(news.account_name);
    if (eventDate) {
      return `${createdTime}，${accountName}，${label}：${eventDate}`;
    }
    return `${createdTime}，${accountName}`;
  }
  return `${formatPublicTime(news.public_time)}，${accountName}`;
}

/**
 * 格式化「日报日期」（仅保留年月日）
 */
function formatReportDate(timeStr) {
  if (!timeStr) return '未知日期';
  try {
    const date = new Date(timeStr);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    return String(timeStr).slice(0, 10) || String(timeStr);
  }
}

/**
 * HTML转义函数，防止XSS攻击
 * @param {string} text - 需要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 解析企业名称，提取简称和全称
 * @param {string} enterpriseName - 企业名称（可能是"简称【全称】"格式或纯全称）
 * @returns {Object} { abbreviation: 简称, fullName: 全称 }
 */
/**
 * 从新闻数据中解析企业名称（简称和全称）
 * 不再解析"简称【全称】"格式，直接从enterprise_abbreviation和enterprise_full_name字段读取
 * @param {string} enterpriseAbbreviation - 企业简称（从enterprise_abbreviation字段获取）
 * @param {string} enterpriseFullName - 企业全称（从enterprise_full_name字段获取）
 * @returns {Object} { abbreviation: string, fullName: string }
 */
function parseEnterpriseName(enterpriseAbbreviation, enterpriseFullName) {
  // 如果全称为空，返回空值
  if (!enterpriseFullName) {
    return { abbreviation: '', fullName: '' };
  }

  // 如果简称为空，使用全称作为简称
  const abbreviation = enterpriseAbbreviation || enterpriseFullName;
  const fullName = enterpriseFullName;

  return {
    abbreviation: abbreviation.trim(),
    fullName: fullName.trim()
  };
}

/**
 * 获取企业类型的显示名称
 */
function getEntityTypeDisplayName(entityType) {
  const typeMap = {
    '企业新闻': '企业新闻',
    '第三方公众号': '第三方公众号',
    '被投企业': '被投企业',
    '基金相关主体': '基金相关主体',
    '基金': '基金相关主体', // 兼容旧数据
    '子基金': '子基金',
    '子基金管理人': '子基金管理人',
    '子基金GP': '子基金GP',
    '其他': '其他',
    null: '被投企业' // 兼容旧数据，默认为被投企业
  };
  return typeMap[entityType] || entityType || '其他';
}

/**
 * 生成邮件HTML内容
 * @param {Object} newsData - 按企业类型和企业分组的新闻数据，格式：{ entityType: { enterpriseName: [news...] } }
 *                            或旧格式：{ enterpriseName: [news...] }（兼容）
 * @param {string} timeRangeFrom - 时间范围开始时间（可选）
 */
function generateEmailContent(newsData, timeRangeFrom = null) {
  // 如果没有提供时间范围，使用默认的昨天（兼容旧代码）
  const dateStr = timeRangeFrom || (() => {
    const { from } = getYesterdayTimeRange();
    return from;
  })();
  
  // 检测数据结构：新格式（按企业类型分组）还是旧格式（只按企业分组）
  const isNewFormat = Object.values(newsData).some(value => 
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
  
  // 转换为统一格式：{ entityType: { enterpriseName: [news...] } }
  let newsByEntityTypeAndEnterprise = {};
  if (isNewFormat) {
    newsByEntityTypeAndEnterprise = newsData;
  } else {
    // 旧格式：按企业分组，需要转换为新格式
    // 默认归类为"被投企业"（兼容旧数据）
    newsByEntityTypeAndEnterprise['被投企业'] = newsData;
  }
  
  // 检查是否有数据
  const hasData = Object.keys(newsByEntityTypeAndEnterprise).some(entityType => 
    Object.keys(newsByEntityTypeAndEnterprise[entityType] || {}).length > 0
  );
  
  if (!hasData) {
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
        <h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">
          【企业新闻】未获取到企业相关信息
        </h2>
        <p style="color: #666; margin-bottom: 30px;">
          日期：${formatReportDate(dateStr)}
        </p>
        <p style="color: #555; font-size: 16px; padding: 20px; background-color: #f9f9f9; border-radius: 5px;">
          昨日未获取到企业相关信息
        </p>
        <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
        <p style="color: #999; font-size: 12px; text-align: center;">
          此邮件由系统自动发送，请勿回复。
        </p>
      </div>
    `;
  }
  
  // 显示顺序：先企业端（被投企业、基金、子基金等），最后第三方公众号
  const entityTypeOrder = ['被投企业', '基金', '基金相关主体', '子基金', '子基金管理人', '子基金GP', '其他', '企业新闻', '第三方公众号'];
  
  let html = `
    <div style="font-family: Arial, sans-serif; padding: 20px; line-height: 1.6;">
      <p style="color: #666; margin-bottom: 30px;">
        日期：${formatReportDate(dateStr)}
      </p>
  `;
  
  // 按企业类型分组显示
  for (const entityType of entityTypeOrder) {
    const newsByEnterprise = newsByEntityTypeAndEnterprise[entityType];
    if (!newsByEnterprise || Object.keys(newsByEnterprise).length === 0) {
      continue;
    }
    
    // 企业类型标题
    const entityTypeDisplayName = getEntityTypeDisplayName(entityType);
    html += `
      <h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; margin-top: 30px; margin-bottom: 20px;">
        舆情信息日报-${entityTypeDisplayName}
      </h2>
    `;
    
    // 按企业分组显示
    for (const [enterpriseName, newsList] of Object.entries(newsByEnterprise)) {
    // 只有分组键为null的才显示"——榜单或获奖信息"（这些是包含榜单/获奖标签的额外公众号新闻）
    // 其他空企业名称的新闻保持原样显示（可能是空字符串或其他值）
    let enterpriseDisplayHtml = '';
    
    if (enterpriseName === null || enterpriseName === '——榜单或获奖信息') {
      enterpriseDisplayHtml = '<h3 style="color: #2c3e50; margin-bottom: 20px; font-size: 18px;">——榜单或获奖信息</h3>';
    } else if (!enterpriseName || enterpriseName === '') {
      enterpriseDisplayHtml = '<h3 style="color: #2c3e50; margin-bottom: 20px; font-size: 18px;">其他公众号</h3>';
    } else {
      // 从第一条新闻中获取enterprise_abbreviation和enterprise_full_name
      // 不再解析"简称【全称】"格式，直接从字段读取
      const firstNews = newsList && newsList.length > 0 ? newsList[0] : null;
      const enterpriseAbbreviation = firstNews?.enterprise_abbreviation || null;
      const enterpriseFullName = firstNews?.enterprise_full_name || enterpriseName; // 兼容旧数据，如果字段为空则使用分组键
      
      // 解析企业名称，提取简称和全称
      const { abbreviation, fullName } = parseEnterpriseName(enterpriseAbbreviation, enterpriseFullName);
      
      // 转义HTML，防止XSS攻击
      const escapedAbbreviation = escapeHtml(abbreviation);
      const escapedFullName = escapeHtml(fullName);
      
      // 如果简称和全称相同，说明没有简称，只显示全称
      if (abbreviation === fullName) {
        enterpriseDisplayHtml = `
          <h3 style="color: #2c3e50; margin-bottom: 20px; font-size: 18px;">
            ${escapedAbbreviation}
          </h3>
        `;
      } else {
        // 显示简称为大字体粗体，全称为小字体灰色（使用正文的字号16px）
        enterpriseDisplayHtml = `
          <h3 style="color: #2c3e50; margin-bottom: 8px; font-size: 18px;">
            ${escapedAbbreviation}
          </h3>
          <div style="color: #888; font-size: 16px; margin-bottom: 20px; line-height: 1.6;">
            ${escapedFullName}
          </div>
        `;
      }
      
      // 从第一条新闻中获取fund和sub_fund（同一企业的所有新闻应该有相同的值）
      // firstNews已在上面声明，这里直接使用
      const subFund = firstNews?.sub_fund || null;
      const fund = firstNews?.fund || null;
      
      // 调试日志：检查数据
      if (entityType === '子基金' || entityType === '子基金管理人' || entityType === '子基金GP') {
        console.log(`[邮件生成] 企业类型: ${entityType}, 企业名称: ${enterpriseName}`);
        console.log(`[邮件生成] 第一条新闻ID: ${firstNews?.F_Id ?? firstNews?.id}, fund: ${fund || '(NULL)'}, sub_fund: ${subFund || '(NULL)'}`);
        if (firstNews) {
          console.log(`[邮件生成] 新闻数据包含fund字段: ${'fund' in firstNews}, 包含sub_fund字段: ${'sub_fund' in firstNews}`);
          console.log(`[邮件生成] 新闻数据所有字段:`, Object.keys(firstNews).join(', '));
        }
      }
      
      // 如果是子基金管理人或子基金GP，显示关联子基金和关联母基金（蓝色字体）
      if (entityType === '子基金管理人' || entityType === '子基金GP') {
        // 构建关联基金信息HTML（蓝色字体）
        let fundInfoHtml = '<div style="font-size: 14px; margin-bottom: 20px; line-height: 1.8;">';
        let hasFundInfo = false;
        
        if (subFund) {
          fundInfoHtml += `<span style="margin-right: 20px;">关联子基金: <strong style="color: #1890ff;">${escapeHtml(subFund)}</strong></span>`;
          hasFundInfo = true;
        }
        if (fund) {
          fundInfoHtml += `<span>关联基金: <strong style="color: #1890ff;">${escapeHtml(fund)}</strong></span>`;
          hasFundInfo = true;
        }
        fundInfoHtml += '</div>';
        
        // 只有在有数据时才显示
        if (hasFundInfo) {
          enterpriseDisplayHtml += fundInfoHtml;
        } else {
          console.log(`[邮件生成] ⚠️ 子基金管理人/子基金GP类型，但fund和sub_fund都为空: ${enterpriseName}`);
        }
      }
      
      // 如果是子基金类型，在简称下面显示关联基金（参考子基金管理人的样式）
      if (entityType === '子基金') {
        if (fund) {
          // 构建关联基金信息HTML（在简称下面，字号稍小，标签黑色，值蓝色）
          let fundInfoHtml = '<div style="font-size: 14px; margin-bottom: 20px; line-height: 1.8;">';
          fundInfoHtml += `<span>关联基金: <strong style="color: #1890ff;">${escapeHtml(fund)}</strong></span>`;
          fundInfoHtml += '</div>';
          
          // 将关联基金信息添加到企业显示HTML后面
          enterpriseDisplayHtml += fundInfoHtml;
        } else {
          console.log(`[邮件生成] ⚠️ 子基金类型，但fund为空: ${enterpriseName}`);
        }
      }
    }
    
      const leftBorderColor = entityType === '第三方公众号' ? '#1890ff' : '#4CAF50';
      html += `
      <div style="margin-bottom: 40px; border-left: 4px solid ${leftBorderColor}; padding-left: 20px;">
        ${enterpriseDisplayHtml}
    `;
    
    for (const news of newsList) {
      const tags = formatNewsTags(news.keywords);
      const sentiment = formatNewsSentiment(news.news_sentiment);
      const footerMeta = formatNewsFooterMeta(news);
      const abstract = news.news_abstract || '暂无摘要';
      const showSourceLink = !isNoLinkType(news);
      const sourceLinkHtml = showSourceLink
        ? `<a href="${news.source_url || '#'}" target="_blank" style="color: #4CAF50; text-decoration: none;">原文链接</a>`
        : '';
      
      html += `
        <div style="margin-bottom: 25px; padding: 15px; background-color: #f9f9f9; border-radius: 5px;">
          <div style="margin-bottom: 12px;">
            <div style="margin-bottom: 8px;">
              <strong style="color: #2c3e50; font-size: 16px; line-height: 1.5;">${news.title || '无标题'}</strong>
            </div>
            <div style="line-height: 1.8;">
              ${tags}
              ${sentiment}
            </div>
          </div>
          <div style="color: #555; margin-bottom: 10px; line-height: 1.8;">
            ${abstract}
          </div>
          <div style="color: #888; font-size: 13px;">
            ${footerMeta}${showSourceLink ? '，' + sourceLinkHtml : ''}
          </div>
        </div>
      `;
    }
    
      html += `</div>`;
    }
    
    // 每个企业类型之间添加分隔线
    html += `
      <hr style="border: none; border-top: 2px solid #ddd; margin: 40px 0;">
    `;
  }
  
  html += `
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
      <p style="color: #999; font-size: 12px; text-align: center;">
        此邮件由系统自动发送，请勿回复。
      </p>
    </div>
  `;
  
  return html;
}

/**
 * 生成邮件纯文本内容（备用）
 * @param {Object} newsData - 按企业类型和企业分组的新闻数据，格式：{ entityType: { enterpriseName: [news...] } }
 *                            或旧格式：{ enterpriseName: [news...] }（兼容）
 * @param {string} timeRangeFrom - 时间范围开始时间（可选）
 */
function generateEmailTextContent(newsData, timeRangeFrom = null) {
  // 如果没有提供时间范围，使用默认的昨天（兼容旧代码）
  const dateStr = timeRangeFrom || (() => {
    const { from } = getYesterdayTimeRange();
    return from;
  })();
  
  // 检测数据结构：新格式（按企业类型分组）还是旧格式（只按企业分组）
  const isNewFormat = Object.values(newsData).some(value => 
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
  
  // 转换为统一格式：{ entityType: { enterpriseName: [news...] } }
  let newsByEntityTypeAndEnterprise = {};
  if (isNewFormat) {
    newsByEntityTypeAndEnterprise = newsData;
  } else {
    // 旧格式：按企业分组，需要转换为新格式
    newsByEntityTypeAndEnterprise['被投企业'] = newsData;
  }
  
  // 检查是否有数据
  const hasData = Object.keys(newsByEntityTypeAndEnterprise).some(entityType => 
    Object.keys(newsByEntityTypeAndEnterprise[entityType] || {}).length > 0
  );
  
  if (!hasData) {
    return `【企业新闻】未获取到企业相关信息\n\n日期：${formatReportDate(dateStr)}\n\n未获取到企业相关信息\n`;
  }
  
  // 显示顺序：先企业端（被投企业、基金、子基金等），最后第三方公众号
  const entityTypeOrder = ['被投企业', '基金', '基金相关主体', '子基金', '子基金管理人', '子基金GP', '其他', '企业新闻', '第三方公众号'];
  
  let text = `日期：${formatReportDate(dateStr)}\n\n`;
  
  // 按企业类型分组显示
  for (const entityType of entityTypeOrder) {
    const newsByEnterprise = newsByEntityTypeAndEnterprise[entityType];
    if (!newsByEnterprise || Object.keys(newsByEnterprise).length === 0) {
      continue;
    }
    
    // 企业类型标题
    const entityTypeDisplayName = getEntityTypeDisplayName(entityType);
    text += `舆情信息日报-${entityTypeDisplayName}\n\n`;
    
    // 按企业分组显示
    for (const [enterpriseName, newsList] of Object.entries(newsByEnterprise)) {
      if (enterpriseName === null || enterpriseName === '——榜单或获奖信息') {
        text += `——榜单或获奖信息\n${'='.repeat(50)}\n\n`;
      } else if (!enterpriseName || enterpriseName === '') {
        text += `其他公众号\n${'='.repeat(50)}\n\n`;
      } else {
        // 从第一条新闻中获取enterprise_abbreviation和enterprise_full_name
        // 不再解析"简称【全称】"格式，直接从字段读取
        const firstNews = newsList && newsList.length > 0 ? newsList[0] : null;
        const enterpriseAbbreviation = firstNews?.enterprise_abbreviation || null;
        const enterpriseFullName = firstNews?.enterprise_full_name || enterpriseName; // 兼容旧数据，如果字段为空则使用分组键
        
        // 解析企业名称，提取简称和全称
        const { abbreviation, fullName } = parseEnterpriseName(enterpriseAbbreviation, enterpriseFullName);
        
        // 从第一条新闻中获取fund和sub_fund（同一企业的所有新闻应该有相同的值）
        const subFund = firstNews?.sub_fund || null;
        const fund = firstNews?.fund || null;
        
        // 如果简称和全称相同，说明没有简称，只显示全称
        if (abbreviation === fullName) {
          // 如果是子基金类型，在全称后面显示关联基金
          if (entityType === '子基金' && fund) {
            text += `${abbreviation}    关联基金: ${fund}\n`;
          } else {
            text += `${abbreviation}\n`;
          }
        } else {
          // 显示简称和全称
          text += `${abbreviation}\n`;
          // 如果是子基金类型，在全称后面显示关联基金
          if (entityType === '子基金' && fund) {
            text += `${fullName}    关联基金: ${fund}\n`;
          } else {
            text += `${fullName}\n`;
          }
        }
        
        // 如果是子基金管理人或子基金GP，显示关联子基金和关联基金
        if (entityType === '子基金管理人' || entityType === '子基金GP') {
          if (subFund) {
            text += `关联子基金: ${subFund}\n`;
          }
          if (fund) {
            text += `关联基金: ${fund}\n`;
          }
        }
        
        text += `${'='.repeat(50)}\n\n`;
      }
      
      for (const news of newsList) {
        const tags = formatNewsTags(news.keywords);
        const sentiment = formatNewsSentiment(news.news_sentiment);
        const footerMeta = formatNewsFooterMeta(news);
        const abstract = news.news_abstract || '暂无摘要';
        const sourcePart = isNoLinkType(news) ? '' : `，${news.source_url || ''}`;
        
        text += `${news.title || '无标题'} ${tags} ${sentiment}\n`;
        text += `${abstract}\n`;
        text += `${footerMeta}${sourcePart}\n\n`;
      }
      
      text += '\n';
    }
    
    // 每个企业类型之间添加分隔
    text += `${'='.repeat(60)}\n\n`;
  }
  
  return text;
}

/**
 * 发送邮件给收件人
 */
async function sendNewsEmail(recipientConfig, emailConfig, newsByEnterprise) {
  try {
    // 创建邮件传输器
    const port = parseInt(emailConfig.smtp_port, 10);
    
    const transporterConfig = {
      host: emailConfig.smtp_host,
      port: port,
      auth: {
        user: emailConfig.smtp_user,
        pass: emailConfig.smtp_password
      }
    };
    
    // 根据端口自动调整SSL/TLS设置
    if (port === 465) {
      transporterConfig.secure = true;
    } else if (port === 587) {
      transporterConfig.secure = false;
      transporterConfig.requireTLS = true;
    } else {
      transporterConfig.secure = emailConfig.smtp_secure === 1;
      if (emailConfig.smtp_secure === 1 && port !== 465) {
        transporterConfig.requireTLS = true;
      }
    }
    
    const transporter = nodemailer.createTransport(transporterConfig);
    
    // 获取时间范围（用于邮件主题和内容）
    const timeRange = await getEmailTimeRange();
    
    // 生成邮件内容（使用与新闻同步一致的时间范围）
    const htmlContent = generateEmailContent(newsByEnterprise, timeRange.from);
    const textContent = generateEmailTextContent(newsByEnterprise, timeRange.from);
    
    // 邮件主题
    const subject = recipientConfig.email_subject || 
                   `舆情信息日报 - ${formatReportDate(timeRange.from)}`;
    
    // 解析收件人邮箱（支持多个，用逗号、分号或换行分隔）
    const recipientEmails = recipientConfig.recipient_email
      .split(/[,;\n\r]+/)
      .map(email => email.trim())
      .filter(email => email && email.includes('@'));
    
    if (recipientEmails.length === 0) {
      throw new Error('收件人邮箱格式不正确');
    }
    
    // 准备邮件选项
    const mailOptions = {
      from: `"${emailConfig.from_name || emailConfig.from_email}" <${emailConfig.from_email}>`,
      to: recipientEmails.join(','),
      subject: subject,
      html: htmlContent,
      text: textContent
    };
    
    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    
    // 记录成功日志（content 截断以避免超出 email_logs.content TEXT 长度）
    const logId = await generateId('email_logs');
    await db.execute(
      `INSERT INTO email_logs 
       (F_Id, email_config_id, operation_type, from_email, to_email, 
        subject, content, status, F_CreatorUserId) 
       VALUES (?, ?, 'send', ?, ?, ?, ?, 'success', ?)`,
      [
        logId,
        emailConfig.F_Id,
        emailConfig.from_email,
        recipientEmails.join(','),
        subject,
        truncateContentForEmailLog(htmlContent),
        recipientConfig.user_id || null
      ]
    );
    
    console.log(`✓ 邮件发送成功: ${recipientEmails.join(', ')}`);
    return {
      success: true,
      logId: logId,
      messageId: info.messageId
    };
  } catch (error) {
    console.error(`✗ 邮件发送失败:`, error);
    
    // 记录失败日志
    try {
      const logId = await generateId('email_logs');
      const recipientEmails = recipientConfig.recipient_email
        .split(/[,;\n\r]+/)
        .map(email => email.trim())
        .filter(email => email && email.includes('@'))
        .join(',');
      
      await db.execute(
        `INSERT INTO email_logs 
         (F_Id, email_config_id, operation_type, from_email, to_email, 
          subject, status, error_message, F_CreatorUserId) 
         VALUES (?, ?, 'send', ?, ?, ?, 'failed', ?, ?)`,
        [
          logId,
          emailConfig.F_Id,
          emailConfig.from_email,
          recipientEmails || recipientConfig.recipient_email,
          recipientConfig.email_subject || '舆情信息日报',
          error.message,
          recipientConfig.user_id || null
        ]
      );
    } catch (logError) {
      console.error('记录邮件日志失败:', logError);
    }
    
    throw error;
  }
}

/**
 * 按收件管理所属应用解析邮件配置（发件人名称、SMTP 等与「邮件发送配置」页一致）
 * 优先 recipient.app_id → email_config.app_id；若无 app_id 或未配置则回退「新闻舆情」应用。
 * @param {{ app_id?: string|null }} recipient - recipient_management 一行
 * @returns {Promise<object>} email_config 行（含联表 app_name）
 */
async function getEmailConfigForRecipient(recipient) {
  const appId = recipient && recipient.app_id ? String(recipient.app_id).trim() : '';
  if (appId) {
    const byApp = await db.query(
      `SELECT ec.*, a.app_name
       FROM email_config ec
       LEFT JOIN applications a ON ec.app_id = a.F_Id
       WHERE ec.app_id = ?
         AND ec.is_active = 1
       LIMIT 1`,
      [appId]
    );
    if (byApp.length > 0) {
      console.log(
        `[邮件发送] 使用收件所属应用邮件配置: app_id=${appId}, app_name=${byApp[0].app_name || '-'}, from_name=${byApp[0].from_name || '-'}`
      );
      return byApp[0];
    }
    console.warn(
      `[邮件发送] 收件配置所属应用 app_id=${appId} 未找到启用的 email_config，将回退查找「新闻舆情」`
    );
  }

  const fallback = await db.query(
    `SELECT ec.*, a.app_name
     FROM email_config ec
     LEFT JOIN applications a ON ec.app_id = a.F_Id
     WHERE CAST(a.app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci
      AND ec.is_active = 1
     LIMIT 1`,
    ['新闻舆情']
  );
  if (fallback.length === 0) {
    throw new Error('未找到邮件发送配置（收件所属应用未配置 SMTP，且未找到默认「新闻舆情」邮件配置）');
  }
  console.log(
    `[邮件发送] 使用默认「新闻舆情」邮件配置: from_name=${fallback[0].from_name || '-'}`
  );
  return fallback[0];
}

function resolveEntityType(news) {
  let entityType = news.entity_type;
  if (!entityType || (typeof entityType === 'string' && entityType.trim() === '')) {
    entityType = news.enterprise_full_name && news.enterprise_full_name.trim() !== '' ? '被投企业' : '其他';
  }
  const validEntityTypes = ['被投企业', '基金', '基金相关主体', '子基金', '子基金管理人', '子基金GP', '其他'];
  if (!validEntityTypes.includes(entityType)) {
    console.log(`[邮件发送] ⚠️ 无效的entity_type: "${entityType}"，使用默认值"被投企业" (新闻ID: ${news.F_Id ?? news.id})`);
    return '被投企业';
  }
  return entityType;
}

function hasEntityTypeSelection(recipient) {
  let raw = recipient ? recipient.entity_type : null;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      raw = raw ? [raw] : [];
    }
  }
  if (raw === null || raw === undefined || raw === '') {
    return false;
  }
  if (!Array.isArray(raw)) {
    raw = [raw];
  }
  return raw.map((x) => String(x || '').trim()).filter(Boolean).length > 0;
}

async function buildNewsByEntityTypeAndEnterprise(newsList, recipient) {
  const grouped = {};
  const groupedDedup = new Set();
  // 未选企业类型时不写入被投企业/子基金等分组，仅展示当前用户第三方公众号区块（与 getUserVisibleYesterdayNews 收窄一致）
  const enableEnterpriseGrouping = hasEntityTypeSelection(recipient);
  const additionalRows = await db.query(
    `SELECT DISTINCT wechat_account_id
     FROM additional_wechat_accounts
     WHERE F_CreatorUserId = ?
       AND status = 'active'
       AND F_DeleteMark = 0
       AND wechat_account_id IS NOT NULL
       AND wechat_account_id != ''`,
    [recipient.user_id]
  );
  const additionalSet = new Set(additionalRows.map((r) => r.wechat_account_id));

  const addToGroup = (groupName, enterpriseName, news) => {
    if (!grouped[groupName]) grouped[groupName] = {};
    if (!grouped[groupName][enterpriseName]) grouped[groupName][enterpriseName] = [];
    const dedupKey = `${groupName}::${enterpriseName}::${news.F_Id ?? news.id}`;
    if (groupedDedup.has(dedupKey)) return;
    groupedDedup.add(dedupKey);
    grouped[groupName][enterpriseName].push(news);
  };

  for (const news of newsList) {
    const entityType = resolveEntityType(news);
    const enterpriseName = news.enterprise_full_name || (news.account_name || news.wechat_account || '其他');
    if (enableEnterpriseGrouping) {
      addToGroup(entityType, enterpriseName, news);
    }

    // 同一条新闻若来自第三方公众号，同时在「第三方公众号」区块再展示一次
    const isAdditionalSource = news.wechat_account && additionalSet.has(news.wechat_account);
    if (isAdditionalSource) {
      const thirdPartyName = news.account_name || news.wechat_account || enterpriseName;
      addToGroup('第三方公众号', thirdPartyName, news);
    }
  }

  return grouped;
}

/**
 * 发送舆情信息邮件给指定的收件管理配置
 */
async function sendNewsEmailToRecipient(recipientId) {
  try {
    console.log(`开始发送舆情信息邮件给收件管理配置: ${recipientId}`);
    
    // 获取指定的收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, rm.F_Id AS id, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.F_Id
       WHERE rm.F_Id = ? 
       AND rm.F_DeleteMark = 0`,
      [recipientId]
    );
    
    if (recipients.length === 0) {
      throw new Error('收件管理配置不存在或已被删除');
    }
    
    const recipient = recipients[0];
    
    if (recipient.is_active !== 1) {
      throw new Error('收件管理配置未启用');
    }
    
    // 获取用户可见的昨日舆情信息（传入收件管理配置，用于企业类型和企查查类别过滤）
    const { getUserVisibleYesterdayNews, isHolidayContentTaggedNews } = require('./scheduledEmailTasks');
    const rawList = await getUserVisibleYesterdayNews(recipient.user_id, recipient);
    const newsList = rawList.filter((n) => !isHolidayContentTaggedNews(n));
    
    const newsByEntityTypeAndEnterprise = await buildNewsByEntityTypeAndEnterprise(newsList, recipient);

    const emailConfig = await getEmailConfigForRecipient(recipient);
    
    // 发送邮件（传递按企业类型和企业分组的嵌套结构）
    const result = await sendNewsEmail(recipient, emailConfig, newsByEntityTypeAndEnterprise);
    
    return {
      success: true,
      recipientId: recipient.F_Id,
      recipientEmail: recipient.recipient_email,
      logId: result.logId,
      message: '邮件发送成功'
    };
  } catch (error) {
    console.error('发送舆情信息邮件失败:', error);
    throw error;
  }
}

/**
 * 发送舆情信息邮件给所有启用的收件人
 */
async function sendNewsEmailsToAllRecipients() {
  try {
    console.log('开始发送舆情信息邮件...');
    
    // 获取所有启用的收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, rm.F_Id AS id, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.F_Id
       WHERE rm.is_active = 1 
       AND rm.F_DeleteMark = 0
       AND rm.send_frequency = 'daily'`,
      []
    );
    
    if (recipients.length === 0) {
      console.log('没有启用的收件管理配置');
      return {
        success: true,
        total: 0,
        successCount: 0,
        errorCount: 0,
        message: '没有启用的收件管理配置'
      };
    }
    
    console.log(`找到 ${recipients.length} 个启用的收件管理配置`);
    
    // 为每个收件人获取对应的新闻（根据各自的entity_type配置）
    const { getUserVisibleYesterdayNews, isHolidayContentTaggedNews } = require('./scheduledEmailTasks');
    
    if (recipients.length === 0) {
      console.log('今天没有获取到相关企业的新闻，将发送空数据通知邮件');
    }
    
    let successCount = 0;
    let errorCount = 0;
    const results = [];

    const listingAppRows = await db.query(
      `SELECT F_Id FROM applications WHERE BINARY app_name = BINARY ? LIMIT 1`,
      ['上市进展']
    );
    const listingAppId = listingAppRows.length ? listingAppRows[0].F_Id : null;

    // 为每个收件人发送邮件（根据各自的entity_type配置获取对应的新闻）
    for (const recipient of recipients) {
      try {
        if (listingAppId && recipient.app_id === listingAppId) {
          console.log(
            `[邮件发送] 跳过收件配置 ${recipient.F_Id}：所属应用为「上市进展」（由定时任务 executeEmailTask 单独处理）`
          );
          continue;
        }

        const emailConfig = await getEmailConfigForRecipient(recipient);
        console.log(
          `[邮件发送] 群发使用配置: app=${emailConfig.app_name || '-'}, from="${emailConfig.from_name || emailConfig.from_email}" <${emailConfig.from_email}>`
        );

        // 获取该收件人可见的昨日舆情信息（根据entity_type过滤）
        const rawNewsList = await getUserVisibleYesterdayNews(recipient.user_id, recipient);
        const newsList = rawNewsList.filter((n) => !isHolidayContentTaggedNews(n));
        
        const newsByEntityTypeAndEnterprise = await buildNewsByEntityTypeAndEnterprise(newsList, recipient);
        
        const hasData = Object.keys(newsByEntityTypeAndEnterprise).some(entityType => 
          Object.keys(newsByEntityTypeAndEnterprise[entityType] || {}).length > 0
        );
        
        if (!hasData) {
          console.log(`收件人 ${recipient.id}：今天没有获取到相关企业的新闻，将发送空数据通知邮件`);
        }
        
        const result = await sendNewsEmail(recipient, emailConfig, newsByEntityTypeAndEnterprise);
        successCount++;
        results.push({
          recipientId: recipient.id,
          recipientEmail: recipient.recipient_email,
          status: 'success',
          logId: result.logId
        });
      } catch (error) {
        errorCount++;
        results.push({
          recipientId: recipient.id,
          recipientEmail: recipient.recipient_email,
          status: 'failed',
          error: error.message
        });
      }
    }
    
    console.log(`邮件发送完成: 成功 ${successCount} 个，失败 ${errorCount} 个`);
    
    return {
      success: true,
      total: recipients.length,
      successCount: successCount,
      errorCount: errorCount,
      results: results,
      message: `邮件发送完成: 成功 ${successCount} 个，失败 ${errorCount} 个`
    };
  } catch (error) {
    console.error('发送舆情信息邮件失败:', error);
    throw error;
  }
}

/**
 * 将邮件内容截断到适合写入 email_logs.content 的长度（MySQL TEXT 约 64KB，utf8mb4 下约 16000 字符内安全）
 * @param {string|null|undefined} content - 邮件内容
 * @param {number} [maxChars=16000] - 最大字符数
 * @returns {string}
 */
function truncateContentForEmailLog(content, maxChars = 16000) {
  if (content == null || typeof content !== 'string') return content || '';
  const suffix = '...(邮件内容已截断)';
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + suffix;
}

module.exports = {
  sendNewsEmailsToAllRecipients,
  sendNewsEmailToRecipient,
  getEmailConfigForRecipient,
  getYesterdayNewsByEnterprise,
  generateEmailContent,
  generateEmailTextContent,
  truncateContentForEmailLog
};

