/**
 * 验证北交所详情 API → 时间轴确认（中煤环保 id=868）。
 * 用法: node server/scripts/verifyBseDetailEnrich.js [id]
 */
const {
  enrichBseStatusDate,
  applyTimelineConfirmationPolicy,
  bseProjectStatusToTimeline,
  fetchBseProjectStatusDetail,
} = (() => {
  const m = require('../utils/listing/listingExchangeCrawler');
  return m;
})();

async function main() {
  const id = process.argv[2] || '868';
  // 直接测 API
  if (typeof fetchBseProjectStatusDetail === 'function') {
    const pack = await fetchBseProjectStatusDetail(id, `verify id=${id}`);
    const tl = bseProjectStatusToTimeline(pack.projectStatus);
    console.log('timeline', tl);
  }

  const row = {
    exchange: '北交所',
    board: '北交所',
    company: '中煤（北京）环保股份有限公司',
    project_name: '中煤环保',
    status: '已问询',
    f_update_time: '2026-06-30 00:00:00',
    _bse_id: id,
    _bse_operating_date: '2026-06-30',
    _update_ymd: '2026-06-30',
    _filing_ymd: '2026-06-30',
  };
  const enrich = await enrichBseStatusDate([row], '[verify]');
  console.log('enrich', enrich);
  console.log('row.receive_date', row.receive_date);
  console.log('row._timeline_rows', row._timeline_rows);
  const policy = await applyTimelineConfirmationPolicy([row], '[verify]');
  console.log('policy', policy);
  console.log('confirmed', row._timeline_confirmed, 'receive_date', row.receive_date);
  if (Number(row._timeline_confirmed) !== 1 || row.receive_date !== '2026-07-27') {
    console.error('FAIL: expected confirmed + receive_date=2026-07-27');
    process.exit(1);
  }
  console.log('OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
