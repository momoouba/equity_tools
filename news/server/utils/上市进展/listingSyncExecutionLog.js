const db = require('../../db');

/** 兼容 VARCHAR 较短或 TEXT 64KB 上限，避免整页 HTML 写入失败 */
function truncateExecutionLogMessage(msg, maxBytes = 12000) {
  const s = String(msg ?? '');
  if (!s) return null;
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return `${buf.subarray(0, maxBytes).toString('utf8')}\n…(已截断，共 ${buf.length} 字节)`;
}

async function createExecutionLog(payload = {}) {
  const sql = `INSERT INTO listing_sync_execution_log
    (config_id, config_name, task_key, source_type, trigger_type, window_start, window_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const args = [
    payload.configId || null,
    payload.configName || null,
    payload.taskKey || null,
    payload.sourceType || null,
    payload.triggerType || 'manual',
    payload.windowStart || null,
    payload.windowEnd || null,
    payload.status || 'running',
  ];
  const ret = await db.execute(sql, args);
  const insertedId = ret.insertId;
  if (insertedId) {
    await appendExecutionLogProgress(insertedId, `任务创建 source=${payload.sourceType || '-'} trigger=${payload.triggerType || 'manual'}`);
  }
  return insertedId;
}

async function appendExecutionLogProgress(logId, message, options = {}) {
  if (!logId || !message) return;
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] ${String(message)}`;
  const maxBytes = Math.max(4000, Math.min(200000, Number(options.maxBytes || 120000)));
  const rows = await db.query(`SELECT progress_log FROM listing_sync_execution_log WHERE id = ? LIMIT 1`, [logId]);
  const oldLog = String(rows[0]?.progress_log || '');
  const next = oldLog ? `${oldLog}\n${line}` : line;
  const truncated = truncateExecutionLogMessage(next, maxBytes);
  await db.execute(
    `UPDATE listing_sync_execution_log
        SET progress_log = ?, heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = ?`,
    [truncated, logId]
  );
}

async function finishExecutionLog(logId, payload = {}) {
  if (!logId) return;
  await db.execute(
    `UPDATE listing_sync_execution_log
        SET retry_count = ?,
            dedup_hits = ?,
            inserted_count = ?,
            updated_count = ?,
            skipped_count = ?,
            status = ?,
            error_message = ?,
            heartbeat_at = NOW(),
            finished_at = NOW()
      WHERE id = ?`,
    [
      Number(payload.retryCount || 0),
      Number(payload.dedupHits || 0),
      Number(payload.insertedCount || 0),
      Number(payload.updatedCount || 0),
      Number(payload.skippedCount || 0),
      payload.status || 'success',
      truncateExecutionLogMessage(payload.errorMessage),
      logId,
    ]
  );
}

module.exports = {
  createExecutionLog,
  appendExecutionLogProgress,
  finishExecutionLog,
};

