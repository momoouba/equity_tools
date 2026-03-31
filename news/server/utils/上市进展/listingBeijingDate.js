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
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + deltaDays);
  return d;
}

module.exports = {
  createShanghaiDate,
  formatDateOnly,
  addDaysCalendar,
};
