const db = require('../db');
const { generateId } = require('./idGenerator');

/**
 * 记录数据变更日志（统一日志表）
 * @param {string} tableName - 表名（'invested_enterprises' 或 'company'）
 * @param {number} recordId - 表数据的ID值
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {number} userId - 变更人ID
 */
async function logDataChange(tableName, recordId, oldData, newData, userId) {
  try {
    const changes = [];
    
    // 根据表名确定需要记录的字段
    let fields = [];
    if (tableName === 'invested_enterprises') {
      fields = [
        'project_abbreviation',
        'enterprise_full_name',
        'unified_credit_code',
        'wechat_official_account_id',
        'official_website',
        'exit_status'
      ];
    } else if (tableName === 'company') {
      fields = [
        'enterprise_abbreviation',
        'enterprise_full_name',
        'unified_credit_code',
        'wechat_official_account_id',
        'official_website'
      ];
    } else if (tableName === 'additional_wechat_accounts') {
      fields = [
        'account_name',
        'wechat_account_id',
        'status'
      ];
    } else if (tableName === 'email_config') {
      fields = [
        'app_id',
        'smtp_host',
        'smtp_port',
        'smtp_secure',
        'smtp_user',
        'from_email',
        'from_name',
        'pop_host',
        'pop_port',
        'pop_secure',
        'pop_user',
        'is_active'
      ];
    } else if (tableName === 'qichacha_config') {
      fields = [
        'app_id',
        'qichacha_app_key',
        'qichacha_daily_limit',
        'is_active'
      ];
    } else if (tableName === 'news_interface_config') {
      fields = [
        'app_id',
        'request_url',
        'content_type',
        'frequency_type',
        'frequency_value',
        'is_active'
      ];
    } else if (tableName === 'recipient_management') {
      fields = [
        'user_id',
        'recipient_email',
        'email_subject',
        'send_frequency',
        'send_time',
        'is_active',
        'is_deleted',
        'deleted_at',
        'deleted_by'
      ];
    } else {
      console.warn(`未知的表名: ${tableName}`);
      return;
    }

    // 比较每个字段的变化
    for (const field of fields) {
      const oldValue = oldData[field] || '';
      const newValue = newData[field] || '';
      
      if (oldValue !== newValue) {
        changes.push({
          table_name: tableName,
          record_id: recordId,
          changed_field: field,
          old_value: oldValue,
          new_value: newValue,
          change_user_id: userId
        });
      }
    }

    // 批量插入日志
    if (changes.length > 0) {
      for (const change of changes) {
        const logId = await generateId('data_change_log');
        await db.execute(
          `INSERT INTO data_change_log 
           (id, table_name, record_id, changed_field, old_value, new_value, change_user_id) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            logId,
            change.table_name,
            change.record_id,
            change.changed_field,
            change.old_value || null,
            change.new_value || null,
            change.change_user_id || null
          ]
        );
      }
    }
  } catch (error) {
    console.error(`记录${tableName}表变更日志失败:`, error);
    // 日志记录失败不影响主流程
  }
}

/**
 * 记录被投企业变更日志（兼容旧接口）
 * @param {number} enterpriseId - 被投企业ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {number} userId - 变更人ID
 */
async function logEnterpriseChange(enterpriseId, oldData, newData, userId) {
  return logDataChange('invested_enterprises', enterpriseId, oldData, newData, userId);
}

/**
 * 记录企业变更日志（兼容旧接口）
 * @param {number} companyId - 企业ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {number} userId - 变更人ID
 */
async function logCompanyChange(companyId, oldData, newData, userId) {
  return logDataChange('company', companyId, oldData, newData, userId);
}

/**
 * 记录额外公众号变更日志（兼容旧接口）
 * @param {string} accountId - 额外公众号ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {string} userId - 变更人ID
 */
async function logAdditionalAccountChange(accountId, oldData, newData, userId) {
  return logDataChange('additional_wechat_accounts', accountId, oldData, newData, userId);
}

/**
 * 记录邮件配置变更日志
 * @param {string} configId - 邮件配置ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {string} userId - 变更人ID
 */
async function logEmailConfigChange(configId, oldData, newData, userId) {
  return logDataChange('email_config', configId, oldData, newData, userId);
}

/**
 * 记录企查查配置变更日志
 * @param {string} configId - 企查查配置ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {string} userId - 变更人ID
 */
async function logQichachaConfigChange(configId, oldData, newData, userId) {
  return logDataChange('qichacha_config', configId, oldData, newData, userId);
}

/**
 * 记录新闻接口配置变更日志
 * @param {string} configId - 新闻接口配置ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {string} userId - 变更人ID
 */
async function logNewsConfigChange(configId, oldData, newData, userId) {
  return logDataChange('news_interface_config', configId, oldData, newData, userId);
}

/**
 * 记录收件管理变更日志
 * @param {string} recipientId - 收件管理ID
 * @param {object} oldData - 旧数据
 * @param {object} newData - 新数据
 * @param {string} userId - 变更人ID
 */
async function logRecipientChange(recipientId, oldData, newData, userId) {
  return logDataChange('recipient_management', recipientId, oldData, newData, userId);
}

module.exports = {
  logDataChange,
  logEnterpriseChange,
  logCompanyChange,
  logAdditionalAccountChange,
  logEmailConfigChange,
  logQichachaConfigChange,
  logNewsConfigChange,
  logRecipientChange
};

