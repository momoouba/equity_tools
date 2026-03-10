/**
 * 业绩看板应用 - 分享页面（React版本）
 * 业绩看板应用扩展
 * 复用 ShareNewsPage 逻辑，适配业绩看板数据
 */
import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import axios from '../utils/axios'
import { Spin, Card, Typography, Message, Button, Descriptions, Table, Tag } from '@arco-design/web-react'
import { IconDownload, IconLock } from '@arco-design/web-react/icon'
import './ShareNewsPage.css' // 复用原有样式

const { Title, Text } = Typography

// 格式化金额（转亿）
const formatAmount = (val) => {
  if (val === null || val === undefined) return '/'
  if (val === 0) return '-'
  return (val / 100000000).toFixed(2)
}

// 格式化数字
const formatNumber = (val) => {
  if (val === null || val === undefined) return '/'
  if (val === 0) return '-'
  return Math.round(val).toLocaleString()
}

// 格式化比例
const formatRatio = (val) => {
  if (val === null || val === undefined) return '/'
  if (val === 0) return '-'
  return val.toFixed(2) + 'x'
}

// 格式化百分比
const formatPercent = (val) => {
  if (val === null || val === undefined) return '/'
  if (val === 0) return '-'
  return (val * 100).toFixed(2) + '%'
}

function PerformanceSharePage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')
  
  // 分享信息
  const [shareInfo, setShareInfo] = useState(null)
  
  // 业绩看板数据
  const [managerData, setManagerData] = useState(null)
  const [fundsData, setFundsData] = useState({ funds: [], indicators: {} })
  const [underlyingData, setUnderlyingData] = useState({ cumulative: null, current: null })
  
  // 密码验证状态
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')

  // 验证分享链接
  useEffect(() => {
    verifyShareToken(token)
  }, [token])

  const verifyShareToken = async (shareToken) => {
    try {
      setLoading(true)
      const res = await axios.get(`/api/performance/share/verify/${shareToken}`)
      
      if (res.data.success) {
        const info = res.data.data
        setShareInfo(info)
        
        if (info.hasPassword) {
          setShowPasswordModal(true)
        } else {
          loadDashboardData(info.version)
        }
      } else {
        setError(res.data.message || '分享链接无效或已过期')
      }
    } catch (err) {
      console.error('验证分享链接失败:', err)
      setError('分享链接验证失败：' + (err.message || '网络错误'))
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordSubmit = async () => {
    if (!password.trim()) {
      setPasswordError('请输入密码')
      return
    }
    
    try {
      const res = await axios.post('/api/performance/share/verify-password', {
        token,
        password
      })
      
      if (res.data.success) {
        setShowPasswordModal(false)
        setVerified(true)
        loadDashboardData(shareInfo.version)
      } else {
        setPasswordError(res.data.message || '密码错误')
      }
    } catch (err) {
      setPasswordError('密码验证失败')
    }
  }

  const loadDashboardData = async (version) => {
    try {
      setLoading(true)
      
      // 加载管理人指标
      const managerRes = await axios.get(`/api/performance/dashboard/manager?version=${encodeURIComponent(version)}`)
      if (managerRes.data.success) {
        setManagerData(managerRes.data.data)
      }
      
      // 加载基金列表
      const fundsRes = await axios.get(`/api/performance/dashboard/funds?version=${encodeURIComponent(version)}`)
      if (fundsRes.data.success) {
        setFundsData(fundsRes.data.data)
      }
      
      // 加载底层资产
      const underlyingRes = await axios.get(`/api/performance/dashboard/underlying?version=${encodeURIComponent(version)}`)
      if (underlyingRes.data.success) {
        setUnderlyingData(underlyingRes.data.data)
      }
      
      setVerified(true)
    } catch (err) {
      console.error('加载业绩看板数据失败:', err)
      setError('加载数据失败：' + (err.message || '网络错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      Message.loading('正在生成导出文件...')
      // TODO: 调用导出接口
      Message.success('导出功能待实现')
    } catch (err) {
      Message.error('导出失败')
    }
  }

  if (loading) {
    return (
      <div className="share-news-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  if (error) {
    return (
      <div className="share-news-page" style={{ minHeight: '100vh', padding: 40 }}>
        <Card style={{ maxWidth: 600, margin: '0 auto' }}>
          <Title heading={3} style={{ color: '#f53f3f' }}>❌ 访问失败</Title>
          <Text type="danger">{error}</Text>
          <div style={{ marginTop: 20 }}>
            <Button type="primary" onClick={() => navigate('/login')}>返回首页</Button>
          </div>
        </Card>
      </div>
    )
  }

  if (!verified && showPasswordModal) {
    return (
      <div className="share-news-page" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 400 }}>
          <Title heading={4}>🔐 需要密码</Title>
          <Text type="secondary">该分享链接设置了访问密码，请输入密码继续。</Text>
          
          <div style={{ marginTop: 20 }}>
            <input
              type="password"
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d9d9d9',
                borderRadius: 4,
                marginBottom: passwordError ? 8 : 0,
                color: passwordError ? '#f53f3f' : undefined
              }}
            />
            {passwordError && <Text type="danger" style={{ fontSize: 12 }}>{passwordError}</Text>}
            
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button type="primary" block onClick={handlePasswordSubmit}>确定</Button>
              <Button block onClick={() => navigate('/login')}>取消</Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="share-news-page" style={{ minHeight: '100vh', background: '#f5f6f7', padding: 24 }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* 头部信息 */}
        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <Title heading={3} style={{ margin: 0 }}>📊 业绩看板（分享页）</Title>
              <Text type="secondary" style={{ fontSize: 13 }}>
                数据版本：{shareInfo?.version} | 
                有效期至：{new Date(shareInfo?.expires_at).toLocaleString('zh-CN')}
              </Text>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {shareInfo?.canExport && (
                <Button
                  type="primary"
                  icon={<IconDownload />}
                  onClick={handleExport}
                >
                  导出底稿
                </Button>
              )}
              <Button onClick={() => window.close()}>关闭页面</Button>
            </div>
          </div>
        </Card>

        {/* 管理人指标卡 */}
        {managerData && (
          <Card title="管理人指标" style={{ marginBottom: 24 }}>
            <Descriptions
              colon="："
              layout="horizontal"
              data={[
                { label: '母基金数量', value: formatNumber(managerData.fof_num) },
                { label: '直投基金数量', value: formatNumber(managerData.direct_num) },
                { label: '认缴管理规模', value: formatAmount(managerData.sub_amount) },
                { label: '实缴管理规模', value: formatAmount(managerData.paid_in_amount) },
                { label: '累计分配总额', value: formatAmount(managerData.dis_amount) },
              ]}
              column={3}
            />
          </Card>
        )}

        {/* 基金产品指标表 */}
        {fundsData.funds.length > 0 && (
          <Card title="基金产品指标" style={{ marginBottom: 24 }}>
            <Table
              columns={[
                { title: '指标', dataIndex: 'label', fixed: 'left', width: 120 },
                ...fundsData.funds.map(fund => ({
                  title: fund,
                  dataIndex: fund,
                  width: 100
                }))
              ]}
              data={[
                { label: '投资人认缴', ...Object.fromEntries(fundsData.funds.map(f => [f, formatAmount(fundsData.indicators[f]?.lp_sub)])) },
                { label: '投资人实缴', ...Object.fromEntries(fundsData.funds.map(f => [f, formatAmount(fundsData.indicators[f]?.paidin)])) },
                { label: 'TVPI', ...Object.fromEntries(fundsData.funds.map(f => [f, formatRatio(fundsData.indicators[f]?.tvpi)])) },
                { label: 'DPI', ...Object.fromEntries(fundsData.funds.map(f => [f, formatRatio(fundsData.indicators[f]?.dpi)])) },
                { label: 'NIRR', ...Object.fromEntries(fundsData.funds.map(f => [f, formatPercent(fundsData.indicators[f]?.nirr)])) },
              ]}
              pagination={false}
              scroll={{ x: 800 }}
              rowKey="label"
              size="small"
            />
          </Card>
        )}

        {/* 底层资产 */}
        {underlyingData.cumulative && underlyingData.current && (
          <Card title="底层资产" style={{ marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 24 }}>
              <div>
                <Title heading={5} style={{ marginBottom: 12 }}>累计组合</Title>
                <Descriptions
                  colon="："
                  data={[
                    { label: '项目数量', value: formatNumber(underlyingData.cumulative.project_num_a) },
                    { label: '企业数量', value: formatNumber(underlyingData.cumulative.company_num_a) },
                    { label: '总投资金额', value: formatAmount(underlyingData.cumulative.total_amount_a) },
                    { label: '上市企业', value: formatNumber(underlyingData.cumulative.ipo_num_a) },
                  ]}
                  column={2}
                />
              </div>
              <div>
                <Title heading={5} style={{ marginBottom: 12 }}>当前组合</Title>
                <Descriptions
                  colon="："
                  data={[
                    { label: '项目数量', value: formatNumber(underlyingData.current.project_num) },
                    { label: '企业数量', value: formatNumber(underlyingData.current.company_num) },
                    { label: '总投资金额', value: formatAmount(underlyingData.current.total_amount) },
                    { label: '上市企业', value: formatNumber(underlyingData.current.ipo_num) },
                  ]}
                  column={2}
                />
              </div>
            </div>
          </Card>
        )}

        {/* 提示信息 */}
        <Card style={{ marginTop: 24, background: '#e6f7ff', border: '1px solid #91d5ff' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            ℹ️ 本页面为分享页面，仅展示部分数据。如需查看完整功能，请联系管理员获取系统访问权限。
          </Text>
        </Card>
      </div>
    </div>
  )
}

export default PerformanceSharePage
