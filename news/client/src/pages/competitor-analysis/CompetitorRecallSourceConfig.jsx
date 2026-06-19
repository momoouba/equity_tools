import React, { useEffect, useState } from 'react'
import { Switch, Typography, Message, Skeleton, Space } from '@arco-design/web-react'
import axios from '../../utils/axios'

/**
 * 系统配置 · 竞品三源召回：底层项目 / 融资事件 / 联网发现
 */
function CompetitorRecallSourceConfig() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [flags, setFlags] = useState({
    enable_ipo_project: true,
    enable_financing_event: true,
    enable_ai_web: true,
  })

  const load = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/system/competitor-recall-source-config')
      if (res.data?.success && res.data.data) {
        setFlags({
          enable_ipo_project: !!res.data.data.enable_ipo_project,
          enable_financing_event: !!res.data.data.enable_financing_event,
          enable_ai_web: !!res.data.data.enable_ai_web,
        })
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '加载配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const save = async (next) => {
    setSaving(true)
    try {
      const res = await axios.put('/api/system/competitor-recall-source-config', next)
      if (res.data?.success) {
        setFlags(next)
        Message.success('已保存')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '保存失败')
      load()
    } finally {
      setSaving(false)
    }
  }

  const onToggle = (key, checked) => {
    const next = { ...flags, [key]: checked }
    save(next)
  }

  if (loading) {
    return <Skeleton text={{ rows: 4 }} animation />
  }

  return (
    <div className="competitor-recall-source-config">
      <Typography.Paragraph style={{ marginBottom: 20, color: 'var(--color-text-2)' }}>
        控制竞品分析任务的三路召回。关闭某源后，新发起的竞品分析将不再使用该数据源（进行中的任务不受影响）。
        「融资事件」除开关外，仍要求用户具备项目挖掘应用权限。
      </Typography.Paragraph>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Switch
            checked={flags.enable_ipo_project}
            disabled={saving}
            onChange={(v) => onToggle('enable_ipo_project', v)}
          />
          <span style={{ marginLeft: 12 }}>底层项目池（ipo_project · 竞品分析应用）</span>
        </div>
        <div>
          <Switch
            checked={flags.enable_financing_event}
            disabled={saving}
            onChange={(v) => onToggle('enable_financing_event', v)}
          />
          <span style={{ marginLeft: 12 }}>融资事件池（sourcing_financing_event · 跨应用只读）</span>
        </div>
        <div>
          <Switch
            checked={flags.enable_ai_web}
            disabled={saving}
            onChange={(v) => onToggle('enable_ai_web', v)}
          />
          <span style={{ marginLeft: 12 }}>联网发现（AI 检索第三源）</span>
        </div>
      </Space>
    </div>
  )
}

export default CompetitorRecallSourceConfig
