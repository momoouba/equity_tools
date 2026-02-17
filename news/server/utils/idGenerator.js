const db = require('../db');

/**
 * 生成年月日时分秒+5位自增序列的ID
 * 格式：YYYYMMDDHHmmss + 5位自增序列（例如：2025112015304500001）
 * @param {string} tableName - 表名
 * @returns {Promise<string>} 生成的ID
 */
async function generateId(tableName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  const prefix = `${year}${month}${day}${hours}${minutes}${seconds}`;
  
  // 查询当天该表的最大ID（使用字符串比较，因为ID是VARCHAR类型）
  const todayStart = `${year}${month}${day}00000000000`;
  const todayEnd = `${year}${month}${day}23595999999`;
  
  try {
    // 使用参数化查询防止SQL注入，但表名不能参数化，所以需要验证表名
    const validTableNames = [
      'applications', 'membership_levels', 'users', 'invested_enterprises',
      'company', 'system_config', 'data_change_log', 'news_interface_config', 'news_detail',
      'email_config', 'additional_wechat_accounts', 'ai_model_config', 'qichacha_config',
      'shanghai_international_group_config', 'qichacha_news_categories', 'recipient_management', 'email_logs', 'system_file_storage',
      'holiday_calendar', 'external_db_config', 'news_sync_execution_log', 'news_sync_detail_log',
      'ai_prompt_config', 'ai_prompt_change_log', 'news_share_links', 'interface_news_type_enabled'
    ];
    
    if (!validTableNames.includes(tableName)) {
      throw new Error(`无效的表名: ${tableName}`);
    }

    // 简化逻辑：直接查询表的最大ID，如果表不存在或为空，查询会返回空数组
    let result = [];
    try {
      // 使用超时机制，避免长时间等待
      const queryPromise = db.query(
        `SELECT id 
         FROM \`${tableName}\` 
         WHERE id >= ? AND id <= ?
         ORDER BY id DESC 
         LIMIT 1`,
        [todayStart, todayEnd]
      );
      
      // 设置5秒超时
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('查询超时')), 5000)
      );
      
      result = await Promise.race([queryPromise, timeoutPromise]);
    } catch (err) {
      // 如果查询失败（表不存在、查询超时等），使用初始序列号
      if (err.message === '查询超时' || err.code === 'ER_NO_SUCH_TABLE' || err.message.includes("doesn't exist")) {
        console.log(`  表 ${tableName} 查询失败或不存在，使用初始序列号`);
        result = [];
      } else {
        // 其他错误也使用初始序列号，但记录警告
        console.warn(`  查询表 ${tableName} 时出错，使用初始序列号:`, err.message);
        result = [];
      }
    }
    
    let sequence = 1;
    if (result.length > 0 && result[0].id) {
      const maxId = result[0].id.toString();
      // 检查是否是同一天同一秒的ID
      if (maxId.startsWith(prefix)) {
        // 提取最后5位序列号
        const lastSequence = parseInt(maxId.slice(-5), 10);
        if (lastSequence < 99999) {
          sequence = lastSequence + 1;
        } else {
          // 如果序列号已满，等待下一秒
          await new Promise(resolve => setTimeout(resolve, 1000));
          return generateId(tableName); // 递归调用，使用新的时间前缀
        }
      }
    }
    
    // 生成5位序列号
    const sequenceStr = String(sequence).padStart(5, '0');
    return `${prefix}${sequenceStr}`;
  } catch (error) {
    console.error(`生成ID失败（表：${tableName}）：`, error);
    // 如果查询失败，使用时间戳+随机数作为后备方案
    const random = Math.floor(Math.random() * 10000);
    return `${prefix}${String(random).padStart(5, '0')}`;
  }
}

module.exports = {
  generateId
};

