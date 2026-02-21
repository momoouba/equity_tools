import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Message } from '@arco-design/web-react'
import CronConfig from './CronConfig'
import CronPreview from './CronPreview'
import CronSchedule from './CronSchedule'
import { generateCron, parseCron } from './utils'
import './index.css'

/**
 * Cron 表达式可视化配置组件
 * @param {boolean} visible - 是否显示弹窗
 * @param {string} value - 初始 Cron 表达式值
 * @param {boolean} skipHoliday - 初始「跳过节假日」状态（可选，用于收件管理等编辑回显）
 * @param {function} onChange - 值变化回调 (cron: string, isSkipHoliday?: boolean) => void
 * @param {function} onCancel - 取消回调
 */
function CronGenerator({ visible, value, skipHoliday: initialSkipHoliday, onChange, onCancel }) {
  // 默认配置：所有维度为通配符
  const defaultConfig = {
    second: { mode: 'wildcard', value: '*' },
    minute: { mode: 'wildcard', value: '*' },
    hour: { mode: 'wildcard', value: '*' },
    day: { mode: 'wildcard', value: '*' },
    month: { mode: 'wildcard', value: '*' },
    weekday: { mode: 'wildcard', value: '?' },
    year: { mode: 'wildcard', value: '*' }
  }

  const [cronConfig, setCronConfig] = useState(defaultConfig)
  const [fullCron, setFullCron] = useState('* * * * * ? *')
  const [isSkipHoliday, setIsSkipHoliday] = useState(false)
  const [activeTab, setActiveTab] = useState('second')

  // 初始化：如果有传入值，解析它；若有 skipHoliday 初始值则同步
  useEffect(() => {
    if (visible && value) {
      try {
        const parsed = parseCron(value)
        if (parsed) {
          setCronConfig(parsed)
          setFullCron(value)
        }
      } catch (error) {
        console.warn('解析初始 Cron 表达式失败:', error)
        Message.warning('初始 Cron 表达式格式错误，已重置为默认值')
      }
    } else if (visible) {
      // 重置为默认值
      setCronConfig(defaultConfig)
      setFullCron('* * * * * ? *')
    }
    if (visible && initialSkipHoliday !== undefined && initialSkipHoliday !== null) {
      setIsSkipHoliday(Boolean(initialSkipHoliday))
    }
  }, [visible, value, initialSkipHoliday])

  // 当配置变化时，重新生成 Cron 表达式
  useEffect(() => {
    try {
      const newCron = generateCron(cronConfig)
      setFullCron(newCron)
    } catch (error) {
      console.error('生成 Cron 表达式失败:', error)
    }
  }, [cronConfig])

  // 处理配置变化
  const handleConfigChange = useCallback((dimension, config) => {
    setCronConfig(prev => ({
      ...prev,
      [dimension]: config
    }))
  }, [])

  // 处理完整表达式变化（手动编辑）
  const handleCronChange = useCallback((newCron) => {
    try {
      const parsed = parseCron(newCron)
      if (parsed) {
        setCronConfig(parsed)
        setFullCron(newCron)
      } else {
        Message.error('表达式格式错误，请检查配置')
      }
    } catch (error) {
      Message.error('表达式格式错误，请检查配置')
    }
  }, [])

  // 重置
  const handleReset = () => {
    setCronConfig(defaultConfig)
    setFullCron('* * * * * ? *')
    setIsSkipHoliday(false)
    setActiveTab('second')
  }

  // 确定：回传 cron 与「跳过节假日」状态，便于收件管理持久化（仅收一个参数的回调会忽略第二参）
  const handleConfirm = () => {
    if (onChange) {
      onChange(fullCron, isSkipHoliday)
    }
    if (onCancel) {
      onCancel()
    }
  }

  // 取消
  const handleCancel = () => {
    // 恢复初始值
    if (value) {
      try {
        const parsed = parseCron(value)
        if (parsed) {
          setCronConfig(parsed)
          setFullCron(value)
        }
      } catch (error) {
        // 忽略错误
      }
    } else {
      setCronConfig(defaultConfig)
      setFullCron('* * * * * ? *')
    }
    setIsSkipHoliday(false)
    if (onCancel) {
      onCancel()
    }
  }

  return (
    <Modal
      visible={visible}
      title="Cron表达式"
      onCancel={handleCancel}
      footer={null}
      style={{ width: 900 }}
      className="cron-generator-modal"
    >
      <div className="cron-generator">
        <CronConfig
          cronConfig={cronConfig}
          activeTab={activeTab}
          isSkipHoliday={isSkipHoliday}
          onTabChange={setActiveTab}
          onConfigChange={handleConfigChange}
          onSkipHolidayChange={setIsSkipHoliday}
        />
        
        <CronPreview
          cronConfig={cronConfig}
          fullCron={fullCron}
          onCronChange={handleCronChange}
          onConfigChange={handleConfigChange}
        />
        
        <CronSchedule
          cronExpression={fullCron}
          isSkipHoliday={isSkipHoliday}
        />
        
        <div className="cron-actions">
          <Button onClick={handleCancel}>取消</Button>
          <Button onClick={handleReset}>重置</Button>
          <Button type="primary" onClick={handleConfirm}>确定</Button>
        </div>
      </div>
    </Modal>
  )
}

export default CronGenerator
