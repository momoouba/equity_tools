const { spawnSync } = require('child_process');
const path = require('path');

const MAX_SYNC_ATTEMPTS = 5;

/**
 * 证监会备案通知书列表 + 详情 HTML → JSON rows（与 overseas_filing_fetch 输出形状兼容）。
 */
function runOverseasFilingNoticeSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[境外备案-通知书HTML]';
  const listUrl = String(opts.listUrl || '').trim();
  if (!startDate || !endDate) return { ok: false, skipped: true, stderr: 'date invalid' };

  const script = path.join(__dirname, 'overseas_filing_notice_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [script, '--start-date', startDate, '--end-date', endDate];
  if (listUrl) args.push('--list-url', listUrl);

  const childEnv = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' };

  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
    const r = spawnSync(py, args, {
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (r.error) {
      lastErr = String(r.error.message || 'spawn error');
      console.warn(`${logTag} attempt ${attempt}/${MAX_SYNC_ATTEMPTS} ${lastErr}`);
      continue;
    }
    if (r.status !== 0) {
      lastErr = String(r.stderr || r.stdout || '').trim() || `exit ${r.status}`;
      console.warn(`${logTag} attempt ${attempt}/${MAX_SYNC_ATTEMPTS} exit=${r.status}`, lastErr.slice(0, 500));
      continue;
    }
    try {
      const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
      const payload = line ? JSON.parse(line) : null;
      if (!payload || !Array.isArray(payload.rows)) {
        lastErr = 'invalid payload';
        continue;
      }
      return { ok: true, summary: payload, rows: payload.rows };
    } catch (e) {
      lastErr = `parse payload failed: ${e.message}`;
      console.warn(`${logTag} attempt ${attempt}/${MAX_SYNC_ATTEMPTS}`, lastErr);
    }
  }
  return { ok: false, stderr: lastErr || '境外备案通知书抓取失败' };
}

module.exports = { runOverseasFilingNoticeSync, MAX_SYNC_ATTEMPTS };
