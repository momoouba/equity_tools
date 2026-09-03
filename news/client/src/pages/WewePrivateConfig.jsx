import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Collapse,
  Input,
  InputNumber,
  Message,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tabs,
  Tag,
  Typography
} from '@arco-design/web-react'
import axios from '../utils/axios'
import AdminListTable, { AdminOps } from '../components/AdminListTable'
import './WewePrivateConfig.css'

const TabPane = Tabs.TabPane
const CollapseItem = Collapse.Item
const Option = Select.Option

const ACCOUNT_PAGE_SIZE_OPTIONS = [20, 50, 100]

function apiOrigin() {
  if (import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `http://${window.location.hostname}:${import.meta.env.VITE_DEV_API_PORT || '3002'}`
  }
  return ''
}

const boolFields = [
  { key: 'wewe_enabled', label: '总开关', hint: '关闭则专队全部不跑' },
  { key: 'enqueue_enabled', label: '允许入队', hint: '新榜「数据不存在」写入专队' },
  { key: 'extract_enabled', label: '允许提取', hint: 'extract_start 当晚入队；catchup_extract_start 隔日补抓昨天 21:00 后；有文优先，空号 1 分钟' },
  { key: 'ingest_enabled', label: '允许入库', hint: '工作日 ingest_at 写入 news_detail' },
  { key: 'remind_enabled', label: '允许催办', hint: '可独立早开；读书失效催办 00:00–07:00 静默，7 点后再发' }
]

function statusColor(s) {
  if (s === 'active' || s === 'mapped' || s === 'ok') return 'green'
  if (s === 'pending_subscribe' || s === 'buffering') return 'orangered'
  if (s === 'expired' || s === 'failed' || s === 'session_dead') return 'red'
  return 'gray'
}

/** 同源反代 + ticket 注入 authCode */
function WeweRssAdminEmbed() {
  const [iframeKey, setIframeKey] = useState(0)
  const [bootError, setBootError] = useState('')
  const [gateUrl, setGateUrl] = useState('')
  const [directUrl, setDirectUrl] = useState('')

  const loadEmbed = useCallback(async () => {
    setBootError('')
    setGateUrl('')
    try {
      const res = await axios.get('/api/wewe-probe/team/wewe-auth-bootstrap')
      if (!res.data?.success) throw new Error(res.data?.message || 'bootstrap failed')
      const ticket = res.data.embedTicket
      if (!ticket) throw new Error('未返回嵌入票据')
      const origin = apiOrigin()
      const url = `${origin}/wewe-rss-gate?t=${encodeURIComponent(ticket)}`
      setGateUrl(url)
      setDirectUrl(url)
      setIframeKey((k) => k + 1)
    } catch (e) {
      const msg = e.response?.data?.message || e.message || '获取 wewe 授权失败'
      setBootError(msg)
      Message.error(msg)
    }
  }, [])

  useEffect(() => {
    loadEmbed()
  }, [loadEmbed])

  return (
    <div className="wewe-rss-embed">
      <div className="wewe-rss-embed__toolbar">
        <Typography.Text type="secondary" style={{ flex: 1 }}>
          自动注入 AUTH_CODE 后进入管理页（扫码/订阅）。嵌入与「新窗口打开」均走本站反代，无需手输授权码。
        </Typography.Text>
        <Space>
          <Button size="small" onClick={loadEmbed}>
            刷新嵌入
          </Button>
          <Button
            size="small"
            type="primary"
            disabled={!directUrl}
            onClick={() => window.open(directUrl, '_blank', 'noopener,noreferrer')}
          >
            新窗口打开
          </Button>
        </Space>
      </div>
      <div className="wewe-rss-embed__url">{gateUrl || '正在签发嵌入票据…'}</div>
      {bootError ? (
        <div className="wewe-rss-embed__fallback">
          <p>{bootError}</p>
          <Button type="primary" onClick={loadEmbed}>
            重试
          </Button>
        </div>
      ) : gateUrl ? (
        <iframe
          key={iframeKey}
          className="wewe-rss-embed__frame"
          title="wewe-rss 管理"
          src={gateUrl}
        />
      ) : (
        <div className="wewe-rss-embed__fallback">
          <p>正在加载 wewe-rss…</p>
        </div>
      )}
    </div>
  )
}

function WewePrivateConfig() {
  const [subTab, setSubTab] = useState('team')
  const [loading, setLoading] = useState(true)
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [session, setSession] = useState(null)
  const [phaseInfo, setPhaseInfo] = useState(null)
  const [weweAccounts, setWeweAccounts] = useState([])
  const [hasEnabledAccount, setHasEnabledAccount] = useState(null)
  const [mapTarget, setMapTarget] = useState(null)
  const [sampleUrl, setSampleUrl] = useState('')
  const [mapping, setMapping] = useState(false)
  const [accountFilter, setAccountFilter] = useState('all')
  const [accountKeyword, setAccountKeyword] = useState('')
  const [filterCollapsed, setFilterCollapsed] = useState(false)
  const [accountPage, setAccountPage] = useState(1)
  const [accountPageSize, setAccountPageSize] = useState(ACCOUNT_PAGE_SIZE_OPTIONS[0])
  const [remindingPending, setRemindingPending] = useState(false)
  const [unsubscribingId, setUnsubscribingId] = useState('')
  const [enqueueBlockingId, setEnqueueBlockingId] = useState('')

  const loadConfigAndSession = useCallback(async () => {
    setLoading(true)
    try {
      const [cfgRes, sessRes] = await Promise.all([
        axios.get('/api/wewe-probe/team/config'),
        axios.get('/api/wewe-probe/team/session')
      ])
      if (cfgRes.data?.success) setConfig(cfgRes.data.config)
      if (sessRes.data?.success) {
        setSession(sessRes.data.session)
        setPhaseInfo(sessRes.data.phaseInfo)
        setWeweAccounts(sessRes.data.weweAccounts || [])
        setHasEnabledAccount(
          typeof sessRes.data.hasEnabledAccount === 'boolean'
            ? sessRes.data.hasEnabledAccount
            : null
        )
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '加载 wewe 配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      const accRes = await axios.get('/api/wewe-probe/team/accounts')
      if (accRes.data?.success) setAccounts(accRes.data.accounts || [])
    } catch (e) {
      Message.error(e.response?.data?.message || '加载专队账号失败')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfigAndSession()
  }, [loadConfigAndSession])

  useEffect(() => {
    if (subTab === 'accounts' || subTab === 'team') {
      loadAccounts()
    }
  }, [subTab, loadAccounts])

  const patchConfig = async (patch, okMsg = '已保存') => {
    setSaving(true)
    try {
      const res = await axios.patch('/api/wewe-probe/team/config', patch)
      if (res.data?.success) {
        setConfig(res.data.config)
        Message.success(okMsg)
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '保存失败')
      loadConfigAndSession()
    } finally {
      setSaving(false)
    }
  }

  const onToggle = (key, checked) => {
    patchConfig({ [key]: checked })
  }

  const saveFields = () => {
    if (!config) return
    patchConfig(
      {
        wewe_base_url: config.wewe_base_url || '',
        ops_email: config.ops_email || '',
        extract_start: config.extract_start || '21:00',
        catchup_extract_start: config.catchup_extract_start || '06:00',
        ingest_at: config.ingest_at || '00:00',
        poll_interval_minutes: Number(config.poll_interval_minutes) || 5,
        session_ttl_hours: Number(config.session_ttl_hours) || 24,
        remind_before_hours: Number(config.remind_before_hours) || 24,
        remind_interval_buffer_hours: Number(config.remind_interval_buffer_hours) || 2,
        remind_interval_dead_minutes: Number(config.remind_interval_dead_minutes) || 30,
        remind_daily_cap: Number(config.remind_daily_cap) || 20
      },
      '参数已保存'
    )
  }

  const openLiveQr = async () => {
    try {
      const res = await axios.post('/api/wewe-probe/team/live-qr-link', {})
      if (res.data?.success && res.data.pageUrl) {
        window.open(res.data.pageUrl, '_blank', 'noopener,noreferrer')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '签发活码失败')
    }
  }

  const checkHealth = async () => {
    try {
      const res = await axios.get('/api/wewe-probe/health')
      if (res.data?.success) {
        Message.success(`wewe 可达：${res.data.config?.baseUrl || ''}`)
      } else {
        Message.warning(res.data?.message || '健康检查异常')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || 'wewe 健康检查失败')
    }
  }

  const submitMapUrl = async () => {
    if (!mapTarget || !sampleUrl.trim()) {
      Message.warning('请填写分享链接')
      return
    }
    setMapping(true)
    try {
      const res = await axios.post('/api/wewe-probe/team/map-url', {
        wechat_account_id: mapTarget.wechat_account_id,
        sample_article_url: sampleUrl.trim()
      })
      if (res.data?.success) {
        Message.success(res.data.message || '映射成功')
        setMapTarget(null)
        setSampleUrl('')
        loadAccounts()
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '映射失败')
    } finally {
      setMapping(false)
    }
  }

  const sendPendingDigest = async () => {
    setRemindingPending(true)
    try {
      const res = await axios.post('/api/wewe-probe/team/remind-pending', { force: true })
      if (res.data?.success) {
        const r = res.data.result || {}
        if (r.action === 'idle_empty') {
          Message.info('当前没有待订阅账号')
        } else {
          Message.success(
            r.sent
              ? `已发送汇总邮件（${r.count || 0} 个账号）→ ${r.to || '运维邮箱'}`
              : `催办已执行（${r.count || 0} 个）：${r.subject || r.action || 'ok'}`
          )
        }
      }
    } catch (e) {
      Message.error(e.response?.data?.message || '发送待订阅催办失败')
    } finally {
      setRemindingPending(false)
    }
  }

  const unsubscribeAccount = (row) => {
    const name = row.account_name || row.wechat_account_id
    Modal.confirm({
      title: '从 wewe 退订',
      content: `将删除 wewe-rss 里「${name}」的订阅，并把专队状态标为已出队。若仅不想再次被新榜自动拉回队列，可改用「禁止重新入队」（不删 wewe 订阅）。`,
      okText: '退订',
      okButtonProps: { status: 'danger' },
      cancelText: '取消',
      onOk: async () => {
        setUnsubscribingId(row.F_Id)
        try {
          const res = await axios.post('/api/wewe-probe/team/unsubscribe', {
            wechat_account_id: row.wechat_account_id
          })
          if (res.data?.success) {
            Message.success(res.data.message || '已退订')
            loadAccounts()
          } else {
            Message.error(res.data?.message || '退订失败')
            loadAccounts()
          }
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '退订失败')
          loadAccounts()
        } finally {
          setUnsubscribingId('')
        }
      }
    })
  }

  const toggleEnqueueBlock = (row, blocked) => {
    const name = row.account_name || row.wechat_account_id
    if (blocked) {
      Modal.confirm({
        title: '禁止重新入队',
        content: `「${name}」将标为已出队，且新榜再报「数据不存在」时也不会自动回到待订阅。不会删除 wewe-rss 已有订阅；若要退订请用「退订」。`,
        okText: '禁止入队',
        cancelText: '取消',
        onOk: () => postEnqueueBlock(row, true)
      })
    } else {
      postEnqueueBlock(row, false)
    }
  }

  const postEnqueueBlock = async (row, blocked) => {
    setEnqueueBlockingId(row.F_Id)
    try {
      const res = await axios.post('/api/wewe-probe/team/enqueue-block', {
        wechat_account_id: row.wechat_account_id,
        blocked
      })
      if (res.data?.success) {
        Message.success(res.data.message || (blocked ? '已禁止重新入队' : '已恢复允许入队'))
        loadAccounts()
      } else {
        Message.error(res.data?.message || '操作失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '操作失败')
    } finally {
      setEnqueueBlockingId('')
    }
  }

  const pendingCount = useMemo(
    () =>
      accounts.filter(
        (a) =>
          Number(a.enqueue_blocked) !== 1 &&
          (a.team_status === 'pending_subscribe' || a.map_status === 'pending_subscribe')
      ).length,
    [accounts]
  )

  const filteredAccounts = useMemo(() => {
    const kw = accountKeyword.trim().toLowerCase()
    return accounts.filter((a) => {
      if (accountFilter === 'pending_subscribe') {
        if (Number(a.enqueue_blocked) === 1) return false
        if (a.team_status !== 'pending_subscribe' && a.map_status !== 'pending_subscribe') {
          return false
        }
      }
      if (accountFilter === 'enqueue_blocked' && Number(a.enqueue_blocked) !== 1) {
        return false
      }
      if (accountFilter === 'exited' && a.team_status !== 'exited') {
        return false
      }
      if (accountFilter === 'active' && a.team_status !== 'active') {
        return false
      }
      if (!kw) return true
      const hay = [
        a.wechat_account_id,
        a.account_name,
        a.enterprise_full_name,
        a.project_abbreviation,
        a.feed_id,
        a.source_type,
        a.team_status,
        a.map_status
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(kw)
    })
  }, [accounts, accountFilter, accountKeyword])

  const pagedAccounts = useMemo(() => {
    const start = (accountPage - 1) * accountPageSize
    return filteredAccounts.slice(start, start + accountPageSize)
  }, [filteredAccounts, accountPage, accountPageSize])

  useEffect(() => {
    setAccountPage(1)
  }, [accountFilter, accountKeyword])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredAccounts.length / accountPageSize) || 1)
    if (accountPage > maxPage) setAccountPage(maxPage)
  }, [filteredAccounts.length, accountPage, accountPageSize])

  const columns = [
    {
      title: '公众号 ID',
      dataIndex: 'wechat_account_id',
      width: 160
    },
    {
      title: '公众号名称',
      dataIndex: 'account_name',
      width: 140,
      render: (v) => v || '-'
    },
    {
      title: '被投企业',
      dataIndex: 'enterprise_full_name',
      width: 207,
      render: (v, row) => v || row.project_abbreviation || '-'
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      width: 100,
      render: (v) => v || '-'
    },
    {
      title: '专队状态',
      dataIndex: 'team_status',
      width: 110,
      render: (v, row) => (
        <Space size={4}>
          <Tag color={statusColor(v)}>{v}</Tag>
          {Number(row.enqueue_blocked) === 1 ? (
            <Tag color="purple" size="small">
              禁入队
            </Tag>
          ) : null}
        </Space>
      )
    },
    {
      title: '映射',
      dataIndex: 'map_status',
      width: 79,
      render: (v) => <Tag color={statusColor(v)}>{v}</Tag>
    },
    {
      title: 'feed_id',
      dataIndex: 'feed_id',
      width: 168,
      render: (v) => v || '-'
    },
    {
      title: '最近提取',
      dataIndex: 'last_extract_status',
      width: 110,
      render: (v) => (v ? `${v}` : '-')
    },
    {
      title: '操作',
      width: 248,
      className: 'admin-ops-col admin-ops-col-nowrap',
      render: (_, row) => {
        const blocked = Number(row.enqueue_blocked) === 1
        const canUnsubscribe =
          Boolean(row.feed_id) ||
          row.team_status === 'active' ||
          row.team_status === 'pending_subscribe'
        const canBlockEnqueue =
          !blocked && (row.team_status === 'pending_subscribe' || row.team_status === 'active')
        return (
          <AdminOps>
            <Button
              type="outline"
              size="small"
              onClick={() => {
                setMapTarget(row)
                setSampleUrl(row.sample_article_url || '')
              }}
            >
              粘贴链接
            </Button>
            {canBlockEnqueue ? (
              <Button
                type="outline"
                size="small"
                loading={enqueueBlockingId === row.F_Id}
                onClick={() => toggleEnqueueBlock(row, true)}
              >
                禁止重新入队
              </Button>
            ) : null}
            {blocked ? (
              <Button
                type="outline"
                size="small"
                loading={enqueueBlockingId === row.F_Id}
                onClick={() => toggleEnqueueBlock(row, false)}
              >
                允许重新入队
              </Button>
            ) : null}
            {canUnsubscribe ? (
              <Button
                type="outline"
                status="danger"
                size="small"
                loading={unsubscribingId === row.F_Id}
                onClick={() => unsubscribeAccount(row)}
              >
                退订
              </Button>
            ) : null}
          </AdminOps>
        )
      }
    }
  ]

  if (loading && !config && subTab === 'team') {
    return <Skeleton text={{ rows: 8 }} animation />
  }

  return (
    <div className="wewe-private-config">
      <Tabs
        activeTab={subTab}
        onChange={setSubTab}
        tabPosition="left"
        type="line"
        className="wewe-private-config__tabs"
      >
        <TabPane key="team" title="专队配置">
          <div className="wewe-private-config__pane">
            {!config ? (
              <Skeleton text={{ rows: 8 }} animation />
            ) : (
              <>
                <Typography.Paragraph className="wewe-private-config__intro">
                  私有公众号 wewe 专队运维。密钥 <code>WEWE_RSS_AUTH_CODE</code> 仅在服务端环境变量配置，本页不展示。
                  建议分步放开：总开关 → 只入队 → 提取/入库 → 催办可独立早开保登录。
                  <br />
                  <strong>缺分享链接时：</strong>
                  到左侧「专队账号」列表右侧点「粘贴链接」（不是 wewe-rss 管理页）。待订阅催办合并为一封汇总邮件。
                  {pendingCount > 0 ? ` 当前待订阅 ${pendingCount} 个。` : ''}
                </Typography.Paragraph>

                <section className="wewe-private-config__section">
                  <Typography.Title heading={6}>分步开关</Typography.Title>
                  <div className="wewe-private-config__flag-row">
                    {boolFields.map((f) => {
                      const on = Number(config[f.key]) === 1
                      return (
                        <div key={f.key} className="wewe-private-config__flag-item">
                          <button
                            type="button"
                            className={`wewe-private-config__flag-btn${on ? ' is-on' : ''}`}
                            title={f.hint}
                            disabled={saving}
                            onClick={() => onToggle(f.key, !on)}
                          >
                            <span className="wewe-private-config__flag-dot" />
                            {f.label}
                          </button>
                          <span className="wewe-private-config__flag-desc">{f.hint}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="wewe-private-config__section">
                  <Typography.Title heading={6}>时间与催办参数</Typography.Title>
                  <div className="wewe-private-config__grid">
                    <label>
                      wewe Base URL
                      <Input
                        value={config.wewe_base_url || ''}
                        onChange={(v) => setConfig({ ...config, wewe_base_url: v })}
                        placeholder="http://127.0.0.1:4000"
                      />
                    </label>
                    <label>
                      运维邮箱 ops_email
                      <Input
                        value={config.ops_email || ''}
                        onChange={(v) => setConfig({ ...config, ops_email: v })}
                        placeholder="ops@example.com"
                      />
                    </label>
                    <label>
                      提取开始 extract_start
                      <Input
                        value={config.extract_start || '21:00'}
                        onChange={(v) => setConfig({ ...config, extract_start: v })}
                        placeholder="21:00"
                      />
                      <span className="wewe-private-config__hint">
                        当晚入队，只收当天 21:00 前的稿。21:00 及以后留给次日隔日补抓。
                      </span>
                    </label>
                    <label>
                      隔日补抓 catchup_extract_start
                      <Input
                        value={config.catchup_extract_start || '06:00'}
                        onChange={(v) => setConfig({ ...config, catchup_extract_start: v })}
                        placeholder="06:00"
                      />
                      <span className="wewe-private-config__hint">
                        次日此时入队，抓昨天（含 21:00 后）。建议早于入库时刻，补完与当天 ingest_at 一并入库，作为当天新闻。
                      </span>
                    </label>
                    <label>
                      入库时刻 ingest_at
                      <Input
                        value={config.ingest_at || '00:00'}
                        onChange={(v) => setConfig({ ...config, ingest_at: v })}
                        placeholder="00:00"
                      />
                      <span className="wewe-private-config__hint">
                        工作日此时把昨晚提取 + 当天隔日补抓一并写入 news_detail，作为当天新闻。
                      </span>
                    </label>
                    <label>
                      提取间隔（有文，分钟）
                      <InputNumber
                        min={1}
                        max={60}
                        value={Number(config.poll_interval_minutes) || 5}
                        onChange={(v) => setConfig({ ...config, poll_interval_minutes: v })}
                      />
                      <span className="wewe-private-config__hint">
                        当天有文后等这么久再提下一个；空号/失败固定 1 分钟。队列优先提上次有文的号。
                      </span>
                    </label>
                    <label>
                      会话 TTL（小时）
                      <InputNumber
                        min={1}
                        max={168}
                        value={Number(config.session_ttl_hours) || 24}
                        onChange={(v) => setConfig({ ...config, session_ttl_hours: v })}
                      />
                    </label>
                    <label>
                      缓冲提前（小时）
                      <InputNumber
                        min={1}
                        max={72}
                        value={Number(config.remind_before_hours) || 24}
                        onChange={(v) => setConfig({ ...config, remind_before_hours: v })}
                      />
                    </label>
                    <label>
                      缓冲催办间隔（小时）
                      <InputNumber
                        min={1}
                        max={24}
                        value={Number(config.remind_interval_buffer_hours) || 2}
                        onChange={(v) => setConfig({ ...config, remind_interval_buffer_hours: v })}
                      />
                    </label>
                    <label>
                      失效催办间隔（分钟）
                      <InputNumber
                        min={5}
                        max={180}
                        value={Number(config.remind_interval_dead_minutes) || 30}
                        onChange={(v) => setConfig({ ...config, remind_interval_dead_minutes: v })}
                      />
                      <span className="wewe-private-config__hint">
                        读书失效/缓冲催办在北京时间 00:00–07:00 静默不发信，7 点后若仍失效再发。
                      </span>
                    </label>
                    <label>
                      日催办上限
                      <InputNumber
                        min={1}
                        max={100}
                        value={Number(config.remind_daily_cap) || 20}
                        onChange={(v) => setConfig({ ...config, remind_daily_cap: v })}
                      />
                    </label>
                  </div>
                  <Space style={{ marginTop: 12 }}>
                    <Button type="primary" loading={saving} onClick={saveFields}>
                      保存参数
                    </Button>
                    <Button onClick={loadConfigAndSession}>刷新</Button>
                    <Button onClick={checkHealth}>探测 wewe</Button>
                    <Button onClick={openLiveQr}>打开活码页</Button>
                  </Space>
                </section>

                <section className="wewe-private-config__section">
                  <Typography.Title heading={6}>会话状态</Typography.Title>
                  <Space wrap>
                    <Tag color={statusColor(session?.session_status)}>
                      status={session?.session_status || '-'}
                    </Tag>
                    <Tag color={Number(session?.pause_extract) === 1 ? 'red' : 'green'}>
                      pause_extract={Number(session?.pause_extract) === 1 ? 1 : 0}
                    </Tag>
                    <Tag color={hasEnabledAccount ? 'green' : 'red'}>
                      读书账号={hasEnabledAccount ? '可用' : '无可用/失效'}
                    </Tag>
                    <span className="wewe-private-config__hint">
                      phase={phaseInfo?.phase || '-'}
                      {phaseInfo?.expiresAt
                        ? ` · 预计失效 ${new Date(phaseInfo.expiresAt).toLocaleString('zh-CN')}`
                        : ''}
                    </span>
                  </Space>
                  {phaseInfo?.phase === 'dead' && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      微信读书会话已失效（与 wewe 服务是否在线无关）。请点「打开活码页」扫码，
                      直到页内出现绿色「扫码成功」，再回本页刷新；恢复后提取会自动继续。
                    </Typography.Paragraph>
                  )}
                  {hasEnabledAccount === false && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      「探测 wewe」只说明服务在线。粘贴链接 / 提取需要<strong>启用中的微信读书账号</strong>。
                      请点「打开活码页」扫码，直到页内出现绿色「扫码成功」，再回本页刷新。
                    </Typography.Paragraph>
                  )}
                  {Array.isArray(weweAccounts) && weweAccounts.length > 0 && !weweAccounts[0]?.error && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      wewe 账号：
                      {weweAccounts
                        .map((a) => `${a.name || a.id}(status=${a.status})`)
                        .join('；')}
                      ；status 含义：0 失效 / 1 启用 / 2 禁用
                    </Typography.Paragraph>
                  )}
                </section>
              </>
            )}
          </div>
        </TabPane>

        <TabPane key="accounts" title={`专队账号${pendingCount ? ` (${pendingCount})` : ''}`}>
          <div className="wewe-private-config__pane wewe-private-config__pane--list">
            <div className="config-header">
              <h3>
                专队账号
                <span className="wewe-private-config__count">
                  共 {filteredAccounts.length} 条
                  {pendingCount ? ` · 待订阅 ${pendingCount}` : ''}
                </span>
              </h3>
              <Space wrap>
                <Button
                  type="outline"
                  loading={remindingPending}
                  disabled={pendingCount === 0}
                  onClick={sendPendingDigest}
                >
                  发送待订阅汇总邮件
                </Button>
                <Button loading={accountsLoading} onClick={loadAccounts}>
                  刷新
                </Button>
              </Space>
            </div>

            <Collapse
              activeKey={filterCollapsed ? [] : ['filters']}
              onChange={(_key, activeKeys) =>
                setFilterCollapsed(!(activeKeys && activeKeys.length))
              }
              className="filter-collapse"
            >
              <CollapseItem header="筛选条件" name="filters">
                <div className="filter-content">
                  <div className="filter-row">
                    <div className="filter-item">
                      <label>状态</label>
                      <Select
                        value={accountFilter}
                        onChange={(v) => setAccountFilter(v)}
                        style={{ width: 180 }}
                      >
                        <Option value="all">全部</Option>
                        <Option value="active">仅在队</Option>
                        <Option value="pending_subscribe">仅待订阅</Option>
                        <Option value="enqueue_blocked">仅禁止入队</Option>
                        <Option value="exited">仅已出队</Option>
                      </Select>
                    </div>
                    <div className="filter-item">
                      <label>关键词</label>
                      <Input
                        value={accountKeyword}
                        onChange={setAccountKeyword}
                        allowClear
                        placeholder="公众号 ID / 名称 / 企业 / feed…"
                        style={{ width: 280 }}
                      />
                    </div>
                    <div className="filter-actions">
                      <Button
                        type="outline"
                        onClick={() => {
                          setAccountFilter('all')
                          setAccountKeyword('')
                          setAccountPage(1)
                        }}
                      >
                        重置
                      </Button>
                    </div>
                  </div>
                </div>
              </CollapseItem>
            </Collapse>

            <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 12 }}>
              待订阅账号点右侧「粘贴链接」，填入该号任意一篇文章的 mp.weixin 分享 URL。
              新榜已能抓到、但 wewe 仍在订阅的号，点「退订」（不要只在 wewe-rss 管理页点删除：那边删的是 wewe 自己的库，新闻专队列表不会变）。
            </Typography.Paragraph>

            <div className="table-container">
              {accountsLoading && accounts.length === 0 ? (
                <Skeleton loading animation text={{ rows: 8, width: ['100%'] }} />
              ) : (
                <AdminListTable
                  rowKey="F_Id"
                  columns={columns}
                  data={pagedAccounts}
                  loading={accountsLoading}
                  pagination={false}
                  page={accountPage}
                  pageSize={accountPageSize}
                />
              )}
            </div>

            {filteredAccounts.length > 0 && (
              <div className="pagination-wrapper">
                <Pagination
                  current={accountPage}
                  total={filteredAccounts.length}
                  pageSize={accountPageSize}
                  sizeCanChange
                  sizeOptions={ACCOUNT_PAGE_SIZE_OPTIONS}
                  pageSizeChangeResetCurrent
                  onChange={setAccountPage}
                  onPageSizeChange={(size) => {
                    setAccountPageSize(size)
                    setAccountPage(1)
                  }}
                  showTotal
                  showJumper
                />
              </div>
            )}
          </div>
        </TabPane>

        <TabPane key="wewe-admin" title="wewe-rss 管理">
          <div className="wewe-private-config__pane wewe-private-config__pane--embed">
            <WeweRssAdminEmbed />
          </div>
        </TabPane>
      </Tabs>

      <Modal
        title={mapTarget ? `粘贴分享链接 · ${mapTarget.wechat_account_id}` : '粘贴分享链接'}
        visible={Boolean(mapTarget)}
        onCancel={() => {
          setMapTarget(null)
          setSampleUrl('')
        }}
        onOk={submitMapUrl}
        confirmLoading={mapping}
        okText="订阅映射"
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          使用一篇该公众号文章的 <code>https://mp.weixin.qq.com/s/...</code> 链接完成 wewe feed 映射。
        </Typography.Paragraph>
        <Input.TextArea
          value={sampleUrl}
          onChange={setSampleUrl}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder="https://mp.weixin.qq.com/s/..."
        />
      </Modal>
    </div>
  )
}

export default WewePrivateConfig
