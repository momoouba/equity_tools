const { syncFinancingDateRange } = require('./financingIngestService');
const db = require('../../db');

let _scheduledSyncRunning = false;

/**
 * 定时任务：从 last_sync_date 次日到当日（Asia/Shanghai），填补停机缺口。
 */
async function runFinancingScheduledSync(configId) {
  if (_scheduledSyncRunning) {
    throw new Error('投融资定时同步任务正在执行中，跳过本次触发');
  }
  _scheduledSyncRunning = true;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year').value;
    const m = parts.find((p) => p.type === 'month').value;
    const d = parts.find((p) => p.type === 'day').value;
    const todayStr = `${y}-${m}-${d}`;
    const today = new Date(`${todayStr}T12:00:00+08:00`);

    // 尝试读取上次成功同步日期，用于回填停机缺口
    let startDate = null;
    if (configId) {
      try {
        const cfgRows = await db.query(
          `SELECT last_sync_date FROM news_interface_config WHERE F_Id = ? LIMIT 1`,
          [configId]
        );
        if (cfgRows.length && cfgRows[0].last_sync_date) {
          const lastDate = new Date(`${String(cfgRows[0].last_sync_date).slice(0, 10)}T12:00:00+08:00`);
          if (!Number.isNaN(lastDate.getTime())) {
            const next = new Date(lastDate);
            next.setDate(next.getDate() + 1);
            startDate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
          }
        }
      } catch {
        /* 读取失败则回退到昨天 */
      }
    }

    if (!startDate) {
      const yest = new Date(today);
      yest.setDate(yest.getDate() - 1);
      startDate = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
    }

    return await syncFinancingDateRange(
      configId,
      { startDate, endDate: todayStr },
      { executionType: 'scheduled', userId: null }
    );
  } finally {
    _scheduledSyncRunning = false;
  }
}

module.exports = { runFinancingScheduledSync };
