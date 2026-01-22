import React, { useState, useEffect } from 'react'
import { Tabs, Radio, InputNumber, Input, Switch, Select } from '@arco-design/web-react'
import './CronConfig.css'

const Option = Select.Option

const DIMENSIONS = [
  { key: 'second', label: '秒', min: 0, max: 59 },
  { key: 'minute', label: '分钟', min: 0, max: 59 },
  { key: 'hour', label: '小时', min: 0, max: 23 },
  { key: 'day', label: '日', min: 1, max: 31 },
  { key: 'month', label: '月', min: 1, max: 12 },
  { key: 'weekday', label: '周', min: 1, max: 7 },
  { key: 'year', label: '年', min: 1970, max: 2099 }
]

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * Cron 配置区组件
 */
function CronConfig({ cronConfig, activeTab, isSkipHoliday, onTabChange, onConfigChange, onSkipHolidayChange }) {
  const currentConfig = cronConfig[activeTab] || { mode: 'wildcard', value: '*' }
  const currentDimension = DIMENSIONS.find(d => d.key === activeTab)

  // 处理配置模式变化
  const handleModeChange = (mode) => {
    const newConfig = { ...currentConfig, mode }
    
    // 根据模式设置默认值
    if (mode === 'wildcard') {
      newConfig.value = activeTab === 'weekday' ? '?' : '*'
    } else if (mode === 'range') {
      newConfig.start = currentConfig.start ?? currentDimension.min
      newConfig.end = currentConfig.end ?? currentDimension.max
    } else if (mode === 'step') {
      newConfig.start = currentConfig.start ?? 0
      newConfig.step = currentConfig.step ?? 1
    } else if (mode === 'specify') {
      newConfig.value = currentConfig.value ?? (Array.isArray(currentConfig.value) ? currentConfig.value : [currentDimension.min])
      if (Array.isArray(newConfig.value)) {
        newConfig.values = newConfig.value
      }
    }

    onConfigChange(activeTab, newConfig)
  }

  // 处理范围配置变化
  const handleRangeChange = (field, value) => {
    const newConfig = {
      ...currentConfig,
      mode: 'range',
      [field]: value
    }
    onConfigChange(activeTab, newConfig)
  }

  // 处理间隔配置变化
  const handleStepChange = (field, value) => {
    const newConfig = {
      ...currentConfig,
      mode: 'step',
      [field]: value
    }
    onConfigChange(activeTab, newConfig)
  }

  // 处理指定值变化
  const handleSpecifyChange = (value) => {
    // 解析输入的值（支持逗号分隔）
    let values = []
    if (typeof value === 'string') {
      values = value.split(',').map(v => {
        const num = parseInt(v.trim(), 10)
        return isNaN(num) ? null : num
      }).filter(v => v !== null && v >= currentDimension.min && v <= currentDimension.max)
    } else if (Array.isArray(value)) {
      values = value.filter(v => v >= currentDimension.min && v <= currentDimension.max)
    } else if (typeof value === 'number') {
      values = [value]
    }

    const newConfig = {
      ...currentConfig,
      mode: 'specify',
      value: values.length === 1 ? values[0] : values,
      values: values
    }
    onConfigChange(activeTab, newConfig)
  }

  // 渲染配置控件
  const renderConfigControls = () => {
    const { mode } = currentConfig

    return (
      <div className="cron-config-controls">
        <Radio.Group value={mode} onChange={handleModeChange}>
          <Radio value="wildcard">
            {activeTab === 'weekday' ? '周, 允许的通配符[, - * / ?]' : `${currentDimension.label}, 允许的通配符[, - * /]`}
          </Radio>
          
          <Radio value="range">
            <span>周期从</span>
            <InputNumber
              value={currentConfig.start ?? currentDimension.min}
              min={currentDimension.min}
              max={currentDimension.max}
              onChange={(val) => handleRangeChange('start', val)}
              disabled={mode !== 'range'}
              style={{ width: 80, margin: '0 8px' }}
            />
            <span>-</span>
            <InputNumber
              value={currentConfig.end ?? currentDimension.max}
              min={currentDimension.min}
              max={currentDimension.max}
              onChange={(val) => handleRangeChange('end', val)}
              disabled={mode !== 'range'}
              style={{ width: 80, margin: '0 8px' }}
            />
            <span>{currentDimension.label}</span>
          </Radio>

          <Radio value="step">
            <span>从</span>
            <InputNumber
              value={currentConfig.start ?? 0}
              min={currentDimension.min}
              max={currentDimension.max}
              onChange={(val) => handleStepChange('start', val)}
              disabled={mode !== 'step'}
              style={{ width: 80, margin: '0 8px' }}
            />
            <span>{currentDimension.label}开始, 每</span>
            <InputNumber
              value={currentConfig.step ?? 1}
              min={1}
              max={currentDimension.max}
              onChange={(val) => handleStepChange('step', val)}
              disabled={mode !== 'step'}
              style={{ width: 80, margin: '0 8px' }}
            />
            <span>{currentDimension.label}执行一次</span>
          </Radio>

          <Radio value="specify">
            <span>指定</span>
            {activeTab === 'weekday' ? (
              <Select
                mode="multiple"
                value={Array.isArray(currentConfig.value) ? currentConfig.value : (currentConfig.value ? [currentConfig.value] : [])}
                onChange={handleSpecifyChange}
                disabled={mode !== 'specify'}
                style={{ width: 200, margin: '0 8px' }}
                placeholder="请选择星期"
              >
                {WEEKDAY_NAMES.map((name, index) => (
                  <Option key={index + 1} value={index + 1}>{name}</Option>
                ))}
              </Select>
            ) : (
              <Input
                value={Array.isArray(currentConfig.value) ? currentConfig.value.join(',') : (currentConfig.value ?? '')}
                onChange={handleSpecifyChange}
                disabled={mode !== 'specify'}
                placeholder="多个值用逗号分隔"
                style={{ width: 200, margin: '0 8px' }}
              />
            )}
          </Radio>
        </Radio.Group>
      </div>
    )
  }

  return (
    <div className="cron-config">
      <div className="cron-config-header">
        <Switch
          checked={isSkipHoliday}
          onChange={onSkipHolidayChange}
          checkedText="跳过节假日"
          uncheckedText="跳过节假日"
        />
      </div>

      <Tabs activeTab={activeTab} onChange={onTabChange} type="line">
        {DIMENSIONS.map(dim => (
          <Tabs.TabPane key={dim.key} title={dim.label}>
            {activeTab === dim.key && renderConfigControls()}
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  )
}

export default CronConfig
