/**
 * 业绩看板应用 - 定时任务配置路由
 * 路径前缀：/api/performance/scheduled-tasks
 */
const express = require('express');
const router = express.Router();
const db = require('../../db');
const { generateId } = require('../../utils/idGenerator');
const { getCurrentUser } = require('../../middleware/auth');

router.use(getCurrentUser);

// 统一使用中国上海时间（UTC+8）
function getShanghaiNow() {
  const now = new Date();
  const shanghaiOffsetMinutes = -8 * 60; // UTC+8
  const localOffsetMinutes = now.getTimezoneOffset();
  const diffMs = (localOffsetMinutes - shanghaiOffsetMinutes) * 60 * 1000;
  return new Date(now.getTime() + diffMs);
}

// 获取业绩看板定时任务列表
router.get('/', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, task_name, app_name, interface_type, request_url,
              cron_expression, is_active, retry_count, retry_interval,
              last_run_at, last_run_status, remark, created_at, updated_at
       FROM performance_scheduled
       ORDER BY created_at DESC`
    );

    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('获取业绩看板定时任务失败:', error);
    res.status(500).json({ success: false, message: '获取定时任务失败' });
  }
});

// 新增业绩看板定时任务
router.post('/', async (req, res) => {
  try {
    const {
      app_name,
      interface_type,
      request_url,
      cron_expression,
      is_active = true,
      retry_count = 0,
      retry_interval = 0,
      remark = ''
    } = req.body;

    if (!app_name || !interface_type || !request_url || !cron_expression) {
      return res.status(400).json({ success: false, message: '应用名称、接口类型、请求URL和Cron表达式不能为空' });
    }

    const id = await generateId('performance_scheduled');
    const taskName = `${app_name}-${interface_type}`;

    await db.execute(
      `INSERT INTO performance_scheduled
       (id, task_name, app_name, interface_type, request_url,
        cron_expression, is_active, retry_count, retry_interval, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        taskName,
        app_name,
        interface_type,
        request_url,
        cron_expression,
        is_active ? 1 : 0,
        retry_count || 0,
        retry_interval || 0,
        remark || ''
      ]
    );

    res.json({ success: true, data: { id } });
  } catch (error) {
    console.error('新增业绩看板定时任务失败:', error);
    res.status(500).json({ success: false, message: '新增定时任务失败' });
  }
});

// 更新业绩看板定时任务
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      app_name,
      interface_type,
      request_url,
      cron_expression,
      is_active = true,
      retry_count = 0,
      retry_interval = 0,
      remark = ''
    } = req.body;

    if (!app_name || !interface_type || !request_url || !cron_expression) {
      return res.status(400).json({ success: false, message: '应用名称、接口类型、请求URL和Cron表达式不能为空' });
    }

    const taskName = `${app_name}-${interface_type}`;

    await db.execute(
      `UPDATE performance_scheduled
       SET task_name = ?, app_name = ?, interface_type = ?, request_url = ?,
           cron_expression = ?, is_active = ?, retry_count = ?, retry_interval = ?, remark = ?
       WHERE id = ?`,
      [
        taskName,
        app_name,
        interface_type,
        request_url,
        cron_expression,
        is_active ? 1 : 0,
        retry_count || 0,
        retry_interval || 0,
        remark || '',
        id
      ]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('更新业绩看板定时任务失败:', error);
    res.status(500).json({ success: false, message: '更新定时任务失败' });
  }
});

// 删除业绩看板定时任务
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.execute('DELETE FROM performance_scheduled WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    console.error('删除业绩看板定时任务失败:', error);
    res.status(500).json({ success: false, message: '删除定时任务失败' });
  }
});

// 立即执行：根据接口类型触发实际业务逻辑（目前实现数据生成占位逻辑）
router.post('/:id/run', async (req, res) => {
  try {
    const { id } = req.params;

    const tasks = await db.query(
      `SELECT id, app_name, interface_type, request_url
       FROM performance_scheduled
       WHERE id = ?`,
      [id]
    );
    if (!tasks || tasks.length === 0) {
      return res.status(404).json({ success: false, message: '定时任务不存在' });
    }
    const task = tasks[0];

    let status = 'success';
    let message = '执行成功';

    // 根据接口类型触发逻辑
    // 计算当前时间所在月份的最后一天，作为生成版本的日期（基于上海时间）
    const now = getShanghaiNow();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const y = lastDay.getFullYear();
    const m = String(lastDay.getMonth() + 1).padStart(2, '0');
    const d = String(lastDay.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;

    if (task.interface_type === '数据生成' || task.interface_type === '数据清理') {
      try {
        // 若为“数据清理”，先按需求文档中的规则删除最新版本数据
        if (task.interface_type === '数据清理') {
          // 1) 查询 b_version 中最大日期的最大版本号（形如 YYYYMMDDVn）
          const versionRows = await db.query(
            `SELECT version
             FROM (
               SELECT
                 version,
                 CAST(SUBSTRING(version, 1, 8) AS UNSIGNED) AS date_num,
                 CAST(SUBSTRING(version, INSTR(version, 'V') + 1) AS UNSIGNED) AS version_num
               FROM b_version
               WHERE version REGEXP '^[0-9]{8}V[0-9]+$'
             ) t
             ORDER BY date_num DESC, version_num DESC
             LIMIT 1`
          );

          if (versionRows && versionRows.length > 0) {
            const targetVersion = versionRows[0].version;

            // 2) 查询该版本的创建人和创建时间
            const metaRows = await db.query(
              `SELECT F_CreatorUserId, F_CreatorTime
               FROM b_version
               WHERE version = ?`,
              [targetVersion]
            );

            if (metaRows && metaRows.length > 0) {
              const creatorId = metaRows[0].F_CreatorUserId;
              const creatorTime = metaRows[0].F_CreatorTime;

              let deleteFlag = false;
              if (!creatorId && creatorTime) {
                const day = new Date(creatorTime).getDate();
                if (day !== 1 && day !== 4) {
                  deleteFlag = true;
                }
              }

              if (deleteFlag) {
                // 3) 按存储过程定义的表清理该版本的所有数据（物理删除）
                const tables = [
                  'b_version',
                  'b_investment_indicator',
                  'b_investment_sum',
                  'b_investor_list',
                  'b_manage_indicator',
                  'b_project_all',
                  'b_transaction_indicator',
                  'b_all_indicator',
                  'b_investment',
                  'b_ipo',
                  'b_manage',
                  'b_project',
                  'b_transaction',
                  'b_project_a',
                  'b_region_a',
                  'b_region',
                  'b_ipo_a'
                ];

                for (const table of tables) {
                  await db.execute(
                    `DELETE FROM \`${table}\` WHERE version = ?`,
                    [targetVersion]
                  );
                }

                console.log(
                  `已删除版本：${targetVersion}（原因：创建人ID为空且创建时间不是1日或4日）`
                );
              } else {
                console.log(
                  `版本 ${targetVersion} 满足保留条件，未删除（F_CreatorUserId: ${
                    creatorId || 'NULL'
                  }, F_CreatorTime: ${creatorTime || 'NULL'}）`
                );
              }
            }
          } else {
            console.log('未查询到符合格式的版本数据，无需删除');
          }
        }

        const axios = require('axios');
        // 与主服务 index.js 保持一致：PORT 默认为 3001
        const port = process.env.PORT || 3001;
        await axios.post(
          `http://127.0.0.1:${port}/api/performance/versions`,
          { date: dateStr, months: [dateStr] },
          {
            headers: {
              // 透传鉴权信息，便于 getCurrentUser 识别触发用户
              cookie: req.headers.cookie || '',
              authorization: req.headers.authorization || ''
            },
            timeout: 1000 * 60 * 10 // 最长10分钟
          }
        );
      } catch (e) {
        console.error(
          task.interface_type === '数据清理'
            ? '定时任务触发数据清理+生成失败:'
            : '定时任务触发数据生成失败:',
          e
        );
        status = 'failed';
        message = `执行失败: ${e.message || e.toString()}`;
      }
    } else {
      // 其他类型暂时只记录一次成功调用占位
      status = 'success';
      message = '已触发执行（当前为占位实现）';
    }

    // 记录最后执行时间与状态
    await db.execute(
      `UPDATE performance_scheduled
       SET last_run_at = NOW(), last_run_status = ?
       WHERE id = ?`,
      [status, id]
    );

    res.json({ success: status === 'success', message });
  } catch (error) {
    console.error('立即执行业绩看板定时任务失败:', error);
    res.status(500).json({ success: false, message: '触发执行失败' });
  }
});

module.exports = router;

