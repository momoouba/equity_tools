const cron = require('node-cron');
const db = require('../db');
const { queryExternal, getExternalPool, createExternalPool } = require('./externalDb');
const enterpriseRoutes = require('../routes/enterprises');
const executeSyncTask = enterpriseRoutes.executeSyncTask;

// 存储所有定时任务
const scheduledTasks = new Map();

/**
 * 执行企业同步任务
 * @param {Object} task - 任务对象
 */
async function executeEnterpriseSyncTask(task) {
  try {
    console.log(`[企业同步任务] 开始执行任务: ${task.id} (${task.description || '无描述'})`);
    
    const result = await executeSyncTask(task.db_config_id, task.sql_query);
    
    // 更新任务执行记录
    await db.execute(
      `UPDATE enterprise_sync_task 
       SET last_execution_time = CURRENT_TIMESTAMP,
           last_execution_status = ?,
           last_execution_message = ?,
           execution_count = execution_count + 1
       WHERE id = ?`,
      ['success', result.message, task.id]
    );

    console.log(`[企业同步任务] 任务执行成功: ${task.id} - ${result.message}`);
    return result;
  } catch (error) {
    console.error(`[企业同步任务] 任务执行失败: ${task.id}`, error);
    
    // 更新任务执行记录为失败
    try {
      await db.execute(
        `UPDATE enterprise_sync_task 
         SET last_execution_time = CURRENT_TIMESTAMP,
             last_execution_status = ?,
             last_execution_message = ?,
             execution_count = execution_count + 1
         WHERE id = ?`,
        ['failed', error.message || '执行失败', task.id]
      );
    } catch (updateError) {
      console.error('更新任务执行记录失败：', updateError);
    }
    
    throw error;
  }
}

/**
 * 初始化企业同步定时任务
 */
async function initializeEnterpriseSyncTasks() {
  try {
    // 停止所有现有任务
    stopAllTasks();

    // 获取所有启用的任务
    const tasks = await db.query(
      `SELECT est.*, edc.name as db_name, edc.host, edc.port, edc.\`database\`
       FROM enterprise_sync_task est
       INNER JOIN external_db_config edc ON est.db_config_id = edc.id
       WHERE est.is_active = 1 AND edc.is_deleted = 0 AND edc.is_active = 1`
    );

    if (tasks.length === 0) {
      console.log('✓ 没有启用的企业同步定时任务');
      return;
    }

    // 为每个任务创建定时调度
    for (const task of tasks) {
      try {
        // 验证cron表达式
        if (!cron.validate(task.cron_expression)) {
          console.error(`✗ 无效的Cron表达式: ${task.cron_expression} (任务ID: ${task.id})`);
          continue;
        }

        // 创建定时任务
        const cronTask = cron.schedule(
          task.cron_expression,
          async () => {
            await executeEnterpriseSyncTask(task);
          },
          {
            scheduled: true,
            timezone: 'Asia/Shanghai'
          }
        );

        scheduledTasks.set(task.id, cronTask);
        console.log(`✓ 企业同步定时任务已启动: ${task.id} (${task.description || '无描述'}) - Cron: ${task.cron_expression}`);
      } catch (error) {
        console.error(`✗ 启动企业同步定时任务失败 (${task.id}):`, error.message);
      }
    }

    console.log(`✓ 企业同步定时任务初始化完成，共 ${scheduledTasks.size} 个任务`);
  } catch (error) {
    console.error('初始化企业同步定时任务失败:', error);
    throw error;
  }
}

/**
 * 停止所有定时任务
 */
function stopAllTasks() {
  for (const [taskId, cronTask] of scheduledTasks.entries()) {
    try {
      cronTask.stop();
      console.log(`✓ 已停止企业同步定时任务: ${taskId}`);
    } catch (error) {
      console.error(`停止企业同步定时任务失败 (${taskId}):`, error.message);
    }
  }
  scheduledTasks.clear();
}

/**
 * 停止指定任务
 * @param {string} taskId - 任务ID
 */
function stopTask(taskId) {
  const cronTask = scheduledTasks.get(taskId);
  if (cronTask) {
    try {
      cronTask.stop();
      scheduledTasks.delete(taskId);
      console.log(`✓ 已停止企业同步定时任务: ${taskId}`);
    } catch (error) {
      console.error(`停止企业同步定时任务失败 (${taskId}):`, error.message);
    }
  }
}

/**
 * 重新加载任务（用于任务更新后）
 */
async function reloadTasks() {
  stopAllTasks();
  await initializeEnterpriseSyncTasks();
}

module.exports = {
  initializeEnterpriseSyncTasks,
  executeEnterpriseSyncTask,
  stopAllTasks,
  stopTask,
  reloadTasks
};

