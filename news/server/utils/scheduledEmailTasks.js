const cron = require('node-cron');
const db = require('../db');
const { sendNewsEmailToRecipient, getYesterdayNewsByEnterprise } = require('./emailSender');
const XLSX = require('xlsx');

/**
 * 拆分逗号分隔的公众号ID字符串，返回去重后的ID数组
 * @param {string} accountIdsStr - 逗号分隔的公众号ID字符串
 * @returns {string[]} - 拆分后的公众号ID数组
 */
function splitAccountIds(accountIdsStr) {
  if (!accountIdsStr || typeof accountIdsStr !== 'string') {
    return [];
  }
  return accountIdsStr
    .split(',')
    .map(id => id.trim())
    .filter(id => id && id !== '');
}

// 存储所有定时任务的Map
const scheduledTasks = new Map();

/**
 * 检查指定日期是否为工作日
 */
async function isWorkdayDate(date) {
  const formatDateOnly = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  
  const dateStr = formatDateOnly(date);
  try {
    const db = require('../db');
    const rows = await db.query(
      'SELECT is_workday FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    if (rows.length > 0) {
      return rows[0].is_workday === 1;
    }
  } catch (error) {
    console.warn('查询节假日数据失败：', error.message);
  }
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * 查找指定日期之前的最后一个工作日
 */
async function findPreviousWorkday(date) {
  let checkDate = new Date(date);
  checkDate.setDate(checkDate.getDate() - 1); // 从前一天开始查找
  
  // 最多向前查找30天，避免无限循环
  let maxDays = 30;
  let daysChecked = 0;
  
  while (daysChecked < maxDays) {
    const isWorkday = await isWorkdayDate(checkDate);
    if (isWorkday) {
      // 找到工作日，返回该日期的00:00:00
      const workday = new Date(checkDate);
      workday.setHours(0, 0, 0, 0);
      return workday;
    }
    
    // 继续向前查找
    checkDate.setDate(checkDate.getDate() - 1);
    daysChecked++;
  }
  
  // 如果30天内都没找到工作日，返回30天前的日期（兜底）
  const fallbackDate = new Date(date);
  fallbackDate.setDate(fallbackDate.getDate() - 30);
  fallbackDate.setHours(0, 0, 0, 0);
  return fallbackDate;
}

/**
 * 获取邮件发送的时间范围（与新闻同步一致：从节假日前的一个工作日到当前工作日）
 */
async function getEmailTimeRange() {
  const now = new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const localDateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const [localYear, localMonth, localDay] = localDateStr.split('/').map(Number);
  
  // 创建本地时区的今天00:00:00
  const today = new Date(localYear, localMonth - 1, localDay, 0, 0, 0);
  
  // 查找节假日前的一个工作日
  const previousWorkday = await findPreviousWorkday(today);
  
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };
  
  return {
    from: formatDate(previousWorkday),
    to: formatDate(today)
  };
}

/**
 * 获取昨日时间范围（保留用于兼容性，但建议使用getEmailTimeRange）
 * @deprecated 使用 getEmailTimeRange 代替，以保持与新闻同步一致
 */
function getYesterdayTimeRange() {
  const now = new Date();
  
  // 使用Asia/Shanghai时区计算本地日期
  const localDateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const [localYear, localMonth, localDay] = localDateStr.split('/').map(Number);
  
  // 创建本地时区的今天00:00:00
  const today = new Date(localYear, localMonth - 1, localDay, 0, 0, 0);
  
  // 创建本地时区的昨天00:00:00
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };
  
  return {
    from: formatDate(yesterday),
    to: formatDate(today)
  };
}

/**
 * 获取用户可见的舆情信息（根据用户权限过滤）
 * 时间范围：从节假日前的一个工作日到当前工作日（与新闻同步一致）
 */
async function getUserVisibleYesterdayNews(userId) {
  console.log(`[邮件发送] ========== 开始获取用户可见的舆情信息 ==========`);
  console.log(`[邮件发送] 用户ID: ${userId}`);
  
  const { from, to } = await getEmailTimeRange();
  console.log(`[邮件发送] 时间范围: ${from} 到 ${to}`);
  
  // 先检查用户角色（管理员自动拥有所有权限）
  const users = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
  const userRole = users.length > 0 ? users[0].role : 'user';
  console.log(`[邮件发送] 用户角色: ${userRole}`);
  
  // 管理员自动拥有所有权限，跳过权限检查
  if (userRole !== 'admin') {
    // 非管理员用户需要检查"新闻舆情"应用权限
    const { checkNewsPermission } = require('./permissionChecker');
    const hasPermission = await checkNewsPermission(userId);
    console.log(`[邮件发送] 用户权限检查: ${hasPermission ? '有权限' : '无权限'}`);
    
    if (!hasPermission) {
      // 用户没有权限，返回空数据
      console.log(`[邮件发送] 用户没有权限，返回空数据`);
      return [];
    }
  } else {
    console.log(`[邮件发送] 管理员用户，自动拥有所有权限，跳过权限检查`);
  }
  
  let newsList = [];
  
  if (userRole === 'admin') {
    console.log(`[邮件发送] ========== 管理员查询逻辑 ==========`);
    // 管理员发送所有被投企业管理中满足条件的新闻
    // 条件：退出状态不为"完全退出"和"已上市"，且未删除
    // 通过公众号ID关联，因为新闻可能通过公众号ID匹配到企业，即使enterprise_full_name为空也能匹配
    
    // 先获取所有满足条件的被投企业的公众号ID
    console.log(`[邮件发送] 步骤1：查询满足条件的被投企业...`);
    const enterprises = await db.query(
      `SELECT DISTINCT wechat_official_account_id 
       FROM invested_enterprises 
       WHERE exit_status NOT IN ('完全退出', '已上市')
       AND wechat_official_account_id IS NOT NULL 
       AND wechat_official_account_id != ''
       AND delete_mark = 0`
    );
    
    if (enterprises.length === 0) {
      console.log('[邮件发送] 管理员：没有满足条件的被投企业');
      return [];
    }
    
    // 拆分逗号分隔的公众号ID
    const accountIds = [];
    enterprises.forEach(e => {
      const ids = splitAccountIds(e.wechat_official_account_id);
      accountIds.push(...ids);
    });
    
    if (accountIds.length === 0) {
      console.log('[邮件发送] 管理员：没有有效的公众号ID');
      return [];
    }
    
    // 去重公众号ID
    const uniqueAccountIds = [...new Set(accountIds)];
    const placeholders = uniqueAccountIds.map(() => '?').join(',');
    
    // 查询这些公众号的新闻，或者企业全称在被投企业管理中的新闻
    console.log(`[邮件发送] 管理员：执行SQL查询`);
    console.log(`[邮件发送] - 时间范围：${from} 到 ${to}`);
    console.log(`[邮件发送] - 公众号ID列表（前10个）：${uniqueAccountIds.slice(0, 10).join(', ')}`);
    console.log(`[邮件发送] - 公众号总数：${uniqueAccountIds.length}`);
    
    // 先测试一下时间范围查询（使用字符串格式，确保格式正确）
    const testTimeQuery = await db.query(
      `SELECT COUNT(*) as count 
       FROM news_detail 
       WHERE public_time >= ? 
       AND public_time < ?
       AND delete_mark = 0`,
      [from, to]
    );
    console.log(`[邮件发送] 管理员：时间范围内总新闻数：${testTimeQuery[0]?.count || 0}`);
    
    // 测试一下公众号ID匹配查询
    if (uniqueAccountIds.length > 0) {
      const testAccountQuery = await db.query(
        `SELECT COUNT(*) as count 
         FROM news_detail 
         WHERE wechat_account IN (${placeholders})
         AND delete_mark = 0`,
        uniqueAccountIds
      );
      console.log(`[邮件发送] 管理员：公众号ID匹配的新闻总数（不限时间）：${testAccountQuery[0]?.count || 0}`);
      
      // 测试公众号ID + 时间范围
      const testAccountTimeQuery = await db.query(
        `SELECT COUNT(*) as count 
         FROM news_detail 
         WHERE wechat_account IN (${placeholders})
         AND public_time >= ? 
         AND public_time < ?
         AND delete_mark = 0`,
        [...uniqueAccountIds, from, to]
      );
      console.log(`[邮件发送] 管理员：公众号ID匹配 + 时间范围的新闻数：${testAccountTimeQuery[0]?.count || 0}`);
    }
    
    newsList = await db.query(
      `SELECT DISTINCT nd.id, nd.title, nd.enterprise_full_name, nd.news_sentiment, nd.keywords, 
              nd.news_abstract, nd.summary, nd.content, nd.public_time, nd.account_name, nd.source_url, nd.created_at,
              nd.APItype, nd.news_category
       FROM news_detail nd
       WHERE (
         -- 通过公众号ID匹配
         nd.wechat_account IN (${placeholders})
         OR
         -- 或者通过企业全称匹配（如果企业全称不为空）
         (nd.enterprise_full_name IS NOT NULL 
          AND nd.enterprise_full_name != ''
          AND nd.enterprise_full_name IN (
            SELECT enterprise_full_name 
            FROM invested_enterprises 
            WHERE exit_status NOT IN ('完全退出', '已上市')
            AND delete_mark = 0
          ))
       )
       AND nd.public_time >= ? 
       AND nd.public_time < ?
       AND nd.delete_mark = 0
       ORDER BY nd.enterprise_full_name, nd.public_time DESC`,
      [...uniqueAccountIds, from, to]
    );
    
    console.log(`[邮件发送] 管理员：查询到 ${newsList.length} 条新闻（时间范围：${from} 到 ${to}，公众号数量：${uniqueAccountIds.length}）`);
    if (newsList.length > 0) {
      console.log(`[邮件发送] 管理员：查询到的新闻示例（前3条）：`, newsList.slice(0, 3).map(n => ({
        title: n.title,
        enterprise_full_name: n.enterprise_full_name,
        public_time: n.public_time,
        wechat_account: n.account_name,
        APItype: n.APItype
      })));
    }
  } else {
    // 普通用户只能看到自己创建的被投企业相关的新闻
    // 查询用户创建的被投企业的微信公众号ID
    const wechatAccounts = await db.query(
      `SELECT DISTINCT wechat_official_account_id 
       FROM invested_enterprises 
       WHERE creator_user_id = ? 
       AND wechat_official_account_id IS NOT NULL 
       AND wechat_official_account_id != ''
       AND exit_status NOT IN ('完全退出', '已上市')
       AND delete_mark = 0`,
      [userId]
    );
    
    if (wechatAccounts.length === 0) {
      return [];
    }
    
    // 拆分逗号分隔的公众号ID
    const accountIds = [];
    wechatAccounts.forEach(item => {
      const ids = splitAccountIds(item.wechat_official_account_id);
      accountIds.push(...ids);
    });
    const placeholders = accountIds.map(() => '?').join(',');
    
    // 查询这些公众号的昨日新闻
    newsList = await db.query(
      `SELECT id, title, enterprise_full_name, news_sentiment, keywords, 
              news_abstract, summary, content, public_time, account_name, source_url, created_at,
              APItype, news_category
       FROM news_detail 
       WHERE wechat_account IN (${placeholders})
       AND enterprise_full_name IS NOT NULL 
       AND enterprise_full_name != ''
       AND public_time >= ? 
       AND public_time < ?
       AND delete_mark = 0
       ORDER BY enterprise_full_name, public_time DESC`,
      [...accountIds, from, to]
    );
  }
  
  console.log(`[邮件发送] ========== 开始过滤新闻 ==========`);
  console.log(`[邮件发送] 初始查询结果：${newsList.length} 条新闻`);
  if (newsList.length > 0) {
    console.log(`[邮件发送] 初始新闻详情（前5条）：`, newsList.slice(0, 5).map(n => ({
      id: n.id,
      title: n.title?.substring(0, 30),
      APItype: n.APItype || '(NULL)',
      news_category: n.news_category || '(NULL)',
      hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
      hasContent: !!(n.content && n.content.trim()),
      enterprise_full_name: n.enterprise_full_name
    })));
  }
  
  // 过滤新闻：只保留企查查数据源且类别为 80000 或 40000 系列的新闻
  const filteredNewsList = filterNewsByCategory(newsList);
  console.log(`[邮件发送] 企查查类别过滤后：${filteredNewsList.length} 条新闻`);
  if (newsList.length > 0 && filteredNewsList.length === 0) {
    console.log(`[邮件发送] ⚠️ 警告：所有新闻都被类别过滤过滤掉了！`);
    console.log(`[邮件发送] 被过滤掉的新闻详情：`, newsList.slice(0, 5).map(n => ({
      id: n.id,
      title: n.title?.substring(0, 30),
      APItype: n.APItype || '(NULL)',
      news_category: n.news_category || '(NULL)',
      filterReason: !n.APItype || (n.APItype !== '企查查' && n.APItype !== 'qichacha') 
        ? '非企查查数据源，应保留' 
        : (!n.news_category || n.news_category.trim() === '' 
          ? '企查查数据源但类别为空' 
          : '企查查数据源但类别不在允许列表中')
    })));
  }
  
  // 过滤掉摘要和正文都为空的数据
  // 注意：news_abstract 可能为 null，但 summary 字段可能有值
  const beforeFilterCount = filteredNewsList.length;
  const finalNewsList = filteredNewsList.filter(news => {
    // 检查 news_abstract 字段（AI提取的摘要）
    const hasAbstract = news.news_abstract && news.news_abstract.trim() !== '';
    // 检查 summary 字段（原始摘要，新榜数据使用此字段）
    const hasSummary = news.summary && news.summary.trim() !== '';
    // 检查 content 字段（正文）
    const hasContent = news.content && news.content.trim() !== '';
    
    // 如果摘要（news_abstract 或 summary）和正文都为空，则过滤掉
    if (!hasAbstract && !hasSummary && !hasContent) {
      return false;
    }
    
    return true;
  });
  
  const filteredCount = beforeFilterCount - finalNewsList.length;
  if (filteredCount > 0) {
    console.log(`[邮件发送] 过滤掉 ${filteredCount} 条摘要和正文都为空的数据，剩余 ${finalNewsList.length} 条`);
  }
  
  console.log(`[邮件发送] ========== 过滤完成 ==========`);
  console.log(`[邮件发送] 最终返回：${finalNewsList.length} 条新闻`);
  if (finalNewsList.length > 0) {
    console.log(`[邮件发送] 最终新闻示例（前3条）：`, finalNewsList.slice(0, 3).map(n => ({
      title: n.title,
      enterprise_full_name: n.enterprise_full_name,
      public_time: n.public_time,
      hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
      hasContent: !!(n.content && n.content.trim())
    })));
  } else if (newsList.length > 0) {
    console.log(`[邮件发送] ⚠️ 警告：初始查询到 ${newsList.length} 条新闻，但经过过滤后为 0 条！`);
  }
  
  return finalNewsList;
}

/**
 * 过滤新闻：只保留企查查数据源且类别为 80000 或 40000 系列的新闻
 * @param {Array} newsList - 新闻列表
 * @returns {Array} - 过滤后的新闻列表
 */
function filterNewsByCategory(newsList) {
  // 需要包含的类别编码（80000和40000系列）
  const allowedCategoryCodes = [
    '80000', '80001', '80002', '80003', '80004', '80005', '80006', '80007', '80008',
    '40000', '40001', '40002', '40003', '40004', '40005', '40006', '40007', '40008', 
    '40009', '40010', '40011', '40012', '40013', '40014', '40015', '40016', '40017', 
    '40018', '40019', '40020', '40021', '40022', '40023', '40024', '40025', '40026', 
    '40027', '40028', '40029', '40030'
  ];
  
  // 从映射表获取对应的中文类别名称
  const { categoryMap } = require('./qichachaCategoryMapper');
  const allowedCategoryNames = allowedCategoryCodes
    .map(code => categoryMap[code])
    .filter(name => name !== undefined);
  
  return newsList.filter(news => {
    // 只处理企查查数据源的新闻
    if (!news.APItype || (news.APItype !== '企查查' && news.APItype !== 'qichacha')) {
      // 如果不是企查查数据源，保留（可能是新榜等其他数据源）
      return true;
    }
    
    // 对于企查查数据源，检查类别
    const category = news.news_category || '';
    
    // 如果类别为空，不包含
    if (!category || category.trim() === '') {
      return false;
    }
    
    // 检查类别是否在允许的列表中
    return allowedCategoryNames.includes(category);
  });
}

/**
 * 将新闻数据导出为Excel Buffer
 */
function exportNewsToExcel(newsList) {
  // 准备Excel数据
  const excelData = newsList.map((news, index) => {
    const keywords = news.keywords ? (typeof news.keywords === 'string' ? JSON.parse(news.keywords) : news.keywords) : [];
    const sentimentMap = {
      'positive': '正面',
      'negative': '负面',
      'neutral': '中性'
    };
    
    return {
      '序号': index + 1,
      '被投企业全称': news.enterprise_full_name || '',
      '新闻标题': news.title || '',
      '新闻标签': Array.isArray(keywords) ? keywords.join('、') : '',
      '新闻情绪': sentimentMap[news.news_sentiment] || news.news_sentiment || '未知',
      '新闻摘要': news.news_abstract || '',
      '发布时间': news.public_time ? new Date(news.public_time).toLocaleString('zh-CN') : '',
      '公众号名称': news.account_name || '',
      '原文链接': news.source_url || ''
    };
  });
  
  // 创建工作簿
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelData);
  
  // 设置列宽
  const colWidths = [
    { wch: 8 },   // 序号
    { wch: 25 },  // 被投企业全称
    { wch: 40 },  // 新闻标题
    { wch: 30 },  // 新闻标签
    { wch: 12 },  // 新闻情绪
    { wch: 50 },  // 新闻摘要
    { wch: 20 },  // 发布时间
    { wch: 20 },  // 公众号名称
    { wch: 50 }   // 原文链接
  ];
  ws['!cols'] = colWidths;
  
  // 添加工作表到工作簿
  XLSX.utils.book_append_sheet(wb, ws, '舆情信息');
  
  // 生成Excel Buffer
  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  return excelBuffer;
}

/**
 * 发送邮件给单个收件管理配置（包含Excel附件）
 */
async function sendNewsEmailWithExcel(recipientConfig, emailConfig, newsList) {
  const nodemailer = require('nodemailer');
  const { generateId } = require('./idGenerator');
  
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
    
    // 生成邮件内容
    const { generateEmailContent, generateEmailTextContent } = require('./emailSender');
    
    // 过滤掉广告类型的新闻（广告推广、商业广告、营销推广）
    const advertisementKeywords = ['广告推广', '商业广告', '营销推广'];
    const filteredNewsList = newsList.filter(news => {
      // 解析keywords字段（可能是JSON字符串或数组）
      let keywords = [];
      if (news.keywords) {
        try {
          if (typeof news.keywords === 'string') {
            keywords = JSON.parse(news.keywords);
          } else if (Array.isArray(news.keywords)) {
            keywords = news.keywords;
          }
        } catch (e) {
          // 解析失败，忽略
        }
      }
      
      // 检查是否包含广告相关标签
      const hasAdvertisementTag = keywords.some(keyword => 
        advertisementKeywords.includes(keyword)
      );
      
      // 如果包含广告标签，过滤掉（不包含在邮件正文中）
      if (hasAdvertisementTag) {
        console.log(`[邮件发送] 过滤广告新闻: ${news.title} (标签: ${keywords.join(', ')})`);
        return false;
      }
      
      return true;
    });
    
    console.log(`[邮件发送] 原始新闻数: ${newsList.length}, 过滤后新闻数: ${filteredNewsList.length}, 过滤掉广告新闻: ${newsList.length - filteredNewsList.length} 条`);
    
    // 按企业分组新闻（使用过滤后的列表）
    const newsByEnterprise = {};
    for (const news of filteredNewsList) {
      const enterpriseName = news.enterprise_full_name;
      if (!newsByEnterprise[enterpriseName]) {
        newsByEnterprise[enterpriseName] = [];
      }
      newsByEnterprise[enterpriseName].push(news);
    }
    
    const htmlContent = generateEmailContent(newsByEnterprise);
    const textContent = generateEmailTextContent(newsByEnterprise);
    
    // 生成Excel附件（使用过滤后的列表，与邮件正文保持一致）
    let excelBuffer = null;
    let fileName = null;
    if (filteredNewsList.length > 0) {
      excelBuffer = exportNewsToExcel(filteredNewsList);
      fileName = `舆情信息日报_${new Date().toISOString().split('T')[0]}.xlsx`;
    }
    
    // 获取时间范围（用于邮件主题）
    const timeRange = await getEmailTimeRange();
    
    // 邮件主题 - 如果没有新闻，使用特定主题
    let subject;
    if (newsList.length === 0) {
      subject = '【企业新闻】未获取到企业相关信息';
    } else {
      const formatPublicTime = (timeStr) => {
        if (!timeStr) return '未知时间';
        try {
          const date = new Date(timeStr);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        } catch (e) {
          return timeStr;
        }
      };
      subject = recipientConfig.email_subject || 
                `舆情信息日报 - ${formatPublicTime(timeRange.from)}`;
    }
    
    // 解析收件人邮箱
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
    
    // 只有在有数据时才添加Excel附件
    if (excelBuffer && fileName) {
      mailOptions.attachments = [
        {
          filename: fileName,
          content: excelBuffer
        }
      ];
    }
    
    // 发送邮件
    const info = await transporter.sendMail(mailOptions);
    
    // 记录成功日志
    const logId = await generateId('email_logs');
    await db.execute(
      `INSERT INTO email_logs 
       (id, email_config_id, operation_type, from_email, to_email, 
        subject, content, status, created_by) 
       VALUES (?, ?, 'send', ?, ?, ?, ?, 'success', ?)`,
      [
        logId,
        emailConfig.id,
        emailConfig.from_email,
        recipientEmails.join(','),
        subject,
        htmlContent,
        recipientConfig.user_id || null
      ]
    );
    
    console.log(`✓ 邮件发送成功（含Excel附件）: ${recipientEmails.join(', ')}`);
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
         (id, email_config_id, operation_type, from_email, to_email, 
          subject, status, error_message, created_by) 
         VALUES (?, ?, 'send', ?, ?, ?, 'failed', ?, ?)`,
        [
          logId,
          emailConfig.id,
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
 * 检查指定日期是否为工作日（不在节假日表中或is_workday=1）
 * 用于收件管理的"每日"发送：只有工作日才发送，节假日不发送
 */
async function isWorkdayForEmail(date) {
  try {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD格式
    const holidays = await db.query(
      'SELECT is_workday, workday_type FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    
    if (holidays.length > 0) {
      // 如果在节假日表中，根据is_workday判断
      // is_workday = 1 表示工作日，is_workday = 0 表示非工作日（节假日）
      const isWorkday = holidays[0].is_workday === 1;
      if (!isWorkday) {
        console.log(`[邮件发送] 日期 ${dateStr} 在节假日表中，类型：${holidays[0].workday_type || '节假日'}，跳过发送`);
      }
      return isWorkday;
    }
    
    // 如果不在节假日表中，默认是工作日（可以发送）
    return true;
  } catch (error) {
    console.warn('查询节假日数据失败：', error.message);
    // 查询失败时，默认认为是工作日，避免影响正常发送
    return true;
  }
}

/**
 * 执行单个收件管理配置的邮件发送任务
 */
async function executeEmailTask(recipientId) {
  try {
    console.log(`执行邮件发送任务: 收件管理配置 ${recipientId}`);
    
    // 获取收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.id = ? 
       AND rm.is_deleted = 0
       AND rm.is_active = 1`,
      [recipientId]
    );
    
    if (recipients.length === 0) {
      console.log(`收件管理配置 ${recipientId} 不存在、已删除或未启用，跳过发送`);
      return;
    }
    
    const recipient = recipients[0];
    
    // 如果是每日发送，需要检查今天是否为工作日（排除节假日）
    if (recipient.send_frequency === 'daily') {
      const today = new Date();
      const isTodayWorkday = await isWorkdayForEmail(today);
      
      if (!isTodayWorkday) {
        const dateStr = today.toISOString().split('T')[0];
        console.log(`[邮件发送] 收件管理配置 ${recipientId} 在 ${dateStr} 为节假日，跳过发送`);
        return;
      }
    }
    
    // 获取用户可见的昨日舆情信息
    const newsList = await getUserVisibleYesterdayNews(recipient.user_id);
    
    // 即使没有数据，也发送邮件通知用户
    if (newsList.length === 0) {
      console.log(`用户 ${recipient.user_id} 昨日没有可见的舆情信息，将发送空数据通知邮件`);
    }
    
    // 获取邮件配置（使用"新闻舆情"应用的邮件配置）
    const emailConfigs = await db.query(
      `SELECT ec.*, a.app_name
       FROM email_config ec
       LEFT JOIN applications a ON ec.app_id = a.id
       WHERE CAST(a.app_name AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci = CAST(? AS CHAR CHARACTER SET utf8mb4) COLLATE utf8mb4_unicode_ci 
       AND ec.is_active = 1
       LIMIT 1`,
      ['新闻舆情']
    );
    
    if (emailConfigs.length === 0) {
      throw new Error('未找到"新闻舆情"应用的邮件配置');
    }
    
    const emailConfig = emailConfigs[0];
    
    // 发送邮件（包含Excel附件）
    await sendNewsEmailWithExcel(recipient, emailConfig, newsList);
    
    console.log(`✓ 邮件发送任务完成: 收件管理配置 ${recipientId}`);
  } catch (error) {
    console.error(`✗ 邮件发送任务失败: 收件管理配置 ${recipientId}`, error);
  }
}

/**
 * 根据发送频率和时间生成cron表达式
 */
function generateCronExpression(sendFrequency, sendTime) {
  // sendTime格式: HH:mm:ss
  const [hours, minutes] = sendTime.split(':');
  
  switch (sendFrequency) {
    case 'daily':
      // 每天在指定时间执行
      return `${minutes} ${hours} * * *`;
    case 'weekly':
      // 每周一在指定时间执行
      return `${minutes} ${hours} * * 1`;
    case 'monthly':
      // 每月1号在指定时间执行
      return `${minutes} ${hours} 1 * *`;
    default:
      // 默认每天执行
      return `${minutes} ${hours} * * *`;
  }
}

/**
 * 更新所有定时任务（根据收件管理配置）
 */
async function updateScheduledTasks() {
  try {
    console.log('更新邮件发送定时任务...');
    
    // 停止所有现有任务
    scheduledTasks.forEach((task, recipientId) => {
      if (task && task.destroy) {
        task.destroy();
      }
      scheduledTasks.delete(recipientId);
    });
    
    // 获取所有启用的收件管理配置
    const recipients = await db.query(
      `SELECT rm.*, u.account as user_account
       FROM recipient_management rm
       LEFT JOIN users u ON rm.user_id = u.id
       WHERE rm.is_active = 1 
       AND rm.is_deleted = 0`,
      []
    );
    
    console.log(`找到 ${recipients.length} 个启用的收件管理配置`);
    
    // 为每个配置创建定时任务
    for (const recipient of recipients) {
      try {
        const cronExpression = generateCronExpression(recipient.send_frequency, recipient.send_time);
        console.log(`为收件管理配置 ${recipient.id} 创建定时任务: ${cronExpression} (${recipient.send_frequency})`);
        
        const task = cron.schedule(cronExpression, async () => {
          await executeEmailTask(recipient.id);
        }, {
          scheduled: true,
          timezone: 'Asia/Shanghai'
        });
        
        scheduledTasks.set(recipient.id, task);
      } catch (error) {
        console.error(`创建定时任务失败 (收件管理配置 ${recipient.id}):`, error);
      }
    }
    
    console.log(`✓ 定时任务更新完成，共 ${scheduledTasks.size} 个任务`);
  } catch (error) {
    console.error('更新定时任务失败:', error);
  }
}

/**
 * 初始化定时任务（服务器启动时调用）
 */
async function initializeScheduledTasks() {
  await updateScheduledTasks();
}


module.exports = {
  updateScheduledTasks,
  initializeScheduledTasks,
  executeEmailTask,
  sendNewsEmailWithExcel,
  getUserVisibleYesterdayNews,
  exportNewsToExcel,
  getYesterdayTimeRange,
  getEmailTimeRange,
  findPreviousWorkday,
  isWorkdayDate
};

