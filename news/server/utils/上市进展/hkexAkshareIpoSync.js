const { spawnSync } = require('child_process');
const path = require('path');

/**
 * 调用 hk_ipo_sync.py：港交所 IPO 申请（AKShare 或 CSV）→ ipo_progress
 * Python 在 akshare 无 hk_ipo_application 时会自动回退港交所「新上市信息」网页；仅当禁用回退且无 CSV 时退出码 2。
 *
 * @param {{ startDate: string, endDate: string, logTag?: string }} opts
 * @returns {{ ok: boolean, skipped?: boolean, exitCode?: number, stderr?: string, summary?: object }}
 */
function runHkexAkshareIpoSync(opts) {
  const startDate = String(opts.startDate || '').trim().slice(0, 10);
  const endDate = String(opts.endDate || '').trim().slice(0, 10);
  const logTag = opts.logTag || '[港交所IPO]';
  if (!startDate || !endDate) {
    console.warn(`${logTag} 跳过：日期无效`);
    return { ok: false, skipped: true };
  }

  const script = path.join(__dirname, 'hk_ipo_sync.py');
  const py = process.env.PYTHON || 'python';
  const src = (process.env.HK_IPO_SOURCE || '').trim().toLowerCase();
  const args = [script, '--start-date', startDate, '--end-date', endDate];
  if (src === 'hkex-web' || src === 'hkex' || src === 'web') {
    args.push('--source', 'hkex-web');
  }
  const r = spawnSync(py, args, {
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (r.error) {
    console.warn(`${logTag} 未执行（可能未安装 Python）:`, r.error.message);
    return { ok: false, skipped: true, stderr: String(r.error.message || '') };
  }

  const stderr = (r.stderr || '').trim();
  const stdout = (r.stdout || '').trim();
  const code = r.status;

  if (code === 2) {
    console.warn(
      `${logTag} 未写入：无港交所数据源（未配置 CSV、akshare 无 hk_ipo_application，且已设置 HK_IPO_DISABLE_HKEX_FALLBACK 禁止网页回退）。${stderr ? ` ${stderr}` : ''}`
    );
    return { ok: true, skipped: true, exitCode: 2, stderr };
  }

  if (code !== 0) {
    console.error(`${logTag} 执行失败 exit=${code}`, stderr || stdout);
    return { ok: false, exitCode: code, stderr: stderr || stdout };
  }

  let summary = null;
  try {
    const line = stdout.split('\n').filter(Boolean).pop();
    if (line) summary = JSON.parse(line);
  } catch (e) {
    console.warn(`${logTag} 无法解析 Python 输出 JSON:`, e.message);
  }

  if (summary) {
    const ins = summary.inserted ?? 0;
    const ue = summary.updatedEarlier ?? 0;
    const sk = summary.skipped ?? 0;
    const rs = summary.resolvedSource ?? '-';
    console.log(
      `${logTag} 入库完成 数据源=${rs} 新增=${ins} 更正为更早快照=${ue} 跳过=${sk} 源表行数=${summary.sourceRows ?? '-'} 生成待写=${summary.builtRows ?? '-'}`
    );
    if (
      (summary.builtRows === 0 || summary.builtRows === '0') &&
      (summary.sourceRows ?? 0) > 0 &&
      Array.isArray(summary.noMatchSample) &&
      summary.noMatchSample.length
    ) {
      console.warn(
        `${logTag} 同步区间内未生成待写行（港交所数据按 PDF 链接路径日期与区间比对）。样例日期字段：`,
        JSON.stringify(summary.noMatchSample.slice(0, 3), null, 0)
      );
    }
  } else {
    console.log(`${logTag} 完成（无 JSON 摘要）`);
  }

  return { ok: true, summary, exitCode: code };
}

module.exports = { runHkexAkshareIpoSync };
