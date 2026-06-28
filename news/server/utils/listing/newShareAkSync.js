const { spawnSync } = require('child_process');
const path = require('path');

function runNewShareAkSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const hkRecentDays = Number(opts.hkRecentDays || 0);
  const issueAfter = String(opts.issueDateAfterExclusive || '').trim().slice(0, 10);
  const updateAfter = String(opts.updateDateAfterExclusive || '').trim().slice(0, 10);
  const listingDateLookbackDays = Math.max(0, Number(opts.listingDateLookbackDays || 0));
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
  if (updateAfter) {
    args.push('--update-date-after', updateAfter);
  }
  if (listingDateLookbackDays > 0) {
    args.push('--listing-date-lookback-days', String(listingDateLookbackDays));
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

function runIpoApplyBackfillByCode(stockCode, logTag) {
  const code = String(stockCode || '').trim();
  if (!code) return { ok: false, row: null, stderr: 'code empty' };
  const script = path.join(__dirname, 'new_share_fetch.py');
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, [script, '--backfill-code', code], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error) return { ok: false, row: null, stderr: String(r.error.message || r.error) };
  const stdout = String(r.stdout || '').trim();
  const stderr = String(r.stderr || '').trim();
  if (r.status !== 0) {
    console.warn(`${logTag || '[打新日历-补全]'} 东财单条补抓失败 code=${code}`, stderr || stdout);
    return { ok: false, row: null, stderr: stderr || stdout };
  }
  try {
    const line = stdout.split('\n').filter(Boolean).pop();
    const payload = JSON.parse(line);
    return { ok: Boolean(payload.ok && payload.row), row: payload.row || null, stderr: payload.ok ? '' : 'row empty' };
  } catch (e) {
    return { ok: false, row: null, stderr: `parse failed: ${e.message}` };
  }
}

function runHkIssueTotalWanFetch(stockCode, logTag) {
  const code = String(stockCode || '').trim().padStart(5, '0');
  if (!code || code === '00000') return { ok: false, wan: null, stderr: 'code empty' };
  const script = path.join(__dirname, 'etnet_hk_fetch.py');
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, [script, 'ipo-detail', '--code', code], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (r.error) return { ok: false, wan: null, stderr: String(r.error.message || r.error) };
  const stdout = String(r.stdout || '').trim();
  const stderr = String(r.stderr || '').trim();
  if (r.status !== 0) {
    console.warn(`${logTag || '[打新日历-补全]'} 港股详情补抓失败 code=${code}`, stderr || stdout);
    return { ok: false, wan: null, stderr: stderr || stdout };
  }
  try {
    const line = stdout.split('\n').filter(Boolean).pop();
    const payload = JSON.parse(line);
    const wan = payload.issueTotalWan != null ? Number(payload.issueTotalWan) : null;
    return {
      ok: Number.isFinite(wan) && wan > 0,
      wan: Number.isFinite(wan) && wan > 0 ? wan : null,
      stderr: payload.ok ? '' : String(payload.message || 'wan empty'),
    };
  } catch (e) {
    return { ok: false, wan: null, stderr: `parse failed: ${e.message}` };
  }
}

module.exports = { runNewShareAkSync, runIpoApplyBackfillByCode, runHkIssueTotalWanFetch };

