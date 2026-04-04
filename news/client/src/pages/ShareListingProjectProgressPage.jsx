import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Input, Button, Message, Space, Tabs } from '@arco-design/web-react'
import {
  verifyListingProjectProgressShare,
  verifyListingProjectProgressSharePassword,
  fetchListingProjectProgressShareData,
  fetchListingIpoProgressShareStats,
  fetchListingIpoProgressShareData,
  downloadListingIpoProgressShareExport,
  downloadListingProjectProgressShareExport,
} from '../api/上市进展'
import './上市进展/ListingIpoProgressPage.css'

const TabPane = Tabs.TabPane

/** Arco Pagination 使用 sizeOptions（不是 pageSizeOptions）；当前 pageSize 须出现在该数组中 */
const SHARE_LISTING_PAGE_SIZE_OPTIONS = [10, 15, 20, 50, 100, 200]

function saveBlobAsCsv(res) {
  const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `上市信息表_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** 分享页「IPO审核进展」：布局与 ListingIpoProgressPage 一致，只读无操作列 */
function ShareIpoAuditTab({ token }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [keyword, setKeyword] = useState('')
  const [kwSearch, setKwSearch] = useState('')
  const [stats, setStats] = useState({
    yesterday: '',
    year: new Date().getFullYear(),
    byExchange: {
      深交所: { yesterday: 0, year: 0 },
      上交所: { yesterday: 0, year: 0 },
      北交所: { yesterday: 0, year: 0 },
      港交所: { yesterday: 0, year: 0 },
    },
  })
  const [tableScrollY, setTableScrollY] = useState(520)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetchListingIpoProgressShareData(token, { page, pageSize, keyword: kwSearch })
      if (res.data?.success) {
        const d = res.data.data || {}
        setData(d.list || [])
        setTotal(d.total || 0)
        if (d.pageSize != null) setPageSize(Number(d.pageSize))
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [token, page, pageSize, kwSearch])

  const loadStats = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetchListingIpoProgressShareStats(token)
      if (res.data?.success && res.data?.data) {
        setStats(res.data.data)
      }
    } catch {
      /* 统计失败不阻断列表 */
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadStats()
  }, [loadStats])

  useEffect(() => {
    const updateTableHeight = () => {
      // 预留：Tab 标题栏 + 外框 padding + 本页标题/筛选/统计卡片 + 表头 + 分页等，避免「整页滚动 + 表体滚动」双条滚动条
      const reserved = 290
      const h = Math.max(240, window.innerHeight - reserved)
      setTableScrollY(h)
    }
    updateTableHeight()
    window.addEventListener('resize', updateTableHeight)
    return () => window.removeEventListener('resize', updateTableHeight)
  }, [])

  const handleExport = async () => {
    try {
      const res = await downloadListingIpoProgressShareExport(token, { keyword: kwSearch })
      saveBlobAsCsv(res)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const handleReset = () => {
    setKeyword('')
    setPage(1)
    if (kwSearch) {
      setKwSearch('')
    } else {
      load()
    }
  }

  const columns = useMemo(
    () => [
      {
        title: '序号',
        width: 64,
        align: 'center',
        render: (_col, _record, index) => (page - 1) * Number(pageSize) + index + 1,
      },
      {
        title: '更新日期',
        dataIndex: 'f_update_time',
        width: 120,
        render: (v) => (v ? String(v).slice(0, 10) : '-'),
      },
      { title: '项目简称', dataIndex: 'project_name', width: 140 },
      { title: '公司全称', dataIndex: 'company', width: 220, ellipsis: true },
      { title: '审核状态', dataIndex: 'status', width: 150 },
      { title: '交易所', dataIndex: 'exchange', width: 100 },
      { title: '板块', dataIndex: 'board', width: 100 },
      { title: '注册地', dataIndex: 'register_address', width: 140, ellipsis: true },
    ],
    [page, pageSize]
  )

  return (
    <div className="listing-ipo-progress-page" style={{ padding: '0 0 16px' }}>
      <div
        style={{
          marginBottom: 8,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <Space wrap>
            <Input
              style={{ width: 440 }}
              placeholder="关键词（公司/项目/状态/交易所等）"
              value={keyword}
              onChange={setKeyword}
              onPressEnter={() => {
                setPage(1)
                setKwSearch(keyword.trim())
              }}
            />
            <Button
              type="primary"
              onClick={() => {
                setPage(1)
                setKwSearch(keyword.trim())
              }}
            >
              查询
            </Button>
            <Button onClick={handleReset}>重置</Button>
            <Button onClick={load} loading={loading}>
              刷新
            </Button>
            <Button onClick={handleExport}>导出 CSV</Button>
          </Space>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {['深交所', '上交所', '北交所', '港交所'].map((ex) => {
            const s = stats.byExchange?.[ex] || { yesterday: 0, year: 0 }
            return (
              <div
                key={ex}
                style={{
                  border: '1px solid #dbe2f0',
                  borderRadius: 8,
                  background: 'linear-gradient(180deg, #ffffff 0%, #f7faff 100%)',
                  boxShadow: '0 2px 8px rgba(31, 35, 41, 0.06)',
                  padding: '10px 12px',
                  minWidth: 210,
                  minHeight: 78,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1d2129' }}>{ex}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#1677ff', lineHeight: 1.1 }}>
                      {s.yesterday ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: '#86909c', marginTop: 2 }}>昨日新增</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: '#00b42a', lineHeight: 1.1 }}>
                      {s.year ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: '#86909c', marginTop: 2 }}>{stats.year}累计</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <Table
        rowKey="f_id"
        loading={loading}
        columns={columns}
        data={data}
        scroll={{ x: 1064, y: tableScrollY }}
        stripe
        border
        pagination={{
          current: page,
          pageSize: Number(pageSize),
          defaultPageSize: 15,
          total,
          sizeCanChange: true,
          pageSizeChangeResetCurrent: true,
          showTotal: true,
          showJumper: true,
          sizeOptions: SHARE_LISTING_PAGE_SIZE_OPTIONS,
          onChange: (p, ps) => {
            setPage(p)
            if (ps !== pageSize) setPageSize(ps)
          },
          onPageSizeChange: (ps) => {
            setPage(1)
            setPageSize(ps)
          },
        }}
      />
    </div>
  )
}

export default function ShareListingProjectProgressPage() {
  const { token } = useParams()
  const [verifying, setVerifying] = useState(true)
  const [needPassword, setNeedPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [total, setTotal] = useState(0)
  const [tableScrollY, setTableScrollY] = useState(520)
  const [shareTab, setShareTab] = useState('project')
  const [rangePreset, setRangePreset] = useState('all')

  const formatAmount = (v) => {
    if (v === null || v === undefined || v === '') return '-'
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const columns = useMemo(
    () => [
      {
        title: '序号',
        width: 64,
        align: 'center',
        render: (_col, _record, index) => (page - 1) * Number(pageSize) + index + 1,
      },
      {
        title: '更新日期',
        dataIndex: 'f_update_time',
        width: 105,
        render: (v) => (v ? String(v).slice(0, 10) : '-'),
      },
      { title: '交易所', dataIndex: 'exchange', width: 80 },
      { title: '板块', dataIndex: 'board', width: 80 },
      { title: '审核状态', dataIndex: 'status', width: 120, ellipsis: true },
      { title: '归属基金', dataIndex: 'fund', width: 140, ellipsis: true },
      { title: '归属子基金', dataIndex: 'sub', width: 140, ellipsis: true },
      { title: '项目简称', dataIndex: 'project_name', width: 100, ellipsis: true },
      { title: '企业全称', dataIndex: 'company', width: 200, ellipsis: true },
      { title: '投资成本', dataIndex: 'inv_amount', width: 120, render: (v) => formatAmount(v) },
      { title: '剩余投资成本', dataIndex: 'residual_amount', width: 120, render: (v) => formatAmount(v) },
      {
        title: '穿透权益占比',
        dataIndex: 'ratio',
        width: 120,
        render: (v) => `${(Number(v || 0) * 100).toFixed(2)}%`,
      },
      { title: '穿透投资成本', dataIndex: 'ct_amount', width: 120, render: (v) => formatAmount(v) },
      { title: '穿透剩余成本', dataIndex: 'ct_residual', width: 120, render: (v) => formatAmount(v) },
    ],
    [page, pageSize]
  )

  const load = async (p = page, ps = pageSize) => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetchListingProjectProgressShareData(token, {
        page: p,
        pageSize: ps,
        rangePreset: rangePreset === 'all' ? '' : rangePreset,
      })
      if (res.data?.success) {
        const data = res.data.data || {}
        setList(data.list || [])
        setTotal(data.total || 0)
        if (data.pageSize != null) setPageSize(Number(data.pageSize))
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExportProject = async () => {
    try {
      const res = await downloadListingProjectProgressShareExport(token, {
        rangePreset: rangePreset === 'all' ? '' : rangePreset,
      })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `底层项目上市进展_${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
      Message.success('已开始下载')
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '导出失败')
    }
  }

  const handleMatchHint = () => {
    Message.info('分享页仅可浏览；匹配数据请登录系统后，在「上市进展 → 底层项目上市进展」中操作')
  }

  useEffect(() => {
    ;(async () => {
      try {
        const res = await verifyListingProjectProgressShare(token)
        if (res.data?.success) {
          if (res.data?.data?.hasPassword) {
            setNeedPassword(true)
          } else {
            setVerified(true)
          }
        }
      } catch (e) {
        Message.error(e.response?.data?.message || '分享链接无效')
      } finally {
        setVerifying(false)
      }
    })()
  }, [token])

  useEffect(() => {
    if (!verified) return
    setPage(1)
    load(1, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, rangePreset])

  useEffect(() => {
    const calc = () => {
      const y = Math.max(320, window.innerHeight - 230)
      setTableScrollY(y)
    }
    calc()
    window.addEventListener('resize', calc)
    return () => window.removeEventListener('resize', calc)
  }, [])

  if (verifying) return <div style={{ padding: 24 }}>校验链接中...</div>

  if (needPassword && !verified) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', padding: 20, border: '1px solid #e5e6eb', borderRadius: 8 }}>
        <div style={{ fontSize: 18, marginBottom: 12 }}>访问密码验证</div>
        <Input.Password value={password} onChange={setPassword} placeholder="请输入访问密码" />
        <Button
          type="primary"
          style={{ marginTop: 12 }}
          onClick={async () => {
            try {
              const res = await verifyListingProjectProgressSharePassword(token, { password })
              if (res.data?.success) setVerified(true)
            } catch (e) {
              Message.error(e.response?.data?.message || '密码错误')
            }
          }}
        >
          验证并查看
        </Button>
      </div>
    )
  }

  return (
    <div style={{ padding: '6px 16px 16px' }}>
      <Tabs activeTab={shareTab} onChange={setShareTab} type="line" style={{ marginBottom: 8 }}>
        <TabPane key="project" title="底层项目上市进展">
          <div style={{ marginBottom: 8 }}>
            <Space wrap>
              <Button type="primary" onClick={() => load(page, pageSize)} loading={loading}>
                刷新
              </Button>
              <Button onClick={handleExportProject}>导出 CSV</Button>
              <Button type="outline" status="success" onClick={handleMatchHint}>
                匹配数据
              </Button>
              <span>时间范围：</span>
              <Button
                type={rangePreset === 'yesterday' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setRangePreset('yesterday')}
              >
                昨日
              </Button>
              <Button
                type={rangePreset === 'week' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setRangePreset('week')}
              >
                本周
              </Button>
              <Button
                type={rangePreset === 'month' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setRangePreset('month')}
              >
                本月
              </Button>
              <Button
                type={rangePreset === 'all' ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setRangePreset('all')}
              >
                全部
              </Button>
            </Space>
          </div>
          <Table
            rowKey="f_id"
            loading={loading}
            columns={columns}
            data={list}
            border
            stripe
            scroll={{ x: 1784, y: tableScrollY }}
            pagination={{
              current: page,
              pageSize: Number(pageSize),
              defaultPageSize: 15,
              total,
              sizeCanChange: true,
              pageSizeChangeResetCurrent: true,
              showTotal: true,
              showJumper: true,
              sizeOptions: SHARE_LISTING_PAGE_SIZE_OPTIONS,
              onChange: (p, ps) => {
                setPage(p)
                setPageSize(ps)
                load(p, ps)
              },
            }}
          />
        </TabPane>
        <TabPane key="ipo" title="IPO审核进展">
          {shareTab === 'ipo' && token ? <ShareIpoAuditTab token={token} /> : null}
        </TabPane>
      </Tabs>
    </div>
  )
}
