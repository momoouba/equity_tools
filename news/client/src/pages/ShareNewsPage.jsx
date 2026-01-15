import React, { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './ShareNewsPage.css'

// 版本标识：简化版本，已移除所有循环逻辑 - 2026-01-15
const VERSION = '2.0.0-simplified'

// 强制清除控制台并显示版本信息（在模块加载时立即执行）
if (typeof window !== 'undefined') {
  // 立即清除控制台
  console.clear()
  
  // 显示醒目的版本信息
  console.log('%c═══════════════════════════════════════════════════════', 'color: green; font-size: 16px; font-weight: bold')
  console.log('%c[ShareNewsPage] 版本: ' + VERSION, 'color: green; font-size: 18px; font-weight: bold')
  console.log('%c已移除所有循环逻辑（MutationObserver、setInterval等）', 'color: green; font-size: 14px')
  console.log('%c═══════════════════════════════════════════════════════', 'color: green; font-size: 16px; font-weight: bold')
  
  // 标记新版本已加载
  window.__SHARE_NEWS_PAGE_VERSION__ = VERSION
  window.__SHARE_NEWS_PAGE_LOADED_AT__ = Date.now()
  
  // 监听控制台输出，如果检测到旧代码的日志，立即警告
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  
  let oldCodeDetected = false
  
  const checkForOldCode = (args) => {
    const message = args.join(' ')
    if (message.includes('MutationObserver 触发') || 
        message.includes('找到') && message.includes('个表头元素') ||
        message.includes('已为') && message.includes('个表头单元格设置样式')) {
      if (!oldCodeDetected) {
        oldCodeDetected = true
        console.error('%c⚠️ 检测到旧代码的日志！浏览器可能在使用缓存！', 'color: red; font-size: 16px; font-weight: bold')
        console.error('%c请立即按 Ctrl+Shift+R 硬刷新，或使用无痕模式', 'color: red; font-size: 14px')
        console.error('%c如果问题持续，请清除浏览器缓存', 'color: orange; font-size: 14px')
      }
    }
  }
  
  console.log = (...args) => {
    checkForOldCode(args)
    originalLog.apply(console, args)
  }
  
  console.warn = (...args) => {
    checkForOldCode(args)
    originalWarn.apply(console, args)
  }
  
  console.error = (...args) => {
    checkForOldCode(args)
    originalError.apply(console, args)
  }
}

function ShareNewsPage() {
  
  const { token } = useParams()
  const [newsList, setNewsList] = useState([])
  const [allFilteredNews, setAllFilteredNews] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('yesterday')
  const [pageSize, setPageSize] = useState(10)
  const [enterpriseFilter, setEnterpriseFilter] = useState('enterprise')
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [verifying, setVerifying] = useState(true)
  const [verified, setVerified] = useState(false)
  const [error, setError] = useState('')

  // 验证token
  useEffect(() => {
    let isMounted = true
    
    const verifyToken = async () => {
      try {
        const response = await axios.get(`/api/news-share/verify/${token}`, {
          timeout: 10000
        })
        
        if (!isMounted) return
        
        if (response.data?.success) {
          if (response.data.data?.hasPassword) {
            setShowPasswordModal(true)
            setVerifying(false)
          } else {
            setVerified(true)
            setVerifying(false)
          }
        } else {
          setVerifying(false)
          setError(response.data?.message || '分享链接验证失败')
        }
      } catch (error) {
        if (!isMounted) return
        
        setVerifying(false)
        if (error.response) {
          setError(error.response.data?.message || `服务器错误 (${error.response.status})`)
        } else {
          setError(error.message || '分享链接无效或已过期')
        }
      }
    }

    if (token) {
      verifyToken()
    } else {
      setVerifying(false)
      setError('缺少分享链接token')
    }
    
    return () => {
      isMounted = false
    }
  }, [token])

  // 验证密码
  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setPasswordError('')
    
    if (!password) {
      setPasswordError('请输入密码')
      return
    }

    try {
      const response = await axios.post(`/api/news-share/verify-password/${token}`, {
        password
      })
      if (response.data.success) {
        setVerified(true)
        setShowPasswordModal(false)
      }
    } catch (error) {
      setPasswordError(error.response?.data?.message || '密码错误')
    }
  }

  // 获取舆情信息
  const fetchNews = useCallback(async () => {
    setLoading(true)
    try {
      const params = {
        page: 1,
        pageSize: 100000,
        timeRange: activeTab
      }
      if (search) {
        params.search = search
      }

      const response = await axios.get(`/api/news-share/news/${token}`, { params })

      if (response.data.success) {
        let allNewsData = response.data.data || []

        // 处理关键词数据
        allNewsData = allNewsData.map(news => {
          let keywords = []
          if (news.keywords) {
            if (Array.isArray(news.keywords)) {
              keywords = news.keywords
            } else if (typeof news.keywords === 'string') {
              try {
                keywords = JSON.parse(news.keywords)
              } catch (e) {
                keywords = [news.keywords]
              }
            }
          }
          return {
            ...news,
            keywords: Array.isArray(keywords) ? keywords : []
          }
        })

        // 客户端过滤
        if (enterpriseFilter === 'enterprise') {
          allNewsData = allNewsData.filter(news => 
            news.enterprise_full_name && news.enterprise_full_name.trim() !== ''
          )
        }

        // 排序
        allNewsData.sort((a, b) => {
          const aHasEnterprise = a.enterprise_full_name && a.enterprise_full_name.trim() !== ''
          const bHasEnterprise = b.enterprise_full_name && b.enterprise_full_name.trim() !== ''

          if (aHasEnterprise && !bHasEnterprise) return -1
          if (!aHasEnterprise && bHasEnterprise) return 1

          const timeA = a.public_time ? new Date(a.public_time).getTime() : 0
          const timeB = b.public_time ? new Date(b.public_time).getTime() : 0
          return timeB - timeA
        })

        setAllFilteredNews(allNewsData)
        setTotal(allNewsData.length)
      } else {
        setError(response.data.message || '获取舆情信息失败')
      }
    } catch (error) {
      setError(error.response?.data?.message || '获取舆情信息失败')
    } finally {
      setLoading(false)
    }
  }, [token, activeTab, search, enterpriseFilter])

  // 当verified为true时获取数据
  useEffect(() => {
    if (verified && !showPasswordModal) {
      fetchNews()
    }
  }, [verified, showPasswordModal, fetchNews])

  // 客户端分页
  useEffect(() => {
    if (allFilteredNews.length === 0) {
      setNewsList([])
      return
    }

    const startIndex = (currentPage - 1) * pageSize
    const endIndex = startIndex + pageSize
    const paginatedData = allFilteredNews.slice(startIndex, endIndex)
    setNewsList(paginatedData)
  }, [currentPage, pageSize, allFilteredNews])

  // 搜索处理
  const handleSearchChange = (e) => {
    setSearch(e.target.value)
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setCurrentPage(1)
    fetchNews()
  }

  // Tab切换
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1)
  }

  // 分页计算
  const totalPages = Math.ceil(total / pageSize) || 1

  // 格式化日期
  const formatDate = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  const formatDateWithLineBreak = (dateString) => {
    if (!dateString) return '-'
    try {
      const date = new Date(dateString)
      const dateStr = date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      })
      const timeStr = date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit'
      })
      return `${dateStr}\n${timeStr}`
    } catch (e) {
      return dateString
    }
  }

  if (verifying) {
    return (
      <div className="share-news-page">
        <div className="loading-container">
          <div className="loading">验证分享链接中...</div>
        </div>
      </div>
    )
  }

  if (error && !verified) {
    return (
      <div className="share-news-page">
        <div className="error-container">
          <div className="error-message">{error}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="share-news-page">
      {/* 密码验证模态框 */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal-content password-modal">
            <div className="modal-header">
              <h3>密码验证</h3>
            </div>
            <div className="modal-body">
              <form onSubmit={handlePasswordSubmit}>
                <div className="form-group">
                  <label>请输入访问密码：</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setPasswordError('')
                    }}
                    className={passwordError ? 'error' : ''}
                    placeholder="请输入密码"
                    autoFocus
                  />
                  {passwordError && (
                    <div className="error-message">{passwordError}</div>
                  )}
                </div>
                <div className="modal-actions">
                  <button type="submit" className="btn-primary">
                    确认
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 主要内容 */}
      <div className="share-header">
        <h2>舆情信息</h2>
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            placeholder="搜索标题、公众号名称或微信号..."
            value={search}
            onChange={handleSearchChange}
            className="search-input"
          />
          <button type="submit" className="search-button">
            搜索
          </button>
        </form>
      </div>

      {/* 统计信息 */}
      <div className="share-stats" style={{ 
        display: 'flex', 
        gap: '24px', 
        marginBottom: '16px', 
        padding: '16px', 
        background: '#f7f8fa', 
        borderRadius: '4px' 
      }}>
        <div>
          <div style={{ fontSize: '12px', color: '#86909c', marginBottom: '4px' }}>总舆情数量</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#165dff' }}>{total}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#86909c', marginBottom: '4px' }}>当前页显示</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#165dff' }}>{newsList.length}</div>
        </div>
        <div>
          <div style={{ fontSize: '12px', color: '#86909c', marginBottom: '4px' }}>总页数</div>
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#165dff' }}>{Math.ceil(total / pageSize) || 0}</div>
        </div>
      </div>

      {/* Tab页签 */}
      <div className="news-tabs">
        <div className="tabs-left">
          <button
            className={`tab-button ${activeTab === 'yesterday' ? 'active' : ''}`}
            onClick={() => handleTabChange('yesterday')}
          >
            昨日舆情
          </button>
          <button
            className={`tab-button ${activeTab === 'thisWeek' ? 'active' : ''}`}
            onClick={() => handleTabChange('thisWeek')}
          >
            本周舆情
          </button>
          <button
            className={`tab-button ${activeTab === 'lastWeek' ? 'active' : ''}`}
            onClick={() => handleTabChange('lastWeek')}
          >
            上周舆情
          </button>
          <button
            className={`tab-button ${activeTab === 'thisMonth' ? 'active' : ''}`}
            onClick={() => handleTabChange('thisMonth')}
          >
            本月舆情
          </button>
          <button
            className={`tab-button ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            全部舆情
          </button>
        </div>
      </div>

      {/* 企业相关/全部过滤按钮 */}
      <div className="enterprise-filter-buttons">
        <button
          className={`enterprise-filter-btn ${enterpriseFilter === 'enterprise' ? 'active' : ''}`}
          onClick={() => {
            setEnterpriseFilter('enterprise')
            setCurrentPage(1)
          }}
        >
          企业相关
        </button>
        <button
          className={`enterprise-filter-btn ${enterpriseFilter === 'all' ? 'active' : ''}`}
          onClick={() => {
            setEnterpriseFilter('all')
            setCurrentPage(1)
          }}
        >
          全部
        </button>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <table className="news-table" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th className="sequence-number-cell">序号</th>
                <th className="enterprise-name-cell">被投企业全称</th>
                <th className="keywords-cell">关键词</th>
                <th className="publish-time-cell">发布时间</th>
                <th className="title-cell">标题</th>
                <th className="abstract-cell">新闻摘要</th>
                <th className="article-link-cell">文章链接</th>
                <th className="account-name-cell">公众号名称</th>
                <th className="wechat-account-cell">微信账号</th>
              </tr>
            </thead>
            <tbody>
              {newsList.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty-data">
                    {search ? '未找到相关数据' : '暂无数据'}
                  </td>
                </tr>
              ) : (
                newsList.map((news, index) => (
                  <tr key={news.id || index}>
                    <td className="sequence-number-cell">
                      {(currentPage - 1) * pageSize + index + 1}
                    </td>
                    <td className="enterprise-name-cell" title={news.enterprise_full_name || ''}>
                      {news.enterprise_full_name || '-'}
                    </td>
                    <td className="keywords-cell">
                      {(() => {
                        let keywords = []
                        if (news.keywords) {
                          if (Array.isArray(news.keywords)) {
                            keywords = news.keywords
                          } else if (typeof news.keywords === 'string') {
                            try {
                              keywords = JSON.parse(news.keywords)
                            } catch (e) {
                              keywords = news.keywords.trim() ? [news.keywords] : []
                            }
                          }
                        }
                        
                        return keywords.length > 0 ? (
                          <div className="keywords-list">
                            {keywords.slice(0, 3).map((keyword, idx) => (
                              <span key={idx} className="keyword-tag" title={keyword}>
                                {keyword}
                              </span>
                            ))}
                            {keywords.length > 3 && (
                              <span className="keyword-more">+{keywords.length - 3}</span>
                            )}
                          </div>
                        ) : '-'
                      })()}
                    </td>
                    <td className="publish-time-cell" style={{ whiteSpace: 'pre-line' }}>
                      {formatDateWithLineBreak(news.public_time)}
                    </td>
                    <td className="title-cell" title={news.title || ''}>
                      {news.title || '-'}
                    </td>
                    <td className="abstract-cell" title={news.news_abstract || ''}>
                      {news.news_abstract || '-'}
                    </td>
                    <td className="article-link-cell">
                      {news.source_url ? (
                        <a href={news.source_url} target="_blank" rel="noopener noreferrer">
                          查看
                        </a>
                      ) : '-'}
                    </td>
                    <td className="account-name-cell" title={news.account_name || ''}>
                      {news.account_name || '-'}
                    </td>
                    <td className="wechat-account-cell" title={news.wechat_account || ''}>
                      {news.wechat_account || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* 分页控件 */}
      <div className="pagination-container">
        <div className="page-size-selector">
          <span>每页显示：</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value))
              setCurrentPage(1)
            }}
          >
            <option value={10}>10条</option>
            <option value={20}>20条</option>
            <option value={30}>30条</option>
            <option value={50}>50条</option>
            <option value={100}>100条</option>
          </select>
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />

        <div className="total-info">
          共 {total} 条记录
        </div>
      </div>
    </div>
  )
}

export default ShareNewsPage
