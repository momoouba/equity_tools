import React, { useState } from 'react'
import { Table, Input } from '@arco-design/web-react'
import './CronPreview.css'

const DIMENSIONS = [
  { key: 'second', label: '秒' },
  { key: 'minute', label: '分钟' },
  { key: 'hour', label: '小时' },
  { key: 'day', label: '日' },
  { key: 'month', label: '月' },
  { key: 'weekday', label: '周' },
  { key: 'year', label: '年' }
]

/**
 * Cron 表达式预览组件
 */
function CronPreview({ cronConfig, fullCron, onCronChange, onConfigChange }) {
  const [editingCell, setEditingCell] = useState(null)
  const [editingValue, setEditingValue] = useState('')

  // 表格列定义
  const columns = [
    {
      title: '维度',
      dataIndex: 'label',
      width: 80
    },
    {
      title: '表达式',
      dataIndex: 'value',
      width: 200,
      render: (value, record) => {
        if (editingCell === record.key) {
          return (
            <Input
              value={editingValue}
              onChange={setEditingValue}
              onBlur={() => handleCellBlur(record.key)}
              onPressEnter={() => handleCellBlur(record.key)}
              autoFocus
            />
          )
        }
        return (
          <span
            onClick={() => handleCellClick(record.key, value)}
            style={{ cursor: 'pointer', padding: '4px 8px', display: 'inline-block', minWidth: '100px' }}
          >
            {value}
          </span>
        )
      }
    }
  ]

  // 表格数据
  const tableData = DIMENSIONS.map(dim => ({
    key: dim.key,
    label: dim.label,
    value: getDimensionValue(cronConfig[dim.key])
  }))

  // 获取维度值
  function getDimensionValue(config) {
    if (!config) return '*'
    const { mode, value } = config
    
    if (mode === 'wildcard') {
      return value || '*'
    } else if (mode === 'range') {
      return `${config.start}-${config.end}`
    } else if (mode === 'step') {
      return `${config.start}/${config.step}`
    } else if (mode === 'specify') {
      return Array.isArray(value) ? value.join(',') : String(value)
    }
    
    return '*'
  }

  // 处理单元格点击
  const handleCellClick = (key, currentValue) => {
    setEditingCell(key)
    setEditingValue(currentValue)
  }

  // 处理单元格失焦
  const handleCellBlur = (key) => {
    if (editingCell === key) {
      // 解析并更新配置
      try {
        const dimension = DIMENSIONS.find(d => d.key === key)
        const parsed = parseDimensionValue(editingValue, dimension)
        if (parsed) {
          onConfigChange(key, parsed)
        }
      } catch (error) {
        console.error('解析失败:', error)
      }
      setEditingCell(null)
      setEditingValue('')
    }
  }

  // 解析维度值
  function parseDimensionValue(value, dimension) {
    if (!value || value.trim() === '') {
      return { mode: 'wildcard', value: dimension.key === 'weekday' ? '?' : '*' }
    }

    const trimmed = value.trim()

    // 通配符
    if (trimmed === '*') {
      return { mode: 'wildcard', value: '*' }
    }

    // 问号
    if (trimmed === '?' && (dimension.key === 'day' || dimension.key === 'weekday')) {
      return { mode: 'wildcard', value: '?' }
    }

    // 周期范围
    if (/^\d+-\d+$/.test(trimmed)) {
      const [start, end] = trimmed.split('-').map(Number)
      const bounds = getBounds(dimension.key)
      if (start >= bounds.min && end <= bounds.max && start <= end) {
        return { mode: 'range', start, end, value: trimmed }
      }
    }

    // 间隔执行
    if (/^\d+\/\d+$/.test(trimmed) || /^\*\/\d+$/.test(trimmed)) {
      const parts = trimmed.split('/')
      const start = parts[0] === '*' ? 0 : Number(parts[0])
      const step = Number(parts[1])
      const bounds = getBounds(dimension.key)
      if (start >= bounds.min && start <= bounds.max && step > 0) {
        return { mode: 'step', start, step, value: trimmed }
      }
    }

    // 指定值
    if (/^\d+(,\d+)*$/.test(trimmed)) {
      const values = trimmed.split(',').map(Number)
      const bounds = getBounds(dimension.key)
      const validValues = values.filter(v => v >= bounds.min && v <= bounds.max)
      if (validValues.length > 0) {
        return {
          mode: 'specify',
          value: validValues.length === 1 ? validValues[0] : validValues,
          values: validValues
        }
      }
    }

    return null
  }

  // 获取边界值
  function getBounds(key) {
    const boundsMap = {
      second: { min: 0, max: 59 },
      minute: { min: 0, max: 59 },
      hour: { min: 0, max: 23 },
      day: { min: 1, max: 31 },
      month: { min: 1, max: 12 },
      weekday: { min: 1, max: 7 },
      year: { min: 1970, max: 2099 }
    }
    return boundsMap[key] || { min: 0, max: 59 }
  }

  // 处理完整表达式变化
  const handleFullCronChange = (value) => {
    if (onCronChange) {
      onCronChange(value)
    }
  }

  return (
    <div className="cron-preview">
      <div className="cron-preview-table">
        <Table
          columns={columns}
          data={tableData}
          pagination={false}
          border={{
            wrapper: true,
            cell: true
          }}
          size="small"
        />
      </div>
      
      <div className="cron-preview-expression">
        <div className="cron-preview-label">crontab完整表达式：</div>
        <Input
          value={fullCron}
          onChange={handleFullCronChange}
          onBlur={(e) => {
            // 失去焦点时解析并同步
            if (onCronChange) {
              onCronChange(e.target.value)
            }
          }}
          placeholder="* * * * * ? *"
        />
      </div>
    </div>
  )
}

export default CronPreview
