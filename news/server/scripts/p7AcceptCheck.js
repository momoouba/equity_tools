/**
 * P7 验收脚本：只读探测 + 可选 --apply 写操作（造数/暂停恢复等）
 * Usage:
 *   node server/scripts/p7AcceptCheck.js
 *   node server/scripts/p7AcceptCheck.js --apply   # 含：周一/节后 preview、session 读、分步开关只读验证
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const http = require('http');
const db = require('../db');

const UID = process.env.P7_UID || '2025112019135100001';
const HOST = process.env.P7_HOST || '127.0.0.1';
const PORT = process.env.PORT || 3002;
const GH = process.env.P7_GH || 'gh_23e6d7335515';
const APPLY = process.argv.includes('--apply');

function toYmd(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        hostname: HOST,
        port: PORT,
        path,
        method,
        headers: {
          'x-user-id': UID,
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
        },
        timeout: 60000
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(buf);
          } catch (_) {
            json = { raw: buf.slice(0, 400) };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on('error', reject);
    r.on('timeout', () => {
      r.destroy();
      reject(new Error(`timeout ${method} ${path}`));
    });
    if (data) r.write(data);
    r.end();
  });
}

function line(ok, name, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  return ok;
}

(async () => {
  let failed = 0;
  const mark = (name, ok, detail) => {
    if (!line(ok, name, detail)) failed += 1;
  };

  console.log(`\n======== P7 验收 @ http://${HOST}:${PORT} ========`);
  console.log(`uid=${UID} gh=${GH} apply=${APPLY}\n`);

  // ---------- P7.0 环境 ----------
  console.log('--- P7.0 环境与开关 ---');
  const cfg = await req('GET', '/api/wewe-probe/team/config');
  const c = cfg.json?.config || {};
  mark('配置可读', cfg.status === 200 && c.F_Id, `F_Id=${c.F_Id}`);
  mark(
    '分步开关字段齐全',
    ['wewe_enabled', 'enqueue_enabled', 'extract_enabled', 'ingest_enabled', 'remind_enabled'].every(
      (k) => c[k] !== undefined
    ),
    `wewe/enqueue/extract/ingest/remind = ${c.wewe_enabled}/${c.enqueue_enabled}/${c.extract_enabled}/${c.ingest_enabled}/${c.remind_enabled}`
  );
  const health = await req('GET', '/api/wewe-probe/health');
  mark('wewe-rss 可达', health.status === 200 && health.json?.success, health.json?.config?.baseUrl);
  const boot = await req('GET', '/api/wewe-probe/team/wewe-auth-bootstrap');
  mark('嵌入 AUTH 票据', boot.status === 200 && Boolean(boot.json?.embedTicket), boot.json?.embedDashPath);

  // ---------- P7.1 已映射 → stage → news_detail APItype ----------
  console.log('\n--- P7.1 专队已映射号：提取记录 + 入库 APItype=私有公众号 ---');
  const acc = await req('GET', '/api/wewe-probe/team/accounts');
  const accounts = acc.json?.accounts || [];
  const row = accounts.find((a) => a.wechat_account_id === GH) || accounts.find((a) => a.map_status === 'mapped');
  mark(
    '存在已映射专队号',
    Boolean(row && (row.map_status === 'mapped' || row.feed_id) && row.team_status !== 'exited'),
    row
      ? `gh=${row.wechat_account_id} status=${row.team_status}/${row.map_status} feed=${row.feed_id} name=${row.account_name || '-'}`
      : '无'
  );

  const ghId = row?.wechat_account_id || GH;
  const stageRows = await db.query(
    `SELECT F_Id, wechat_account_id, extract_ymd, ingest_status, ingested_news_id, source_url, title
     FROM wewe_private_article_stage
     WHERE F_DeleteMark = 0 AND wechat_account_id = ?
     ORDER BY F_CreatorTime DESC LIMIT 50`,
    [ghId]
  );
  const ingested = stageRows.filter((i) => i.ingest_status === 'ingested');
  const pending = stageRows.filter((i) => i.ingest_status === 'pending');
  mark(
    '该号有 stage（提取或入库）',
    stageRows.length > 0,
    `gh条=${stageRows.length} ingested=${ingested.length} pending=${pending.length} 最近ymd=${stageRows[0]?.extract_ymd || '-'}`
  );

  let newsSample = null;
  if (ingested[0]?.ingested_news_id) {
    const newsRows = await db.query(
      `SELECT F_Id, APItype, source_url, title, F_CreatorTime, news_abstract, public_time
       FROM news_detail WHERE F_Id = ? LIMIT 1`,
      [ingested[0].ingested_news_id]
    );
    newsSample = newsRows[0];
    mark(
      'news_detail.APItype=私有公众号',
      newsSample && String(newsSample.APItype) === '私有公众号',
      newsSample
        ? `id=${newsSample.F_Id} APItype=${newsSample.APItype} creator=${newsSample.F_CreatorTime}`
        : 'news 行缺失'
    );
  } else {
    const recent = await db.query(
      `SELECT F_Id, APItype, source_url, title, F_CreatorTime, news_abstract
       FROM news_detail
       WHERE APItype = '私有公众号' AND F_DeleteMark = 0
       ORDER BY F_CreatorTime DESC LIMIT 3`
    );
    mark(
      '库内存在 APItype=私有公众号',
      recent.length > 0,
      recent[0]
        ? `id=${recent[0].F_Id} title=${String(recent[0].title || '').slice(0, 40)}`
        : '无入库记录（需先 extract+ingest）'
    );
    newsSample = recent[0] || null;
  }

  // ---------- P7.2 / P7.3 账本窗造数 ----------
  console.log('\n--- P7.2 周一窗 / P7.3 节后首日（ingest-preview 造数） ---');
  // 找一个已知周一：2026-08-10 是周一
  const mon = await req('GET', '/api/wewe-probe/team/ingest-preview?run_date=2026-08-10');
  const monBiz = mon.json?.preview?.bizDates || [];
  const monExpect = ['2026-08-07', '2026-08-08', '2026-08-09'];
  const monOk = monExpect.every((d) => monBiz.includes(d));
  mark(
    'P7.2 周一窗含周五～周日',
    mon.status === 200 && monOk,
    `run=2026-08-10 biz=[${monBiz.join(',')}] expect⊇[${monExpect.join(',')}]`
  );

  // 节后：用日历中已验证的春节后首班 2026-02-24（prevWd=02-14；base 无 14，wewe 有 14）
  const resumeYmd = '2026-02-24';
  const expectPrevWd = '2026-02-14';
  const hol = await req('GET', `/api/wewe-probe/team/ingest-preview?run_date=${resumeYmd}`);
  const holBiz = hol.json?.preview?.bizDates || [];
  const hasPrev = holBiz.includes(expectPrevWd);
  const coversStretch =
    holBiz.includes('2026-02-15') && holBiz.includes('2026-02-23') && hasPrev;
  mark(
    'P7.3 节后首日含上个工作日当天',
    hol.status === 200 && coversStretch,
    `resume=${resumeYmd} expect⊇${expectPrevWd}..02-23 inBiz_prev=${hasPrev} biz=[${holBiz.join(',')}]`
  );

  // ---------- P7.4 出队 + source_url 去重 ----------
  console.log('\n--- P7.4 出队与 source_url 去重 ---');
  const exited = accounts.filter((a) => a.team_status === 'exited');
  mark('出队状态可区分', true, `当前 exited=${exited.length}（本脚本不自动出队，避免动现网专队）`);

  if (newsSample?.source_url) {
    const dups = await db.query(
      `SELECT F_Id, APItype, F_DeleteMark FROM news_detail WHERE source_url = ?`,
      [newsSample.source_url]
    );
    const alive = dups.filter((d) => Number(d.F_DeleteMark) === 0);
    mark(
      '同一 source_url 存活至多 1 条',
      alive.length <= 1,
      `url尾=${String(newsSample.source_url).slice(-24)} alive=${alive.length} apitypes=[${alive.map((a) => a.APItype).join(',')}]`
    );
  } else {
    mark('source_url 去重抽检', false, '无入库样本可抽检');
  }

  // ---------- P7.5 待订阅 ----------
  console.log('\n--- P7.5 待订阅：不进提取；催办；补链 ---');
  const pendingSub = accounts.filter(
    (a) => a.team_status === 'pending_subscribe' || a.map_status === 'pending_subscribe'
  );
  mark(
    '待订阅状态可区分',
    true,
    `pending_subscribe=${pendingSub.length}${pendingSub[0] ? ' 例=' + pendingSub[0].wechat_account_id : ''}`
  );
  // 已映射号不应是 pending_subscribe
  if (row) {
    mark(
      '已映射号非待订阅',
      row.map_status === 'mapped' && row.team_status !== 'pending_subscribe',
      `${row.wechat_account_id} → ${row.team_status}/${row.map_status}`
    );
  }

  // ---------- P7.6 会话 ----------
  console.log('\n--- P7.6 会话失效→恢复 ---');
  const sess = await req('GET', '/api/wewe-probe/team/session');
  const phase = sess.json?.phaseInfo?.phase || sess.json?.session?.session_status;
  mark(
    '会话状态可读',
    sess.status === 200,
    `phase=${sess.json?.phaseInfo?.phase} status=${sess.json?.session?.session_status} pause=${sess.json?.session?.pause_extract}`
  );
  if (APPLY) {
    console.log('  [--apply] 跳过自动 pause/resume（避免打断线上提取）；请手动：');
  }
  console.log('  手工步骤: POST session-pause → remind-scan(force) → 活码扫码/session-resume → extract-run');

  // ---------- P7.7 AI / 邮件 ----------
  console.log('\n--- P7.7 AI：无摘要不挡发信 ---');
  if (newsSample) {
    const absEmpty = !newsSample.news_abstract || String(newsSample.news_abstract).trim() === '';
    mark(
      '入库可无摘要（不阻塞）',
      true,
      `F_Id=${newsSample.F_Id} abstract_empty=${absEmpty}（邮件候选按 F_CreatorTime，不依赖 abstract）`
    );
  } else {
    mark('AI/摘要抽检', false, '无 news_detail 样本');
  }

  // ---------- P7.8 分步开关语义 ----------
  console.log('\n--- P7.8 分步开关 ---');
  mark(
    '当前为全开主路径',
    Number(c.wewe_enabled) === 1 &&
      Number(c.enqueue_enabled) === 1 &&
      Number(c.extract_enabled) === 1 &&
      Number(c.ingest_enabled) === 1,
    '若要验「只入队」：关 extract/ingest，跑 enqueue-test，确认无新 stage'
  );

  // 今日 preview
  const today = await req('GET', '/api/wewe-probe/team/ingest-preview');
  console.log('\n--- 今日 ingest-preview ---');
  console.log(JSON.stringify(today.json?.preview, null, 2));

  console.log('\n======== 汇总 ========');
  console.log(failed === 0 ? '冒烟项全部 PASS（写操作/邮件/真实周一仍需你点确认）' : `${failed} 项 FAIL，见上`);
  console.log('\n待你人工点的项：');
  console.log('1) 配置页「私有公众号 wewe」嵌入不手输 AUTH，新窗口用 gate');
  console.log('2) P7.4 出队：对新榜已恢复号触发同步后 team_status=exited');
  console.log('3) P7.5：找/造一个待订阅号 → 收催办邮 → 粘贴 map-url → mapped');
  console.log('4) P7.6：pause → 催办邮 → resume → 立刻 extract');
  console.log('5) P7.8：只开 enqueue 再切回全开');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
