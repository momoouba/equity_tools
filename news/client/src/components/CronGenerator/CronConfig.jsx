import React from 'react'
import { Tabs, Radio, InputNumber, Switch, Checkbox } from '@arco-design/web-react'
import './CronConfig.css'

const DIMENSIONS = [
  { key: 'second', label: '秒', min: 0, max: 59 },
  { key: 'minute', label: '分钟', min: 0, max: 59 },
  { key: 'hour', label: '小时', min: 1, max: 23 },
  { key: 'day', label: '日', min: 1, max: 31 },
  { key: 'month', label: '月', min: 1, max: 12 },
  { key: 'weekday', label: '周', min: 1, max: 7 },
  { key: 'year', label: '年', min: new Date().getFullYear(), max: new Date().getFullYear() + 10 },
]

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function normalizeSpecifyValue(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
      .filter((n) => !Number.isNaN(n))
  }
  if (raw === null || raw === undefined || raw === '' || raw === '*' || raw === '?') return []
  if (typeof raw === 'number') return [raw]
  const n = parseInt(String(raw), 10)
  return Number.isNaN(n) ? [] : [n]
}

/**
 * Cron 配置区：指定值用页内勾选网格，避免 SheetModal 内 Select 下拉被遮挡/秒关。
 */
function CronConfig({ cronConfig, activeTab, isSkipHoliday, onTabChange, onConfigChange, onSkipHolidayChange }) {
  const currentConfig = cronConfig[activeTab] || { mode: 'wildcard', value: '*' }
  const currentDimension = DIMENSIONS.find((d) => d.key === activeTab)

  const handleModeChange = (mode) => {
    const newConfig = { ...currentConfig, mode }

    if (mode === 'wildcard') {
      newConfig.value = activeTab === 'weekday' ? '?' : '*'
    } else if (mode === 'range') {
      newConfig.start = currentConfig.start ?? currentDimension.min
      newConfig.end = currentConfig.end ?? currentDimension.max
    } else if (mode === 'step') {
      newConfig.start = currentConfig.start ?? currentDimension.min
      newConfig.step = currentConfig.step ?? 1
    } else if (mode === 'specify') {
      const existing = normalizeSpecifyValue(currentConfig.values ?? currentConfig.value).filter(
        (n) => n >= currentDimension.min && n <= currentDimension.max
      )
      const values = existing.length ? existing : [currentDimension.min]
      newConfig.value = values.length === 1 ? values[0] : values
      newConfig.values = values
    }

    onConfigChange(activeTab, newConfig)
  }

  const handleRangeChange = (field, value) => {
    onConfigChange(activeTab, {
      ...currentConfig,
      mode: 'range',
      [field]: value,
    })
  }

  const handleStepChange = (field, value) => {
    onConfigChange(activeTab, {
      ...currentConfig,
      mode: 'step',
      [field]: value,
    })
  }

  const handleSpecifyValuesChange = (values) => {
    const sorted = [...values]
      .map((v) => (typeof v === 'number' ? v : parseInt(v, 10)))
      .filter((n) => !Number.isNaN(n) && n >= currentDimension.min && n <= currentDimension.max)
      .sort((a, b) => a - b)

    onConfigChange(activeTab, {
      ...currentConfig,
      mode: 'specify',
      value: sorted.length === 1 ? sorted[0] : sorted,
      values: sorted,
    })
  }

  const renderSpecifyPicker = () => {
    const selected = normalizeSpecifyValue(currentConfig.values ?? currentConfig.value).filter(
      (n) => n >= currentDimension.min && n <= currentDimension.max
    )
    const disabled = currentConfig.mode !== 'specify'
    const options =
      activeTab === 'weekday'
        ? WEEKDAY_NAMES.map((name, index) => ({ value: index + 1, label: name }))
        : Array.from({ length: currentDimension.max - currentDimension.min + 1 }, (_, i) => {
            const value = currentDimension.min + i
            return { value, label: String(value) }
          })

    return (
      <div className={`cron-specify-panel${disabled ? ' is-disabled' : ''}`}>
        <div className="cron-specify-toolbar">
          <button
            type="button"
            className="cron-specify-link"
            disabled={disabled}
            onClick={() => handleSpecifyValuesChange(options.map((o) => o.value))}
          >
            全选
          </button>
          <button
            type="button"
            className="cron-specify-link"
            disabled={disabled}
            onClick={() => handleSpecifyValuesChange([])}
          >
            清空
          </button>
          <span className="cron-specify-hint">已选 {selected.length} 项（可多选）</span>
        </div>
        <Checkbox.Group
          value={selected}
          disabled={disabled}
          onChange={handleSpecifyValuesChange}
          className={
            activeTab === 'weekday' || activeTab === 'month' || activeTab === 'hour'
              ? 'cron-specify-grid cron-specify-grid--wide'
              : 'cron-specify-grid'
          }
        >
          {options.map((opt) => (
            <Checkbox key={opt.value} value={opt.value}>
              {opt.label}
            </Checkbox>
          ))}
        </Checkbox.Group>
      </div>
    )
  }

  const renderConfigControls = () => {
    const { mode } = currentConfig

    return (
      <div className="cron-config-controls">
        <Radio.Group value={mode} onChange={handleModeChange}>
          <Radio value="wildcard">
            {activeTab === 'weekday'
              ? '周, 允许的通配符[, - * / ?]'
              : `${currentDimension.label}, 允许的通配符[, - * /]`}
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
              value={currentConfig.start ?? currentDimension.min}
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

          <Radio value="specify">指定</Radio>
        </Radio.Group>

        {mode === 'specify' ? renderSpecifyPicker() : null}
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
        {DIMENSIONS.map((dim) => (
          <Tabs.TabPane key={dim.key} title={dim.label}>
            {activeTab === dim.key && renderConfigControls()}
          </Tabs.TabPane>
        ))}
      </Tabs>
    </div>
  )
}

export default CronConfig
