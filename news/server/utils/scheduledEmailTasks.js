const cron = require('node-cron');
const db = require('../db');
const { sendNewsEmailToRecipient, getYesterdayNewsByEnterprise } = require('./emailSender');
const XLSX = require('xlsx');
const { logWithTimestamp, errorWithTimestamp, warnWithTimestamp } = require('./logUtils');

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
 * 格式化日期为 YYYY-MM-DD，使用北京时区
 * @param {Date} date - 日期对象
 * @returns {string} YYYY-MM-DD 格式的日期字符串（北京时区）
 */
function formatDateOnly(date) {
  // 使用北京时区格式化日期，确保日期计算基于北京时间
  const beijingDateStr = date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // 解析格式：2024/12/8 或 2024-12-8
  const datePart = beijingDateStr.split(' ')[0];
  const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 检查指定日期是否为工作日，使用北京时区
 * @param {Date} date - 日期对象
 * @returns {Promise<boolean>} 是否为工作日
 */
async function isWorkdayDate(date) {
  // 使用北京时区格式化日期，确保与节假日表中的日期（北京时区）一致
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
  // 如果没有节假日记录，使用北京时区判断星期几
  // 使用北京时区的日期来判断星期几
  const beijingDay = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getDay();
  return beijingDay !== 0 && beijingDay !== 6; // 0=周日, 6=周六
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

/** 语义相似度阈值：标题或摘要相似度 >= 此值视为“讲同一件事”，只保留排序后第一条 */
const SEMANTIC_SIMILARITY_THRESHOLD = 50;

/**
 * 按企业分组，对同一企业内新闻做标题/摘要语义相似度分析，相似度>=50%则只保留按 title 倒序、account_name 倒序、wechat_account 倒序的第一条。
 * @param {Array<Object>} newsList - 待发送的新闻列表（含 title、news_abstract/summary、enterprise_full_name、account_name、wechat_account）
 * @param {string} logTag - 日志前缀，如 '[邮件发送]' 或 '[手动发送邮件]'
 * @returns {Promise<Array<Object>>} 去重后的新闻列表
 */
async function deduplicateNewsBySemanticSimilarity(newsList, logTag = '[邮件发送]') {
  if (!Array.isArray(newsList) || newsList.length <= 1) {
    return newsList || [];
  }

  const newsAnalysis = require('./newsAnalysis');

  // 按企业分组（无企业名称的用空字符串作为 key，单独一组）
  const byEnterprise = new Map();
  for (const n of newsList) {
    const key = (n.enterprise_full_name && String(n.enterprise_full_name).trim()) || '';
    if (!byEnterprise.has(key)) byEnterprise.set(key, []);
    byEnterprise.get(key).push(n);
  }

  const sortKey = (n) => [
    (n.title && String(n.title).trim()) || '',
    (n.account_name && String(n.account_name).trim()) || '',
    (n.wechat_account && String(n.wechat_account).trim()) || ''
  ];
  const cmp = (a, b) => {
    const [t1, ac1, w1] = sortKey(a);
    const [t2, ac2, w2] = sortKey(b);
    if (t1 !== t2) return t2.localeCompare(t1, 'zh-CN');
    if (ac1 !== ac2) return ac2.localeCompare(ac1, 'zh-CN');
    return w2.localeCompare(w1, 'zh-CN');
  };

  const result = [];
  let totalDropped = 0;

  for (const [entName, group] of byEnterprise.entries()) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }

    group.sort(cmp);
    const kept = [group[0]];

    for (let i = 1; i < group.length; i++) {
      const candidate = group[i];
      let isSimilar = false;
      for (const k of kept) {
        const { titleSimilarity, summarySimilarity } = await newsAnalysis.checkNewsSemanticSimilarity(candidate, k);
        if (titleSimilarity >= SEMANTIC_SIMILARITY_THRESHOLD || summarySimilarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
          isSimilar = true;
          totalDropped++;
          logWithTimestamp(`${logTag} 语义去重：企业="${(entName || '(无)').substring(0, 30)}"，跳过相似新闻 ID=${candidate.id}（与已保留 ID=${k.id} 标题相似度=${titleSimilarity}% 摘要相似度=${summarySimilarity}%）`);
          break;
        }
      }
      if (!isSimilar) kept.push(candidate);
    }

    result.push(...kept);
  }

  if (totalDropped > 0) {
    logWithTimestamp(`${logTag} 语义去重完成：共去掉 ${totalDropped} 条相似新闻，保留 ${result.length} 条`);
  }

  return result;
}

/**
 * 获取邮件发送的时间范围（基于创建时间：今天获取到的新闻）
 * 说明：节假日后第一天获取到的新闻，本身就包含了节假日期间的新闻，所以只需要筛选今天创建（获取）的新闻
 */
async function getEmailTimeRange() {
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
  
  // 明天的00:00:00（作为结束时间，不包含明天）
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
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
    from: formatDate(today),      // 今天00:00:00
    to: formatDate(tomorrow)       // 明天00:00:00（不包含）
  };
}

/**
 * 获取昨日时间范围（保留用于兼容性，但建议使用getEmailTimeRange）
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
 * 时间范围：今天创建（获取）的新闻（基于 created_at）
 * @param {string} userId - 用户ID
 * @param {Object|null} recipientConfig - 收件管理配置（可选）
 * @param {boolean} skipFinalFilter - 是否跳过最终过滤（用于邮件发送前的AI重新分析）
 */
async function getUserVisibleYesterdayNews(userId, recipientConfig = null, skipFinalFilter = false) {
  logWithTimestamp(`[邮件发送] ========== 开始获取用户可见的舆情信息 ==========`);
  logWithTimestamp(`[邮件发送] 用户ID: ${userId}`);
  if (recipientConfig) {
    console.log(`[邮件发送] 收件管理配置ID: ${recipientConfig.id || '(NULL)'}`);
  }
  
  const { from, to } = await getEmailTimeRange();
  console.log(`[邮件发送] 时间范围（基于创建时间）: ${from} 到 ${to}`);

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
    // 根据收件配置的企业类型添加过滤条件（支持多选）
    let entityTypeFilter = '';
    if (recipientConfig && recipientConfig.entity_type) {
      // 解析entity_type（可能是JSON字符串、数组或单个值）
      let entityTypes = recipientConfig.entity_type;
      if (typeof entityTypes === 'string') {
        try {
          entityTypes = JSON.parse(entityTypes);
        } catch (e) {
          // 如果不是JSON，可能是单个值，转换为数组
          entityTypes = [entityTypes];
        }
      }
      if (!Array.isArray(entityTypes)) {
        entityTypes = [entityTypes];
      }
      
      if (entityTypes.length > 0) {
        // 构建多选过滤条件
        const conditions = [];
        entityTypes.forEach(type => {
          if (type === '被投企业') {
            conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
          } else if (type === '基金') {
            conditions.push(`entity_type = '基金'`);
          } else if (type === '子基金') {
            conditions.push(`entity_type = '子基金'`);
          } else if (type === '子基金管理人') {
            conditions.push(`entity_type = '子基金管理人'`);
          } else if (type === '子基金GP') {
            conditions.push(`entity_type = '子基金GP'`);
          }
        });
        if (conditions.length > 0) {
          entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
        console.log(`[邮件发送] 管理员：根据企业类型过滤被投企业 - ${entityTypes.join(', ')}`);
      }
    }
    
    console.log(`[邮件发送] 步骤1：查询满足条件的被投企业...`);
    const enterprises = await db.query(
      `SELECT DISTINCT wechat_official_account_id 
       FROM invested_enterprises 
       WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND wechat_official_account_id IS NOT NULL 
       AND wechat_official_account_id != ''
       AND delete_mark = 0
       ${entityTypeFilter}`
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
       WHERE created_at >= ? 
       AND created_at < ?
       AND delete_mark = 0`,
      [from, to]
    );
    console.log(`[邮件发送] 管理员：时间范围内总新闻数（基于创建时间）：${testTimeQuery[0]?.count || 0}`);
    
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
         AND created_at >= ? 
         AND created_at < ?
         AND delete_mark = 0`,
        [...uniqueAccountIds, from, to]
      );
      console.log(`[邮件发送] 管理员：公众号ID匹配 + 时间范围的新闻数（基于创建时间）：${testAccountTimeQuery[0]?.count || 0}`);
    }
    
    // 特别检查量子位公众号ID是否在查询列表中
    const quantumBitAccountId = 'gh_114e76fd6e5d';
    const hasQuantumBit = uniqueAccountIds.includes(quantumBitAccountId);
    if (hasQuantumBit) {
      console.log(`[邮件发送] ✓ 量子位公众号ID (${quantumBitAccountId}) 在查询列表中`);
    } else {
      console.log(`[邮件发送] ⚠️ 量子位公众号ID (${quantumBitAccountId}) 不在查询列表中`);
      console.log(`[邮件发送]   当前查询的公众号ID列表（前20个）: ${uniqueAccountIds.slice(0, 20).join(', ')}`);
    }
    
    // 根据收件配置的企业类型过滤条件（支持多选）
    let entityTypeCondition = '';
    let entityTypeSubqueryFilter = '';
    if (recipientConfig && recipientConfig.entity_type) {
      // 解析entity_type（可能是JSON字符串、数组或单个值）
      let entityTypes = recipientConfig.entity_type;
      if (typeof entityTypes === 'string') {
        try {
          entityTypes = JSON.parse(entityTypes);
        } catch (e) {
          // 如果不是JSON，可能是单个值，转换为数组
          entityTypes = [entityTypes];
        }
      }
      if (!Array.isArray(entityTypes)) {
        entityTypes = [entityTypes];
      }
      
      if (entityTypes.length > 0) {
        // 构建多选过滤条件
        // 注意：只使用 news_detail 表中的 entity_type 字段
        const conditions = [];
        const subqueryConditions = [];
        entityTypes.forEach(type => {
          if (type === '被投企业') {
            conditions.push(`(nd.entity_type = '被投企业' OR nd.entity_type IS NULL)`);
            subqueryConditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
          } else if (type === '基金') {
            conditions.push(`nd.entity_type = '基金'`);
            subqueryConditions.push(`entity_type = '基金'`);
          } else if (type === '子基金') {
            conditions.push(`nd.entity_type = '子基金'`);
            subqueryConditions.push(`entity_type = '子基金'`);
          } else if (type === '子基金管理人') {
            conditions.push(`nd.entity_type = '子基金管理人'`);
            subqueryConditions.push(`entity_type = '子基金管理人'`);
          } else if (type === '子基金GP') {
            conditions.push(`nd.entity_type = '子基金GP'`);
            subqueryConditions.push(`entity_type = '子基金GP'`);
          }
        });
        if (conditions.length > 0) {
          entityTypeCondition = `AND (${conditions.join(' OR ')})`;
          entityTypeSubqueryFilter = `AND (${subqueryConditions.join(' OR ')})`;
          // 调试：验证entityTypeSubqueryFilter不包含nd.前缀
          if (entityTypeSubqueryFilter.includes('nd.')) {
            console.error(`[邮件发送] ⚠️ 错误：entityTypeSubqueryFilter包含nd.前缀: ${entityTypeSubqueryFilter}`);
            // 修复：移除nd.前缀
            entityTypeSubqueryFilter = entityTypeSubqueryFilter.replace(/nd\.entity_type/g, 'entity_type');
            console.log(`[邮件发送] ✓ 已修复entityTypeSubqueryFilter: ${entityTypeSubqueryFilter}`);
          }
        }
        console.log(`[邮件发送] 管理员：根据企业类型过滤 - ${entityTypes.join(', ')}`);
        console.log(`[邮件发送] entityTypeCondition: ${entityTypeCondition}`);
        console.log(`[邮件发送] entityTypeSubqueryFilter: ${entityTypeSubqueryFilter}`);
      }
    }

    // 按照用户要求：简化查询，只查询需要的字段
    // 步骤2：查询created_at为今天的且enterprise_full_name不为null的数据
    // 先简化查询，不使用LEFT JOIN，直接查询news_detail表，确保fund和sub_fund字段能正确返回
    newsList = await db.query(
      `SELECT 
              nd.id, 
              nd.enterprise_full_name, 
              nd.enterprise_abbreviation,
              nd.title, 
              nd.news_abstract, 
              nd.news_sentiment, 
              nd.entity_type,
              nd.fund, 
              nd.sub_fund,
              nd.keywords,
              nd.summary, 
              nd.content, 
              nd.public_time, 
              nd.account_name, 
              nd.wechat_account, 
              nd.source_url, 
              nd.created_at,
              nd.APItype, 
              nd.news_category
       FROM news_detail nd
       WHERE (
         -- 通过公众号ID匹配
         nd.wechat_account IN (${placeholders})
         OR
         -- 或者通过企业全称匹配（如果企业全称不为空）
         -- 支持精确匹配和模糊匹配（去掉括号内容后匹配，处理"企业全称(简称)"格式）
         -- 企业全称匹配（不再解析"简称【全称】"格式，直接使用enterprise_full_name字段）
         (nd.enterprise_full_name IS NOT NULL 
          AND nd.enterprise_full_name != ''
          AND (
            -- 精确匹配
            nd.enterprise_full_name IN (
              SELECT enterprise_full_name 
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              ${entityTypeSubqueryFilter}
            )
            OR
            -- 模糊匹配：新闻中的企业全称去掉括号内容后，与数据库中的企业全称匹配
            -- 例如："上海燧原科技股份有限公司(燧原科技)" 匹配 "上海燧原科技股份有限公司"
            (CASE 
              WHEN nd.enterprise_full_name LIKE '%(%' THEN 
                TRIM(SUBSTRING_INDEX(nd.enterprise_full_name, '(', 1))
              ELSE 
                nd.enterprise_full_name
            END) IN (
              SELECT enterprise_full_name 
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              ${entityTypeSubqueryFilter}
            )
            OR
            -- 反向匹配：数据库中的企业全称去掉括号内容后，与新闻中的企业全称匹配
            nd.enterprise_full_name IN (
              SELECT CASE 
                WHEN enterprise_full_name LIKE '%(%' THEN 
                  TRIM(SUBSTRING_INDEX(enterprise_full_name, '(', 1))
                ELSE 
                  enterprise_full_name
              END
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              ${entityTypeSubqueryFilter}
            )
            OR
            -- 支持通过enterprise_abbreviation字段匹配（匹配project_abbreviation）
            nd.enterprise_abbreviation IN (
              SELECT project_abbreviation 
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              AND project_abbreviation IS NOT NULL
              AND project_abbreviation != ''
              ${entityTypeSubqueryFilter}
            )
            -- 兼容旧数据：如果enterprise_full_name中仍存在"简称【全称】"格式，提取全称部分进行匹配
            OR
            (CASE 
              WHEN nd.enterprise_full_name LIKE '%【%】%' THEN 
                TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(nd.enterprise_full_name, '【', -1), '】', 1))
              ELSE 
                NULL
            END) IN (
              SELECT enterprise_full_name 
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              ${entityTypeSubqueryFilter}
            )
            -- 兼容旧数据：如果数据库中的enterprise_full_name仍存在"简称【全称】"格式，提取全称部分与新闻中的企业全称匹配
            OR
            nd.enterprise_full_name IN (
              SELECT CASE 
                WHEN enterprise_full_name LIKE '%【%】%' THEN 
                  TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(enterprise_full_name, '【', -1), '】', 1))
                ELSE 
                  enterprise_full_name
              END
              FROM invested_enterprises 
              WHERE exit_status NOT IN ('完全退出', '已上市', '不再观察')
              AND delete_mark = 0
              ${entityTypeSubqueryFilter}
            )
          ))
         OR
         -- 额外公众号新闻：包含"榜单"或"获奖"标签且企业名称为空
         (nd.enterprise_full_name IS NULL 
          AND nd.wechat_account IN (
            SELECT wechat_account_id 
            FROM additional_wechat_accounts 
            WHERE status = 'active' 
            AND delete_mark = 0
          )
          AND (
            nd.keywords LIKE '%"榜单"%'
            OR nd.keywords LIKE '%"获奖"%'
            OR nd.keywords LIKE '%榜单%'
            OR nd.keywords LIKE '%获奖%'
          ))
       )
       AND nd.created_at >= ? 
       AND nd.created_at < ?
       AND nd.delete_mark = 0
       AND nd.enterprise_full_name IS NOT NULL
       AND nd.enterprise_full_name != ''
       ${entityTypeCondition}
       ORDER BY nd.enterprise_full_name, nd.public_time DESC`,
      [...uniqueAccountIds, from, to]
    );
    
    // 调试：立即检查查询结果是否包含fund和sub_fund字段
    console.log(`[邮件发送] ========== 查询结果检查 ==========`);
    if (newsList.length > 0) {
      const firstNews = newsList[0];
      console.log(`[邮件发送] 查询到的第一条新闻ID: ${firstNews.id}`);
      console.log(`[邮件发送] 查询到的第一条新闻字段:`, Object.keys(firstNews).join(', '));
      console.log(`[邮件发送] 查询到的第一条新闻包含fund字段: ${'fund' in firstNews}, 包含sub_fund字段: ${'sub_fund' in firstNews}`);
      
      // 直接查询数据库验证
      const testQuery = await db.query(
        `SELECT id, fund, sub_fund FROM news_detail WHERE id = ?`,
        [firstNews.id]
      );
      if (testQuery.length > 0) {
        console.log(`[邮件发送] 数据库直接查询验证，ID=${firstNews.id}, fund="${testQuery[0].fund || '(NULL)'}", sub_fund="${testQuery[0].sub_fund || '(NULL)'}"`);
      }
      
      if ('fund' in firstNews) {
        console.log(`[邮件发送] 查询结果中第一条新闻的fund值: "${firstNews.fund || '(NULL)'}"`);
      }
      if ('sub_fund' in firstNews) {
        console.log(`[邮件发送] 查询结果中第一条新闻的sub_fund值: "${firstNews.sub_fund || '(NULL)'}"`);
      }
      
      // 如果查询结果中没有fund和sub_fund字段，手动补充
      if (!('fund' in firstNews)) {
        console.log(`[邮件发送] ⚠️ 查询结果中缺少fund和sub_fund字段，手动补充...`);
        const newsIds = newsList.map(n => n.id);
        const placeholders = newsIds.map(() => '?').join(',');
        const fundData = await db.query(
          `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
          newsIds
        );
        
        const fundMap = {};
        fundData.forEach(item => {
          fundMap[item.id] = {
            fund: item.fund || null,
            sub_fund: item.sub_fund || null
          };
        });
        
        newsList.forEach(news => {
          if (fundMap[news.id]) {
            news.fund = fundMap[news.id].fund;
            news.sub_fund = fundMap[news.id].sub_fund;
          } else {
            news.fund = null;
            news.sub_fund = null;
          }
        });
        
        console.log(`[邮件发送] ✓ 已手动补充fund和sub_fund字段，共 ${newsList.length} 条新闻`);
        
        // 验证补充后的结果
        const firstAfter = newsList[0];
        console.log(`[邮件发送] 补充后第一条新闻包含fund字段: ${'fund' in firstAfter}, 包含sub_fund字段: ${'sub_fund' in firstAfter}`);
        if ('fund' in firstAfter) {
          console.log(`[邮件发送] 补充后第一条新闻的fund值: "${firstAfter.fund || '(NULL)'}"`);
        }
        if ('sub_fund' in firstAfter) {
          console.log(`[邮件发送] 补充后第一条新闻的sub_fund值: "${firstAfter.sub_fund || '(NULL)'}"`);
        }
      }
    }
    console.log(`[邮件发送] ========== 查询结果检查结束 ==========`);
    
    // 特别查询量子位公众号的新闻（用于调试）
    if (quantumBitAccountId) {
      const quantumBitTestQuery = await db.query(
        `SELECT COUNT(*) as count 
         FROM news_detail 
         WHERE wechat_account = ?
         AND created_at >= ? 
         AND created_at < ?
         AND delete_mark = 0`,
        [quantumBitAccountId, from, to]
      );
      const quantumBitCount = quantumBitTestQuery[0]?.count || 0;
      console.log(`[邮件发送] 时间范围内量子位公众号(${quantumBitAccountId})的新闻总数（基于创建时间）: ${quantumBitCount}`);
      
      if (quantumBitCount > 0) {
        const quantumBitNewsSample = await db.query(
          `SELECT id, title, enterprise_full_name, account_name, wechat_account, 
                  news_abstract, summary, content, public_time, APItype
           FROM news_detail 
           WHERE wechat_account = ?
           AND created_at >= ? 
           AND created_at < ?
           AND delete_mark = 0
           ORDER BY public_time DESC
           LIMIT 5`,
          [quantumBitAccountId, from, to]
        );
        console.log(`[邮件发送] 量子位公众号新闻示例（前5条）:`, quantumBitNewsSample.map(n => ({
          id: n.id,
          title: n.title?.substring(0, 50),
          enterprise_full_name: n.enterprise_full_name || '(NULL)',
          public_time: n.public_time,
          APItype: n.APItype || '(NULL)',
          hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
          hasSummary: !!(n.summary && n.summary.trim()),
          hasContent: !!(n.content && n.content.trim())
        })));
        
        // 特别检查目标新闻ID
        const targetNewsId = '2026010409510500005';
        const targetNewsInDB = quantumBitNewsSample.find(n => n.id === targetNewsId);
        if (targetNewsInDB) {
          console.log(`[邮件发送] ⚠️⚠️⚠️ 发现目标新闻 ${targetNewsId} 在数据库中：`);
          console.log(`[邮件发送]   企业全称: "${targetNewsInDB.enterprise_full_name || '(NULL)'}"`);
          
          // 检查企业全称是否在被投企业列表中
          if (targetNewsInDB.enterprise_full_name) {
            const enterpriseMatch = await db.query(
              `SELECT enterprise_full_name, exit_status 
               FROM invested_enterprises 
               WHERE enterprise_full_name = ?
               AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
               AND delete_mark = 0
               LIMIT 1`,
              [targetNewsInDB.enterprise_full_name]
            );
            if (enterpriseMatch.length > 0) {
              console.log(`[邮件发送]   ✓ 企业全称在被投企业列表中: ${enterpriseMatch[0].enterprise_full_name}, 退出状态: ${enterpriseMatch[0].exit_status}`);
            } else {
              console.log(`[邮件发送]   ⚠️ 企业全称不在被投企业列表中，或退出状态不符合条件`);
              // 尝试模糊匹配（去掉括号内容）
              const enterpriseNameWithoutBrackets = targetNewsInDB.enterprise_full_name.replace(/\([^)]*\)/g, '').trim();
              if (enterpriseNameWithoutBrackets !== targetNewsInDB.enterprise_full_name) {
                const enterpriseMatch2 = await db.query(
                  `SELECT enterprise_full_name, exit_status 
                   FROM invested_enterprises 
                   WHERE enterprise_full_name = ?
                   AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
                   AND delete_mark = 0
                   LIMIT 1`,
                  [enterpriseNameWithoutBrackets]
                );
                if (enterpriseMatch2.length > 0) {
                  console.log(`[邮件发送]   ⚠️ 去掉括号后匹配到: ${enterpriseMatch2[0].enterprise_full_name}, 退出状态: ${enterpriseMatch2[0].exit_status}`);
                  console.log(`[邮件发送]   ⚠️ 问题：新闻中的企业全称 "${targetNewsInDB.enterprise_full_name}" 与数据库中的 "${enterpriseMatch2[0].enterprise_full_name}" 不完全匹配`);
                }
              }
            }
          }
        } else {
          console.log(`[邮件发送] ⚠️ 目标新闻 ${targetNewsId} 不在量子位公众号的新闻示例中`);
        }
      }
    }
    
    console.log(`[邮件发送] 管理员：查询到 ${newsList.length} 条新闻（时间范围：${from} 到 ${to}，公众号数量：${uniqueAccountIds.length}）`);
    
    // 如果查询结果中没有fund和sub_fund字段，手动补充这些字段
    if (newsList.length > 0 && !('fund' in newsList[0])) {
      console.log(`[邮件发送] ⚠️ 查询结果中缺少fund和sub_fund字段，手动补充...`);
      const newsIds = newsList.map(n => n.id);
      const placeholders = newsIds.map(() => '?').join(',');
      const fundData = await db.query(
        `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
        newsIds
      );
      
      // 创建映射表
      const fundMap = {};
      fundData.forEach(item => {
        fundMap[item.id] = {
          fund: item.fund || null,
          sub_fund: item.sub_fund || null
        };
      });
      
      // 补充字段
      newsList.forEach(news => {
        if (fundMap[news.id]) {
          news.fund = fundMap[news.id].fund;
          news.sub_fund = fundMap[news.id].sub_fund;
        } else {
          news.fund = null;
          news.sub_fund = null;
        }
      });
      
      console.log(`[邮件发送] ✓ 已手动补充fund和sub_fund字段，共 ${newsList.length} 条新闻`);
    }
    
    // 调试：检查查询结果是否包含fund和sub_fund字段
    if (newsList.length > 0) {
      const firstNews = newsList[0];
      console.log(`[邮件发送] 调试：第一条新闻的字段:`, Object.keys(firstNews).join(', '));
      console.log(`[邮件发送] 调试：第一条新闻包含fund字段: ${'fund' in firstNews}, 包含sub_fund字段: ${'sub_fund' in firstNews}`);
      
      // 直接测试查询这条新闻的fund和sub_fund
      if (firstNews.id) {
        const testQuery = await db.query(
          `SELECT id, fund, sub_fund FROM news_detail WHERE id = ?`,
          [firstNews.id]
        );
        if (testQuery.length > 0) {
          console.log(`[邮件发送] 调试：直接查询数据库，ID=${firstNews.id}, fund="${testQuery[0].fund || '(NULL)'}", sub_fund="${testQuery[0].sub_fund || '(NULL)'}"`);
        }
      }
      
      if ('fund' in firstNews) {
        console.log(`[邮件发送] 调试：第一条新闻的fund值: "${firstNews.fund || '(NULL)'}"`);
      }
      if ('sub_fund' in firstNews) {
        console.log(`[邮件发送] 调试：第一条新闻的sub_fund值: "${firstNews.sub_fund || '(NULL)'}"`);
      }
    }
    
    // 测试查询：直接查询数据库中的 entity_type 值（用于调试）
    if (newsList.length > 0) {
      const testNewsIds = newsList.slice(0, 5).map(n => n.id);
      const placeholders = testNewsIds.map(() => '?').join(',');
      const testQuery = await db.query(
        `SELECT id, entity_type, enterprise_full_name 
         FROM news_detail 
         WHERE id IN (${placeholders})`,
        testNewsIds
      );
      console.log(`[邮件发送] ========== 直接查询数据库测试 ==========`);
      testQuery.forEach(n => {
        console.log(`[邮件发送] 数据库直接查询: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
      });
      console.log(`[邮件发送] ========== 直接查询数据库测试结束 ==========`);
    }
    
    // 检查查询结果中的 entity_type 分布（用于调试）
    if (newsList.length > 0) {
      const entityTypeStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        entityTypeStats[et] = (entityTypeStats[et] || 0) + 1;
      });
      console.log(`[邮件发送] 查询结果中的 entity_type 分布:`, JSON.stringify(entityTypeStats, null, 2));
      
      // 显示前5条新闻的 entity_type 信息
      newsList.slice(0, 5).forEach((n, index) => {
        console.log(`[邮件发送] 查询结果新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
      });
    }
    
    // 统计企查查新闻数量
    const qichachaNews = newsList.filter(n => n.APItype === '企查查' || n.APItype === 'qichacha');
    console.log(`[邮件发送] 管理员：查询到的企查查新闻数量：${qichachaNews.length}`);
    if (qichachaNews.length > 0) {
      console.log(`[邮件发送] 管理员：企查查新闻示例（前5条）：`, qichachaNews.slice(0, 5).map(n => ({
        id: n.id,
        title: n.title?.substring(0, 50),
        enterprise_full_name: n.enterprise_full_name || '(NULL)',
        entity_type: n.entity_type || '(NULL)',
        news_category: n.news_category || '(NULL)',
        APItype: n.APItype || '(NULL)',
        wechat_account: n.wechat_account || '(NULL)'
      })));
    } else {
      // 如果没有查询到企查查新闻，检查时间范围内是否有企查查新闻
      const qichachaCountQuery = await db.query(
        `SELECT COUNT(*) as count 
         FROM news_detail 
         WHERE (APItype = '企查查' OR APItype = 'qichacha')
         AND created_at >= ? 
         AND created_at < ?
         AND delete_mark = 0`,
        [from, to]
      );
      const qichachaCount = qichachaCountQuery[0]?.count || 0;
      console.log(`[邮件发送] ⚠️ 时间范围内企查查新闻总数：${qichachaCount}，但查询结果中为0条`);
      
      if (qichachaCount > 0) {
        // 查询一些企查查新闻示例，检查企业全称和entity_type
        const qichachaSample = await db.query(
          `SELECT id, title, enterprise_full_name, entity_type, news_category, APItype, wechat_account
           FROM news_detail 
           WHERE (APItype = '企查查' OR APItype = 'qichacha')
           AND created_at >= ? 
           AND created_at < ?
           AND delete_mark = 0
           LIMIT 10`,
          [from, to]
        );
        console.log(`[邮件发送] ⚠️ 企查查新闻示例（前10条）：`, qichachaSample.map(n => ({
          id: n.id,
          title: n.title?.substring(0, 50),
          enterprise_full_name: n.enterprise_full_name || '(NULL)',
          entity_type: n.entity_type || '(NULL)',
          news_category: n.news_category || '(NULL)',
          wechat_account: n.wechat_account || '(NULL)'
        })));
      }
    }
    
    if (newsList.length > 0) {
      console.log(`[邮件发送] 管理员：查询到的新闻示例（前3条）：`, newsList.slice(0, 3).map(n => ({
        id: n.id,
        title: n.title,
        enterprise_full_name: n.enterprise_full_name,
        public_time: n.public_time,
        wechat_account: n.wechat_account,
        account_name: n.account_name,
        APItype: n.APItype,
        entity_type: n.entity_type || '(NULL)',
        hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
        hasSummary: !!(n.summary && n.summary.trim()),
        hasContent: !!(n.content && n.content.trim())
      })));
      
      // 特别检查量子位公众号的新闻
      const quantumBitNews = newsList.filter(n => 
        (n.account_name && n.account_name.includes('量子位')) || 
        (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
      );
      if (quantumBitNews.length > 0) {
        console.log(`[邮件发送] ⚠️ 发现 ${quantumBitNews.length} 条量子位公众号的新闻，详细检查：`);
        quantumBitNews.forEach(n => {
          console.log(`[邮件发送]   新闻ID: ${n.id}`);
          console.log(`[邮件发送]   标题: ${n.title?.substring(0, 50)}`);
          console.log(`[邮件发送]   企业全称: ${n.enterprise_full_name || '(NULL)'}`);
          console.log(`[邮件发送]   公众号ID: ${n.wechat_account || '(NULL)'}`);
          console.log(`[邮件发送]   公众号名称: ${n.account_name || '(NULL)'}`);
          console.log(`[邮件发送]   APItype: ${n.APItype || '(NULL)'}`);
          console.log(`[邮件发送]   发布时间: ${n.public_time || '(NULL)'}`);
          console.log(`[邮件发送]   有摘要(news_abstract): ${!!(n.news_abstract && n.news_abstract.trim())}`);
          console.log(`[邮件发送]   有摘要(summary): ${!!(n.summary && n.summary.trim())}`);
          console.log(`[邮件发送]   有正文(content): ${!!(n.content && n.content.trim())}`);
          console.log(`[邮件发送]   摘要预览(news_abstract): ${n.news_abstract ? n.news_abstract.substring(0, 100) : '(NULL)'}`);
          console.log(`[邮件发送]   摘要预览(summary): ${n.summary ? n.summary.substring(0, 100) : '(NULL)'}`);
        });
      }
    }
  } else {
    // 普通用户只能看到自己创建的被投企业相关的新闻，以及自己创建的额外公众号数据
    console.log(`[邮件发送] ========== 普通用户查询逻辑 ==========`);
    
    // 根据收件配置的企业类型添加过滤条件（支持多选）
    let entityTypeFilter = '';
    if (recipientConfig && recipientConfig.entity_type) {
      // 解析entity_type（可能是JSON字符串、数组或单个值）
      let entityTypes = recipientConfig.entity_type;
      if (typeof entityTypes === 'string') {
        try {
          entityTypes = JSON.parse(entityTypes);
        } catch (e) {
          // 如果不是JSON，可能是单个值，转换为数组
          entityTypes = [entityTypes];
        }
      }
      if (!Array.isArray(entityTypes)) {
        entityTypes = [entityTypes];
      }
      
      if (entityTypes.length > 0) {
        // 构建多选过滤条件
        const conditions = [];
        entityTypes.forEach(type => {
          if (type === '被投企业') {
            conditions.push(`(entity_type = '被投企业' OR entity_type IS NULL)`);
          } else if (type === '基金') {
            conditions.push(`entity_type = '基金'`);
          } else if (type === '子基金') {
            conditions.push(`entity_type = '子基金'`);
          } else if (type === '子基金管理人') {
            conditions.push(`entity_type = '子基金管理人'`);
          } else if (type === '子基金GP') {
            conditions.push(`entity_type = '子基金GP'`);
          }
        });
        if (conditions.length > 0) {
          entityTypeFilter = `AND (${conditions.join(' OR ')})`;
        }
        console.log(`[邮件发送] 普通用户：根据企业类型过滤被投企业 - ${entityTypes.join(', ')}`);
      }
    }
    
    // 1. 查询用户创建的被投企业的微信公众号ID
    const wechatAccounts = await db.query(
      `SELECT DISTINCT wechat_official_account_id 
       FROM invested_enterprises 
       WHERE creator_user_id = ? 
       AND wechat_official_account_id IS NOT NULL 
       AND wechat_official_account_id != ''
       AND exit_status NOT IN ('完全退出', '已上市', '不再观察')
       AND delete_mark = 0
       ${entityTypeFilter}`,
      [userId]
    );
    
    // 2. 查询用户创建的额外公众号ID
    const userAdditionalAccounts = await db.query(
      `SELECT DISTINCT wechat_account_id 
       FROM additional_wechat_accounts 
       WHERE creator_user_id = ? 
       AND status = 'active' 
       AND wechat_account_id IS NOT NULL 
       AND wechat_account_id != ''
       AND delete_mark = 0`,
      [userId]
    );
    
    console.log(`[邮件发送] 用户创建的被投企业公众号数: ${wechatAccounts.length}`);
    console.log(`[邮件发送] 用户创建的额外公众号数: ${userAdditionalAccounts.length}`);
    
    // 拆分逗号分隔的公众号ID
    const accountIds = [];
    wechatAccounts.forEach(item => {
      const ids = splitAccountIds(item.wechat_official_account_id);
      accountIds.push(...ids);
    });
    userAdditionalAccounts.forEach(item => {
      accountIds.push(item.wechat_account_id);
    });
    
    // 去重公众号ID
    const uniqueAccountIds = [...new Set(accountIds)];
    
    if (uniqueAccountIds.length === 0) {
      console.log(`[邮件发送] 用户没有创建任何被投企业或额外公众号`);
      return [];
    }
    
    const placeholders = uniqueAccountIds.map(() => '?').join(',');
    console.log(`[邮件发送] 用户查询的公众号总数: ${uniqueAccountIds.length}`);
    
    // 查询这些公众号的新闻，包括：
    // 1. 通过公众号ID匹配且有企业全称的新闻（来自被投企业）
    // 2. 通过公众号ID匹配的额外公众号新闻（可能有企业全称，也可能没有）
    newsList = await db.query(
      `SELECT nd.id, nd.title, nd.enterprise_full_name, nd.enterprise_abbreviation, nd.news_sentiment, nd.keywords, 
              nd.news_abstract, nd.summary, nd.content, nd.public_time, nd.account_name, nd.wechat_account, nd.source_url, nd.created_at,
              nd.APItype, nd.news_category, nd.entity_type, 
              nd.fund, nd.sub_fund
       FROM news_detail nd
       LEFT JOIN invested_enterprises ie ON (
         nd.enterprise_full_name = ie.enterprise_full_name 
         OR (CASE 
           WHEN nd.enterprise_full_name LIKE '%(%' THEN 
             TRIM(SUBSTRING_INDEX(nd.enterprise_full_name, '(', 1))
           ELSE 
             nd.enterprise_full_name
         END) = ie.enterprise_full_name
         OR nd.enterprise_full_name = (CASE 
           WHEN ie.enterprise_full_name LIKE '%(%' THEN 
             TRIM(SUBSTRING_INDEX(ie.enterprise_full_name, '(', 1))
           ELSE 
             ie.enterprise_full_name
         END)
       ) AND ie.delete_mark = 0
       WHERE nd.wechat_account IN (${placeholders})
       AND nd.created_at >= ? 
       AND nd.created_at < ?
       AND nd.delete_mark = 0
       ORDER BY 
         CASE WHEN nd.enterprise_full_name IS NOT NULL AND nd.enterprise_full_name != '' THEN 0 ELSE 1 END,
         COALESCE(nd.enterprise_full_name, nd.account_name, ''),
         nd.public_time DESC`,
      [...uniqueAccountIds, from, to]
    );
    
    console.log(`[邮件发送] 普通用户：查询到 ${newsList.length} 条新闻`);
    
    // 如果查询结果中没有fund和sub_fund字段，手动补充这些字段
    if (newsList.length > 0 && !('fund' in newsList[0])) {
      console.log(`[邮件发送] ⚠️ 普通用户查询结果中缺少fund和sub_fund字段，手动补充...`);
      const newsIds = newsList.map(n => n.id);
      const placeholders = newsIds.map(() => '?').join(',');
      const fundData = await db.query(
        `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
        newsIds
      );
      
      // 创建映射表
      const fundMap = {};
      fundData.forEach(item => {
        fundMap[item.id] = {
          fund: item.fund || null,
          sub_fund: item.sub_fund || null
        };
      });
      
      // 补充字段
      newsList.forEach(news => {
        if (fundMap[news.id]) {
          news.fund = fundMap[news.id].fund;
          news.sub_fund = fundMap[news.id].sub_fund;
        } else {
          news.fund = null;
          news.sub_fund = null;
        }
      });
      
      console.log(`[邮件发送] ✓ 普通用户已手动补充fund和sub_fund字段，共 ${newsList.length} 条新闻`);
    }
    
    // 检查查询结果中的 entity_type 分布（用于调试）
    if (newsList.length > 0) {
      const entityTypeStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        entityTypeStats[et] = (entityTypeStats[et] || 0) + 1;
      });
      console.log(`[邮件发送] 普通用户查询结果中的 entity_type 分布:`, JSON.stringify(entityTypeStats, null, 2));
      
      // 显示前5条新闻的 entity_type 信息
      newsList.slice(0, 5).forEach((n, index) => {
        console.log(`[邮件发送] 普通用户查询结果新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}", enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
      });
    }
  }
  
  console.log(`[邮件发送] ========== 开始过滤新闻 ==========`);
  console.log(`[邮件发送] 初始查询结果：${newsList.length} 条新闻`);
  
  // 预先获取所有额外公众号的ID列表（用于后续过滤判断）
  let additionalAccountIdsSet = new Set();
  try {
    const additionalAccounts = await db.query(
      `SELECT DISTINCT wechat_account_id 
       FROM additional_wechat_accounts 
       WHERE status = 'active' 
       AND wechat_account_id IS NOT NULL 
       AND wechat_account_id != ''
       AND delete_mark = 0`
    );
    additionalAccounts.forEach(acc => {
      if (acc.wechat_account_id) {
        additionalAccountIdsSet.add(acc.wechat_account_id);
      }
    });
    console.log(`[邮件发送] 预先获取额外公众号ID列表，共 ${additionalAccountIdsSet.size} 个`);
  } catch (err) {
    console.warn(`[邮件发送] 获取额外公众号列表失败: ${err.message}`);
  }
  
  if (newsList.length > 0) {
    console.log(`[邮件发送] 初始新闻详情（前5条）：`, newsList.slice(0, 5).map(n => ({
      id: n.id,
      title: n.title?.substring(0, 30),
      APItype: n.APItype || '(NULL)',
      news_category: n.news_category || '(NULL)',
      enterprise_full_name: n.enterprise_full_name || '(NULL)',
      account_name: n.account_name || '(NULL)',
      wechat_account: n.wechat_account || '(NULL)',
      hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
      hasSummary: !!(n.summary && n.summary.trim()),
      hasContent: !!(n.content && n.content.trim())
    })));
    
    // 特别检查量子位公众号的新闻
    const quantumBitNews = newsList.filter(n => 
      (n.account_name && n.account_name.includes('量子位')) || 
      (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
    );
    if (quantumBitNews.length > 0) {
      console.log(`[邮件发送] ⚠️ 初始查询中包含 ${quantumBitNews.length} 条量子位公众号的新闻`);
    }
  }
  
  // 根据企业类型进行二次过滤（如果配置了entity_type，支持多选）
  if (recipientConfig && recipientConfig.entity_type && newsList.length > 0) {
    // 解析entity_type（可能是JSON字符串、数组或单个值）
    let entityTypes = recipientConfig.entity_type;
    if (typeof entityTypes === 'string') {
      try {
        entityTypes = JSON.parse(entityTypes);
      } catch (e) {
        // 如果不是JSON，可能是单个值，转换为数组
        entityTypes = [entityTypes];
      }
    }
    if (!Array.isArray(entityTypes)) {
      entityTypes = [entityTypes];
    }
    
    if (entityTypes.length > 0) {
      const beforeFilterCount = newsList.length;
      
      // 需要获取每个新闻对应的企业类型，通过企业全称匹配
      const enterpriseNames = [...new Set(newsList
        .map(n => n.enterprise_full_name)
        .filter(name => name && name.trim() !== ''))];
      
      if (enterpriseNames.length > 0) {
        const placeholders = enterpriseNames.map(() => '?').join(',');
        const enterpriseTypes = await db.query(
          `SELECT DISTINCT enterprise_full_name, entity_type 
           FROM invested_enterprises 
           WHERE enterprise_full_name IN (${placeholders}) 
           AND delete_mark = 0`,
          enterpriseNames
        );
        
        // 创建企业名称到类型的映射（支持模糊匹配）
        const enterpriseTypeMap = new Map();
        enterpriseTypes.forEach(e => {
          enterpriseTypeMap.set(e.enterprise_full_name, e.entity_type);
          // 也支持去掉括号后的匹配
          if (e.enterprise_full_name.includes('(')) {
            const nameWithoutBrackets = e.enterprise_full_name.split('(')[0].trim();
            enterpriseTypeMap.set(nameWithoutBrackets, e.entity_type);
          }
        });
        
        // 根据多个entity_type过滤新闻
        newsList = newsList.filter(news => {
          // 如果没有企业全称，保留（额外公众号新闻等）
          if (!news.enterprise_full_name || news.enterprise_full_name.trim() === '') {
            return true;
          }
          
          // 获取企业类型
          let newsEntityType = enterpriseTypeMap.get(news.enterprise_full_name);
          if (!newsEntityType && news.enterprise_full_name.includes('(')) {
            const nameWithoutBrackets = news.enterprise_full_name.split('(')[0].trim();
            newsEntityType = enterpriseTypeMap.get(nameWithoutBrackets);
          }
          
          // 如果查询结果中已经有entity_type，优先使用
          if (news.entity_type) {
            newsEntityType = news.entity_type;
          }
          
          // 检查是否匹配任何一个配置的企业类型
          for (const entityType of entityTypes) {
            if (entityType === '被投企业') {
              if (newsEntityType === '被投企业' || !newsEntityType) {
                return true;
              }
            } else if (entityType === '基金') {
              if (newsEntityType === '基金') {
                return true;
              }
            } else if (entityType === '子基金') {
              if (newsEntityType === '子基金') {
                return true;
              }
            } else if (entityType === '子基金管理人') {
              if (newsEntityType === '子基金管理人') {
                return true;
              }
            } else if (entityType === '子基金GP') {
              if (newsEntityType === '子基金GP') {
                return true;
              }
            }
          }
          
          // 不匹配任何配置的类型，过滤掉
          return false;
        });
        
        console.log(`[邮件发送] 根据企业类型(${entityTypes.join(', ')})过滤：${beforeFilterCount} -> ${newsList.length} 条新闻`);
      }
    }
  }

  // 如果skipFinalFilter为true，跳过企查查类别过滤和最终过滤，直接返回基本查询结果（用于邮件发送前的AI重新分析）
  if (skipFinalFilter) {
    console.log(`[邮件发送] 跳过企查查类别过滤和最终过滤，返回基本查询结果（用于AI重新分析）`);
    // 确保 newsList 是数组
    if (!Array.isArray(newsList)) {
      console.log(`[邮件发送] ⚠️ newsList 不是数组，类型: ${typeof newsList}, 值: ${newsList}`);
      newsList = [];
    }
    return newsList;
  }
  
  // 过滤新闻：只保留企查查数据源且类别在配置的允许列表中的新闻
  // 注意：此函数会过滤掉类别不在允许列表中的企查查新闻，但会保留所有新榜新闻
  // 如果收件管理配置了自定义类别（qichacha_category_codes），则使用自定义类别；否则使用默认类别
  let categoryCodes = null;
  if (recipientConfig && recipientConfig.qichacha_category_codes) {
    try {
      const parsed = typeof recipientConfig.qichacha_category_codes === 'string'
        ? JSON.parse(recipientConfig.qichacha_category_codes)
        : recipientConfig.qichacha_category_codes;
      if (Array.isArray(parsed) && parsed.length > 0) {
        categoryCodes = parsed;
        console.log(`[邮件发送] 使用收件管理配置的自定义企查查类别，共 ${categoryCodes.length} 个类别`);
      }
    } catch (e) {
      console.warn(`[邮件发送] 解析收件管理配置的企查查类别编码失败: ${e.message}`);
    }
  }
  
  // 确保 newsList 是数组，避免 undefined 错误
  if (!Array.isArray(newsList)) {
    console.log(`[邮件发送] ⚠️ newsList 不是数组，类型: ${typeof newsList}, 值: ${newsList}`);
    newsList = [];
  }
  
  const filteredNewsList = filterNewsByCategory(newsList, categoryCodes);
  
  // 确保 filteredNewsList 是数组
  if (!Array.isArray(filteredNewsList)) {
    console.log(`[邮件发送] ⚠️ filterNewsByCategory 返回的不是数组，类型: ${typeof filteredNewsList}, 值: ${filteredNewsList}`);
    return [];
  }
  
  console.log(`[邮件发送] 企查查类别过滤后：${filteredNewsList.length} 条新闻`);
  if (filteredNewsList.length > 0) {
    console.log(`[邮件发送] 企查查类别过滤后的新闻详情：`, filteredNewsList.slice(0, 5).map(n => ({
      id: n.id,
      title: n.title?.substring(0, 30),
      APItype: n.APItype || '(NULL)',
      news_category: n.news_category || '(NULL)',
      enterprise_full_name: n.enterprise_full_name || '(NULL)',
      account_name: n.account_name || '(NULL)',
      hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
      hasSummary: !!(n.summary && n.summary.trim()),
      hasContent: !!(n.content && n.content.trim())
    })));
    
    // 检查量子位公众号的新闻是否还在
    const quantumBitAfterCategory = filteredNewsList.filter(n => 
      (n.account_name && n.account_name.includes('量子位')) || 
      (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
    );
    if (quantumBitAfterCategory.length > 0) {
      console.log(`[邮件发送] ✓ 企查查类别过滤后，仍有 ${quantumBitAfterCategory.length} 条量子位公众号的新闻`);
    } else {
      const quantumBitBefore = newsList.filter(n => 
        (n.account_name && n.account_name.includes('量子位')) || 
        (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
      );
      if (quantumBitBefore.length > 0) {
        console.log(`[邮件发送] ⚠️ 警告：量子位公众号的 ${quantumBitBefore.length} 条新闻在企查查类别过滤中被过滤掉了！`);
        quantumBitBefore.forEach(n => {
          console.log(`[邮件发送]   被过滤的新闻: ID=${n.id}, 标题=${n.title?.substring(0, 50)}, APItype=${n.APItype || '(NULL)'}`);
        });
      }
    }
  }
  if (newsList.length > 0 && filteredNewsList.length === 0) {
    console.log(`[邮件发送] ⚠️ 警告：所有新闻都被类别过滤过滤掉了！`);
    console.log(`[邮件发送] 被过滤掉的新闻详情：`, newsList.slice(0, 5).map(n => ({
      id: n.id,
      title: n.title?.substring(0, 30),
      APItype: n.APItype || '(NULL)',
      news_category: n.news_category || '(NULL)',
      enterprise_full_name: n.enterprise_full_name || '(NULL)',
      filterReason: !n.APItype || (n.APItype !== '企查查' && n.APItype !== 'qichacha') 
        ? '非企查查数据源，应保留' 
        : (!n.news_category || n.news_category.trim() === '' 
          ? '企查查数据源但类别为空' 
          : '企查查数据源但类别不在允许列表中')
    })));
  }
  
  // 过滤新闻：根据数据源类型应用不同的过滤规则
  // 注意：企查查新闻的类别检查已经在 filterNewsByCategory 函数中完成
  // 进入此过滤的企查查新闻都是已经通过类别检查的（类别在配置的允许列表中）
  // 
  // 新榜新闻推送条件：有企业全称、有标题、有摘要（news_abstract 或 summary）
  // 企查查新闻推送条件：有企业全称、有标题、有摘要（news_abstract）或正文，且类别在配置的允许列表中（已在前面完成）
  const beforeFilterCount = filteredNewsList.length;
  console.log(`[邮件发送] 开始最终过滤，当前新闻数：${beforeFilterCount}`);
  
  // 特别检查目标新闻ID是否在过滤列表中
  const targetNewsId = '2026010409510500005';
  const targetNews = filteredNewsList.find(n => n.id === targetNewsId);
  if (targetNews) {
    console.log(`[邮件发送] ⚠️⚠️⚠️ 发现目标新闻 ${targetNewsId} 在过滤列表中，详细检查：`);
    console.log(`[邮件发送]   标题: ${targetNews.title || '(NULL)'}`);
    console.log(`[邮件发送]   企业全称: ${targetNews.enterprise_full_name || '(NULL)'}`);
    console.log(`[邮件发送]   企业全称类型: ${typeof targetNews.enterprise_full_name}`);
    console.log(`[邮件发送]   企业全称trim后: ${targetNews.enterprise_full_name ? targetNews.enterprise_full_name.trim() : '(NULL)'}`);
    console.log(`[邮件发送]   APItype: ${targetNews.APItype || '(NULL)'}`);
    console.log(`[邮件发送]   account_name: ${targetNews.account_name || '(NULL)'}`);
    console.log(`[邮件发送]   wechat_account: ${targetNews.wechat_account || '(NULL)'}`);
    console.log(`[邮件发送]   news_abstract存在: ${!!targetNews.news_abstract}`);
    console.log(`[邮件发送]   news_abstract值: ${targetNews.news_abstract ? `"${targetNews.news_abstract.substring(0, 100)}..."` : '(NULL)'}`);
    console.log(`[邮件发送]   summary存在: ${!!targetNews.summary}`);
    console.log(`[邮件发送]   summary值: ${targetNews.summary ? `"${targetNews.summary.substring(0, 100)}..."` : '(NULL)'}`);
    console.log(`[邮件发送]   content存在: ${!!targetNews.content}`);
    console.log(`[邮件发送]   content长度: ${targetNews.content ? targetNews.content.length : 0}`);
  } else {
    console.log(`[邮件发送] ⚠️ 目标新闻 ${targetNewsId} 不在过滤列表中，可能在企查查类别过滤时已被过滤`);
  }
  
  const finalNewsList = filteredNewsList.filter(news => {
    // 特别记录目标新闻的过滤过程
    const isTargetNews = news.id === targetNewsId;
    
    // 首先检查标题（标题是必需的）
    if (!news.title || news.title.trim() === '') {
      if (isTargetNews) {
        console.log(`[邮件发送] ⚠️⚠️⚠️ 目标新闻 ${targetNewsId} 被过滤：标题为空`);
      }
      console.log(`[邮件发送] 过滤掉标题为空的新闻: ${news.id} (APItype: ${news.APItype || '(NULL)'})`);
      return false;
    }
    
    // 检查企业全称
    // 注意：额外公众号的新闻可能没有企业名称，这种情况下应该保留，并在邮件中显示公众号名称
    const enterpriseName = news.enterprise_full_name;
    const hasEnterpriseName = enterpriseName && enterpriseName.trim() !== '';
    
    // 对于没有企业名称的新闻，检查是否是额外公众号的新闻
    // 如果是额外公众号的新闻，即使没有企业名称也允许通过
    if (!hasEnterpriseName) {
      // 使用预先获取的额外公众号ID列表来判断（避免在filter回调中查询数据库）
      const isAdditionalAccountNews = news.wechat_account && additionalAccountIdsSet.has(news.wechat_account);
      
      if (!isAdditionalAccountNews) {
        // 非额外公众号的新闻，企业全称是必需的
        if (isTargetNews) {
          console.log(`[邮件发送] ⚠️⚠️⚠️ 目标新闻 ${targetNewsId} 被过滤：企业名称为空（非额外公众号新闻）`);
          console.log(`[邮件发送]   企业全称原始值: ${enterpriseName === null ? '(null)' : enterpriseName === undefined ? '(undefined)' : `"${enterpriseName}"`}`);
          console.log(`[邮件发送]   企业全称trim后: ${enterpriseName ? enterpriseName.trim() : '(NULL)'}`);
        }
        console.log(`[邮件发送] 过滤掉企业名称为空的新闻: ${news.id} - ${news.title?.substring(0, 50)} (APItype: ${news.APItype || '(NULL)'})`);
        return false;
      } else {
        // 额外公众号的新闻，没有企业名称也允许通过，在邮件中显示公众号名称
        news._display_enterprise_name = news.account_name || news.wechat_account || '未知公众号';
        console.log(`[邮件发送] ✓ 额外公众号新闻（无企业名称）: ${news.id} - ${news.title?.substring(0, 50)} (将显示为: ${news._display_enterprise_name})`);
      }
    }
    
    // 检查 news_abstract 字段（AI提取的摘要）
    const hasAbstract = news.news_abstract && news.news_abstract.trim() !== '';
    // 检查 summary 字段（原始摘要，新榜数据使用此字段）
    const hasSummary = news.summary && news.summary.trim() !== '';
    // 检查 content 字段（正文）
    const hasContent = news.content && news.content.trim() !== '';
    
    // 判断数据源类型
    const isQichacha = news.APItype === '企查查' || news.APItype === 'qichacha';
    const isXinbang = news.APItype === '新榜' || !news.APItype || (!isQichacha);
    
    if (isTargetNews) {
      console.log(`[邮件发送] ⚠️⚠️⚠️ 目标新闻 ${targetNewsId} 过滤检查：`);
      console.log(`[邮件发送]   isQichacha: ${isQichacha}, isXinbang: ${isXinbang}`);
      console.log(`[邮件发送]   hasAbstract: ${hasAbstract}, hasSummary: ${hasSummary}, hasContent: ${hasContent}`);
    }
    
    if (isXinbang) {
      // 新榜新闻：只要有摘要（news_abstract 或 summary）即可推送
      if (hasAbstract || hasSummary) {
        // 特别记录量子位公众号的新闻
        const isQuantumBit = (news.account_name && news.account_name.includes('量子位')) || 
                            (news.wechat_account && news.wechat_account.includes('gh_114e76fd6e5d'));
        if (isQuantumBit) {
          console.log(`[邮件发送] ✓✓✓ 量子位新榜新闻通过过滤: ${news.id} - ${news.title?.substring(0, 50)}`);
          console.log(`[邮件发送]   企业: ${news.enterprise_full_name}, 有摘要(news_abstract): ${hasAbstract}, 有摘要(summary): ${hasSummary}`);
        } else {
          if (isTargetNews) {
            console.log(`[邮件发送] ✓✓✓ 目标新闻 ${targetNewsId} 通过过滤（新榜新闻，有摘要）`);
          }
          console.log(`[邮件发送] ✓ 新榜新闻通过过滤: ${news.id} - ${news.title?.substring(0, 50)} (企业: ${news.enterprise_full_name}, 有摘要: ${hasAbstract || hasSummary})`);
        }
        return true;
      } else {
        // 特别记录量子位公众号的新闻被过滤的原因
        const isQuantumBit = (news.account_name && news.account_name.includes('量子位')) || 
                            (news.wechat_account && news.wechat_account.includes('gh_114e76fd6e5d'));
        if (isQuantumBit || isTargetNews) {
          if (isTargetNews) {
            console.log(`[邮件发送] ⚠️⚠️⚠️ 目标新闻 ${targetNewsId} 被过滤（新榜新闻，无摘要）`);
          }
          console.log(`[邮件发送] ⚠️⚠️⚠️ ${isQuantumBit ? '量子位' : '目标'}新榜新闻被过滤（无摘要）: ${news.id} - ${news.title?.substring(0, 50)}`);
          console.log(`[邮件发送]   企业: ${news.enterprise_full_name || '(NULL)'}`);
          console.log(`[邮件发送]   hasAbstract: ${hasAbstract}, news_abstract值: ${news.news_abstract ? `"${news.news_abstract.substring(0, 50)}..."` : '(NULL)'}`);
          console.log(`[邮件发送]   hasSummary: ${hasSummary}, summary值: ${news.summary ? `"${news.summary.substring(0, 50)}..."` : '(NULL)'}`);
          console.log(`[邮件发送]   hasContent: ${hasContent}, content长度: ${news.content ? news.content.length : 0}`);
        } else {
          console.log(`[邮件发送] 过滤掉新榜新闻（无摘要）: ${news.id} - ${news.title?.substring(0, 50)} (企业: ${news.enterprise_full_name}, hasAbstract: ${hasAbstract}, hasSummary: ${hasSummary})`);
        }
        return false;
      }
    } else {
      // 企查查新闻：有摘要（news_abstract）或正文即可推送
      // 注意：企查查新闻的类别检查已经在 filterNewsByCategory 函数中完成
      // 进入此过滤的企查查新闻都是类别在配置的允许列表中的
      if (hasAbstract || hasContent) {
        if (isTargetNews) {
          console.log(`[邮件发送] ✓✓✓ 目标新闻 ${targetNewsId} 通过过滤（企查查新闻，有摘要或正文）`);
        }
        console.log(`[邮件发送] ✓ 企查查新闻通过过滤: ${news.id} - ${news.title?.substring(0, 50)} (企业: ${news.enterprise_full_name}, 类别: ${news.news_category || '(NULL)'}, 有摘要或正文: ${hasAbstract || hasContent})`);
        return true;
      } else {
        if (isTargetNews) {
          console.log(`[邮件发送] ⚠️⚠️⚠️ 目标新闻 ${targetNewsId} 被过滤（企查查新闻，无摘要和正文）`);
        }
        console.log(`[邮件发送] 过滤掉企查查新闻（无摘要和正文）: ${news.id} - ${news.title?.substring(0, 50)} (企业: ${news.enterprise_full_name}, 类别: ${news.news_category || '(NULL)'}, hasAbstract: ${hasAbstract}, hasContent: ${hasContent})`);
        return false;
      }
    }
  });
  
  const filteredCount = beforeFilterCount - finalNewsList.length;
  if (filteredCount > 0) {
    console.log(`[邮件发送] 过滤掉 ${filteredCount} 条摘要和正文都为空的数据，剩余 ${finalNewsList.length} 条`);
  }
  
  console.log(`[邮件发送] ========== 过滤完成 ==========`);
  console.log(`[邮件发送] 最终返回：${finalNewsList.length} 条新闻`);
  
  // 在返回前，确保finalNewsList中的所有新闻都有fund和sub_fund字段
  if (finalNewsList.length > 0 && !('fund' in finalNewsList[0])) {
    console.log(`[邮件发送] ⚠️ 返回前检查：最终结果中缺少fund和sub_fund字段，手动补充...`);
    const newsIds = finalNewsList.map(n => n.id);
    const placeholders = newsIds.map(() => '?').join(',');
    const fundData = await db.query(
      `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
      newsIds
    );
    
    // 创建映射表
    const fundMap = {};
    fundData.forEach(item => {
      fundMap[item.id] = {
        fund: item.fund || null,
        sub_fund: item.sub_fund || null
      };
    });
    
    // 补充字段
    finalNewsList.forEach(news => {
      if (fundMap[news.id]) {
        news.fund = fundMap[news.id].fund;
        news.sub_fund = fundMap[news.id].sub_fund;
      } else {
        news.fund = null;
        news.sub_fund = null;
      }
    });
    
    console.log(`[邮件发送] ✓ 返回前已手动补充fund和sub_fund字段，共 ${finalNewsList.length} 条新闻`);
    
    // 验证补充后的结果
    if (finalNewsList.length > 0) {
      const firstAfter = finalNewsList[0];
      console.log(`[邮件发送] 返回前补充后第一条新闻包含fund字段: ${'fund' in firstAfter}, 包含sub_fund字段: ${'sub_fund' in firstAfter}`);
      if ('fund' in firstAfter) {
        console.log(`[邮件发送] 返回前补充后第一条新闻的fund值: "${firstAfter.fund || '(NULL)'}"`);
      }
      if ('sub_fund' in firstAfter) {
        console.log(`[邮件发送] 返回前补充后第一条新闻的sub_fund值: "${firstAfter.sub_fund || '(NULL)'}"`);
      }
    }
  }
  
  if (finalNewsList.length > 0) {
    console.log(`[邮件发送] 最终新闻示例（前3条）：`, finalNewsList.slice(0, 3).map(n => ({
      id: n.id,
      title: n.title,
      enterprise_full_name: n.enterprise_full_name,
      account_name: n.account_name,
      public_time: n.public_time,
      hasAbstract: !!(n.news_abstract && n.news_abstract.trim()),
      hasSummary: !!(n.summary && n.summary.trim()),
      hasContent: !!(n.content && n.content.trim()),
      hasFund: 'fund' in n,
      hasSubFund: 'sub_fund' in n,
      fund: n.fund || '(NULL)',
      sub_fund: n.sub_fund || '(NULL)'
    })));
    
    // 检查最终结果中是否包含量子位公众号的新闻
    const quantumBitFinal = finalNewsList.filter(n => 
      (n.account_name && n.account_name.includes('量子位')) || 
      (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
    );
    if (quantumBitFinal.length > 0) {
      console.log(`[邮件发送] ✓✓✓ 最终结果中包含 ${quantumBitFinal.length} 条量子位公众号的新闻，将被发送`);
    } else {
      const quantumBitInitial = newsList.filter(n => 
        (n.account_name && n.account_name.includes('量子位')) || 
        (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
      );
      if (quantumBitInitial.length > 0) {
        console.log(`[邮件发送] ⚠️⚠️⚠️ 警告：初始查询到 ${quantumBitInitial.length} 条量子位公众号的新闻，但最终结果中为 0 条！`);
        console.log(`[邮件发送]   请检查上述日志，查看量子位新闻在哪个过滤步骤被过滤掉了`);
      }
    }
  } else if (newsList.length > 0) {
    console.log(`[邮件发送] ⚠️ 警告：初始查询到 ${newsList.length} 条新闻，但经过过滤后为 0 条！`);
    
    // 检查是否有量子位公众号的新闻被过滤
    const quantumBitInitial = newsList.filter(n => 
      (n.account_name && n.account_name.includes('量子位')) || 
      (n.wechat_account && n.wechat_account.includes('gh_114e76fd6e5d'))
    );
    if (quantumBitInitial.length > 0) {
      console.log(`[邮件发送] ⚠️⚠️⚠️ 特别警告：初始查询中包含 ${quantumBitInitial.length} 条量子位公众号的新闻，但全部被过滤掉了！`);
      quantumBitInitial.forEach(n => {
        console.log(`[邮件发送]   被过滤的量子位新闻: ID=${n.id}, 标题=${n.title?.substring(0, 50)}`);
        console.log(`[邮件发送]     企业全称: ${n.enterprise_full_name || '(NULL)'}`);
        console.log(`[邮件发送]     APItype: ${n.APItype || '(NULL)'}`);
        console.log(`[邮件发送]     有摘要(news_abstract): ${!!(n.news_abstract && n.news_abstract.trim())}`);
        console.log(`[邮件发送]     有摘要(summary): ${!!(n.summary && n.summary.trim())}`);
        console.log(`[邮件发送]     有正文(content): ${!!(n.content && n.content.trim())}`);
      });
    }
  }
  
  return finalNewsList;
}

/**
 * 过滤新闻：只保留企查查数据源且类别在允许列表中的新闻
 * @param {Array} newsList - 新闻列表
 * @param {Array|null} customCategoryCodes - 自定义类别编码列表（null表示使用默认类别）
 * @returns {Array} - 过滤后的新闻列表
 */
function filterNewsByCategory(newsList, customCategoryCodes = null) {
  // 检查 newsList 是否为有效的数组
  if (!newsList || !Array.isArray(newsList)) {
    console.log(`[邮件发送] ⚠️ filterNewsByCategory: newsList 不是有效的数组，类型: ${typeof newsList}, 值: ${newsList}`);
    return [];
  }
  
  // 默认类别编码（80000和40000系列，以及荣誉奖项14004，排除80008）
  const defaultCategoryCodes = [
    '80000', '80001', '80002', '80003', '80004', '80005', '80006', '80007',
    '40000', '40001', '40002', '40003', '40004', '40005', '40006', '40007', '40008', 
    '40009', '40010', '40011', '40012', '40013', '40014', '40015', '40016', '40017', 
    '40018', '40019', '40020', '40021', '40022', '40023', '40024', '40025', '40026', 
    '40027', '40028', '40029', '40030',
    '14004'  // 荣誉奖项
  ];
  
  // 使用自定义类别编码或默认类别编码
  const allowedCategoryCodes = customCategoryCodes && Array.isArray(customCategoryCodes) && customCategoryCodes.length > 0
    ? customCategoryCodes.map(code => String(code).trim()) // 确保都是字符串格式
    : defaultCategoryCodes;
  
  // 将允许的类别编码转换为Set，提高查找效率
  const allowedCategorySet = new Set(allowedCategoryCodes);
  
  // 从映射表获取对应的中文类别名称（用于日志显示）
  const qichachaCategoryMapper = require('./qichachaCategoryMapper');
  const categoryMap = qichachaCategoryMapper.getCategoryMapSync ? qichachaCategoryMapper.getCategoryMapSync() : qichachaCategoryMapper.categoryMap || {};
  const allowedCategoryNames = allowedCategoryCodes
    .map(code => categoryMap[code])
    .filter(name => name !== undefined);
  
  console.log(`[邮件发送] 使用的企查查类别：${customCategoryCodes ? '自定义' : '默认'}，共 ${allowedCategoryCodes.length} 个类别编码`);
  console.log(`[邮件发送] 允许的企查查类别编码：${allowedCategoryCodes.join(', ')}`);
  if (allowedCategoryNames.length > 0) {
    console.log(`[邮件发送] 允许的企查查类别名称：${allowedCategoryNames.join(', ')}`);
  }
  
  const filtered = newsList.filter(news => {
    // 只处理企查查数据源的新闻
    if (!news.APItype || (news.APItype !== '企查查' && news.APItype !== 'qichacha')) {
      // 如果不是企查查数据源，保留（可能是新榜等其他数据源）
      return true;
    }
    
    // 对于企查查数据源，检查类别编码
    const categoryCode = news.news_category ? String(news.news_category).trim() : '';
    
    // 如果类别编码为空，不包含
    if (!categoryCode) {
      console.log(`[邮件发送] 企查查新闻被过滤：类别编码为空 (ID: ${news.id}, 标题: ${news.title?.substring(0, 30)})`);
      return false;
    }
    
    // 直接检查类别编码是否在允许的编码列表中
    const isAllowed = allowedCategorySet.has(categoryCode);
    if (!isAllowed) {
      const categoryName = categoryMap[categoryCode] || categoryCode;
      console.log(`[邮件发送] 企查查新闻被过滤：类别编码"${categoryCode}"(${categoryName})不在允许列表中 (ID: ${news.id}, 标题: ${news.title?.substring(0, 30)}, 允许的类别: ${Array.from(allowedCategorySet).join(', ')})`);
    } else {
      // 记录通过的新闻（仅记录前几条，避免日志过多）
      if (Math.random() < 0.1) { // 随机记录10%的通过记录
        const categoryName = categoryMap[categoryCode] || categoryCode;
        console.log(`[邮件发送] ✓ 企查查新闻通过类别过滤：类别编码"${categoryCode}"(${categoryName}) (ID: ${news.id}, 标题: ${news.title?.substring(0, 30)})`);
      }
    }
    return isAllowed;
  });
  
  return filtered;
}

/**
 * 将新闻数据导出为Excel Buffer
 */
function exportNewsToExcel(newsList) {
  // 准备Excel数据
  // 注意：对于没有企业名称的额外公众号新闻，显示公众号名称
  const excelData = newsList.map((news, index) => {
    const keywords = news.keywords ? (typeof news.keywords === 'string' ? JSON.parse(news.keywords) : news.keywords) : [];
    const sentimentMap = {
      'positive': '正面',
      'negative': '负面',
      'neutral': '中性'
    };
    
    // 如果没有企业名称，使用公众号名称（或_display_enterprise_name标记）
    const displayEnterpriseName = news.enterprise_full_name || 
                                  news._display_enterprise_name || 
                                  news.account_name || 
                                  news.wechat_account || 
                                  '';
    
    return {
      '序号': index + 1,
      '被投企业全称': displayEnterpriseName,
      '新闻标题': news.title || '',
      '新闻标签': Array.isArray(keywords) ? keywords.join('、') : '',
      '新闻情绪': sentimentMap[news.news_sentiment] || news.news_sentiment || '未知',
      '新闻摘要': news.news_abstract || news.summary || '',
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
    // 检查传入的新闻列表的 entity_type 分布（用于调试）
    console.log(`[邮件发送] ========== sendNewsEmailWithExcel 函数开始 ==========`);
    console.log(`[邮件发送] 传入的新闻数量: ${newsList.length}`);
    if (newsList.length > 0) {
      const entityTypeStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        entityTypeStats[et] = (entityTypeStats[et] || 0) + 1;
      });
      console.log(`[邮件发送] 传入的新闻 entity_type 分布:`, JSON.stringify(entityTypeStats, null, 2));
      
      // 显示前5条新闻的详细信息
      newsList.slice(0, 5).forEach((n, index) => {
        console.log(`[邮件发送] 传入的新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
      });
    }
    console.log(`[邮件发送] ========== sendNewsEmailWithExcel 函数检查结束 ==========`);
    
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
    
    // 检查过滤前的 entity_type 分布（用于调试）
    console.log(`[邮件发送] ========== 开始过滤广告新闻 ==========`);
    console.log(`[邮件发送] 过滤前新闻数量: ${newsList.length}`);
    if (newsList.length > 0) {
      const beforeFilterStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        beforeFilterStats[et] = (beforeFilterStats[et] || 0) + 1;
      });
      console.log(`[邮件发送] 过滤前的 entity_type 分布:`, JSON.stringify(beforeFilterStats, null, 2));
    }
    
    // 在过滤前，确保newsList中的所有新闻都有fund和sub_fund字段
    // 如果查询结果中没有fund和sub_fund字段，手动补充这些字段
    if (newsList.length > 0) {
      const firstNews = newsList[0];
      console.log(`[邮件发送] 过滤前检查：第一条新闻的字段:`, Object.keys(firstNews).join(', '));
      console.log(`[邮件发送] 过滤前检查：第一条新闻包含fund字段: ${'fund' in firstNews}, 包含sub_fund字段: ${'sub_fund' in firstNews}`);
      
      if (!('fund' in firstNews)) {
        console.log(`[邮件发送] ⚠️ 过滤前检查：查询结果中缺少fund和sub_fund字段，手动补充...`);
        const newsIds = newsList.map(n => n.id);
        const placeholders = newsIds.map(() => '?').join(',');
        const fundData = await db.query(
          `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
          newsIds
        );
        
        console.log(`[邮件发送] 从数据库查询到 ${fundData.length} 条fund和sub_fund数据`);
        
        // 创建映射表
        const fundMap = {};
        fundData.forEach(item => {
          fundMap[item.id] = {
            fund: item.fund || null,
            sub_fund: item.sub_fund || null
          };
        });
        
        // 补充字段
        newsList.forEach(news => {
          if (fundMap[news.id]) {
            news.fund = fundMap[news.id].fund;
            news.sub_fund = fundMap[news.id].sub_fund;
          } else {
            news.fund = null;
            news.sub_fund = null;
          }
        });
        
        console.log(`[邮件发送] ✓ 过滤前已手动补充fund和sub_fund字段，共 ${newsList.length} 条新闻`);
        
        // 验证补充后的结果
        if (newsList.length > 0) {
          const firstAfter = newsList[0];
          console.log(`[邮件发送] 过滤前补充后第一条新闻包含fund字段: ${'fund' in firstAfter}, 包含sub_fund字段: ${'sub_fund' in firstAfter}`);
          if ('fund' in firstAfter) {
            console.log(`[邮件发送] 过滤前补充后第一条新闻的fund值: "${firstAfter.fund || '(NULL)'}"`);
          }
          if ('sub_fund' in firstAfter) {
            console.log(`[邮件发送] 过滤前补充后第一条新闻的sub_fund值: "${firstAfter.sub_fund || '(NULL)'}"`);
          }
        }
      } else {
        console.log(`[邮件发送] ✓ 过滤前检查：第一条新闻已包含fund和sub_fund字段`);
        if ('fund' in firstNews) {
          console.log(`[邮件发送] 过滤前第一条新闻的fund值: "${firstNews.fund || '(NULL)'}"`);
        }
        if ('sub_fund' in firstNews) {
          console.log(`[邮件发送] 过滤前第一条新闻的sub_fund值: "${firstNews.sub_fund || '(NULL)'}"`);
        }
      }
    }
    
    // 过滤掉广告类型的新闻：仅「节假日类官方营销」会打这三种标签（节日庆祝、节日工作安排、节日放假安排，如春节/元旦/中秋等）；
    // 企业推介自家产品、服务、品牌的发展类内容不打此类标签，故不会被过滤（股权投资关注企业发展）
    const advertisementKeywords = ['广告推广', '商业广告', '营销推广'];
    const filteredNewsList = newsList.filter(news => {
      // 首先过滤掉企业名称为null或空字符串的新闻
      if (!news.enterprise_full_name || news.enterprise_full_name.trim() === '') {
        console.log(`[邮件发送] 过滤掉企业名称为空的新闻: ${news.id} - ${news.title}`);
        return false;
      }
      
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
    
    // 查询所有额外公众号的ID列表（用于判断新闻是否来自额外公众号）
    // 注意：db已经在文件顶部导入，不需要重新导入
    let additionalAccountIds = [];
    try {
      const additionalAccounts = await db.query(
        `SELECT wechat_account_id 
         FROM additional_wechat_accounts 
         WHERE status = 'active' 
         AND delete_mark = 0
         AND wechat_account_id IS NOT NULL 
         AND wechat_account_id != ''`
      );
      additionalAccountIds = additionalAccounts.map(a => a.wechat_account_id);
      console.log(`[邮件发送] 查询到 ${additionalAccountIds.length} 个额外公众号ID`);
    } catch (e) {
      console.error('[邮件发送] 查询额外公众号列表失败:', e.message);
    }
    
    // 先按企业类型分组，再按企业分组新闻（使用过滤后的列表，过滤掉企业名称为null或空的新闻）
    const newsByEntityTypeAndEnterprise = {};
    for (const news of filteredNewsList) {
      // 过滤掉企业名称为null或空字符串的新闻
      if (!news.enterprise_full_name || news.enterprise_full_name.trim() === '') {
        console.log(`[邮件发送] 过滤掉企业名称为空的新闻: ${news.id} - ${news.title}`);
        continue;
      }
      
      // 获取企业类型，直接使用 news_detail 表中的 entity_type 字段
      // 如果 entity_type 为空（null、undefined 或空字符串），且有企业全称，默认为"被投企业"（兼容旧数据）
      let entityType = news.entity_type;
      
      // 记录原始 entity_type 值（用于调试）
      const originalEntityType = entityType;
      
      if (!entityType || (typeof entityType === 'string' && entityType.trim() === '')) {
        if (news.enterprise_full_name && news.enterprise_full_name.trim() !== '') {
          entityType = '被投企业';
          console.log(`[邮件发送] ⚠️ 新闻 ${news.id} 的 entity_type 为空，使用默认值"被投企业"`);
        } else {
          entityType = '其他';
        }
      }
      
      // 确保 entityType 是有效的分组类型
      const validEntityTypes = ['被投企业', '基金', '子基金', '子基金管理人', '子基金GP', '其他'];
      if (!validEntityTypes.includes(entityType)) {
        // 如果 entityType 不在有效列表中，默认为"被投企业"
        console.log(`[邮件发送] ⚠️ 无效的entity_type: "${entityType}"，使用默认值"被投企业" (新闻ID: ${news.id})`);
        entityType = '被投企业';
      }
      
      // 记录分组信息（前10条新闻都记录，便于调试）
      if (filteredNewsList.indexOf(news) < 10) {
        console.log(`[邮件发送] 分组新闻: ID=${news.id}, entity_type="${entityType}" (原始值: "${originalEntityType || '(NULL)'}"), enterprise="${news.enterprise_full_name?.substring(0, 30)}"`);
      }
      
      let enterpriseName = news.enterprise_full_name;
      let groupKey = enterpriseName;
      
      // 只有来自额外公众号的新闻，且企业名称为空，且包含"榜单"或"获奖"标签的，才使用null作为分组键
      // 注意：这里不应该覆盖已经正确设置的 entityType
      if ((!enterpriseName || enterpriseName === '' || enterpriseName === 'null')) {
        // 检查是否来自额外公众号
        const isFromAdditionalAccount = news.wechat_account && additionalAccountIds.includes(news.wechat_account);
        
        if (isFromAdditionalAccount) {
          // 检查是否包含"榜单"或"获奖"标签
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
          
          const hasAwardTag = keywords.some(k => k === '榜单' || k === '获奖');
          if (hasAwardTag) {
            // 只有来自额外公众号且包含"榜单"或"获奖"标签的，归类为"其他"
            // 但只有在 entityType 还没有被正确设置时才覆盖
            if (!originalEntityType || (typeof originalEntityType === 'string' && originalEntityType.trim() === '')) {
              entityType = '其他';
            }
            groupKey = null;
          } else {
            // 来自额外公众号但没有标签的，保持原值（使用空字符串作为分组键）
            // 但只有在 entityType 还没有被正确设置时才覆盖
            if (!originalEntityType || (typeof originalEntityType === 'string' && originalEntityType.trim() === '')) {
              entityType = '其他';
            }
            groupKey = enterpriseName || '';
          }
        } else {
          // 不是来自额外公众号的，保持原值（使用空字符串作为分组键）
          // 但只有在 entityType 还没有被正确设置时才覆盖
          if (!originalEntityType || (typeof originalEntityType === 'string' && originalEntityType.trim() === '')) {
            entityType = '其他';
          }
          groupKey = enterpriseName || '';
        }
      }
      
      // 确保groupKey不为undefined或null，统一使用字符串
      if (groupKey === undefined || groupKey === null) {
        groupKey = '';
      }
      // 确保 groupKey 是字符串类型
      groupKey = String(groupKey);
      
      if (!newsByEntityTypeAndEnterprise[entityType]) {
        newsByEntityTypeAndEnterprise[entityType] = {};
      }
      if (!newsByEntityTypeAndEnterprise[entityType][groupKey]) {
        newsByEntityTypeAndEnterprise[entityType][groupKey] = [];
      }
      // 确保 news 对象存在且是有效的
      if (news && typeof news === 'object') {
        // 调试：检查分组时的数据是否包含fund和sub_fund字段
        if ((entityType === '子基金' || entityType === '子基金管理人' || entityType === '子基金GP') && filteredNewsList.indexOf(news) < 3) {
          console.log(`[邮件发送] 分组时检查新闻 ID=${news.id}: 包含fund字段=${'fund' in news}, 包含sub_fund字段=${'sub_fund' in news}`);
          if ('fund' in news) {
            console.log(`[邮件发送] 分组时新闻 ID=${news.id} 的fund值: "${news.fund || '(NULL)'}"`);
          }
          if ('sub_fund' in news) {
            console.log(`[邮件发送] 分组时新闻 ID=${news.id} 的sub_fund值: "${news.sub_fund || '(NULL)'}"`);
          }
        }
        // 调试：检查分组时的数据是否包含fund和sub_fund字段
        if ((entityType === '子基金' || entityType === '子基金管理人' || entityType === '子基金GP') && filteredNewsList.indexOf(news) < 3) {
          console.log(`[邮件发送] 分组时检查新闻 ID=${news.id}: 包含fund字段=${'fund' in news}, 包含sub_fund字段=${'sub_fund' in news}`);
          console.log(`[邮件发送] 分组时新闻 ID=${news.id} 的所有字段:`, Object.keys(news).join(', '));
          if ('fund' in news) {
            console.log(`[邮件发送] 分组时新闻 ID=${news.id} 的fund值: "${news.fund || '(NULL)'}"`);
          }
          if ('sub_fund' in news) {
            console.log(`[邮件发送] 分组时新闻 ID=${news.id} 的sub_fund值: "${news.sub_fund || '(NULL)'}"`);
          }
        }
        newsByEntityTypeAndEnterprise[entityType][groupKey].push(news);
      } else {
        console.log(`[邮件发送] ⚠️ 跳过无效的新闻对象: ${news?.id || '(NULL)'}`);
      }
    }
    
    // 记录分组统计信息（用于调试）
    const groupingStats = {};
    Object.keys(newsByEntityTypeAndEnterprise).forEach(et => {
      const entityGroup = newsByEntityTypeAndEnterprise[et] || {};
      const enterpriseCount = Object.keys(entityGroup).length;
      const newsCount = Object.values(entityGroup).reduce((sum, arr) => {
        // 确保 arr 是数组，避免 undefined 错误
        return sum + (Array.isArray(arr) ? arr.length : 0);
      }, 0);
      groupingStats[et] = { enterprises: enterpriseCount, news: newsCount };
    });
    console.log(`[邮件发送] ========== 分组统计 ==========`);
    console.log(`[邮件发送] 分组统计:`, JSON.stringify(groupingStats, null, 2));
    
    // 检查每个分组的前几条新闻，确认 entity_type 是否正确
    Object.keys(newsByEntityTypeAndEnterprise).forEach(et => {
      const firstNews = Object.values(newsByEntityTypeAndEnterprise[et] || {})[0]?.[0];
      if (firstNews) {
        console.log(`[邮件发送] 分组"${et}"的第一条新闻: ID=${firstNews.id}, entity_type="${firstNews.entity_type || '(NULL)'}", enterprise="${firstNews.enterprise_full_name?.substring(0, 30)}"`);
        // 检查fund和sub_fund字段
        console.log(`[邮件发送] 分组"${et}"的第一条新闻字段:`, Object.keys(firstNews).join(', '));
        console.log(`[邮件发送] 分组"${et}"的第一条新闻包含fund字段: ${'fund' in firstNews}, 包含sub_fund字段: ${'sub_fund' in firstNews}`);
        if ('fund' in firstNews) {
          console.log(`[邮件发送] 分组"${et}"的第一条新闻fund值: "${firstNews.fund || '(NULL)'}"`);
        }
        if ('sub_fund' in firstNews) {
          console.log(`[邮件发送] 分组"${et}"的第一条新闻sub_fund值: "${firstNews.sub_fund || '(NULL)'}"`);
        }
      }
    });
    console.log(`[邮件发送] ========== 分组统计结束 ==========`);
    
    const htmlContent = generateEmailContent(newsByEntityTypeAndEnterprise);
    const textContent = generateEmailTextContent(newsByEntityTypeAndEnterprise);
    
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
/**
 * 检查指定日期是否为工作日（用于邮件发送），使用北京时区
 * @param {Date} date - 日期对象
 * @returns {Promise<boolean>} 是否为工作日
 */
async function isWorkdayForEmail(date) {
  try {
    // 使用北京时区格式化日期，确保与节假日表中的日期（北京时区）一致
    const dateStr = formatDateOnly(date);
    const holidays = await db.query(
      'SELECT is_workday, workday_type FROM holiday_calendar WHERE holiday_date = ? AND is_deleted = 0 LIMIT 1',
      [dateStr]
    );
    
    if (holidays.length > 0) {
      // 如果在节假日表中，根据is_workday判断
      // is_workday = 1 表示工作日，is_workday = 0 表示非工作日（节假日）
      const isWorkday = holidays[0].is_workday === 1;
      if (!isWorkday) {
        console.log(`[邮件发送] 日期 ${dateStr}（北京时区）在节假日表中，类型：${holidays[0].workday_type || '节假日'}，跳过发送`);
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
    
    // 获取收件管理配置，包括企查查类别编码
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
    
    // 解析企查查类别编码（JSON格式）
    let categoryCodes = null;
    if (recipient.qichacha_category_codes) {
      try {
        const parsed = typeof recipient.qichacha_category_codes === 'string'
          ? JSON.parse(recipient.qichacha_category_codes)
          : recipient.qichacha_category_codes;
        if (Array.isArray(parsed) && parsed.length > 0) {
          categoryCodes = parsed;
        }
      } catch (e) {
        console.warn(`[邮件发送] 解析企查查类别编码失败: ${e.message}`);
      }
    }
    
    console.log(`[邮件发送] 收件配置 ${recipientId} 使用${categoryCodes ? '自定义' : '默认'}企查查类别`);
    
    // 如果是每日发送，需要检查今天是否为工作日（排除节假日）
    if (recipient.send_frequency === 'daily') {
      const today = new Date();
      const isTodayWorkday = await isWorkdayForEmail(today);
      
      if (!isTodayWorkday) {
        const dateStr = formatDateOnly(today); // 使用北京时区格式化日期
        console.log(`[邮件发送] 收件管理配置 ${recipientId} 在 ${dateStr}（北京时区）为节假日，跳过发送`);
        return;
      }
    }
    
    // 获取用户可见的昨日舆情信息（传入收件管理配置，用于企查查类别过滤）
    let newsList = await getUserVisibleYesterdayNews(recipient.user_id, recipient);
    
    // 如果收件人ID是14004，额外添加涉及荣誉奖项关键词的企查查新闻
    if (recipientId === '14004') {
      console.log(`[邮件发送] 收件人ID为14004，额外添加荣誉奖项关键词的企查查新闻（基于创建时间）`);
      const { from, to } = await getEmailTimeRange();
      
      // 查询包含荣誉奖项关键词的企查查新闻（仅按创建时间筛选）
      const honorAwardNews = await db.query(
        `SELECT DISTINCT nd.id, nd.title, nd.enterprise_full_name, nd.news_sentiment, nd.keywords, 
                nd.news_abstract, nd.summary, nd.content, nd.public_time, nd.account_name, nd.wechat_account, nd.source_url, nd.created_at,
                nd.APItype, nd.news_category
         FROM news_detail nd
         WHERE nd.APItype = '企查查'
         AND (
           -- 类别为荣誉奖项（14004对应的中文类别）
           nd.news_category = '荣誉奖项'
           OR
           -- 或者关键词中包含荣誉奖项相关关键词（JSON格式或普通文本）
           (
             nd.keywords LIKE '%"荣誉"%'
             OR nd.keywords LIKE '%"奖项"%'
             OR nd.keywords LIKE '%"获奖"%'
             OR nd.keywords LIKE '%"榜单"%'
             OR nd.keywords LIKE '%荣誉%'
             OR nd.keywords LIKE '%奖项%'
             OR nd.keywords LIKE '%获奖%'
             OR nd.keywords LIKE '%榜单%'
             OR nd.title LIKE '%荣誉%'
             OR nd.title LIKE '%奖项%'
             OR nd.title LIKE '%获奖%'
             OR nd.title LIKE '%榜单%'
             OR nd.summary LIKE '%荣誉%'
             OR nd.summary LIKE '%奖项%'
             OR nd.summary LIKE '%获奖%'
             OR nd.summary LIKE '%榜单%'
             OR nd.news_abstract LIKE '%荣誉%'
             OR nd.news_abstract LIKE '%奖项%'
             OR nd.news_abstract LIKE '%获奖%'
             OR nd.news_abstract LIKE '%榜单%'
           )
         )
         AND nd.created_at >= ? 
         AND nd.created_at < ?
         AND nd.delete_mark = 0
         -- 过滤掉摘要和正文都为空的数据
         AND (
           (nd.news_abstract IS NOT NULL AND nd.news_abstract != '')
           OR (nd.summary IS NOT NULL AND nd.summary != '')
           OR (nd.content IS NOT NULL AND nd.content != '')
         )
         ORDER BY nd.public_time DESC`,
        [from, to]
      );
      
      console.log(`[邮件发送] 查询到 ${honorAwardNews.length} 条荣誉奖项相关的企查查新闻（基于创建时间）`);
      
      // 合并新闻列表，去重（根据id）
      const existingIds = new Set(newsList.map(n => n.id));
      const additionalNews = honorAwardNews.filter(n => !existingIds.has(n.id));
      
      if (additionalNews.length > 0) {
        console.log(`[邮件发送] 添加 ${additionalNews.length} 条荣誉奖项新闻到推送列表`);
        newsList = [...newsList, ...additionalNews];
      } else {
        console.log(`[邮件发送] 荣誉奖项新闻已包含在现有列表中，无需额外添加`);
      }
    }
    
    // 即使没有数据，也发送邮件通知用户
    if (newsList.length === 0) {
      console.log(`用户 ${recipient.user_id} 今天没有获取到可见的舆情信息，将发送空数据通知邮件`);
    }
    
    // ========== 邮件发送前AI重新分析 ==========
    logWithTimestamp(`[邮件发送] ========== 检查是否需要AI重新分析 ==========`);
    logWithTimestamp(`[邮件发送] 当前新闻数量: ${newsList.length}`);
    if (newsList.length > 0) {
      // 检查当前新闻列表的 entity_type 分布（重新分析前）
      const beforeReanalyzeStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        beforeReanalyzeStats[et] = (beforeReanalyzeStats[et] || 0) + 1;
      });
      logWithTimestamp(`[邮件发送] 重新分析前的 entity_type 分布:`, JSON.stringify(beforeReanalyzeStats, null, 2));
      
      logWithTimestamp(`[邮件发送] ========== 开始AI重新分析 ==========`);
      logWithTimestamp(`[邮件发送] 需要重新分析的新闻数量: ${newsList.length}`);
      
      const newsAnalysis = require('./newsAnalysis');
      
      let reanalyzeSuccessCount = 0;
      let reanalyzeErrorCount = 0;
      
      // 导入AI分析缓存工具
      const aiAnalysisCache = require('./aiAnalysisCache');
      
      // 批量重新分析新闻
      let skippedCount = 0;
      for (const news of newsList) {
        try {
          // 检查是否在20分钟内已分析过
          if (aiAnalysisCache.isRecentlyAnalyzed(news.id)) {
            skippedCount++;
            logWithTimestamp(`[邮件发送] ⏭️ 新闻 ${news.id} 在20分钟内已分析过，跳过重新分析`);
            continue;
          }
          
          logWithTimestamp(`[邮件发送] 正在重新分析新闻 ${news.id}: ${news.title?.substring(0, 50)}`);
          
          // 获取完整的新闻数据（包括content）
          const fullNewsItems = await db.query(
            'SELECT id, title, content, source_url, enterprise_full_name, wechat_account, account_name, news_abstract, news_sentiment, keywords, APItype FROM news_detail WHERE id = ?',
            [news.id]
          );
          
          if (fullNewsItems.length === 0) {
            logWithTimestamp(`[邮件发送] ⚠️ 新闻 ${news.id} 不存在，跳过重新分析`);
            continue;
          }
          
          const newsItem = fullNewsItems[0];
          
          // 根据是否有企业关联选择不同的处理方式
          let reanalyzeResult;
          if (newsItem.enterprise_full_name) {
            // 有企业关联，使用processNewsWithEnterprise（会保护来自invested_enterprises的企业关联）
            logWithTimestamp(`[邮件发送] 新闻 ${news.id} 有企业关联，使用processNewsWithEnterprise`);
            reanalyzeResult = await newsAnalysis.processNewsWithEnterprise(newsItem);
          } else {
            // 无企业关联，使用processNewsWithoutEnterprise
            logWithTimestamp(`[邮件发送] 新闻 ${news.id} 无企业关联，使用processNewsWithoutEnterprise`);
            reanalyzeResult = await newsAnalysis.processNewsWithoutEnterprise(newsItem);
          }
          
          if (reanalyzeResult) {
            reanalyzeSuccessCount++;
            // 记录分析时间戳到缓存
            aiAnalysisCache.recordAnalysis(news.id);
            logWithTimestamp(`[邮件发送] ✓ 新闻 ${news.id} 重新分析成功`);
          } else {
            reanalyzeErrorCount++;
            logWithTimestamp(`[邮件发送] ✗ 新闻 ${news.id} 重新分析失败`);
          }
          
          // 添加延迟避免API频率限制
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          reanalyzeErrorCount++;
          errorWithTimestamp(`[邮件发送] ✗ 新闻 ${news.id} 重新分析出错: ${error.message}`);
        }
      }
      
      if (skippedCount > 0) {
        logWithTimestamp(`[邮件发送] ⏭️ 跳过 ${skippedCount} 条在20分钟内已分析过的新闻`);
      }
      
      logWithTimestamp(`[邮件发送] AI重新分析完成: 成功 ${reanalyzeSuccessCount} 条, 失败 ${reanalyzeErrorCount} 条, 跳过 ${skippedCount || 0} 条`);
      logWithTimestamp(`[邮件发送] ========== AI重新分析结束 ==========`);
      
      // 重新分析完成后，从数据库重新获取最新的新闻数据（包含entity_type）
      logWithTimestamp(`[邮件发送] 从数据库重新获取最新的新闻数据...`);
      const newsIds = newsList.map(n => n.id);
      if (newsIds.length > 0) {
        // 先测试查询一条新闻，确认 entity_type 是否有值
        const testNewsId = newsIds[0];
        const testQuery = await db.query(
          `SELECT id, entity_type, enterprise_full_name 
           FROM news_detail 
           WHERE id = ?`,
          [testNewsId]
        );
        if (testQuery.length > 0) {
          logWithTimestamp(`[邮件发送] 测试查询新闻 ${testNewsId}: entity_type="${testQuery[0].entity_type || '(NULL)'}" (类型: ${typeof testQuery[0].entity_type})`);
        }
        
        const placeholders = newsIds.map(() => '?').join(',');
        const refreshedNewsList = await db.query(
          `SELECT DISTINCT nd.id, nd.title, nd.enterprise_full_name, nd.news_sentiment, nd.keywords, 
                  nd.news_abstract, nd.summary, nd.content, nd.public_time, nd.account_name, nd.wechat_account, nd.source_url, nd.created_at,
                  nd.APItype, nd.news_category, nd.entity_type, 
                  nd.fund, nd.sub_fund
           FROM news_detail nd
           WHERE nd.id IN (${placeholders})
           AND nd.delete_mark = 0`,
          newsIds
        );
        
        logWithTimestamp(`[邮件发送] 重新获取到 ${refreshedNewsList.length} 条新闻数据`);
        
        // 检查重新获取的数据是否包含fund和sub_fund字段
        if (refreshedNewsList.length > 0) {
          const firstRefreshed = refreshedNewsList[0];
          logWithTimestamp(`[邮件发送] ========== 检查重新获取的数据 ==========`);
          logWithTimestamp(`[邮件发送] 重新获取的第一条新闻ID: ${firstRefreshed.id}`);
          logWithTimestamp(`[邮件发送] 重新获取的第一条新闻字段:`, Object.keys(firstRefreshed).join(', '));
          logWithTimestamp(`[邮件发送] 重新获取的第一条新闻包含fund字段: ${'fund' in firstRefreshed}, 包含sub_fund字段: ${'sub_fund' in firstRefreshed}`);
          
          // 直接查询数据库验证
          const testQuery = await db.query(
            `SELECT id, fund, sub_fund FROM news_detail WHERE id = ?`,
            [firstRefreshed.id]
          );
          if (testQuery.length > 0) {
            logWithTimestamp(`[邮件发送] 数据库直接查询，ID=${firstRefreshed.id}, fund="${testQuery[0].fund || '(NULL)'}", sub_fund="${testQuery[0].sub_fund || '(NULL)'}"`);
          }
          
          if ('fund' in firstRefreshed) {
            logWithTimestamp(`[邮件发送] 重新获取的第一条新闻fund值: "${firstRefreshed.fund || '(NULL)'}"`);
          }
          if ('sub_fund' in firstRefreshed) {
            logWithTimestamp(`[邮件发送] 重新获取的第一条新闻sub_fund值: "${firstRefreshed.sub_fund || '(NULL)'}"`);
          }
          
          // 如果缺少字段，手动补充
          if (!('fund' in firstRefreshed)) {
            logWithTimestamp(`[邮件发送] ⚠️ 重新获取的数据缺少fund和sub_fund字段，手动补充...`);
            const fundData = await db.query(
              `SELECT id, fund, sub_fund FROM news_detail WHERE id IN (${placeholders})`,
              newsIds
            );
            
            const fundMap = {};
            fundData.forEach(item => {
              fundMap[item.id] = {
                fund: item.fund || null,
                sub_fund: item.sub_fund || null
              };
            });
            
            refreshedNewsList.forEach(news => {
              if (fundMap[news.id]) {
                news.fund = fundMap[news.id].fund;
                news.sub_fund = fundMap[news.id].sub_fund;
              } else {
                news.fund = null;
                news.sub_fund = null;
              }
            });
            
            logWithTimestamp(`[邮件发送] ✓ 已手动补充fund和sub_fund字段`);
          }
          logWithTimestamp(`[邮件发送] ========== 检查结束 ==========`);
        }
        
        // 记录entity_type信息（用于调试）
        if (refreshedNewsList.length > 0) {
          const entityTypeStats = {};
          refreshedNewsList.forEach(n => {
            const et = n.entity_type || '(NULL)';
            entityTypeStats[et] = (entityTypeStats[et] || 0) + 1;
          });
          logWithTimestamp(`[邮件发送] 重新获取的新闻entity_type统计:`, JSON.stringify(entityTypeStats, null, 2));
          
          // 显示前5条新闻的详细信息
          refreshedNewsList.slice(0, 5).forEach((n, index) => {
            logWithTimestamp(`[邮件发送] 重新获取的新闻 ${index + 1}: ID=${n.id}, entity_type="${n.entity_type || '(NULL)'}" (类型: ${typeof n.entity_type}), enterprise="${n.enterprise_full_name?.substring(0, 30)}"`);
            // 检查对象是否包含 entity_type 属性
            logWithTimestamp(`[邮件发送]   对象属性检查: hasOwnProperty('entity_type')=${n.hasOwnProperty('entity_type')}, 'entity_type' in n=${'entity_type' in n}`);
          });
        }
        
        // 重要：更新 newsList 引用
        logWithTimestamp(`[邮件发送] 更新 newsList 引用，从 ${newsList.length} 条更新为 ${refreshedNewsList.length} 条`);
        newsList = refreshedNewsList;
        
        // 验证更新后的 newsList
        if (newsList.length > 0) {
          const afterUpdateStats = {};
          newsList.forEach(n => {
            const et = n.entity_type || '(NULL)';
            afterUpdateStats[et] = (afterUpdateStats[et] || 0) + 1;
          });
          logWithTimestamp(`[邮件发送] 更新后的 newsList entity_type 分布:`, JSON.stringify(afterUpdateStats, null, 2));
        }
      }
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
    
    // 过滤新闻：根据收件配置的企查查类别编码进行过滤
    logWithTimestamp(`[邮件发送] ========== AI重新分析后，重新应用企查查类别过滤 ==========`);
    logWithTimestamp(`[邮件发送] 重新分析后的新闻数量: ${newsList.length}`);
    
    // 检查过滤前的 entity_type 分布
    if (newsList.length > 0) {
      const beforeCategoryFilterStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        beforeCategoryFilterStats[et] = (beforeCategoryFilterStats[et] || 0) + 1;
      });
      logWithTimestamp(`[邮件发送] 类别过滤前的 entity_type 分布:`, JSON.stringify(beforeCategoryFilterStats, null, 2));
    }
    if (newsList.length > 0) {
      logWithTimestamp(`[邮件发送] 重新分析后的新闻类别详情（前5条）:`, newsList.slice(0, 5).map(n => ({
        id: n.id,
        title: n.title?.substring(0, 30),
        APItype: n.APItype || '(NULL)',
        news_category: n.news_category || '(NULL)',
        enterprise_full_name: n.enterprise_full_name || '(NULL)'
      })));
    }
    // 检查过滤前的 newsList 的 entity_type 分布
    if (newsList.length > 0) {
      const beforeFilterStats = {};
      newsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        beforeFilterStats[et] = (beforeFilterStats[et] || 0) + 1;
      });
      logWithTimestamp(`[邮件发送] filterNewsByCategory 过滤前的 entity_type 分布:`, JSON.stringify(beforeFilterStats, null, 2));
      
      // 检查第一条新闻的详细信息
      const firstNews = newsList[0];
      logWithTimestamp(`[邮件发送] filterNewsByCategory 过滤前的第一条新闻: ID=${firstNews.id}, entity_type="${firstNews.entity_type || '(NULL)'}" (类型: ${typeof firstNews.entity_type}), hasOwnProperty=${firstNews.hasOwnProperty('entity_type')}`);
    }
    
    const filteredNewsList = filterNewsByCategory(newsList, categoryCodes);
    logWithTimestamp(`[邮件发送] 企查查类别过滤后: ${filteredNewsList.length} 条新闻`);
    
    // 检查过滤后的 filteredNewsList 的 entity_type 分布
    if (filteredNewsList.length > 0) {
      const afterFilterStats = {};
      filteredNewsList.forEach(n => {
        const et = n.entity_type || '(NULL)';
        afterFilterStats[et] = (afterFilterStats[et] || 0) + 1;
      });
      logWithTimestamp(`[邮件发送] filterNewsByCategory 过滤后的 entity_type 分布:`, JSON.stringify(afterFilterStats, null, 2));
      
      // 检查第一条新闻的详细信息
      const firstNews = filteredNewsList[0];
      logWithTimestamp(`[邮件发送] filterNewsByCategory 过滤后的第一条新闻: ID=${firstNews.id}, entity_type="${firstNews.entity_type || '(NULL)'}" (类型: ${typeof firstNews.entity_type}), hasOwnProperty=${firstNews.hasOwnProperty('entity_type')}`);
    }
    if (filteredNewsList.length < newsList.length) {
      const filteredOut = newsList.filter(n => {
        const isQichacha = n.APItype === '企查查' || n.APItype === 'qichacha';
        if (!isQichacha) return false; // 非企查查新闻不会被类别过滤过滤掉
        const categoryCode = n.news_category ? String(n.news_category).trim() : '';
        const isInFiltered = filteredNewsList.some(fn => fn.id === n.id);
        return !isInFiltered;
      });
      if (filteredOut.length > 0) {
        logWithTimestamp(`[邮件发送] ⚠️ 被类别过滤过滤掉的企查查新闻（${filteredOut.length}条）:`, filteredOut.map(n => ({
          id: n.id,
          title: n.title?.substring(0, 50),
          news_category: n.news_category || '(NULL)',
          enterprise_full_name: n.enterprise_full_name || '(NULL)'
        })));
      }
    }
    
    // 预先获取所有额外公众号的ID列表（用于后续过滤判断）
    let additionalAccountIdsSet = new Set();
    try {
      const additionalAccounts = await db.query(
        `SELECT DISTINCT wechat_account_id 
         FROM additional_wechat_accounts 
         WHERE status = 'active' 
         AND wechat_account_id IS NOT NULL 
         AND wechat_account_id != ''
         AND delete_mark = 0`
      );
      additionalAccounts.forEach(acc => {
        if (acc.wechat_account_id) {
          additionalAccountIdsSet.add(acc.wechat_account_id);
        }
      });
      logWithTimestamp(`[邮件发送] 预先获取额外公众号ID列表，共 ${additionalAccountIdsSet.size} 个`);
    } catch (err) {
      warnWithTimestamp(`[邮件发送] 获取额外公众号列表失败: ${err.message}`);
    }
    
    // 重新应用最终过滤逻辑（过滤掉不满足发送邮件条件的数据）
    logWithTimestamp(`[邮件发送] ========== 重新应用最终过滤逻辑 ==========`);
    logWithTimestamp(`[邮件发送] AI重新分析后新闻数: ${newsList.length}, 企查查类别过滤后: ${filteredNewsList.length}`);
    
    // 使用finalNewsList的过滤逻辑再次过滤
    const beforeFinalFilterCount = filteredNewsList.length;
    const finalFilteredNewsList = filteredNewsList.filter(news => {
      // 检查标题（标题是必需的）
      if (!news.title || news.title.trim() === '') {
        return false;
      }
      
      // 检查企业全称（额外公众号的新闻可能没有企业名称）
      const enterpriseName = news.enterprise_full_name;
      const hasEnterpriseName = enterpriseName && enterpriseName.trim() !== '';
      
      // 对于没有企业名称的新闻，检查是否是额外公众号的新闻
      if (!hasEnterpriseName) {
        const isAdditionalAccountNews = news.wechat_account && additionalAccountIdsSet.has(news.wechat_account);
        if (!isAdditionalAccountNews) {
          // 非额外公众号的新闻，企业全称是必需的
          return false;
        }
      }
      
      // 检查 news_abstract 字段（AI提取的摘要）
      const hasAbstract = news.news_abstract && news.news_abstract.trim() !== '';
      // 检查 summary 字段（原始摘要，新榜数据使用此字段）
      const hasSummary = news.summary && news.summary.trim() !== '';
      // 检查 content 字段（正文）
      const hasContent = news.content && news.content.trim() !== '';
      
      // 判断数据源类型
      const isQichacha = news.APItype === '企查查' || news.APItype === 'qichacha';
      const isXinbang = news.APItype === '新榜' || !news.APItype || (!isQichacha);
      
      if (isXinbang) {
        // 新榜新闻：只要有摘要（news_abstract 或 summary）即可推送
        return hasAbstract || hasSummary;
      } else {
        // 企查查新闻：有摘要（news_abstract）或正文即可推送
        return hasAbstract || hasContent;
      }
    });
    
    const afterFinalFilterCount = finalFilteredNewsList.length;
    const finalFilteredCount = beforeFinalFilterCount - afterFinalFilterCount;
    if (finalFilteredCount > 0) {
      logWithTimestamp(`[邮件发送] 最终过滤掉 ${finalFilteredCount} 条不满足发送邮件条件的数据，剩余 ${afterFinalFilterCount} 条`);
    }
    logWithTimestamp(`[邮件发送] ========== 最终过滤完成 ==========`);
    
    // 检查最终过滤后的新闻列表的 entity_type 分布（用于调试）
    logWithTimestamp(`[邮件发送] ========== 最终过滤后的新闻 entity_type 分布 ==========`);
    const entityTypeDistribution = {};
    finalFilteredNewsList.forEach(news => {
      const et = news.entity_type || '(NULL)';
      entityTypeDistribution[et] = (entityTypeDistribution[et] || 0) + 1;
    });
    logWithTimestamp(`[邮件发送] entity_type 分布:`, JSON.stringify(entityTypeDistribution, null, 2));
    
    // 显示前5条新闻的 entity_type 信息
    finalFilteredNewsList.slice(0, 5).forEach((news, index) => {
      logWithTimestamp(`[邮件发送] 新闻 ${index + 1}: ID=${news.id}, entity_type="${news.entity_type || '(NULL)'}", enterprise="${news.enterprise_full_name?.substring(0, 30)}"`);
    });
    logWithTimestamp(`[邮件发送] ========== entity_type 分布检查结束 ==========`);

    // 按企业做标题/摘要语义相似度去重：同一企业内若存在相似度>=50%的新闻，只保留按 title、account_name、wechat_account 倒序的第一条
    let newsListToSend = finalFilteredNewsList;
    if (finalFilteredNewsList.length > 1) {
      logWithTimestamp(`[邮件发送] ========== 开始语义相似度去重 ==========`);
      newsListToSend = await deduplicateNewsBySemanticSimilarity(finalFilteredNewsList, '[邮件发送]');
      logWithTimestamp(`[邮件发送] ========== 语义相似度去重结束，将发送 ${newsListToSend.length} 条 ==========`);
    }
    
    // 发送邮件（包含Excel附件），使用最终过滤并去重后的新闻列表
    await sendNewsEmailWithExcel(recipient, emailConfig, newsListToSend);
    
    console.log(`✓ 邮件发送任务完成: 收件管理配置 ${recipientId}`);
  } catch (error) {
    console.error(`✗ 邮件发送任务失败: 收件管理配置 ${recipientId}`, error);
  }
}

/**
 * 根据发送频率和时间生成cron表达式
 */
/**
 * 将7字段的Quartz Cron表达式转换为6字段的node-cron表达式
 * Quartz格式: 秒 分 时 日 月 周 年
 * node-cron格式: 分 时 日 月 周
 * Quartz周: 1=Sunday, 2=Monday, ..., 7=Saturday
 * node-cron周: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
function convertQuartzCronToNodeCron(quartzCron) {
  if (!quartzCron || typeof quartzCron !== 'string') {
    return null;
  }
  
  const parts = quartzCron.trim().split(/\s+/);
  
  // 如果是6字段，直接返回
  if (parts.length === 6) {
    return quartzCron.trim();
  }
  
  // 如果是7字段，转换为6字段
  if (parts.length === 7) {
    // 提取: 秒 分 时 日 月 周 年 -> 分 时 日 月 周
    const [second, minute, hour, day, month, weekday, year] = parts;
    
    // 转换日期字段：将 ? 转换为 *（node-cron不支持?）
    let convertedDay = day === '?' ? '*' : day;
    
    // 转换星期字段：Quartz (1-7) -> node-cron (0-6)
    // 同时将 ? 转换为 *（node-cron不支持?）
    let convertedWeekday = weekday;
    if (weekday === '?') {
      convertedWeekday = '*';
    } else if (weekday && weekday !== '*') {
      // 处理逗号分隔的值，如 "2,3,4,5,6"
      if (weekday.includes(',')) {
        convertedWeekday = weekday.split(',').map(w => {
          const wNum = parseInt(w.trim());
          if (wNum >= 1 && wNum <= 7) {
            // Quartz: 1=Sunday -> node-cron: 0=Sunday
            // Quartz: 2=Monday -> node-cron: 1=Monday
            return (wNum - 1).toString();
          }
          return w.trim();
        }).join(',');
      } else {
        // 单个值
        const wNum = parseInt(weekday);
        if (wNum >= 1 && wNum <= 7) {
          convertedWeekday = (wNum - 1).toString();
        }
      }
    }
    
    // 构建6字段cron表达式: 分 时 日 月 周
    return `${minute} ${hour} ${convertedDay} ${month} ${convertedWeekday}`;
  }
  
  return null;
}

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
        let cronExpression = null;
        let cronSource = '';
        
        // 优先使用 cron_expression 字段
        if (recipient.cron_expression && recipient.cron_expression.trim()) {
          // 将7字段的Quartz Cron转换为6字段的node-cron
          cronExpression = convertQuartzCronToNodeCron(recipient.cron_expression);
          cronSource = 'cron_expression';
          
          if (!cronExpression) {
            console.warn(`收件管理配置 ${recipient.id} 的 cron_expression 格式无效: ${recipient.cron_expression}`);
            // 如果转换失败，尝试使用旧的字段
            if (recipient.send_frequency && recipient.send_time) {
              cronExpression = generateCronExpression(recipient.send_frequency, recipient.send_time);
              cronSource = 'send_frequency/send_time (fallback)';
            }
          }
        } else if (recipient.send_frequency && recipient.send_time) {
          // 向后兼容：使用旧的 send_frequency 和 send_time
          cronExpression = generateCronExpression(recipient.send_frequency, recipient.send_time);
          cronSource = 'send_frequency/send_time';
        }
        
        if (!cronExpression) {
          console.error(`收件管理配置 ${recipient.id} 没有有效的定时任务配置`);
          continue;
        }
        
        console.log(`为收件管理配置 ${recipient.id} 创建定时任务: ${cronExpression} (来源: ${cronSource})`);
        console.log(`  - 原始配置: cron_expression=${recipient.cron_expression || '(空)'}, send_frequency=${recipient.send_frequency || '(空)'}, send_time=${recipient.send_time || '(空)'}`);
        
        // 验证cron表达式
        if (!cron.validate(cronExpression)) {
          console.error(`收件管理配置 ${recipient.id} 的 cron 表达式无效: ${cronExpression}`);
          continue;
        }
        
        const task = cron.schedule(cronExpression, async () => {
          console.log(`[定时任务] 执行收件管理配置 ${recipient.id} 的邮件发送任务`);
          await executeEmailTask(recipient.id);
        }, {
          scheduled: true,
          timezone: 'Asia/Shanghai'
        });
        
        scheduledTasks.set(recipient.id, task);
        console.log(`✓ 收件管理配置 ${recipient.id} 的定时任务已创建并启动`);
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
  isWorkdayDate,
  filterNewsByCategory,
  deduplicateNewsBySemanticSimilarity
};


