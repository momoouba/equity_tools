const { syncFinancingDateRange } = require('./financingIngestService');

/**
 * 定时任务：前一日 + 当日（Asia/Shanghai）
 */
async function runFinancingScheduledSync(configId) {
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
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const startDate = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(
    yest.getDate()
  ).padStart(2, '0')}`;
  return syncFinancingDateRange(
    configId,
    { startDate, endDate: todayStr },
    { executionType: 'scheduled', userId: null }
  );
}

module.exports = { runFinancingScheduledSync };
