/**
 * 与 news.js 中 createShanghaiDate / formatDateOnly 语义一致（北京时间日历日）
 */
function createShanghaiDate(date = null) {
  const now = date || new Date();
  const localDateTimeStr = now.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const [datePart] = localDateTimeStr.split(' ');
  const [localYear, localMonth, localDay] = datePart.split('/').map(Number);
  const dateStr = `${localYear}-${String(localMonth).padStart(2, '0')}-${String(localDay).padStart(2, '0')}T00:00:00+08:00`;
  return new Date(dateStr);
}

function formatDateOnly(date) {
  const beijingDateStr = date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const datePart = beijingDateStr.split(' ')[0];
  const [year, month, day] = datePart.split(/[\/\-]/).map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysCalendar(date, deltaDays) {
  // 禁止用 setDate/getDate：在 Docker 常见 TZ=UTC 下，北京时间零点对应的 UTC 是「前一天下午」，
  // getDate() 会按 UTC 取日序，导致「昨日」「+730 日」与本地 Windows（中国时区）不一致。
  const ymd = formatDateOnly(date);
  const [y, mo, da] = ymd.split('-').map(Number);
  const baseStr = `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}T00:00:00+08:00`;
  const delta = Number(deltaDays);
  if (!Number.isFinite(delta)) {
    return createShanghaiDate(date);
  }
  const shiftedMs = new Date(baseStr).getTime() + delta * 86400000;
  return createShanghaiDate(new Date(shiftedMs));
}

/**
 * 北京日历 YYYY-MM-DD 的前一天（用于「开始日期含当日」与抓取侧 strict `>` 下界对齐）。
 */
function subtractOneBeijingCalendarDay(ymd) {
  const s = String(ymd || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return '';
  }
  const anchor = createShanghaiDate(new Date(`${s}T12:00:00+08:00`));
  return formatDateOnly(addDaysCalendar(anchor, -1));
}

module.exports = {
  createShanghaiDate,
  formatDateOnly,
  addDaysCalendar,
  subtractOneBeijingCalendarDay,
};
