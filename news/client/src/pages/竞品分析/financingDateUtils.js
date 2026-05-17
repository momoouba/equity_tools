import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

/** 系统约定：融资日期筛选、批量 AI、手动同步（融资事件页）等与库 `event_date`（DATE）对齐，口径为北京时间日历日 */
export const FINANCING_DATE_TZ = 'Asia/Shanghai'

/**
 * 格式化为 yyyy-MM-dd（北京时间）。
 * 将控件取值或接口日期解析为同一日历日口径，避免浏览器默认时区与 UTC 造成的自然日偏移。
 */
export function formatFinancingYmd(value) {
  if (value == null || value === '') return ''
  const d = dayjs.isDayjs(value) ? value : dayjs(value)
  if (!d.isValid()) return ''
  return d.tz(FINANCING_DATE_TZ).format('YYYY-MM-DD')
}

/** 当前时刻对应的北京时间（默认日期范围、导出文件名时间戳等） */
export function financingNow() {
  return dayjs().tz(FINANCING_DATE_TZ)
}

/** 日志、详情等：北京时间日期时间 */
export function formatFinancingDateTime(value) {
  if (value == null || value === '') return '-'
  const d = dayjs(value)
  if (!d.isValid()) return String(value)
  return d.tz(FINANCING_DATE_TZ).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * 列表「融资日期」列：与库 `event_date`（DATE）业务日历日一致。
 * - 接口已为纯 `yyyy-MM-dd` 时直接使用，不做时区换算。
 * - `DATE` 经 JSON 常为带 `T` 的 ISO（UTC 午夜），在西方时区若按本地 parse 会少一天：统一按北京时间取日历日。
 */
export function formatFinancingEventDate(val) {
  if (val == null || val === '') return '-'
  if (val instanceof Date) {
    const ymd = formatFinancingYmd(dayjs(val))
    return ymd || '-'
  }
  const s = String(val).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/T/.test(s)) {
    const ymd = formatFinancingYmd(dayjs(s))
    return ymd || '-'
  }
  const head = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (head) return head[1]
  const ymd = formatFinancingYmd(dayjs(s))
  return ymd || s || '-'
}
