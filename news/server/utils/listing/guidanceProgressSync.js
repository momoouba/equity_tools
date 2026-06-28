const { spawnSync } = require('child_process');
const path = require('path');

const MAX_STDERR_CHARS = 4000;

function capErr(s) {
  const t = String(s || '').trim();
  if (t.length <= MAX_STDERR_CHARS) return t;
  return `${t.slice(0, MAX_STDERR_CHARS)}\n…(stderr 已截断)`;
}

function runGuidanceProgressSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[辅导备案抓取]';
  const source = String(opts.source || 'html').trim().toLowerCase();
  const sourceUrl = String(opts.sourceUrl || '').trim();
  if (!startDate || !endDate) {
    return { ok: false, skipped: true, stderr: 'date invalid' };
  }
  const script = path.join(__dirname, 'guidance_progress_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [script, '--start-date', startDate, '--end-date', endDate, '--source', source];
  if (sourceUrl) args.push('--url', sourceUrl);
  const r = spawnSync(py, args, {
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (r.error) return { ok: false, stderr: String(r.error.message || 'spawn error') };
  if (r.status !== 0) {
    const rawErr = String(r.stderr || r.stdout || '').trim();
    let friendly = rawErr;
    if (rawErr.includes('No tables found')) {
      friendly = '未在证监会页面解析到表格，请检查页面结构或切换为 CSV 数据源';
    } else if (rawErr.includes('HTTP Error 403')) {
      friendly = '证监会页面拒绝访问(403)，请检查网络出口策略或页面地址';
    } else if (rawErr.includes('SSLError') || rawErr.includes('TLSV1_ALERT_INTERNAL_ERROR')) {
      friendly = '证监会页面 SSL 握手失败，请检查代理/网络策略后重试';
    } else if (rawErr.includes('ProxyError')) {
      friendly = '证监会页面代理连接失败，请检查代理配置后重试';
    }
    console.error(`${logTag} 执行失败 exit=${r.status}`, capErr(friendly));
    return { ok: false, exitCode: r.status, stderr: capErr(friendly) };
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

module.exports = { runGuidanceProgressSync };

