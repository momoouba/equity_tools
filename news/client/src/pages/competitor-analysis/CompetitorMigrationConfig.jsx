import React, { useEffect, useState } from 'react'
import { Button, Space, Message, Tag, Switch } from '@arco-design/web-react'
import axios from '../../utils/axios'
import CronGenerator from '../../components/CronGenerator'
import AdminListTable, { AdminOps } from '../../components/AdminListTable'

/**
 * 系统配置 · 竞品分析：投前→投后竞品数据自动迁移定时任务配置
 * 样式参考新闻接口配置列表页
 */
function CompetitorMigrationConfig() {
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState({ cron: '0 30 18 * * ? *', active: true, lastSync: null })
  const [showCronModal, setShowCronModal] = useState(false)
  const [tempCron, setTempCron] = useState('0 30 18 * * ? *')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const fetchConfig = async () => {
    setLoading(true)
    try {
      const res = await axios.get('/api/competitor-analysis/competitor-migration/config')
      if (res.data?.success && res.data.data) {
        setConfig(res.data.data)
      }
    } catch (e) {
      Message.error('获取配置失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfig()
  }, [])

  // 格式化 Cron 表达式为友好文本（支持 Quartz 7段和 node-cron 5段）
  const formatCronExpression = (cronStr) => {
    if (!cronStr) return '-'
    const parts = cronStr.trim().split(/\s+/)
    // Quartz 7段: 秒 分 时 日 月 周 年
    if (parts.length === 7) {
      const [, minute, hour, day, , weekday] = parts
      if (day === '*' && (weekday === '?' || weekday === '*')) {
        return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      }
      if (weekday !== '?' && weekday !== '*') {
        const weekNames = { '1': '周日', '2': '周一', '3': '周二', '4': '周三', '5': '周四', '6': '周五', '7': '周六' }
        return `每${weekNames[weekday] || `周${weekday}`} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      }
      return cronStr
    }
    // node-cron 5段: 分 时 日 月 周
    if (parts.length === 5) {
      const [minute, hour, day, , weekday] = parts
      if (day === '*' && weekday === '*') {
        return `每天 ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
      }
      return cronStr
    }
    return cronStr
  }

  const formatDate = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  // 切换启用/禁用
  const handleToggleActive = async (checked) => {
    try {
      const res = await axios.put('/api/competitor-analysis/competitor-migration/config', {
        active: checked
      })
      if (res.data?.success) {
        Message.success(checked ? '已启用' : '已禁用')
        fetchConfig()
      } else {
        Message.error(res.data?.message || '操作失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '操作失败')
    }
  }

  // 手动触发同步
  const handleManualSync = async () => {
    setSyncing(true)
    try {
      const res = await axios.post('/api/competitor-analysis/competitor-migration/run', {}, { timeout: 300000 })
      if (res.data?.success) {
        Message.success(res.data.message || '同步完成')
        fetchConfig()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      if (e.code === 'ECONNABORTED') {
        Message.warning('请求超时，任务可能仍在后台执行')
      } else {
        Message.error(e.response?.data?.message || '同步失败')
      }
    } finally {
      setSyncing(false)
    }
  }

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      width: 260,
      render: () => '投前→投后竞品数据自动同步'
    },
    {
      title: 'Cron表达式',
      dataIndex: 'cron',
      width: 200,
      render: (text) => (
        <Space>
          <span>{formatCronExpression(text)}</span>
          <Tag size="small" color="arcoblue">{text}</Tag>
        </Space>
      )
    },
    {
      title: '最后同步时间',
      dataIndex: 'lastSync',
      width: 200,
      render: (text) => formatDate(text)
    },
    {
      title: '状态',
      dataIndex: 'active',
      width: 100,
      render: (isActive) => (
        <Tag color={isActive ? 'green' : 'red'}>
          {isActive ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '操作',
      width: 132,
      className: 'admin-ops-col',
      render: (_, record) => (
        <AdminOps>
          <Button
            type="outline"
            size="small"
            onClick={() => {
              setTempCron(record.cron)
              setShowCronModal(true)
            }}
          >
            编辑Cron
          </Button>
          <Button type="outline" size="small" loading={syncing} onClick={handleManualSync}>
            手动同步
          </Button>
          <Switch
            size="small"
            checked={record.active}
            onChange={handleToggleActive}
          />
        </AdminOps>
      )
    }
  ]

  // 将 config 转为表格数据源（单行）
  const tableData = [{
    key: '1',
    name: '投前→投后竞品数据自动同步',
    cron: config.cron,
    lastSync: config.lastSync,
    active: config.active
  }]

  return (
    <div className="competitor-migration-config">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>竞品分析 · 定时迁移任务</h3>
        <Space>
          <Button onClick={fetchConfig} loading={loading}>刷新</Button>
        </Space>
      </div>

      <p style={{ color: '#86909c', fontSize: 13, marginBottom: 16 }}>
        每日定时检查投前项目中与被投企业全称匹配的记录，将最新一次成功的投前竞品分析数据同步至投后（排除已上市/完全退出企业）。
      </p>

      <AdminListTable
        columns={columns}
        data={tableData}
        loading={loading}
        pagination={false}
        style={{ marginBottom: 16 }}
      />

      {/* Cron 表达式配置弹窗 */}
      <CronGenerator
        visible={showCronModal}
        value={tempCron}
        onChange={(cron) => {
          setTempCron(cron)
          setShowCronModal(false)
          // 自动保存
          setTimeout(() => {
            setSaving(true)
            axios.put('/api/competitor-analysis/competitor-migration/config', { cron_expression: cron })
              .then((res) => {
                if (res.data?.success) {
                  Message.success('Cron 表达式已更新')
                  fetchConfig()
                } else {
                  Message.error(res.data?.message || '更新失败')
                }
              })
              .catch((e) => {
                Message.error(e.response?.data?.message || '更新失败')
              })
              .finally(() => setSaving(false))
          }, 0)
        }}
        onCancel={() => setShowCronModal(false)}
      />
    </div>
  )
}

export default CompetitorMigrationConfig
