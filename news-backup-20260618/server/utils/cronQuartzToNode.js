/**
 * Quartz Cron → node-cron（5 段：分 时 日 月 周）
 * - 5 段：视为已是 node-cron，原样返回
 * - 6 段：秒 分 时 日 月 周（无年）
 * - 7 段：秒 分 时 日 月 周 年
 * Quartz 周：1=周日 … 7=周六；node-cron 周：0=周日 … 6=周六
 */
function convertQuartzCronToNodeCron(quartzCron) {
  if (!quartzCron || typeof quartzCron !== 'string') {
    return null;
  }
  const parts = quartzCron.trim().split(/\s+/);
  if (parts.length === 5) {
    return quartzCron.trim();
  }
  if (parts.length === 6 || parts.length === 7) {
    const [, minute, hour, day, month, weekday] = parts;
    let convertedDay = day === '?' ? '*' : day;
    let convertedWeekday = weekday;
    if (weekday === '?') {
      convertedWeekday = '*';
    } else if (weekday && weekday !== '*') {
      if (weekday.includes(',')) {
        convertedWeekday = weekday
          .split(',')
          .map((w) => {
            const wNum = parseInt(w.trim(), 10);
            if (wNum >= 1 && wNum <= 7) {
              return (wNum - 1).toString();
            }
            return w.trim();
          })
          .join(',');
      } else {
        const wNum = parseInt(weekday, 10);
        if (wNum >= 1 && wNum <= 7) {
          convertedWeekday = (wNum - 1).toString();
        }
      }
    }
    return `${minute} ${hour} ${convertedDay} ${month} ${convertedWeekday}`;
  }
  return null;
}

module.exports = { convertQuartzCronToNodeCron };
