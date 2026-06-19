const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncNewShareCalendar } = require('../server/utils/上市进展/newShareService');
const { syncGuidanceProgress } = require('../server/utils/上市进展/guidanceProgressService');
const { syncOverseasFiling } = require('../server/utils/上市进展/overseasFilingService');
const db = require('../server/db');

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-smoke-'));
  const guidanceCsv = path.join(tmpDir, 'guidance.csv');
  const overseasCsv = path.join(tmpDir, 'overseas.csv');

  fs.writeFileSync(
    guidanceCsv,
    [
      '公司名称,辅导备案日期,当前状态,派出机构,拟上市板块,证券代码',
      '测试辅导企业A,2026-04-10,辅导备案,上海证监局,主板,600001',
      '测试辅导企业B,2026-04-11,辅导备案,深圳证监局,创业板,300001',
    ].join('\n'),
    'utf8'
  );

  fs.writeFileSync(
    overseasCsv,
    [
      '企业名称,申报类型,申报主体,拟上市证券交易所,接收日期,备案状态,来源链接,附件链接,批次周',
      '测试境外企业A,首次备案,测试主体A,港交所,2026-04-12,已受理,https://example.com/a,https://example.com/a.xlsx,2026W15',
      '测试境外企业B,补充备案,测试主体B,纳斯达克,2026-04-13,补正中,https://example.com/b,https://example.com/b.xlsx,2026W15',
    ].join('\n'),
    'utf8'
  );

  process.env.CSRC_GUIDANCE_CSV_PATH = guidanceCsv;
  process.env.OVERSEAS_FILING_FILE_PATH = overseasCsv;

  const from = '2026-04-01';
  const to = '2026-04-30';

  const r1 = await syncNewShareCalendar({ from, to, triggerType: 'manual', logTag: '[smoke][new-share]' });
  const r3 = await syncGuidanceProgress({ from, to, triggerType: 'manual', logTag: '[smoke][guidance]' });
  const r4 = await syncOverseasFiling({ from, to, triggerType: 'manual', logTag: '[smoke][overseas]' });

  const logRows = await db.query(
    `SELECT source_type, trigger_type, status, started_at
       FROM listing_sync_execution_log
      ORDER BY id DESC
      LIMIT 10`
  );

  console.log(
    JSON.stringify(
      {
        newShare: r1,
        guidance: r3,
        overseas: r4,
        latestExecutionLogs: logRows,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.closePool();
    } catch (_) {
      // ignore
    }
  });

