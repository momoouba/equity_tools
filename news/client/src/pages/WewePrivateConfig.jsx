import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Collapse,
  Dropdown,
  Input,
  InputNumber,
  Menu,
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
import SheetModal, { SheetActions } from '../components/SheetModal'
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
  { key: 'enqueue_enabled', label: '允许入队', hint: '遗留开关；正式名单请用「从监控同步」，新榜不再自动进出队' },
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

/**
 * 浏览器打开 we-mp-rss 的地址。
 * 优先独立 HTTPS 根路径端口 8443（Vue 路由正常）；勿用 docker 内网名；
 * /we-mp-rss/ 子路径仅作兜底（易出现顶栏有、内容空白）。
 */
function resolveWerssBrowserUrl(baseUrl) {
  const raw = String(baseUrl || '').trim()
  const isBrowserReachable =
    raw &&
    !/^https?:\/\/(we-mp-rss|wewe-rss|host\.docker\.internal)(:|\/|$)/i.test(raw) &&
    !/^https?:\/\/(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/i.test(raw)
  if (isBrowserReachable && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/$/, '') + '/'
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    const proto = window.location.protocol || 'https:'
    const host = window.location.hostname
    return `${proto}//${host}:8443/`
  }
  return 'https://news.gf-dsai.com:8443/'
}

/**
 * 采集管理嵌入：
 * - werss：同源反代 /we-mp-rss/（服务端 Base URL 仍用 http://we-mp-rss:8001）
 * - wewe：同源反代 + ticket 注入 AUTH_CODE
 */
function CollectorAdminEmbed({ provider = 'wewe', baseUrl = '' }) {
  const isWerss = provider === 'werss' || provider === 'we-mp-rss' || provider === 'mp-rss'
  const [iframeKey, setIframeKey] = useState(0)
  const [bootError, setBootError] = useState('')
  const [gateUrl, setGateUrl] = useState('')
  const [directUrl, setDirectUrl] = useState('')

  const loadEmbed = useCallback(async () => {
    setBootError('')
    setGateUrl('')
    try {
      if (isWerss) {
        const url = resolveWerssBrowserUrl(baseUrl)
        setGateUrl(url)
        setDirectUrl(url)
        setIframeKey((k) => k + 1)
        return
      }
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
      const msg = e.response?.data?.message || e.message || '获取采集管理页失败'
      setBootError(msg)
      Message.error(msg)
    }
  }, [isWerss, baseUrl])

  useEffect(() => {
    loadEmbed()
  }, [loadEmbed])

  return (
    <div className="wewe-rss-embed">
      <div className="wewe-rss-embed__toolbar">
        <Typography.Text type="secondary" style={{ flex: 1 }}>
          {isWerss ? (
            <>
              嵌入 <strong>we-mp-rss</strong> 管理页（订阅公众号、微信读书 Cookie）。
              浏览器走 <code>https://本域:8443/</code>（根路径，内容才完整）；专队 Base URL 仍填{' '}
              <code>http://we-mp-rss:8001</code> 给服务端贴链接。默认账号 <code>admin</code> /{' '}
              <code>admin@123</code>。
            </>
          ) : (
            <>自动注入 AUTH_CODE 后进入 wewe-rss 管理页。嵌入与「新窗口打开」均走本站反代。</>
          )}
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
      <div className="wewe-rss-embed__url">{gateUrl || (isWerss ? '正在加载 we-mp-rss…' : '正在签发嵌入票据…')}</div>
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
          title={isWerss ? 'we-mp-rss 管理' : 'wewe-rss 管理'}
          src={gateUrl}
        />
      ) : (
        <div className="wewe-rss-embed__fallback">
          <p>{isWerss ? '正在加载 we-mp-rss…' : '正在加载 wewe-rss…'}</p>
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
  const [accountSourceFilter, setAccountSourceFilter] = useState('all')
  const [accountKeyword, setAccountKeyword] = useState('')
  const [filterCollapsed, setFilterCollapsed] = useState(false)
  const [accountPage, setAccountPage] = useState(1)
  const [accountPageSize, setAccountPageSize] = useState(ACCOUNT_PAGE_SIZE_OPTIONS[0])
  const [remindingPending, setRemindingPending] = useState(false)
  const [unsubscribingId, setUnsubscribingId] = useState('')
  const [batchUnsubscribing, setBatchUnsubscribing] = useState(false)
  const [batchBlocking, setBatchBlocking] = useState(false)
  const [batchSubscribing, setBatchSubscribing] = useState(false)
  const [syncingFromMonitor, setSyncingFromMonitor] = useState(false)
  const [selectedAccountKeys, setSelectedAccountKeys] = useState([])
  const [enqueueBlockingId, setEnqueueBlockingId] = useState('')
  const [subscribingId, setSubscribingId] = useState('')
  const [tableScrollY, setTableScrollY] = useState(() =>
    typeof window !== 'undefined' ? Math.max(420, window.innerHeight - 380) : 420
  )
  const tableScrollAreaRef = useRef(null)

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

  useLayoutEffect(() => {
    if (subTab !== 'accounts') return undefined
    const el = tableScrollAreaRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => {
      const h = el.clientHeight
      const fallback = Math.max(420, Math.floor(window.innerHeight - 380))
      if (h < 120) {
        setTableScrollY(fallback)
        return
      }
      const head = el.querySelector('.arco-table-header')
      const headH = head ? Math.ceil(head.getBoundingClientRect().height) : 40
      // 至少约一屏可用高度，避免只露出两三行
      setTableScrollY(Math.max(360, Math.floor(h - headH - 2)))
    }
    const raf = requestAnimationFrame(() => measure())
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [subTab, filterCollapsed, accountPageSize, accountsLoading])

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
        collector_provider: config.collector_provider || 'wewe',
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

  const canUnsubscribeRow = (row) =>
    Boolean(row?.feed_id) ||
    row?.team_status === 'active' ||
    row?.team_status === 'pending_subscribe'

  /** 未禁入队的账号均可禁止（含已出队，避免同步再次拉回） */
  const canBlockEnqueueRow = (row) => Number(row?.enqueue_blocked) !== 1

  /** 可批量/单行订阅：未禁入队，且非已在队 active */
  const canSubscribeRow = (row) =>
    Number(row?.enqueue_blocked) !== 1 && row?.team_status !== 'active'

  const unsubscribeAccount = (row) => {
    const name = row.account_name || row.wechat_account_id
    Modal.confirm({
      title: '从采集端退订',
      content: `将删除 we-mp-rss/wewe 里「${name}」的订阅，并把专队状态标为已出队。若不想被「从监控同步」再次拉回，请再用「禁止重新入队」（不删采集端订阅）。`,
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

  const runSyncFromMonitor = async (sourceKinds = 'all', includeInactiveAdditional = false) => {
    setSyncingFromMonitor(true)
    try {
      const res = await axios.post('/api/wewe-probe/team/sync-from-monitor', {
        autoMap: true,
        sourceKinds,
        includeInactiveAdditional
      })
      if (res.data?.success) {
        const msg = res.data.message || '已从监控对象同步'
        if (String(msg).includes('全部为「失效」')) Message.warning(msg)
        else Message.success(msg)
        setSelectedAccountKeys([])
        if (sourceKinds === 'additional') setAccountSourceFilter('third_party')
        await loadAccounts()
      } else {
        Message.error(res.data?.message || '同步失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '同步失败')
    } finally {
      setSyncingFromMonitor(false)
    }
  }

  const confirmSyncFromMonitor = (sourceKinds, includeInactiveAdditional = false) => {
    const kindLabel =
      sourceKinds === 'additional'
        ? includeInactiveAdditional
          ? '仅第三方·含失效'
          : '仅第三方·仅生效'
        : sourceKinds === 'invested'
          ? '仅企业'
          : '全部'
    const warn =
      sourceKinds === 'all'
        ? '会把监控对象里仍有效、且未「禁入队」的已出队企业号重新拉回待订阅。第三方默认只收「生效」。'
        : sourceKinds === 'additional'
          ? includeInactiveAdditional
            ? '将把第三方表中有 ID 的账号（含「失效」）按去重写入专队；不会拉回企业号。'
            : '只同步第三方「生效」账号。若管理页全是「失效」，这里会是 0——请先批量设为生效，或改选「含失效」。'
          : '只处理监控对象企业公众号。'
    Modal.confirm({
      title: `从监控同步（${kindLabel}）`,
      content: warn,
      okText: '开始同步',
      cancelText: '取消',
      onOk: () => runSyncFromMonitor(sourceKinds, includeInactiveAdditional)
    })
  }

  const batchUnsubscribeAccounts = () => {
    const selected = accounts.filter(
      (a) => selectedAccountKeys.includes(a.F_Id) && canUnsubscribeRow(a)
    )
    if (!selected.length) {
      Message.warning('请先勾选可退订的账号（在队 / 待订阅 / 已映射）')
      return
    }
    Modal.confirm({
      title: '批量退订',
      content: `将对已选 ${selected.length} 个账号：删除采集端订阅，并把专队状态标为已出队。此操作不可批量撤销。`,
      okText: `退订 ${selected.length} 个`,
      okButtonProps: { status: 'danger' },
      cancelText: '取消',
      onOk: async () => {
        setBatchUnsubscribing(true)
        try {
          const res = await axios.post('/api/wewe-probe/team/unsubscribe-batch', {
            wechat_account_ids: selected.map((a) => a.wechat_account_id)
          })
          const msg = res.data?.message || '批量退订完成'
          if (res.data?.success) Message.success(msg)
          else Message.warning(msg)
          setSelectedAccountKeys([])
          await loadAccounts()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '批量退订失败')
          await loadAccounts()
        } finally {
          setBatchUnsubscribing(false)
        }
      }
    })
  }

  const batchBlockEnqueue = () => {
    const selected = accounts.filter(
      (a) => selectedAccountKeys.includes(a.F_Id) && canBlockEnqueueRow(a)
    )
    if (!selected.length) {
      Message.warning('请先勾选尚未禁止入队的账号')
      return
    }
    Modal.confirm({
      title: '批量禁止重新入队',
      content: `将对已选 ${selected.length} 个账号标记「禁入队」并标为已出队。之后「从监控同步」不会再把它们拉回。不会删除采集端已有订阅。`,
      okText: `禁止 ${selected.length} 个`,
      cancelText: '取消',
      onOk: async () => {
        setBatchBlocking(true)
        try {
          const res = await axios.post('/api/wewe-probe/team/enqueue-block-batch', {
            wechat_account_ids: selected.map((a) => a.wechat_account_id),
            blocked: true
          })
          const msg = res.data?.message || '批量禁止入队完成'
          if (res.data?.success) Message.success(msg)
          else Message.warning(msg)
          setSelectedAccountKeys([])
          await loadAccounts()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '批量禁止入队失败')
          await loadAccounts()
        } finally {
          setBatchBlocking(false)
        }
      }
    })
  }

  const batchSubscribeAccounts = () => {
    const selected = accounts.filter(
      (a) => selectedAccountKeys.includes(a.F_Id) && canSubscribeRow(a)
    )
    if (!selected.length) {
      Message.warning('请先勾选可订阅的账号（非在队、未禁入队）')
      return
    }
    Modal.confirm({
      title: '批量订阅',
      content: `将对已选 ${selected.length} 个账号：已有 feed 的直接重新入队；否则尝试历史/样例链接自动映射。仍缺链接的需稍后「粘贴链接」。`,
      okText: `订阅 ${selected.length} 个`,
      cancelText: '取消',
      onOk: async () => {
        setBatchSubscribing(true)
        try {
          const res = await axios.post('/api/wewe-probe/team/subscribe-batch', {
            wechat_account_ids: selected.map((a) => a.wechat_account_id)
          })
          const msg = res.data?.message || '批量订阅完成'
          if (res.data?.success) Message.success(msg)
          else Message.warning(msg)
          setSelectedAccountKeys([])
          await loadAccounts()
        } catch (e) {
          Message.error(e.response?.data?.message || e.message || '批量订阅失败')
          await loadAccounts()
        } finally {
          setBatchSubscribing(false)
        }
      }
    })
  }

  const subscribeOneAccount = async (row) => {
    setSubscribingId(row.F_Id)
    try {
      const res = await axios.post('/api/wewe-probe/team/subscribe-batch', {
        wechat_account_ids: [row.wechat_account_id]
      })
      const msg = res.data?.message || '订阅完成'
      if (res.data?.success) Message.success(msg)
      else Message.warning(msg)
      await loadAccounts()
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '订阅失败')
      await loadAccounts()
    } finally {
      setSubscribingId('')
    }
  }

  const toggleEnqueueBlock = (row, blocked) => {
    const name = row.account_name || row.wechat_account_id
    if (blocked) {
      Modal.confirm({
        title: '禁止重新入队',
        content: `「${name}」将标为已出队，且之后「从监控同步」也不会再把它拉回。不会删除采集端已有订阅；若要退订请用「退订」。`,
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
      const src = String(a.source_type || '').toLowerCase()
      if (accountSourceFilter === 'enterprise') {
        // 监控对象企业；both = 同时挂在企业与第三方
        if (src !== 'invested' && src !== 'both') return false
      }
      if (accountSourceFilter === 'third_party') {
        if (src !== 'additional' && src !== 'both') return false
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
  }, [accounts, accountFilter, accountSourceFilter, accountKeyword])

  const pagedAccounts = useMemo(() => {
    const start = (accountPage - 1) * accountPageSize
    return filteredAccounts.slice(start, start + accountPageSize)
  }, [filteredAccounts, accountPage, accountPageSize])

  useEffect(() => {
    setAccountPage(1)
  }, [accountFilter, accountSourceFilter, accountKeyword])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredAccounts.length / accountPageSize) || 1)
    if (accountPage > maxPage) setAccountPage(maxPage)
  }, [filteredAccounts.length, accountPage, accountPageSize])

  const wrapCell = (text) => (
    <span className="wewe-private-config__cell-wrap">{text || '-'}</span>
  )

  const columns = [
    {
      title: '公众号 ID',
      dataIndex: 'wechat_account_id',
      width: 160,
      render: (v) => wrapCell(v)
    },
    {
      title: '公众号名称',
      dataIndex: 'account_name',
      width: 140,
      render: (v) => wrapCell(v)
    },
    {
      title: '被投企业',
      dataIndex: 'enterprise_full_name',
      width: 200,
      render: (v, row) => wrapCell(v || row.project_abbreviation)
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      width: 100,
      render: (v) => {
        const src = String(v || '').toLowerCase()
        if (src === 'invested') return wrapCell('企业')
        if (src === 'additional') return wrapCell('第三方')
        if (src === 'both') return wrapCell('企业+第三方')
        return wrapCell(v || '—')
      }
    },
    {
      title: '专队状态',
      dataIndex: 'team_status',
      width: 120,
      render: (v, row) => (
        <Space size={4} wrap>
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
      width: 88,
      render: (v) => <Tag color={statusColor(v)}>{v}</Tag>
    },
    {
      title: 'feed_id',
      dataIndex: 'feed_id',
      width: 168,
      render: (v) => wrapCell(v)
    },
    {
      title: '最近提取',
      dataIndex: 'last_extract_status',
      width: 110,
      render: (v) => wrapCell(v)
    },
    {
      title: '操作',
      width: 320,
      className: 'admin-ops-col admin-ops-col-nowrap',
      render: (_, row) => {
        const blocked = Number(row.enqueue_blocked) === 1
        const canUnsubscribe = canUnsubscribeRow(row)
        const canBlockEnqueue = canBlockEnqueueRow(row)
        const canSubscribe = canSubscribeRow(row)
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
            {canSubscribe ? (
              <Button
                type="outline"
                size="small"
                loading={subscribingId === row.F_Id}
                onClick={() => subscribeOneAccount(row)}
              >
                订阅
              </Button>
            ) : null}
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
                  私有公众号专队运维。推荐采集后端 <strong>we-mp-rss</strong>（直连微信读书；旧 wewe 中转已失效）。
                  we-mp-rss 账号 <code>MP_RSS_USERNAME/PASSWORD</code> 仅在服务端环境变量配置。
                  建议分步放开：总开关 → 提取/入库 → 催办可独立早开保登录。
                  <br />
                  <strong>专队名单：</strong>
                  来自「新闻舆情监控对象」中已填企业公众号 id 的记录，外加「第三方/额外公众号」；
                  在「专队账号」点「从监控同步」。不再由新榜「数据不存在」自动进出队。
                  缺分享链接时到列表右侧「粘贴链接」。
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
                      采集后端 collector_provider
                      <select
                        className="wewe-private-config__select"
                        value={config.collector_provider === 'werss' ? 'werss' : 'wewe'}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            collector_provider: e.target.value,
                            wewe_base_url:
                              e.target.value === 'werss'
                                ? config.wewe_base_url && !/4000/.test(config.wewe_base_url)
                                  ? config.wewe_base_url
                                  : 'http://127.0.0.1:8001'
                                : config.wewe_base_url || 'http://127.0.0.1:4000'
                          })
                        }
                      >
                        <option value="werss">we-mp-rss（推荐，端口 8001）</option>
                        <option value="wewe">wewe-rss（旧，中转已失效）</option>
                      </select>
                      <span className="wewe-private-config__hint">
                        本地：<code>cd news/deploy/we-mp-rss && docker compose up -d</code>
                      </span>
                    </label>
                    <label>
                      采集 Base URL
                      <Input
                        value={config.wewe_base_url || ''}
                        onChange={(v) => setConfig({ ...config, wewe_base_url: v })}
                        placeholder={
                          config.collector_provider === 'werss'
                            ? 'http://we-mp-rss:8001'
                            : 'http://127.0.0.1:4000'
                        }
                      />
                      <span className="wewe-private-config__hint">
                        {config.collector_provider === 'werss'
                          ? '给服务端贴链接/订号用（生产填 http://we-mp-rss:8001）。浏览器管理页走本站 /we-mp-rss/，勿把内网名填进浏览器地址栏。'
                          : 'wewe 上游地址'}
                      </span>
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
                      {config?.collector_provider === 'werss' ? (
                        <>
                          新闻侧会话过期。若已在 we-mp-rss（http://127.0.0.1:8001）配好微信读书 Cookie，
                          点「刷新」即可同步；否则请到 we-mp-rss 管理页「微信读书」扫码/粘贴 Cookie。
                          使用 we-mp-rss 时不必依赖本页「打开活码页」。
                        </>
                      ) : (
                        <>
                          微信读书会话已失效（与 wewe 服务是否在线无关）。请点「打开活码页」扫码，
                          直到页内出现绿色「扫码成功」，再回本页刷新；恢复后提取会自动继续。
                        </>
                      )}
                    </Typography.Paragraph>
                  )}
                  {hasEnabledAccount === false && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      {config?.collector_provider === 'werss' ? (
                        <>
                          探测只说明服务在线。请到 <strong>we-mp-rss 管理页 → 微信读书</strong> 配置 Cookie，
                          再回本页点「刷新」。
                        </>
                      ) : (
                        <>
                          「探测 wewe」只说明服务在线。粘贴链接 / 提取需要<strong>启用中的微信读书账号</strong>。
                          请点「打开活码页」扫码，直到页内出现绿色「扫码成功」，再回本页刷新。
                        </>
                      )}
                    </Typography.Paragraph>
                  )}
                  {Array.isArray(weweAccounts) && weweAccounts.length > 0 && !weweAccounts[0]?.error && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                      采集账号：
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
                <Dropdown
                  droplist={
                    <Menu
                      onClickMenuItem={(key) => {
                        if (key === 'additional') confirmSyncFromMonitor('additional', false)
                        else if (key === 'additional_inactive') {
                          confirmSyncFromMonitor('additional', true)
                        } else if (key === 'invested') confirmSyncFromMonitor('invested', false)
                        else if (key === 'all') confirmSyncFromMonitor('all', false)
                      }}
                    >
                      <Menu.Item key="additional">仅同步第三方（仅生效）</Menu.Item>
                      <Menu.Item key="additional_inactive">仅同步第三方（含失效）</Menu.Item>
                      <Menu.Item key="invested">仅同步企业</Menu.Item>
                      <Menu.Item key="all">同步全部</Menu.Item>
                    </Menu>
                  }
                  trigger="click"
                  disabled={syncingFromMonitor}
                >
                  <Button type="primary" loading={syncingFromMonitor}>
                    从监控同步
                  </Button>
                </Dropdown>
                <Button
                  type="outline"
                  loading={batchSubscribing}
                  disabled={!selectedAccountKeys.length || batchSubscribing}
                  onClick={batchSubscribeAccounts}
                >
                  批量订阅{selectedAccountKeys.length ? ` (${selectedAccountKeys.length})` : ''}
                </Button>
                <Button
                  type="outline"
                  loading={batchBlocking}
                  disabled={!selectedAccountKeys.length || batchBlocking}
                  onClick={batchBlockEnqueue}
                >
                  批量禁止入队
                  {selectedAccountKeys.length ? ` (${selectedAccountKeys.length})` : ''}
                </Button>
                <Button
                  type="outline"
                  status="danger"
                  loading={batchUnsubscribing}
                  disabled={!selectedAccountKeys.length || batchUnsubscribing}
                  onClick={batchUnsubscribeAccounts}
                >
                  批量退订{selectedAccountKeys.length ? ` (${selectedAccountKeys.length})` : ''}
                </Button>
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
                      <label>来源</label>
                      <Select
                        value={accountSourceFilter}
                        onChange={(v) => setAccountSourceFilter(v)}
                        style={{ width: 160 }}
                      >
                        <Option value="all">全部</Option>
                        <Option value="enterprise">企业</Option>
                        <Option value="third_party">第三方</Option>
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
                          setAccountSourceFilter('all')
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

            <Typography.Paragraph type="secondary" className="wewe-private-config__list-hint">
              名单请用「从监控同步」：可选仅第三方 / 仅企业 / 全部；按公众号 ID 去重；不会自动删已出队旧号。
              已退订又不想被同步拉回：勾选后点「批量禁止入队」。待订阅可「批量订阅」或「粘贴链接」完成 we-mp-rss 订号。
            </Typography.Paragraph>

            <div ref={tableScrollAreaRef} className="table-container wewe-private-config__table-area">
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
                  scroll={{ x: 1380, y: tableScrollY }}
                  rowSelection={{
                    type: 'checkbox',
                    selectedRowKeys: selectedAccountKeys,
                    onChange: (keys) => setSelectedAccountKeys(keys),
                    checkboxProps: (row) => ({
                      disabled: !canUnsubscribeRow(row)
                    })
                  }}
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

        <TabPane
          key="wewe-admin"
          title={
            config?.collector_provider === 'werss' ? 'we-mp-rss 管理' : 'wewe-rss 管理'
          }
        >
          <div className="wewe-private-config__pane wewe-private-config__pane--embed">
            <CollectorAdminEmbed
              provider={config?.collector_provider || 'wewe'}
              baseUrl={config?.wewe_base_url || ''}
            />
          </div>
        </TabPane>
      </Tabs>

      <SheetModal
        visible={Boolean(mapTarget)}
        title={mapTarget ? `粘贴分享链接 · ${mapTarget.wechat_account_id}` : '粘贴分享链接'}
        onClose={() => {
          setMapTarget(null)
          setSampleUrl('')
        }}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <p className="form-hint form-span-4">
              使用一篇该公众号文章的 https://mp.weixin.qq.com/s/... 链接完成 wewe feed 映射。
            </p>
            <div className="form-group form-span-4">
              <label>文章链接</label>
              <Input.TextArea
                value={sampleUrl}
                onChange={setSampleUrl}
                autoSize={{ minRows: 3, maxRows: 5 }}
                placeholder="https://mp.weixin.qq.com/s/..."
              />
            </div>
          </div>
          <SheetActions
            onCancel={() => {
              setMapTarget(null)
              setSampleUrl('')
            }}
            submitLabel="订阅映射"
            submitType="button"
            onSubmitClick={submitMapUrl}
            submitLoading={mapping}
          />
        </div>
      </SheetModal>
    </div>
  )
}

export default WewePrivateConfig
