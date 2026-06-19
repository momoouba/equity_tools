const { spawnSync } = require('child_process');
const path = require('path');

function runOverseasFilingDiscoverSync(opts = {}) {
  const logTag = opts.logTag || '[境外备案-CSRC发现]';
  const script = path.join(__dirname, 'overseas_filing_discover.py');
  const py = process.env.PYTHON || 'python';
  const r = spawnSync(py, [script], {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (r.error) {
    return { ok: false, stderr: String(r.error.message || 'spawn error') };
  }
  const line = String(r.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .pop();
  let payload = null;
  try {
    payload = line ? JSON.parse(line) : null;
  } catch (e) {
    console.error(`${logTag} JSON 解析失败`, line);
    return { ok: false, stderr: `parse discover payload failed: ${e.message}` };
  }
  if (!payload || !payload.ok || !String(payload.excelUrl || '').trim()) {
    const err = (payload && payload.error) || String(r.stderr || '').trim() || '未发现 Excel';
    console.error(`${logTag} 失败 exit=${r.status}`, err);
    return { ok: false, exitCode: r.status, stderr: err };
  }
  return {
    ok: true,
    excelUrl: String(payload.excelUrl).trim(),
    detailUrl: String(payload.detailUrl || '').trim(),
    title: String(payload.title || '').trim(),
  };
}

module.exports = { runOverseasFilingDiscoverSync };
