/**
 * Cron 表达式工具函数
 */

/**
 * 根据配置生成完整的 Cron 表达式
 * @param {Object} config - 各维度的配置
 * @returns {string} 7位 Cron 表达式
 */
export function generateCron(config) {
  const { second, minute, hour, day, month, weekday, year } = config

  // 处理日和周的互斥关系
  let dayValue = day.value
  let weekdayValue = weekday.value

  // 如果周字段是指定模式，检查是否选择了所有7天
  if (weekday.mode === 'specify' && Array.isArray(weekday.value)) {
    // 如果选择了所有7天（1-7），自动转换为通配符 *
    const sortedValues = [...weekday.value].sort((a, b) => a - b);
    if (sortedValues.length === 7 && sortedValues.every((v, i) => v === i + 1)) {
      weekdayValue = '*';
    }
  }

  // 如果日不是通配符，周必须是 ?
  if (dayValue !== '*' && dayValue !== '?') {
    weekdayValue = '?'
  }
  // 如果周不是通配符和?，日必须是 ?
  else if (weekdayValue !== '*' && weekdayValue !== '?') {
    dayValue = '?'
  }

  // 生成各维度的表达式
  const secondExpr = formatDimensionValue(second)
  const minuteExpr = formatDimensionValue(minute)
  const hourExpr = formatDimensionValue(hour)
  const dayExpr = dayValue
  const monthExpr = formatDimensionValue(month)
  const weekdayExpr = weekdayValue
  const yearExpr = formatDimensionValue(year)

  return `${secondExpr} ${minuteExpr} ${hourExpr} ${dayExpr} ${monthExpr} ${weekdayExpr} ${yearExpr}`
}

/**
 * 格式化单个维度的值
 * @param {Object} config - 维度配置 { mode, value, ... }
 * @returns {string} 格式化后的表达式
 */
function formatDimensionValue(config) {
  const { mode, value } = config

  if (mode === 'wildcard') {
    return '*'
  } else if (mode === 'range') {
    // 周期范围：从 start 到 end
    const { start, end } = config
    return `${start}-${end}`
  } else if (mode === 'step') {
    // 间隔执行：从 start 开始，每 step 执行一次
    const { start, step } = config
    if (start === 0 && step === 1) {
      return '*'
    }
    return `${start}/${step}`
  } else if (mode === 'specify') {
    // 指定具体值：可以是单个值或逗号分隔的多个值
    if (Array.isArray(value)) {
      // 对于周字段，如果选择了所有7天（1-7），自动转换为 *
      if (value.length === 7 && value.every((v, i) => v === i + 1)) {
        return '*'
      }
      return value.join(',')
    }
    return String(value)
  }

  return '*'
}

/**
 * 解析 Cron 表达式为配置对象
 * @param {string} cronExpression - 7位 Cron 表达式
 * @returns {Object|null} 配置对象，解析失败返回 null
 */
export function parseCron(cronExpression) {
  if (!cronExpression || typeof cronExpression !== 'string') {
    return null
  }

  try {
    const parts = cronExpression.trim().split(/\s+/)
    if (parts.length !== 7) {
      return null
    }

    const [second, minute, hour, day, month, weekday, year] = parts

    return {
      second: parseDimension(second, { min: 0, max: 59 }),
      minute: parseDimension(minute, { min: 0, max: 59 }),
      hour: parseDimension(hour, { min: 0, max: 23 }),
      day: parseDimension(day, { min: 1, max: 31 }, true),
      month: parseDimension(month, { min: 1, max: 12 }),
      weekday: parseDimension(weekday, { min: 1, max: 7 }, false, true),
      year: parseDimension(year, { min: 1970, max: 2099 })
    }
  } catch (error) {
    console.error('解析 Cron 表达式失败:', error)
    return null
  }
}

/**
 * 解析单个维度的表达式
 * @param {string} expr - 维度表达式
 * @param {Object} bounds - 边界 { min, max }
 * @param {boolean} allowQuestion - 是否允许 ?
 * @param {boolean} isWeekday - 是否是星期维度
 * @returns {Object} 配置对象
 */
function parseDimension(expr, bounds, allowQuestion = false, isWeekday = false) {
  // 通配符
  if (expr === '*') {
    return { mode: 'wildcard', value: '*' }
  }

  // 问号（仅用于日和周）
  if (allowQuestion && expr === '?') {
    return { mode: 'wildcard', value: '?' }
  }

  // 周期范围：1-5
  if (/^\d+-\d+$/.test(expr)) {
    const [start, end] = expr.split('-').map(Number)
    if (start >= bounds.min && end <= bounds.max && start <= end) {
      return { mode: 'range', start, end, value: expr }
    }
  }

  // 间隔执行：*/5 或 0/5
  if (/^\d+\/\d+$/.test(expr) || /^\*\/\d+$/.test(expr)) {
    const parts = expr.split('/')
    const start = parts[0] === '*' ? 0 : Number(parts[0])
    const step = Number(parts[1])
    if (start >= bounds.min && start <= bounds.max && step > 0) {
      return { mode: 'step', start, step, value: expr }
    }
  }

  // 指定具体值：单个值或逗号分隔的多个值
  if (/^\d+(,\d+)*$/.test(expr)) {
    const values = expr.split(',').map(Number)
    const validValues = values.filter(v => v >= bounds.min && v <= bounds.max)
    if (validValues.length > 0) {
      return {
        mode: 'specify',
        value: validValues.length === 1 ? validValues[0] : validValues,
        values: validValues
      }
    }
  }

  // 默认返回通配符
  return { mode: 'wildcard', value: isWeekday ? '?' : '*' }
}

/**
 * 验证 Cron 表达式格式
 * @param {string} cronExpression - Cron 表达式
 * @returns {boolean} 是否有效
 */
export function validateCron(cronExpression) {
  if (!cronExpression || typeof cronExpression !== 'string') {
    return false
  }

  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 7) {
    return false
  }

  // 基本格式验证
  const patterns = [
    /^[\d\*\/\-,?]+$/, // 秒
    /^[\d\*\/\-,?]+$/, // 分
    /^[\d\*\/\-,?]+$/, // 时
    /^[\d\*\/\-,?]+$/, // 日
    /^[\d\*\/\-,?]+$/, // 月
    /^[\d\*\/\-,?]+$/, // 周
    /^[\d\*\/\-,?]+$/  // 年
  ]

  return parts.every((part, index) => patterns[index].test(part))
}
