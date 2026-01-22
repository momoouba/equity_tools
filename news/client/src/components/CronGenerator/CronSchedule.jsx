import React, { useState, useEffect } from 'react'
import { Alert, Empty, Skeleton } from '@arco-design/web-react'
import { CronExpressionParser } from 'cron-parser'
import dayjs from 'dayjs'
import axios from '../../utils/axios'
import './CronSchedule.css'

/**
 * Cron 执行时间预览组件
 */
function CronSchedule({ cronExpression, isSkipHoliday }) {
  const [scheduleList, setScheduleList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [holidayList, setHolidayList] = useState([])

  // 获取节假日列表
  useEffect(() => {
    if (isSkipHoliday) {
      fetchHolidayList()
    } else {
      setHolidayList([])
    }
  }, [isSkipHoliday])

  // 计算执行时间
  useEffect(() => {
    calculateSchedule()
  }, [cronExpression, isSkipHoliday, holidayList])

  // 获取节假日列表
  const fetchHolidayList = async () => {
    try {
      // 获取未来几年的节假日数据
      const currentYear = new Date().getFullYear()
      const years = [currentYear, currentYear + 1, currentYear + 2]
      
      const allHolidays = []
      for (const year of years) {
        try {
          const response = await axios.get('/api/system/holidays', {
            params: {
              year: year,
              isWorkday: '0', // 只获取节假日（非工作日）
              page: 1,
              pageSize: 1000
            }
          })
          if (response.data.success && response.data.data) {
            const holidays = response.data.data
              .filter(item => item.is_workday === 0 || item.is_workday === '0')
              .map(item => item.holiday_date)
            allHolidays.push(...holidays)
          }
        } catch (err) {
          console.warn(`获取${year}年节假日失败:`, err)
        }
      }
      
      setHolidayList([...new Set(allHolidays)])
    } catch (error) {
      console.error('获取节假日列表失败:', error)
      setError('节假日数据加载失败，暂无法过滤')
    }
  }

  // 将7位Cron表达式转换为6位（去掉年份字段，因为cron-parser不支持7位）
  const convertTo6FieldCron = (cron7Field) => {
    if (!cron7Field) return null
    
    const parts = cron7Field.trim().split(/\s+/)
    if (parts.length === 7) {
      // 去掉最后一个字段（年份），返回前6位
      return parts.slice(0, 6).join(' ')
    } else if (parts.length === 6) {
      // 已经是6位，直接返回
      return cron7Field.trim()
    }
    return null
  }

  // 转换星期字段：Quartz Cron使用1-7（1=周日），cron-parser使用0-6（0=周日）
  const convertWeekdayForParser = (cron6Field) => {
    if (!cron6Field) return cron6Field
    
    const parts = cron6Field.trim().split(/\s+/)
    if (parts.length !== 6) return cron6Field
    
    // 第6个字段是星期字段（索引5）
    const weekdayField = parts[5]
    
    // 如果包含数字1-7，需要转换为0-6
    if (weekdayField && weekdayField !== '*' && weekdayField !== '?') {
      // 处理逗号分隔的多个值，如 "2,3,5,4,6"
      if (weekdayField.includes(',')) {
        const values = weekdayField.split(',').map(v => {
          const trimmed = v.trim()
          const num = parseInt(trimmed, 10)
          if (!isNaN(num) && num >= 1 && num <= 7) {
            // 1-7转换为0-6：1->0, 2->1, ..., 7->6
            return (num - 1) % 7
          }
          return trimmed
        })
        parts[5] = values.join(',')
      } 
      // 处理范围，如 "1-5"
      else if (weekdayField.includes('-')) {
        const [startStr, endStr] = weekdayField.split('-')
        const start = parseInt(startStr.trim(), 10)
        const end = parseInt(endStr.trim(), 10)
        if (!isNaN(start) && !isNaN(end) && start >= 1 && start <= 7 && end >= 1 && end <= 7) {
          parts[5] = `${(start - 1) % 7}-${(end - 1) % 7}`
        }
      }
      // 处理间隔表达式，如 "*/2" 或 "1/2"
      else if (weekdayField.includes('/')) {
        const [baseStr, stepStr] = weekdayField.split('/')
        const step = parseInt(stepStr.trim(), 10)
        if (!isNaN(step) && step > 0) {
          if (baseStr.trim() === '*') {
            // */2 保持不变
            parts[5] = weekdayField
          } else {
            // 1/2 需要转换
            const base = parseInt(baseStr.trim(), 10)
            if (!isNaN(base) && base >= 1 && base <= 7) {
              parts[5] = `${(base - 1) % 7}/${step}`
            }
          }
        }
      }
      // 处理单个数字
      else {
        const num = parseInt(weekdayField, 10)
        if (!isNaN(num) && num >= 1 && num <= 7) {
          parts[5] = String((num - 1) % 7)
        }
      }
    }
    
    return parts.join(' ')
  }

  // 计算执行时间
  const calculateSchedule = () => {
    if (!cronExpression || cronExpression.trim() === '') {
      setScheduleList([])
      setError('请配置有效 Cron 表达式')
      return
    }

    setLoading(true)
    setError(null)

    let cron6Field = null
    try {
      // 将7位表达式转换为6位（cron-parser只支持6位）
      cron6Field = convertTo6FieldCron(cronExpression)
      if (!cron6Field) {
        setError('表达式格式错误：无法转换为6位表达式，请检查配置')
        setScheduleList([])
        setLoading(false)
        return
      }

      // 验证 Cron 表达式（注意：cron-parser 默认使用本地时区）
      // cron-parser 使用0-6表示星期（0=周日），而Quartz Cron使用1-7（1=周日）
      // 需要转换星期字段：将1-7转换为0-6
      const cron6FieldConverted = convertWeekdayForParser(cron6Field)
      const interval = CronExpressionParser.parse(cron6FieldConverted, {
        currentDate: new Date()
      })

      // 生成候选执行时间（如果跳过节假日，生成更多候选）
      const candidateCount = isSkipHoliday ? 20 : 5
      const candidates = []
      
      try {
        for (let i = 0; i < candidateCount; i++) {
          // cron-parser v5.x 的 next() 直接返回 Date 对象
          const nextDate = interval.next()
          if (nextDate) {
            candidates.push(nextDate)
          }
        }
      } catch (e) {
        // 如果超出范围或没有更多时间，停止
        console.warn('获取执行时间时出错:', e.message)
      }

      // 如果跳过节假日，过滤掉节假日
      let filteredCandidates = candidates
      if (isSkipHoliday && holidayList.length > 0) {
        filteredCandidates = candidates.filter(date => {
          const dateStr = dayjs(date).format('YYYY-MM-DD')
          return !holidayList.includes(dateStr)
        })
      }

      // 取最近5条
      const finalList = filteredCandidates.slice(0, 5).map(date => 
        dayjs(date).format('YYYY-MM-DD HH:mm:ss')
      )

      setScheduleList(finalList)

      if (isSkipHoliday && finalList.length === 0 && candidates.length > 0) {
        setError('暂无符合条件的执行时间（已跳过节假日）')
      }
    } catch (error) {
      console.error('计算执行时间失败:', error)
      console.error('原始表达式:', cronExpression)
      console.error('转换后的6位表达式:', cron6Field)
      // 显示更详细的错误信息
      const errorMessage = error.message || '表达式格式错误'
      setError(`表达式格式错误：${errorMessage}，请检查配置`)
      setScheduleList([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="cron-schedule">
      <div className="cron-schedule-title">最近5次运行时间：</div>
      
      {loading ? (
        <Skeleton loading={true} animation={true} text={{ rows: 5 }} />
      ) : error ? (
        <Alert
          type="warning"
          content={error}
          style={{ marginTop: 8 }}
        />
      ) : scheduleList.length === 0 ? (
        <Empty description="暂无执行时间" style={{ marginTop: 8 }} />
      ) : (
        <div className="cron-schedule-list">
          {scheduleList.map((time, index) => (
            <div key={index} className="cron-schedule-item">
              {time}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CronSchedule
