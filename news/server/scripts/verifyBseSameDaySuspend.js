/**
 * 验证北交所同日「已受理+中止」（嘉拓智能 id=865）。
 * 用法: node server/scripts/verifyBseSameDaySuspend.js
 */
const {
  enrichBseStatusDate,
  expandRowsWithTimeline,
  applyTimelineConfirmationPolicy,
  bseProjectStatusToTimeline,
  fetchBseProjectStatusDetail,
} = require('../utils/listing/listingExchangeCrawler');

(async () => {
  const pack = await fetchBseProjectStatusDetail('865', 'verify-sameday');
  const tl = bseProjectStatusToTimeline(pack.projectStatus);
  console.log('detail timeline', tl);
  const hasAccepted = tl.some((x) => x.status === '已受理' && x.ymd === '2026-06-30');
  const hasSuspend = tl.some((x) => x.status === '中止' && x.ymd === '2026-06-30');
  if (!hasAccepted || !hasSuspend) {
    console.error('FAIL: detail timeline missing same-day 已受理/中止');
    process.exit(1);
  }

  const row = {
    exchange: '北交所',
    board: '北交所',
    company: '江苏嘉拓新能源智能装备股份有限公司',
    project_name: '嘉拓智能',
    status: '中止',
    code: '874969',
    f_update_time: '2026-06-30 00:00:00',
    receive_date: '2026-06-30',
    _bse_id: '865',
    _bse_operating_date: '2026-06-30',
    _update_ymd: '2026-06-30',
    _filing_ymd: '2026-06-30',
    _timeline_rows: [
      { status: '已受理', ymd: '2026-06-30' },
      { status: '中止', ymd: '2026-06-30' },
    ],
  };
  await enrichBseStatusDate([row], '[verify-sameday]');
  await applyTimelineConfirmationPolicy([row], '[verify-sameday]');
  const expanded = expandRowsWithTimeline([row], '[verify-sameday]');
  const statuses = expanded.map((r) => `${r.status}@${String(r.receive_date || '').slice(0, 10)}`);
  console.log('expanded', statuses);
  const ok =
    expanded.some((r) => r.status === '中止' && String(r.receive_date).startsWith('2026-06-30')) &&
    expanded.some((r) => r.status === '已受理' && String(r.receive_date).startsWith('2026-06-30'));
  if (!ok) {
    console.error('FAIL: expand missing same-day dual rows');
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
