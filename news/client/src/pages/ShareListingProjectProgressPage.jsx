import React, { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Table, Input, Button, Message, Space } from '@arco-design/web-react'
import {
  verifyListingProjectProgressShare,
  verifyListingProjectProgressSharePassword,
  fetchListingProjectProgressShareData,
} from '../api/上市进展'

export default function ShareListingProjectProgressPage() {
  const { token } = useParams()
  const [verifying, setVerifying] = useState(true)
  const [needPassword, setNeedPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [verified, setVerified] = useState(false)
  const [loading, setLoading] = useState(false)
  const [list, setList] = useState([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [total, setTotal] = useState(0)

  const formatAmount = (v) => {
    if (v === null || v === undefined || v === '') return '-'
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const columns = useMemo(
    () => [
      { title: '更新日期', dataIndex: 'f_update_time', width: 105 },
      { title: '交易所', dataIndex: 'exchange', width: 80 },
      { title: '板块', dataIndex: 'board', width: 80 },
      { title: '审核状态', dataIndex: 'status', width: 120, ellipsis: true  },
      { title: '归属基金', dataIndex: 'fund', width: 140, ellipsis: true },
      { title: '归属子基金', dataIndex: 'sub', width: 140, ellipsis: true },
      { title: '项目简称', dataIndex: 'project_name', width: 100, ellipsis: true },
      { title: '企业全称', dataIndex: 'company', width: 200, ellipsis: true },
      { title: '投资成本', dataIndex: 'inv_amount', width: 120, render: (v) => formatAmount(v) },
      { title: '剩余投资成本', dataIndex: 'residual_amount', width: 120, render: (v) => formatAmount(v) },
      { title: '穿透权益占比', dataIndex: 'ratio', width: 120, render: (v) => `${(Number(v || 0) * 100).toFixed(2)}%` },
      { title: '穿透投资成本', dataIndex: 'ct_amount', width: 120, render: (v) => formatAmount(v) },
      { title: '穿透剩余成本', dataIndex: 'ct_residual', width: 120, render: (v) => formatAmount(v) },
    ],
    []
  )

  const load = async (p = page, ps = pageSize) => {
    setLoading(true)
    try {
      const res = await fetchListingProjectProgressShareData(token, { page: p, pageSize: ps })
      if (res.data?.success) {
        const data = res.data.data || {}
        setList(data.list || [])
        setTotal(data.total || 0)
      } else {
        Message.error(res.data?.message || '加载失败')
      }
    } catch (e) {
      Message.error(e.response?.data?.message || e.message || '加载失败')
    } finally {
      setLoading(false)
    }
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
    if (verified) load(1, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, pageSize])

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
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>底层项目上市进展（分享）</div>
      <Space style={{ marginBottom: 8 }}>
        <Button onClick={() => load(1, pageSize)}>刷新</Button>
      </Space>
      <Table
        rowKey="f_id"
        loading={loading}
        columns={columns}
        data={list}
        border
        stripe
        scroll={{ x: 1720, y: 700 }}
        pagination={{
          current: page,
          pageSize,
          total,
          sizeCanChange: true,
          showTotal: true,
          showJumper: true,
          pageSizeOptions: [20, 50, 100, 200],
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
            load(p, ps)
          },
        }}
      />
    </div>
  )
}

