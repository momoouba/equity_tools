const { spawnSync } = require('child_process');
const path = require('path');

function runNewShareAkSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const hkRecentDays = Number(opts.hkRecentDays || 0);
  const issueAfter = String(opts.issueDateAfterExclusive || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[打新日历-AkShare]';
  if (!startDate || !endDate) {
    return { ok: false, skipped: true, stderr: 'date invalid' };
  }

  const script = path.join(__dirname, 'new_share_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [script, '--start-date', startDate, '--end-date', endDate];
  if (issueAfter) {
    args.push('--issue-date-after', issueAfter);
  }
  if (hkRecentDays > 0) {
    args.push('--hk-recent-days', String(hkRecentDays));
  }
  const r = spawnSync(py, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (r.error) {
    return { ok: false, stderr: String(r.error.message || 'spawn error') };
  }
  const code = r.status;
  const stderr = String(r.stderr || '').trim();
  const stdout = String(r.stdout || '').trim();
  if (code !== 0) {
    console.error(`${logTag} 执行失败 exit=${code}`, stderr || stdout);
    return { ok: false, exitCode: code, stderr: stderr || stdout };
  }
  let summary = null;
  try {
    const line = stdout.split('\n').filter(Boolean).pop();
    if (line) summary = JSON.parse(line);
  } catch (e) {
    return { ok: false, stderr: `parse json failed: ${e.message}` };
  }
  if (!summary || !Array.isArray(summary.rows)) {
    return { ok: false, stderr: 'akshare output invalid' };
  }
  console.log(`${logTag} 抓取完成 sourceRows=${summary.sourceRows || 0} builtRows=${summary.builtRows || 0}`);
  return { ok: true, summary, rows: summary.rows };
}

module.exports = { runNewShareAkSync };

