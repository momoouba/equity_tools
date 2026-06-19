const { spawnSync } = require('child_process');
const path = require('path');

function ifindIpoSpawnTimeoutMs() {
  const n = parseInt(process.env.IFIND_IPO_SYNC_TIMEOUT_MS || '600000', 10);
  return Number.isFinite(n) && n >= 5000 ? n : 600000;
}

/**
 * 调用 ifind_ipo_fetch.py：THS_iFinD 抓取港股上市申请并返回标准化 rows（不直接写库）。
 * 支持两种认证方式：
 * - Windows：用户名 + 密码（有本地 iFinD 客户端）
 * - Linux：Token（无 GUI 环境）
 * @param {{
 *   startDate: string,
 *   endDate: string,
 *   username?: string,
 *   password?: string,
 *   token?: string,
 *   drCode?: string,
 *   queryParams?: string,
 *   fields?: string,
 *   format?: string,
 *   logTag?: string,
 * }} opts
 * @returns {{ ok: boolean, skipped?: boolean, exitCode?: number, stderr?: string, summary?: object, rows?: any[] }}
 */
function runIfindIpoSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[港交所iFinD]';
  const username = String(opts.username || '').trim();
  const password = String(opts.password || '').trim();
  const token = String(opts.token || '').trim();

  if (!startDate || !endDate) {
    console.warn(`${logTag} 跳过：日期无效`);
    return { ok: false, skipped: true };
  }
  if (!username && !password && !token) {
    console.warn(`${logTag} 跳过：未配置 iFinD 凭证（需要用户名密码或 token）`);
    return { ok: false, skipped: true };
  }

  const script = path.join(__dirname, 'ifind_ipo_fetch.py');
  const py = process.env.PYTHON || 'python';
  const args = [
    script,
    '--start-date',
    startDate,
    '--end-date',
    endDate,
    '--username',
    username,
    '--password',
    password,
    '--token',
    token,
    '--dr-code',
    String(opts.drCode || 'p04920').trim() || 'p04920',
    '--query-params',
    String(opts.queryParams || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0').trim() || 'iv_sfss=0;iv_sqlx=0;iv_sqzt=0',
    '--fields',
    String(
      opts.fields ||
        'p04920_f001:Y,p04920_f002:Y,p04920_f003:Y,p04920_f004:Y,p04920_f005:Y,p04920_f006:Y,p04920_f037:Y,p04920_f007:Y,p04920_f008:Y,p04920_f021:Y,p04920_f022:Y'
    ).trim(),
    '--format',
    String(opts.format || 'json').trim() || 'json',
  ];

  const timeoutMs = ifindIpoSpawnTimeoutMs();
  console.log(
    `${logTag} 启动 ifind_ipo_fetch.py 区间=${startDate}~${endDate}（spawn 最长 ${timeoutMs}ms，可调 IFIND_IPO_SYNC_TIMEOUT_MS）`
  );
  const r = spawnSync(py, args, {
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });

  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') {
      console.error(
        `${logTag} 子进程超时 ${timeoutMs}ms（iFinD 客户端无响应或 THS 过慢；可调 IFIND_IPO_SYNC_TIMEOUT_MS 或暂时关闭 ifind_enabled）`
      );
      return { ok: false, stderr: `ETIMEDOUT ${timeoutMs}ms` };
    }
    return { ok: false, stderr: String(r.error.message || 'spawn error') };
  }
  const stderr = (r.stderr || '').trim();
  const stdout = (r.stdout || '').trim();
  const code = r.status;
  if (code !== 0) {
    console.error(`${logTag} 执行失败 exit=${code}`, stderr || stdout);
    return { ok: false, exitCode: code, stderr: stderr || stdout };
  }

  let summary = null;
  try {
    const line = stdout.split('\n').filter(Boolean).pop();
    if (line) summary = JSON.parse(line);
  } catch (e) {
    console.warn(`${logTag} 无法解析 JSON:`, e.message);
  }
  if (!summary) {
    return { ok: false, stderr: 'ifind output empty' };
  }
  const sourceRows = Number(summary.sourceRows || 0);
  const builtRows = Number(summary.builtRows || 0);
  console.log(`${logTag} 拉取完成 源表行数=${sourceRows} 生成待写=${builtRows}`);
  return {
    ok: true,
    summary,
    rows: Array.isArray(summary.rows) ? summary.rows : [],
  };
}

module.exports = { runIfindIpoSync };
