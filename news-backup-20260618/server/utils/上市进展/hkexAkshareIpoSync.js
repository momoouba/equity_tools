const { spawnSync } = require('child_process');
const path = require('path');

function hkIpoSpawnTimeoutMs() {
  const n = parseInt(process.env.HK_IPO_SYNC_TIMEOUT_MS || '300000', 10);
  return Number.isFinite(n) && n >= 5000 ? n : 300000;
}

/**
 * 调用 hk_ipo_sync.py：港交所 IPO → ipo_progress
 * 默认数据源为港交所官网（HK_IPO_SOURCE 未设或为 hkex-web）；可选 akshare。
 * AkShare 无 hk_ipo_application 时会回退官网；仅当禁用回退且无 CSV 时退出码 2。
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
  const timeoutMs = hkIpoSpawnTimeoutMs();
  console.log(
    `${logTag} 启动 hk_ipo_sync.py 区间=${startDate}~${endDate}（spawn 最长 ${timeoutMs}ms，可调 HK_IPO_SYNC_TIMEOUT_MS）`
  );
  const r = spawnSync(py, args, {
    env: { ...process.env },
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 25 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGTERM',
  });

  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') {
      console.error(
        `${logTag} 子进程超时 ${timeoutMs}ms（下载 xlsx / 解析 / 写库过慢；可增大 HK_IPO_SYNC_TIMEOUT_MS 或检查容器出网与 DB）`
      );
      return { ok: false, skipped: true, stderr: `ETIMEDOUT ${timeoutMs}ms` };
    }
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
      `${logTag} 入库完成 数据源=${rs} 新增=${ins} 同更新日补字段=${ue} 跳过=${sk} 源表行数=${summary.sourceRows ?? '-'} 生成待写=${summary.builtRows ?? '-'}`
    );

    const builtDetail = summary.builtRowsDetail;
    if (Array.isArray(builtDetail) && builtDetail.length > 0) {
      console.log(
        `${logTag} 区间内港股「生成待写」全量 ${builtDetail.length} 条（脚本根据日期区间构造的快照，可与库内比对）：`
      );
      builtDetail.forEach((row, idx) => {
        const c = row.company ?? '';
        const nm = row.project_name ? ` 简称=${row.project_name}` : '';
        const ev = row.event_kind ? ` 事件=${row.event_kind}` : '';
        console.log(
          `${logTag}   待写[${idx + 1}/${builtDetail.length}] 更新日=${row.f_update_time ?? '-'} | ${row.board ?? '-'} | ${row.status ?? '-'} | ${c}${nm} | 代码=${row.code || '-'}${ev}`
        );
      });
    }

    const rowOut = summary.writeRowOutcomes;
    if (Array.isArray(rowOut) && rowOut.length > 0) {
      console.log(`${logTag} 港股入库逐条结果（与上表顺序一致，按脚本处理顺序输出）：`);
      rowOut.forEach((o, idx) => {
        const row = o.row || {};
        const c = row.company ?? '';
        console.log(
          `${logTag}   结果[${idx + 1}/${rowOut.length}] action=${o.action} | 更新日=${row.f_update_time ?? '-'} | ${row.board ?? '-'} | ${row.status ?? '-'} | ${c}`
        );
      });
    }

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
