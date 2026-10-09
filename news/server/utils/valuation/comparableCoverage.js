/**
 * 可比公司相对估值锚定日要补齐的报表期和科目。
 * 缺报告期，或这些科目为空，就开始采集时再抓取。
 */

const PL_REQUIRED = ['revenue', 'cogs', 'selling', 'admin', 'operating_profit', 'net_income'];
const BS_REQUIRED = ['accounts_receivable', 'accounts_payable', 'inventory', 'cash', 'total_assets', 'equity'];
const CF_REQUIRED = ['cfo', 'cfi', 'cff', 'da', 'capex', 'cash_end'];
const REQUIRED_FIELDS = { pl: PL_REQUIRED, bs: BS_REQUIRED, cf: CF_REQUIRED };

const MULTIPLES_HISTORY_START = '2020-09-01';
const MULTIPLES_LAG_DAYS = 15;
const MULTIPLES_MIN_POINTS = 2;
const MULTIPLES_SHORT_HISTORY_POINTS = 200;

function periodKey(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(v || '').trim().slice(0, 10);
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function addDays(ymd, delta) {
  const key = periodKey(ymd);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function earlierYmd(a, b) {
  const left = periodKey(a);
  const right = periodKey(b);
  if (!left) return right;
  if (!right) return left;
  return left <= right ? left : right;
}

function reportTypeForMonth(month) {
  if (month === 3) return 'q1';
  if (month === 6) return 'interim';
  if (month === 9) return 'q3';
  return 'annual';
}

function statementNeeds(asOfYmd, todayYmd) {
  const asOf = periodKey(asOfYmd);
  const today = periodKey(todayYmd) || asOf;
  const m = /^(\d{4})-(03-31|06-30|09-30|12-31)$/.exec(asOf);
  if (!m || !today) return [];
  const year = Number(m[1]);
  const md = m[2];
  const month = Number(md.slice(0, 2));
  let completeYear = month === 12 ? year : year - 1;
  while (`${completeYear}-12-31` > today && completeYear > year - 8) completeYear -= 1;
  const periods = [];
  for (let i = 0; i < 3; i += 1) {
    const reportPeriod = `${completeYear - i}-12-31`;
    if (reportPeriod <= today) {
      periods.push({
        report_period: reportPeriod,
        report_type: 'annual',
        kinds: ['pl', 'bs', 'cf'],
      });
    }
  }
  if (month !== 12) {
    const reportType = reportTypeForMonth(month);
    for (const y of [year, year - 1]) {
      const reportPeriod = `${y}-${md}`;
      if (reportPeriod <= today) {
        periods.push({
          report_period: reportPeriod,
          report_type: reportType,
          kinds: ['pl', 'bs', 'cf'],
        });
      }
    }
  }
  return periods;
}

function fieldBlank(row, key) {
  if (!row) return true;
  const v = row[key];
  if (v == null || v === '') return true;
  const n = Number(v);
  return !Number.isFinite(n);
}

function statementGaps(rows, needs) {
  const missingTypes = new Set();
  const gaps = [];
  for (const need of needs || []) {
    for (const kind of need.kinds) {
      const row = (rows || []).find((r) => (
        periodKey(r.report_period) === need.report_period
        && String(r.statement_type || '') === kind
      ));
      const fields = REQUIRED_FIELDS[kind] || [];
      if (!row) {
        missingTypes.add(kind);
        gaps.push({
          report_period: need.report_period,
          report_type: need.report_type,
          statement_type: kind,
          reason: 'missing_period',
        });
        continue;
      }
      const blank = fields.filter((key) => fieldBlank(row, key));
      if (blank.length) {
        missingTypes.add(kind);
        gaps.push({
          report_period: need.report_period,
          report_type: need.report_type,
          statement_type: kind,
          reason: 'blank',
          fields: blank,
        });
      }
    }
  }
  return { missingTypes: [...missingTypes], gaps };
}

function multiplesCovered({
  minDate,
  maxDate,
  usable,
  asOf,
  today,
  historyStart = MULTIPLES_HISTORY_START,
} = {}) {
  const target = earlierYmd(asOf, today);
  const latest = periodKey(maxDate);
  const oldest = periodKey(minDate);
  const n = Number(usable) || 0;
  if (!target || !latest || latest > target || n < MULTIPLES_MIN_POINTS) return false;
  if (addDays(latest, MULTIPLES_LAG_DAYS) < target) return false;
  return Boolean(
    (oldest && oldest <= historyStart)
    || n >= 700
    || n >= MULTIPLES_SHORT_HISTORY_POINTS
  );
}

module.exports = {
  PL_REQUIRED,
  BS_REQUIRED,
  CF_REQUIRED,
  REQUIRED_FIELDS,
  MULTIPLES_HISTORY_START,
  MULTIPLES_LAG_DAYS,
  statementNeeds,
  statementGaps,
  multiplesCovered,
  periodKey,
  earlierYmd,
};
