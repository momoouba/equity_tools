const { spawnSync } = require('child_process');
const path = require('path');

function runOverseasFilingSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[境外备案抓取]';
  const source = String(opts.source || 'url').trim().toLowerCase();
  const sourceUrl = String(opts.sourceUrl || '').trim();
  const sourceFile = String(opts.sourceFile || '').trim();
  if (!startDate || !endDate) return { ok: false, skipped: true, stderr: 'date invalid' };
  const script = path.join(__dirname, 'overseas_filing_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [script, '--start-date', startDate, '--end-date', endDate, '--source', source];
  if (sourceUrl) args.push('--url', sourceUrl);
  if (sourceFile) args.push('--file', sourceFile);
  const r = spawnSync(py, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error) return { ok: false, stderr: String(r.error.message || 'spawn error') };
  if (r.status !== 0) {
    const raw = String(r.stderr || r.stdout || '').trim();
    const friendly = raw.includes('source=url')
      ? '未配置境外备案线上数据源：请在「上市数据配置」中 request_url 填写证监会政府信息公开门户地址（HTML）或 Excel/CSV 直链；门户页将自动解析/Playwright 抓取。需安装: pip install playwright pandas openpyxl && playwright install chromium'
      : raw.includes('source=file')
        ? '未配置境外备案本地文件源，请设置 OVERSEAS_FILING_FILE_PATH'
        : raw;
    console.error(`${logTag} 执行失败 exit=${r.status}`, friendly);
    return { ok: false, exitCode: r.status, stderr: friendly };
  }
  try {
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    const payload = line ? JSON.parse(line) : null;
    if (!payload || !Array.isArray(payload.rows)) return { ok: false, stderr: 'invalid payload' };
    return { ok: true, summary: payload, rows: payload.rows };
  } catch (e) {
    return { ok: false, stderr: `parse payload failed: ${e.message}` };
  }
}

module.exports = { runOverseasFilingSync };

