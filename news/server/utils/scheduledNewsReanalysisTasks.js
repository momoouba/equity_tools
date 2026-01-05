const cron = require('node-cron');
const db = require('../db');
const newsAnalysis = require('./newsAnalysis');

// 存储定时任务
let scheduledTask = null;

/**
 * 查询摘要为空的新闻
 * @param {number} limit - 每次处理的记录数
 * @returns {Promise<Array>} - 新闻列表
 */
async function getNewsWithEmptyAbstract(limit = 50) {
  try {
    // 查询条件：摘要为空或null，有正文内容，未被删除
    const newsList = await db.query(
      `SELECT id, title, content, source_url, enterprise_full_name,
              wechat_account, account_name, APItype, news_abstract, keywords
       FROM news_detail
       WHERE (news_abstract IS NULL OR news_abstract = '')
       AND content IS NOT NULL
       AND content != ''
       AND LENGTH(content) > 20
       AND delete_mark = 0
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit]
    );

    return newsList;
  } catch (error) {
    console.error('[空摘要重新分析定时任务] 查询空摘要新闻失败:', error);
    throw error;
  }
}

/**
 * 执行空摘要新闻的重新分析
 * @param {number} batchSize - 每批处理的记录数
 */
async function executeEmptyAbstractReanalysis(batchSize = 50) {
  try {
    console.log(`\n========== [空摘要重新分析定时任务] 开始执行 ==========`);
    const startTime = new Date();

    // 查询需要分析的新闻
    const newsList = await getNewsWithEmptyAbstract(batchSize);
    
    if (newsList.length === 0) {
      console.log('[空摘要重新分析定时任务] 没有找到摘要为空的新闻');
      return {
        total: 0,
        processed: 0,
        successCount: 0,
        errorCount: 0
      };
    }

    console.log(`[空摘要重新分析定时任务] 找到 ${newsList.length} 条摘要为空的新闻，开始重新分析...`);

    // 确保新闻分析模块已初始化
    if (!newsAnalysis.aiConfig) {
      await newsAnalysis.initialize();
    }

    let successCount = 0;
    let errorCount = 0;
    const processedNews = [];

    // 分批处理新闻
    for (let i = 0; i < newsList.length; i++) {
      const news = newsList[i];
      try {
        console.log(`[空摘要重新分析定时任务] 处理第 ${i + 1}/${newsList.length} 条: ID=${news.id}, 标题=${news.title?.substring(0, 50)}`);

        // 检查是否是额外公众号
        let isAdditionalAccount = false;
        if (news.wechat_account) {
          try {
            const additionalResult = await db.query(
              `SELECT id FROM additional_wechat_accounts 
               WHERE wechat_account_id = ? 
               AND status = 'active' 
               AND delete_mark = 0`,
              [news.wechat_account]
            );
            isAdditionalAccount = additionalResult.length > 0;
          } catch (err) {
            console.warn(`[空摘要重新分析定时任务] 检查额外公众号失败: ${err.message}`);
          }
        }

        // 检查内容是否被污染（乱码）
        const isContentDirty = news.content && newsAnalysis.isContentContaminated(news.content);
        if (isContentDirty) {
          console.log(`[空摘要重新分析定时任务] 新闻 ${news.id} 内容被污染，跳过分析`);
          errorCount++;
          continue;
        }

        const interfaceType = news.APItype || '新榜';

        // 如果有企业全称，使用 processNewsWithEnterprise
        // 如果没有企业全称，使用 processNewsWithoutEnterprise
        let analysisResult;
        if (news.enterprise_full_name) {
          analysisResult = await newsAnalysis.processNewsWithEnterprise({
            id: news.id,
            title: news.title || '',
            content: news.content || '',
            source_url: news.source_url || '',
            enterprise_full_name: news.enterprise_full_name,
            wechat_account: news.wechat_account || '',
            account_name: news.account_name || '',
            APItype: interfaceType
          });
        } else {
          analysisResult = await newsAnalysis.processNewsWithoutEnterprise({
            id: news.id,
            title: news.title || '',
            content: news.content || '',
            source_url: news.source_url || '',
            wechat_account: news.wechat_account || '',
            account_name: news.account_name || '',
            APItype: interfaceType
          }, isAdditionalAccount);
        }

        // 检查分析结果是否成功
        if (analysisResult && analysisResult.success) {
          // 验证分析结果中是否有摘要
          const updatedNews = await db.query(
            'SELECT news_abstract FROM news_detail WHERE id = ?',
            [news.id]
          );

          if (updatedNews.length > 0 && updatedNews[0].news_abstract) {
            console.log(`[空摘要重新分析定时任务] ✓ 新闻 ${news.id} 分析成功，已生成摘要`);
            successCount++;
            processedNews.push({
              id: news.id,
              title: news.title,
              status: 'success'
            });
          } else {
            console.log(`[空摘要重新分析定时任务] ⚠️ 新闻 ${news.id} 分析完成但摘要仍为空`);
            errorCount++;
            processedNews.push({
              id: news.id,
              title: news.title,
              status: 'warning'
            });
          }
        } else {
          console.error(`[空摘要重新分析定时任务] ✗ 新闻 ${news.id} 分析失败`);
          errorCount++;
          processedNews.push({
            id: news.id,
            title: news.title,
            status: 'error'
          });
        }

        // 添加延迟，避免API调用过于频繁
        if (i < newsList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // 延迟1秒
        }

      } catch (error) {
        console.error(`[空摘要重新分析定时任务] ✗ 处理新闻 ${news.id} 时出错:`, error.message);
        errorCount++;
        processedNews.push({
          id: news.id,
          title: news.title,
          status: 'error',
          error: error.message
        });
      }
    }

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n========== [空摘要重新分析定时任务] 执行完成 ==========`);
    console.log(`[空摘要重新分析定时任务] 总计: ${newsList.length} 条`);
    console.log(`[空摘要重新分析定时任务] 成功: ${successCount} 条`);
    console.log(`[空摘要重新分析定时任务] 失败: ${errorCount} 条`);
    console.log(`[空摘要重新分析定时任务] 耗时: ${duration} 秒`);

    return {
      total: newsList.length,
      processed: newsList.length,
      successCount,
      errorCount,
      duration: parseFloat(duration),
      processedNews: processedNews.slice(0, 20) // 只返回前20条详情
    };

  } catch (error) {
    console.error('[空摘要重新分析定时任务] 执行失败:', error);
    throw error;
  }
}

/**
 * 初始化定时任务（从数据库读取配置）
 */
async function initializeScheduledTaskFromConfig() {
  try {
    const db = require('../db');
    
    // 从system_config表读取配置
    const configs = await db.query(
      'SELECT config_key, config_value FROM system_config WHERE config_key IN (?, ?)',
      ['ai_reanalysis_cron', 'ai_reanalysis_active']
    );

    let cronExpression = '0 2 * * *'; // 默认每天凌晨2点
    let isActive = true; // 默认启用

    for (const config of configs) {
      if (config.config_key === 'ai_reanalysis_cron') {
        cronExpression = config.config_value || '0 2 * * *';
      } else if (config.config_key === 'ai_reanalysis_active') {
        isActive = config.config_value === '1' || config.config_value === 'true';
      }
    }

    if (isActive) {
      initializeScheduledTask(cronExpression);
    } else {
      console.log('[空摘要重新分析定时任务] 配置为禁用状态，不启动定时任务');
    }
  } catch (error) {
    console.error('[空摘要重新分析定时任务] 从配置初始化失败:', error);
    // 如果读取配置失败，使用默认配置
    initializeScheduledTask('0 2 * * *');
  }
}

/**
 * 初始化定时任务
 * @param {string} cronExpression - Cron表达式，默认为每天凌晨2点执行
 */
function initializeScheduledTask(cronExpression = '0 2 * * *') {
  try {
    // 如果已有任务，先停止
    if (scheduledTask) {
      scheduledTask.destroy();
      scheduledTask = null;
    }

    // 验证cron表达式
    if (!cron.validate(cronExpression)) {
      console.error(`[空摘要重新分析定时任务] 无效的cron表达式: ${cronExpression}`);
      return;
    }

    // 解析cron表达式为可读的时间描述
    let timeDesc = '';
    try {
      const parts = cronExpression.trim().split(/\s+/);
      if (parts.length >= 2 && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
        const hours = parseInt(parts[1]);
        const minutes = parseInt(parts[0]);
        timeDesc = `每天${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      } else {
        timeDesc = cronExpression;
      }
    } catch (e) {
      timeDesc = cronExpression;
    }

    console.log(`[空摘要重新分析定时任务] 创建定时任务，Cron表达式: ${cronExpression} (${timeDesc})`);

    // 创建定时任务
    scheduledTask = cron.schedule(cronExpression, async () => {
      try {
        console.log(`[空摘要重新分析定时任务] 定时任务触发，开始执行...`);
        await executeEmptyAbstractReanalysis(50); // 每次处理50条
      } catch (error) {
        console.error('[空摘要重新分析定时任务] 定时任务执行失败:', error);
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    console.log('[空摘要重新分析定时任务] ✓ 定时任务已创建并启动');

  } catch (error) {
    console.error('[空摘要重新分析定时任务] 初始化定时任务失败:', error);
    throw error;
  }
}

/**
 * 停止定时任务
 */
function stopScheduledTask() {
  if (scheduledTask) {
    scheduledTask.destroy();
    scheduledTask = null;
    console.log('[空摘要重新分析定时任务] 定时任务已停止');
  }
}

module.exports = {
  initializeScheduledTask,
  initializeScheduledTaskFromConfig,
  stopScheduledTask,
  executeEmptyAbstractReanalysis,
  getNewsWithEmptyAbstract
};

