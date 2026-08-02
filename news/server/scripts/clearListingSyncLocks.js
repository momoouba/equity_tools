/**
 * 清理上市进展同步僵尸锁 / stuck running 日志（进程被杀后残留）。
 * 用法（在 news 目录）: node server/scripts/clearListingSyncLocks.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const db = require('../db');

(async () => {
  await db.ready;
  const locks = await db.query('SELECT task_key, F_CreatorTime FROM listing_sync_task_lock');
  console.log('locks before', locks);
  const runs = await db.query(
    `SELECT F_Id, task_key, status, started_at, heartbeat_at
     FROM listing_sync_execution_log WHERE status='running' ORDER BY F_Id DESC LIMIT 20`
  );
  console.log('running before', runs);
  const del = await db.execute('DELETE FROM listing_sync_task_lock');
  console.log('deleted locks', del?.affectedRows);
  const upd = await db.execute(
    `UPDATE listing_sync_execution_log
        SET status='failed',
            error_message=CONCAT(
              COALESCE(NULLIF(error_message, ''), ''),
              CASE WHEN COALESCE(error_message, '') = '' THEN '' ELSE ' | ' END,
              '进程中断/手动清锁'
            ),
            finished_at=NOW(),
            heartbeat_at=NOW()
      WHERE status='running'`
  );
  console.log('closed running logs', upd?.affectedRows);
  console.log('OK — 可重新点同步');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
