const db = require('../../db');
const { normalizeCreditCode, strTrim } = require('./competitorMatchUtils');
const {
  isValidMainlandUscc,
  normalizeCompetitorCompanyNameForMatch,
} = require('./competitorCompanyMatch');

const PLACEHOLDER = '【无】';

function formatFinancingDate(d) {
  if (!d) return PLACEHOLDER;
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return PLACEHOLDER;
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch {
    return PLACEHOLDER;
  }
}

function formatFinancingLine(row) {
  const date = formatFinancingDate(row.event_date);
  const round = strTrim(row.round) || strTrim(row.latest_round) || PLACEHOLDER;
  const amt = strTrim(row.funding_amt_raw) || strTrim(row.estimated_amt_raw) || PLACEHOLDER;
  return `${date}-${round}-${amt}`;
}

function eventGroupKeyFromRow(row) {
  const credit = normalizeCreditCode(row.company_credit_code);
  if (isValidMainlandUscc(credit)) return `cc:${credit.toUpperCase()}`;
  const nm = normalizeCompetitorCompanyNameForMatch(row.company_name);
  return nm ? `name:${nm}` : null;
}

/**
 * 全量加载融资事件池索引（单次分析落库调用一次）。
 */
async function buildFinancingEventIndex() {
  const rows = await db.query(
    `SELECT company_name, company_credit_code, event_date, round, latest_round,
            funding_amt_raw, estimated_amt_raw
     FROM sourcing_financing_event
     WHERE delete_mark = 0
     ORDER BY event_date DESC, id DESC`
  );
  const byKey = new Map();
  for (const r of rows) {
    const key = eventGroupKeyFromRow(r);
    if (!key) continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  return { byKey };
}

function pickCreditFromEvents(events) {
  for (const e of events) {
    const c = normalizeCreditCode(e.company_credit_code);
    if (isValidMainlandUscc(c)) return c.toUpperCase();
  }
  return null;
}

function buildFinancingHistoryText(events) {
  if (!events?.length) return null;
  const lines = events.map(formatFinancingLine).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

/**
 * @param {ReturnType<typeof buildFinancingEventIndex> extends Promise<infer T> ? T : never} index
 */
function resolveFinancingForCompetitor(index, { displayName, unifiedCreditCode }) {
  const credit = normalizeCreditCode(unifiedCreditCode);
  let key = null;
  if (isValidMainlandUscc(credit)) key = `cc:${credit.toUpperCase()}`;
  else {
    const nm = normalizeCompetitorCompanyNameForMatch(displayName);
    if (nm) key = `name:${nm}`;
  }
  if (!key || !index?.byKey?.has(key)) {
    return { unifiedCreditCode: isValidMainlandUscc(credit) ? credit.toUpperCase() : credit || null, financingHistoryText: null };
  }
  const events = index.byKey.get(key);
  const resolvedCredit = isValidMainlandUscc(credit) ? credit.toUpperCase() : pickCreditFromEvents(events);
  return {
    unifiedCreditCode: resolvedCredit || (isValidMainlandUscc(credit) ? credit.toUpperCase() : null),
    financingHistoryText: buildFinancingHistoryText(events),
  };
}

module.exports = {
  PLACEHOLDER,
  buildFinancingEventIndex,
  resolveFinancingForCompetitor,
  formatFinancingLine,
  buildFinancingHistoryText,
};
