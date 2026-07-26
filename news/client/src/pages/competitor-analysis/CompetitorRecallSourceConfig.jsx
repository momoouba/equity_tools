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
    use_new_share_listed_recall: false,
    enable_recall_ab_compare: false,
    new_share_gray_categories: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/system/competitor-recall-source-config')
      if (res.data?.success && res.data.data) {
        const d = res.data.data
        setFlags({
          enable_ipo_project: !!d.enable_ipo_project,
          enable_financing_event: !!d.enable_financing_event,
          enable_ai_web: !!d.enable_ai_web,
          use_new_share_listed_recall: !!d.use_new_share_listed_recall,
          enable_recall_ab_compare: !!d.enable_recall_ab_compare,
          new_share_gray_categories: d.new_share_gray_categories || '',
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
        <Typography.Paragraph style={{ marginTop: 8, marginBottom: 0, color: 'var(--color-text-3)' }}>
          Stage 4 · 上市召回灰度（默认不改主路径）
        </Typography.Paragraph>
        <div>
          <Switch
            checked={flags.enable_recall_ab_compare}
            disabled={saving}
            onChange={(v) => onToggle('enable_recall_ab_compare', v)}
          />
          <span style={{ marginLeft: 12 }}>
            A/B 对比（并行新旧召回统计写入 S1 step_log，不改落库候选）
          </span>
        </div>
        <div>
          <Switch
            checked={flags.use_new_share_listed_recall}
            disabled={saving}
            onChange={(v) => onToggle('use_new_share_listed_recall', v)}
          />
          <span style={{ marginLeft: 12 }}>
            主召回切到 ipo_new_share（关闭则仍用 1.0 ipo_project）
          </span>
        </div>
      </Space>
    </div>
  )
}

export default CompetitorRecallSourceConfig
