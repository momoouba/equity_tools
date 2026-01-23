import React, { useState, useEffect } from 'react'
import { Alert, Empty, Skeleton } from '@arco-design/web-react'
import axios from '../../utils/axios'
import './CronSchedule.css'

/**
 * Cron 执行时间预览组件
 */
function CronSchedule({ cronExpression, isSkipHoliday }) {
  const [scheduleList, setScheduleList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // 计算执行时间
  useEffect(() => {
    calculateSchedule()
  }, [cronExpression, isSkipHoliday])


  // 计算执行时间（通过后端API）
  const calculateSchedule = async () => {
    if (!cronExpression || cronExpression.trim() === '') {
      setScheduleList([])
      setError('请配置有效 Cron 表达式')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 调用后端API解析cron表达式
      const response = await axios.post('/api/system/cron/parse', {
        cronExpression: cronExpression,
        count: 5,
        isSkipHoliday: isSkipHoliday
      })

      if (response.data.success) {
        setScheduleList(response.data.data || [])
        if (isSkipHoliday && response.data.data && response.data.data.length === 0) {
          setError('暂无符合条件的执行时间（已跳过节假日）')
        }
      } else {
        setError(response.data.message || '解析失败')
        setScheduleList([])
      }
    } catch (error) {
      console.error('计算执行时间失败:', error)
      const errorMessage = error.response?.data?.message || error.message || '表达式格式错误'
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
