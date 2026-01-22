import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Tabs, Input, Select, Tag, Progress, Checkbox, Radio, Divider, Icon } from '@arco-design/web-react'
import axios from '../utils/axios'
import AdditionalAccounts from './AdditionalAccounts'
import RecipientManagement from './RecipientManagement'
import UserEmailRecords from './UserEmailRecords'
import './NewsInfo.css'

const Option = Select.Option
const TabPane = Tabs.TabPane
const InputSearch = Input.Search
const RadioGroup = Radio.Group

function NewsInfo() {
  const [newsList, setNewsList] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [selectedNews, setSelectedNews] = useState(null)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [showContentModal, setShowContentModal] = useState(false)
  const [userStats, setUserStats] = useState(null)
  const [activeTab, setActiveTab] = useState('yesterday')
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [adminActiveTab, setAdminActiveTab] = useState('news')
  const [recipientTab, setRecipientTab] = useState('recipients')
  const [selectedNewsIds, setSelectedNewsIds] = useState([])
  const [selectAll, setSelectAll] = useState(false)
  const [batchAnalysisLoading, setBatchAnalysisLoading] = useState(false)
  const [pageSize, setPageSize] = useState(100) // 默认100条
  const [analysisStatus, setAnalysisStatus] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [currentTaskId, setCurrentTaskId] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [enterpriseFilter, setEnterpriseFilter] = useState('enterprise')
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareConfig, setShareConfig] = useState({
    enabled: false,
    hasExpiry: false,
    expiryTime: '',
    hasPassword: false,
    password: ''
  })
  const [shareLink, setShareLink] = useState(null)
  const [shareLoading, setShareLoading] = useState(false)
  const [currentShareLinkId, setCurrentShareLinkId] = useState(null)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const userInfo = JSON.parse(userData)
      setUser(userInfo)
      setIsAdmin(userInfo.role === 'admin')
    }
  }, [])

  const fetchUserStats = async () => {
    if (!isAdmin) {
      try {
        const response = await axios.get('/api/news/user-stats')
        if (response.data.success) {
          setUserStats(response.data.data)
        }
      } catch (error) {
        console.error('获取统计信息失败:', error)
      }
    }
  }

  useEffect(() => {
    if (user !== null && !isAdmin) {
      fetchUserStats()
    }
  }, [user, isAdmin])

  // 当模态框打开时，加载已有分享链接
  useEffect(() => {
    if (showShareModal) {
      loadCurrentShareLink()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showShareModal])

  const fetchNews = async () => {
    if (isAdmin && adminActiveTab !== 'news') {
      return
    }
    
    if (user === null) {
      return
    }
    
    setLoading(true)
    try {
      // 使用服务端分页，根据currentPage查询对应页的数据
      const params = {
        page: currentPage,
        pageSize: pageSize,
        timeRange: activeTab,
        enterpriseFilter: enterpriseFilter // 传递企业过滤参数到后端
      }
      if (search) {
        params.search = search
      }
      
      const endpoint = isAdmin ? '/api/news/' : '/api/news/user-news'
      const response = await axios.get(endpoint, { params })
      
      if (response.data.success) {
        let newsData = response.data.data || []
        const totalCount = response.data.total || 0
        
        console.log('[获取新闻] 返回数据:', {
          dataCount: newsData.length,
          total: totalCount,
          currentPage,
          pageSize,
          totalPages: Math.ceil(totalCount / pageSize)
        })
        
        // 处理关键词数据
        newsData = newsData.map(news => {
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
        
        // 后端已经根据enterpriseFilter过滤和排序，直接使用返回的数据
        setNewsList(newsData)
        setTotal(totalCount)
      } else {
        console.error('获取舆情信息失败:', response.data.message)
        setNewsList([])
        setTotal(0)
        throw new Error(response.data.message || '获取舆情信息失败')
      }
    } catch (error) {
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        console.warn('后端服务器连接被拒绝，可能正在启动中...')
        setNewsList([])
        setTotal(0)
        throw error
      }
      console.error('获取舆情信息失败:', error)
      setNewsList([])
      setTotal(0)
      if (currentPage === 1 && !search) {
        throw new Error('获取舆情信息失败：' + (error.response?.data?.message || error.message || '未知错误'))
      }
      throw error
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    
    const loadData = async () => {
      try {
        await fetchNews()
      } catch (error) {
        if (isMounted && currentPage === 1 && !search) {
          if (error.message && !error.message.includes('ECONNREFUSED')) {
            Message.error(error.message)
          }
        }
      }
    }
    
    if (isAdmin && adminActiveTab !== 'news') {
      return
    }
    
    if (user === null) {
      return
    }
    
    loadData()
    
    return () => {
      isMounted = false
    }
  }, [search, isAdmin, user, activeTab, pageSize, adminActiveTab, enterpriseFilter, currentPage])

  const shouldShowCheckbox = () => {
    return ['yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'all'].includes(activeTab)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1)
    setSelectedNewsIds([])
    setSelectAll(false)
  }


  const handlePageSizeChange = (newPageSize) => {
    setPageSize(newPageSize)
    setCurrentPage(1)
    setSelectedNewsIds([])
    setSelectAll(false)
  }

  const checkAnalysisStatus = async () => {
    try {
      const response = await axios.get('/api/news-analysis/analysis-status')
      if (response.data.success) {
        setAnalysisStatus(response.data.data)
        if (response.data.data.isProcessing) {
          setTimeout(checkAnalysisStatus, 3000)
        }
      }
    } catch (error) {
      console.error('检查分析状态失败:', error)
    }
  }

  const checkAnalysisProgress = async (taskId) => {
    try {
      const response = await axios.get(`/api/news-analysis/analysis-progress/${taskId}`)
      if (response.data.success) {
        const progressData = response.data.data
        setAnalysisProgress(progressData)
        
        if (progressData.status === 'processing') {
          setTimeout(() => checkAnalysisProgress(taskId), 2000)
        } else if (progressData.status === 'completed') {
          setTimeout(() => {
            setAnalysisProgress(null)
            setCurrentTaskId(null)
            fetchNews()
          }, 3000)
        } else if (progressData.status === 'not_found') {
          setAnalysisProgress(null)
          setCurrentTaskId(null)
        }
      }
    } catch (error) {
      console.error('检查分析进度失败:', error)
      setAnalysisProgress(null)
      setCurrentTaskId(null)
    }
  }

  const cleanInvalidAssociations = async () => {
    Modal.confirm({
      title: '确认清理',
      content: '此操作将检查所有新闻的企业关联，并清理不在被投企业数据库中的关联。\n\n这可能会影响大量数据，是否继续？',
      onOk: async () => {
        try {
          const response = await axios.post('/api/news-analysis/clean-invalid-associations')
          if (response.data.success) {
            const result = response.data.data
            let resultMessage = `清理完成！\n\n` +
              `检查了 ${result.totalChecked} 条新闻\n` +
              `清理了 ${result.cleanedCount} 个无效企业关联\n\n`
            
            if (result.invalidEnterprises.length > 0) {
              resultMessage += `清理的无效企业示例：\n`
              result.invalidEnterprises.slice(0, 5).forEach(item => {
                resultMessage += `• ${item.invalidEnterprise}\n`
              })
              if (result.invalidEnterprises.length > 5) {
                resultMessage += `... 还有 ${result.invalidEnterprises.length - 5} 个\n`
              }
            }
            Message.success(resultMessage.replace(/\n/g, ' '))
            fetchNews()
          } else {
            Message.error('清理失败：' + response.data.message)
          }
        } catch (error) {
          console.error('清理无效关联失败:', error)
          Message.error('清理失败：' + (error.response?.data?.message || error.message))
        }
      }
    })
  }

  const cancelAnalysis = () => {
    Modal.confirm({
      title: '确认取消',
      content: '确定要取消当前的AI分析吗？\n\n已处理的数据不会回滚。',
      onOk: () => {
        setAnalysisProgress(null)
        setCurrentTaskId(null)
        Message.info('已取消AI分析监控\n\n注意：后台分析可能仍在继续，但不再显示进度。')
      }
    })
  }

  const handleRefreshList = async () => {
    if (isRefreshing || loading) return
    
    setIsRefreshing(true)
    try {
      await fetchNews()
    } catch (error) {
      console.error('刷新新闻列表失败:', error)
      Message.error('刷新失败，请稍后重试')
    } finally {
      setTimeout(() => {
        setIsRefreshing(false)
      }, 800)
    }
  }

  const handleSearch = () => {
    setCurrentPage(1)
  }

  const totalPages = Math.ceil(total / pageSize)

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

  const handleViewDetail = (news) => {
    setSelectedNews(news)
    setShowDetailModal(true)
  }

  const handleViewContent = (news) => {
    setSelectedNews(news)
    setShowContentModal(true)
  }

  const handleDelete = async (newsId) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条新闻记录吗？此操作不可恢复。',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/news/${newsId}`, {
            headers: {
              'user-id': user?.id,
              'user-role': user?.role
            }
          })
          if (response.data.success) {
            Message.success('删除成功')
            fetchNews()
          } else {
            Message.error('删除失败：' + (response.data.message || '未知错误'))
          }
        } catch (error) {
          console.error('删除新闻失败:', error)
          Message.error('删除失败：' + (error.response?.data?.message || '网络错误'))
        }
      }
    })
  }

  const closeModal = () => {
    setShowDetailModal(false)
    setShowContentModal(false)
    setSelectedNews(null)
  }

  const handleExport = useCallback(async (exportTimeRange = null, timeRange = null) => {
    setExportLoading(true)
    try {
      const response = await axios.post('/api/news/export', {
        timeRange: timeRange || activeTab,
        exportTimeRange: exportTimeRange
      }, {
        responseType: 'blob'
      })

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      const contentDisposition = response.headers['content-disposition']
      let filename = '舆情信息.xlsx'
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''))
        }
      }
      
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      
      setShowExportModal(false)
      Message.success('导出成功')
    } catch (error) {
      console.error('导出失败:', error)
      Message.error('导出失败，请重试')
    } finally {
      setExportLoading(false)
    }
  }, [activeTab])

  const handleSelectNews = (newsId) => {
    setSelectedNewsIds(prev => {
      if (prev.includes(newsId)) {
        return prev.filter(id => id !== newsId)
      } else {
        return [...prev, newsId]
      }
    })
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedNewsIds([])
    } else {
      setSelectedNewsIds(newsList.map(news => news.id))
    }
    setSelectAll(!selectAll)
  }

  useEffect(() => {
    if (newsList.length === 0) {
      setSelectAll(false)
      return
    }
    
    const currentPageNewsIds = newsList.map(news => news.id)
    const allCurrentPageSelected = currentPageNewsIds.length > 0 && 
      currentPageNewsIds.every(id => selectedNewsIds.includes(id))
    
    setSelectAll(allCurrentPageSelected)
  }, [newsList, selectedNewsIds])

  // 加载当前用户的分享链接
  const loadCurrentShareLink = async () => {
    try {
      const response = await axios.get('/api/news-share/current')
      if (response.data.success && response.data.data) {
        const link = response.data.data
        setShareLink(link)
        setCurrentShareLinkId(link.id)
        // 恢复配置状态
        setShareConfig({
          enabled: true,
          hasExpiry: link.hasExpiry,
          expiryTime: link.expiryTime ? new Date(link.expiryTime).toISOString().slice(0, 16) : '',
          hasPassword: link.hasPassword,
          password: '' // 密码不显示，每次需要重新生成
        })
      } else {
        // 没有已有链接，重置状态
        setShareLink(null)
        setCurrentShareLinkId(null)
        setShareConfig({
          enabled: false,
          hasExpiry: false,
          expiryTime: '',
          hasPassword: false,
          password: ''
        })
      }
    } catch (error) {
      console.error('加载分享链接失败:', error)
      // 加载失败时重置状态
      setShareLink(null)
      setCurrentShareLinkId(null)
    }
  }

  // 创建或更新分享链接
  const handleCreateShareLink = async () => {
    if (!shareConfig.enabled) {
      Message.warning('请先开启公共链接分享')
      return
    }

    if (shareConfig.hasExpiry && !shareConfig.expiryTime) {
      Message.warning('请设置有效期时间')
      return
    }

    // 如果启用密码保护，每次都需要重新生成密码
    let finalPassword = shareConfig.password
    if (shareConfig.hasPassword) {
      // 如果已有链接，或者密码为空，都重新生成密码
      if (currentShareLinkId || !finalPassword) {
        // 生成随机密码
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
        finalPassword = ''
        for (let i = 0; i < 10; i++) {
          finalPassword += chars.charAt(Math.floor(Math.random() * chars.length))
        }
        setShareConfig({
          ...shareConfig,
          password: finalPassword
        })
      }
    }

    setShareLoading(true)
    try {
      const response = await axios.post('/api/news-share/create', {
        hasExpiry: shareConfig.hasExpiry,
        expiryTime: shareConfig.hasExpiry ? shareConfig.expiryTime : null,
        hasPassword: shareConfig.hasPassword,
        password: shareConfig.hasPassword ? finalPassword : null
      })

      if (response.data.success) {
        setShareLink(response.data.data)
        setCurrentShareLinkId(response.data.data.id)
        const textToCopy = shareConfig.hasPassword
          ? `链接：${response.data.data.shareUrl}\n密码：${finalPassword}`
          : response.data.data.shareUrl
        navigator.clipboard.writeText(textToCopy)
        const actionText = currentShareLinkId ? '更新' : '创建'
        Message.success(`分享链接${actionText}成功！链接和密码已复制到剪贴板`)
      } else {
        Message.error('创建/更新分享链接失败：' + response.data.message)
      }
    } catch (error) {
      console.error('创建/更新分享链接失败:', error)
      Message.error('创建/更新分享链接失败：' + (error.response?.data?.message || error.message))
    } finally {
      setShareLoading(false)
    }
  }

  // 复制链接和密码
  const handleCopyLinkAndPassword = () => {
    if (shareLink) {
      const textToCopy = shareConfig.hasPassword
        ? `链接：${shareLink.shareUrl}\n密码：${shareConfig.password}`
        : shareLink.shareUrl
      navigator.clipboard.writeText(textToCopy)
      Message.success('链接和密码已复制到剪贴板')
    }
  }

  const handleBatchAnalysis = async () => {
    if (selectedNewsIds.length === 0) {
      Message.warning('请先选择要分析的新闻')
      return
    }

    if (!user || !user.id) {
      Message.warning('用户信息未加载，请刷新页面重试')
      return
    }

    Modal.confirm({
      title: '确认AI分析',
      content: `确定要对选中的 ${selectedNewsIds.length} 条新闻进行AI重新分析吗？\n\n分析过程可能需要一些时间，请耐心等待。`,
      onOk: async () => {
        setBatchAnalysisLoading(true)
        try {
          const response = await axios.post('/api/news-analysis/batch-analyze-selected', {
            newsIds: selectedNewsIds
          })
          
          if (response.data.success) {
            if (response.data.status === 'processing') {
              const taskId = response.data.taskId
              setCurrentTaskId(taskId)
              
              setAnalysisProgress({
                status: 'processing',
                total: response.data.data.total,
                processed: 0,
                successCount: 0,
                errorCount: 0,
                percentage: 0,
                currentItem: null,
                estimatedTimeLeft: null
              })
              
              Message.success(`AI分析已开始！正在后台处理 ${response.data.data.total} 条新闻`)
              
              setSelectedNewsIds([])
              setSelectAll(false)
              
              setTimeout(() => checkAnalysisProgress(taskId), 1000)
            } else {
              Message.success(`AI分析完成！处理了 ${response.data.processed || selectedNewsIds.length} 条新闻，成功: ${response.data.successCount || 0} 条，失败: ${response.data.errorCount || 0} 条`)
              fetchNews()
              setSelectedNewsIds([])
              setSelectAll(false)
            }
          } else {
            Message.error('分析失败：' + (response.data.message || '未知错误'))
          }
        } catch (error) {
          console.error('批量分析失败:', error)
          let errorMessage = '分析失败：'
          if (error.code === 'ECONNABORTED') {
            errorMessage += '请求超时。如果您看到此消息，AI分析可能仍在后台进行中，请等待几分钟后刷新页面查看结果'
          } else if (error.response) {
            errorMessage += `服务器错误 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`
          } else if (error.request) {
            errorMessage += '网络连接超时或服务器无响应。分析可能仍在后台进行，请稍后刷新页面查看结果'
          } else {
            errorMessage += error.message || '未知错误'
          }
          Message.error(errorMessage)
        } finally {
          setBatchAnalysisLoading(false)
        }
      }
    })
  }

  const columns = [
    ...(shouldShowCheckbox() ? [{
      title: (
        <Checkbox
          checked={selectAll && newsList.length > 0}
          onChange={handleSelectAll}
        />
      ),
      width: 60,
      render: (_, record) => (
        <Checkbox
          checked={selectedNewsIds.includes(record.id)}
          onChange={() => handleSelectNews(record.id)}
        />
      )
    }] : []),
    {
      title: '序号',
      width: 60,
      align: 'center',
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    },
    {
      title: '企业类型',
      dataIndex: 'entity_type',
      width: 140,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '被投企业全称',
      dataIndex: 'enterprise_full_name',
      width: 200,
      ellipsis: false,
      render: (text) => (
        <div style={{ 
          whiteSpace: 'normal', 
          wordWrap: 'break-word', 
          wordBreak: 'break-word',
          lineHeight: '1.5'
        }}>
          {text || '-'}
        </div>
      )
    },
    {
      title: '关键词',
      dataIndex: 'keywords',
      width: 150,
      align: 'center',
      ellipsis: true,
      tooltip: true,
      render: (keywords) => {
        if (keywords && Array.isArray(keywords) && keywords.length > 0) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
              {keywords.map((keyword, idx) => (
                <Tag key={idx} size="small" style={{ margin: 0 }}>
                  {keyword}
                </Tag>
              ))}
            </div>
          )
        }
        return '-'
      }
    },
    {
      title: '发布时间',
      dataIndex: 'public_time',
      width: 180,
      ellipsis: true,
      tooltip: true,
      render: (text) => formatDate(text)
    },
    {
      title: '标题',
      dataIndex: 'title',
      width: 300,
      ellipsis: false,
      render: (text) => (
        <div style={{ 
          whiteSpace: 'normal', 
          wordWrap: 'break-word', 
          wordBreak: 'break-word',
          lineHeight: '1.5'
        }}>
          {text || '-'}
        </div>
      )
    },
    {
      title: '新闻摘要',
      dataIndex: 'news_abstract',
      width: 450,
      ellipsis: false,
      render: (text) => (
        <div style={{ 
          whiteSpace: 'normal', 
          wordWrap: 'break-word', 
          wordBreak: 'break-word',
          lineHeight: '1.5'
        }}>
          {text || '-'}
        </div>
      )
    },
    {
      title: '文章链接',
      dataIndex: 'source_url',
      width: 120,
      ellipsis: true,
      tooltip: true,
      render: (text) => text ? (
        <Button type="text" size="small" onClick={() => window.open(text, '_blank')}>
          查看文章
        </Button>
      ) : '-'
    },
    {
      title: '关联基金',
      dataIndex: 'fund',
      width: 150,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '关联子基金',
      dataIndex: 'sub_fund',
      width: 150,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '公众号名称',
      dataIndex: 'account_name',
      width: 150,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '微信账号',
      dataIndex: 'wechat_account',
      width: 150,
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    ...(isAdmin ? [{
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      ellipsis: true,
      tooltip: true,
      render: (text) => formatDate(text)
    }, {
      title: '操作',
      width: 100,
      align: 'center',
      render: (_, record) => (
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          justifyContent: 'center', 
          alignItems: 'center',
          gap: '4px',
          paddingLeft: '4px',
          paddingRight: '4px',
          width: '100%'
        }}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleViewDetail(record)}
            style={{ width: '100%' }}
          >
            详情
          </Button>
          {record.content && (
            <Button
              type="outline"
              size="small"
              status="success"
              onClick={() => handleViewContent(record)}
              style={{ width: '100%' }}
            >
              正文
            </Button>
          )}
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
            style={{ width: '100%' }}
          >
            删除
          </Button>
        </div>
      )
    }] : [])
  ]

  return (
    <div className="news-info">
      <Tabs
        activeTab={adminActiveTab}
        onChange={setAdminActiveTab}
        type="line"
        className="admin-tabs"
      >
        <TabPane key="news" title="舆情信息">
          <Card className="news-card" bordered={false}>
            <div className="news-header">
              <h2>
                舆情信息
                {isAdmin && <Tag color="orange" style={{ marginLeft: '8px' }}>（管理员 - 全部数据）</Tag>}
                {!isAdmin && <Tag color="blue" style={{ marginLeft: '8px' }}>（我的企业相关）</Tag>}
              </h2>
              <Space>
                <InputSearch
                  value={search}
                  onChange={(value) => setSearch(value)}
                  placeholder="搜索标题、公众号名称或微信号..."
                  style={{ width: 400 }}
                  allowClear
                  onSearch={handleSearch}
                />
                <Button
                  type="primary"
                  status="danger"
                  onClick={() => {
                    setShowShareModal(true)
                  }}
                >
                  发布
                </Button>
              </Space>
            </div>

            {isAdmin && (
              <Card className="stats-card" style={{ marginBottom: '16px' }}>
                <Space size="large">
                  <div>
                    <div className="stats-label">总舆情数量</div>
                    <div className="stats-value">{total.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="stats-label">当前页显示</div>
                    <div className="stats-value">{newsList.length}</div>
                  </div>
                  <div>
                    <div className="stats-label">总页数</div>
                    <div className="stats-value">{totalPages}</div>
                  </div>
                </Space>
              </Card>
            )}

            {!isAdmin && userStats && (
              <Card className="stats-card" style={{ marginBottom: '16px' }}>
                <Space size="large">
                  <div>
                    <div className="stats-label">昨日发布新闻企业个数</div>
                    <div className="stats-value highlight">{userStats.yesterdayAccountsCount || 0}</div>
                  </div>
                  <div>
                    <div className="stats-label">昨日累计新闻条数</div>
                    <div className="stats-value highlight">{userStats.yesterdayCount || 0}</div>
                  </div>
                  <div>
                    <div className="stats-label">当前总关注被投企业个数</div>
                    <div className="stats-value highlight-blue">{userStats.totalEnterprises || 0}</div>
                  </div>
                </Space>
              </Card>
            )}

            <Tabs
              activeTab={activeTab}
              onChange={handleTabChange}
              type="line"
              className="time-range-tabs"
            >
              <TabPane 
                key="yesterday" 
                title="昨日舆情"
              />
              <TabPane 
                key="thisWeek" 
                title="本周舆情"
              />
              <TabPane 
                key="lastWeek" 
                title="上周舆情"
              />
              <TabPane 
                key="thisMonth" 
                title="本月舆情"
              />
              <TabPane 
                key="all" 
                title="全部舆情"
              />
            </Tabs>

            <div className="toolbar">
              <Space>
                {activeTab === 'all' ? (
                  <Button
                    type="outline"
                    onClick={() => setShowExportModal(true)}
                    loading={exportLoading}
                  >
                    导出
                  </Button>
                ) : (
                  <Button
                    type="outline"
                    onClick={() => handleExport()}
                    loading={exportLoading}
                  >
                    导出
                  </Button>
                )}
                
                {shouldShowCheckbox() && selectedNewsIds.length > 0 && (
                  <Button
                    type="outline"
                    status="warning"
                    onClick={handleBatchAnalysis}
                    loading={batchAnalysisLoading}
                  >
                    AI分析({selectedNewsIds.length})
                  </Button>
                )}

                {(analysisProgress && analysisProgress.status === 'processing') && (
                  <Card className="progress-card" style={{ padding: '12px', marginTop: '16px' }}>
                    <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>AI分析进行中</span>
                      <span style={{ fontSize: '14px', color: '#4e5969' }}>
                        {analysisProgress?.processed || 0}/{analysisProgress?.total || 0} ({analysisProgress?.percentage || 0}%)
                      </span>
                    </div>
                    <Progress
                      percent={analysisProgress?.percentage || 0}
                      status="normal"
                      style={{ marginBottom: '8px' }}
                    />
                    <div style={{ fontSize: '12px', color: '#86909c', display: 'flex', justifyContent: 'space-between' }}>
                      <span>成功: {analysisProgress?.successCount || 0} 失败: {analysisProgress?.errorCount || 0}</span>
                      <Button type="text" size="mini" onClick={cancelAnalysis}>取消</Button>
                    </div>
                  </Card>
                )}

                {analysisProgress && analysisProgress.status === 'completed' && (
                  <Card className="completed-card" style={{ padding: '12px', marginTop: '16px', background: '#f0f9ff' }}>
                    <Space>
                      <Tag color="green">✅</Tag>
                      <span>
                        分析完成！处理了 {analysisProgress.total} 条新闻，成功 {analysisProgress.successCount} 条，失败 {analysisProgress.errorCount} 条
                      </span>
                    </Space>
                  </Card>
                )}

                {isAdmin && (
                  <Button
                    type="outline"
                    status="warning"
                    onClick={cleanInvalidAssociations}
                  >
                    清理无效关联
                  </Button>
                )}

                <Button
                  onClick={handleRefreshList}
                  loading={isRefreshing}
                >
                  刷新
                </Button>
              </Space>
            </div>

            <RadioGroup
              value={enterpriseFilter}
              onChange={(value) => {
                setEnterpriseFilter(value)
                setCurrentPage(1)
                setSelectedNewsIds([])
                setSelectAll(false)
              }}
              type="button"
              style={{ marginBottom: '16px' }}
            >
              <Radio value="enterprise">企业相关</Radio>
              <Radio value="all">全部</Radio>
            </RadioGroup>

            <div className="table-container">
              {loading && newsList.length === 0 ? (
                <Skeleton
                  loading={true}
                  animation={true}
                  text={{ rows: 8, width: ['100%'] }}
                />
              ) : (
                <Table
                  columns={columns}
                  data={newsList}
                  loading={loading}
                  pagination={false}
                  rowKey="id"
                  border={{
                    wrapper: true,
                    cell: true
                  }}
                  stripe
                  scroll={{
                    x: 'max-content'
                  }}
                />
              )}
            </div>

            {total > 0 && (
              <div className="pagination-wrapper">
                <div className="page-size-selector">
                  <span className="page-size-label">每页显示：</span>
                  <Select
                    value={pageSize}
                    onChange={handlePageSizeChange}
                    style={{ width: 100 }}
                  >
                    <Option value={10}>10</Option>
                    <Option value={20}>20</Option>
                    <Option value={30}>30</Option>
                    <Option value={50}>50</Option>
                    <Option value={100}>100</Option>
                  </Select>
                  <span className="page-size-unit">条</span>
                </div>
                <Pagination
                  current={currentPage}
                  total={Number(total)}
                  pageSize={Number(pageSize)}
                  onChange={(page) => {
                    console.log('[分页] 切换到页码:', page, '总数据量:', total, '每页:', pageSize, '总页数:', Math.ceil(total / pageSize))
                    setCurrentPage(Number(page))
                  }}
                  showTotal={(total, range) => {
                    const totalPages = Math.ceil(total / pageSize)
                    console.log('[分页显示] total:', total, 'range:', range, '总页数:', totalPages, '当前页:', currentPage, 'pageSize:', pageSize)
                    return `共 ${total} 条，显示 ${range[0]}-${range[1]} 条`
                  }}
                  showJumper
                  sizeCanChange={false}
                  simple={false}
                />
              </div>
            )}
          </Card>
        </TabPane>

        <TabPane key="accounts" title="公众号管理">
          <AdditionalAccounts />
        </TabPane>

        <TabPane key="recipients" title="收件管理">
          {!isAdmin ? (
            <Tabs
              activeTab={recipientTab}
              onChange={setRecipientTab}
              type="line"
            >
              <TabPane key="recipients" title="收件管理">
                <RecipientManagement />
              </TabPane>
              <TabPane key="records" title="收发记录">
                <UserEmailRecords activeTab="records" />
              </TabPane>
              <TabPane key="logs" title="邮件日志">
                <UserEmailRecords activeTab="logs" />
              </TabPane>
            </Tabs>
          ) : (
            <RecipientManagement />
          )}
        </TabPane>
      </Tabs>

      {/* 分享链接对话框 */}
      <Modal
        visible={showShareModal}
        title="公共链接分享"
        onCancel={() => {
          setShowShareModal(false)
          setShareConfig({
            enabled: false,
            hasExpiry: false,
            expiryTime: '',
            hasPassword: false,
            password: ''
          })
          setShareLink(null)
          setCurrentShareLinkId(null)
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <div style={{ padding: '20px 0' }}>
          {/* 开启/关闭开关 */}
          <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid #e0e0e0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '16px', fontWeight: 500 }}>公共链接分享</span>
              <Checkbox
                checked={shareConfig.enabled}
                onChange={(checked) => {
                  setShareConfig({
                    ...shareConfig,
                    enabled: checked
                  })
                  // 关闭开关时不删除链接信息，只是隐藏，这样再次打开时可以恢复
                  // 如果用户真的想删除，可以通过其他方式（如删除链接功能）
                }}
              />
            </div>
            <div style={{ fontSize: '14px', color: '#666', marginTop: '8px' }}>
              开启后,用户可以通过该链接访问仪表板
            </div>
          </div>

          {/* 分享链接显示 */}
          {shareLink && (
            <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: '14px', fontWeight: 500, marginBottom: '8px' }}>分享链接：</div>
              <Space style={{ width: '100%' }}>
                <Input
                  value={shareLink.shareUrl}
                  readOnly
                  style={{ flex: 1, backgroundColor: '#f5f5f5' }}
                />
                <Button onClick={() => {
                  navigator.clipboard.writeText(shareLink.shareUrl)
                  Message.success('链接已复制到剪贴板')
                }}>
                  复制链接
                </Button>
              </Space>
            </div>
          )}

          {/* 有效期设置 */}
          {shareConfig.enabled && (
            <>
              <div style={{ marginBottom: '20px' }}>
                <Checkbox
                  checked={shareConfig.hasExpiry}
                  onChange={(checked) => {
                    setShareConfig({
                      ...shareConfig,
                      hasExpiry: checked,
                      expiryTime: checked ? shareConfig.expiryTime : ''
                    })
                  }}
                >
                  有效期
                </Checkbox>
                {shareConfig.hasExpiry && (
                  <div style={{ marginTop: '12px' }}>
                    <Input
                      type="datetime-local"
                      value={shareConfig.expiryTime}
                      onChange={(value) => {
                        setShareConfig({
                          ...shareConfig,
                          expiryTime: value
                        })
                      }}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
              </div>

              {/* 密码保护设置 */}
              <div style={{ marginBottom: '20px' }}>
                <Checkbox
                  checked={shareConfig.hasPassword}
                  onChange={(checked) => {
                    setShareConfig({
                      ...shareConfig,
                      hasPassword: checked,
                      password: checked ? shareConfig.password : ''
                    })
                  }}
                >
                  密码保护
                </Checkbox>
                {shareConfig.hasPassword && (
                  <Space style={{ width: '100%', marginTop: '12px' }}>
                    <Input
                      value={shareConfig.password}
                      onChange={(value) => {
                        setShareConfig({
                          ...shareConfig,
                          password: value
                        })
                      }}
                      placeholder={currentShareLinkId ? "密码已隐藏，点击更新链接将自动生成新密码" : "留空将自动生成密码，或手动输入"}
                      style={{ flex: 1 }}
                      readOnly={!!currentShareLinkId}
                    />
                    {!currentShareLinkId && (
                      <Button
                        onClick={() => {
                          // 生成随机密码
                          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
                          let newPassword = ''
                          for (let i = 0; i < 10; i++) {
                            newPassword += chars.charAt(Math.floor(Math.random() * chars.length))
                          }
                          setShareConfig({
                            ...shareConfig,
                            password: newPassword
                          })
                        }}
                      >
                        重新生成
                      </Button>
                    )}
                  </Space>
                )}
              </div>
            </>
          )}

          {/* 操作按钮 */}
          {shareConfig.enabled && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #e0e0e0' }}>
              <Button
                onClick={() => {
                  setShowShareModal(false)
                  setShareConfig({
                    enabled: false,
                    hasExpiry: false,
                    expiryTime: '',
                    hasPassword: false,
                    password: ''
                  })
                  setShareLink(null)
                  setCurrentShareLinkId(null)
                }}
              >
                取消
              </Button>
              <Button
                type="primary"
                onClick={handleCreateShareLink}
                loading={shareLoading}
              >
                {shareLoading ? (currentShareLinkId ? '更新中...' : '创建中...') : (currentShareLinkId ? '更新链接' : '创建链接')}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* 详情模态框 */}
      <Modal
        visible={showDetailModal}
        title="舆情详情"
        onCancel={closeModal}
        footer={null}
        style={{ width: 600 }}
      >
        {selectedNews && (
          <div className="detail-content">
            <div className="detail-row">
              <label>公众号名称：</label>
              <span>{selectedNews.account_name || '-'}</span>
            </div>
            <div className="detail-row">
              <label>微信账号：</label>
              <span>{selectedNews.wechat_account || '-'}</span>
            </div>
            <div className="detail-row">
              <label>发布时间：</label>
              <span>{formatDate(selectedNews.public_time)}</span>
            </div>
            <div className="detail-row">
              <label>创建时间：</label>
              <span>{formatDate(selectedNews.created_at)}</span>
            </div>
            <div className="detail-row">
              <label>文章标题：</label>
              <span>{selectedNews.title || '-'}</span>
            </div>
            {selectedNews.summary && (
              <div className="detail-row">
                <label>文章摘要：</label>
                <span>{selectedNews.summary}</span>
              </div>
            )}
            <div className="detail-row">
              <label>原文链接：</label>
              <span>
                {selectedNews.source_url ? (
                  <a href={selectedNews.source_url} target="_blank" rel="noopener noreferrer">
                    {selectedNews.source_url}
                  </a>
                ) : '-'}
              </span>
            </div>
            {selectedNews.keywords && selectedNews.keywords.length > 0 && (
              <div className="detail-row">
                <label>关键词：</label>
                <Space wrap>
                  {selectedNews.keywords.map((keyword, idx) => (
                    <Tag key={idx}>{keyword}</Tag>
                  ))}
                </Space>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 正文模态框 */}
      <Modal
        visible={showContentModal}
        title="文章正文"
        onCancel={closeModal}
        footer={null}
        style={{ width: 800 }}
      >
        {selectedNews && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h3>{selectedNews.title}</h3>
              <p style={{ color: '#86909c', fontSize: '14px' }}>
                {selectedNews.account_name} · {formatDate(selectedNews.public_time)}
              </p>
            </div>
            <Divider />
            <div>
              {selectedNews.content ? (
                <div dangerouslySetInnerHTML={{ __html: selectedNews.content }} />
              ) : (
                <p>暂无正文内容</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 导出选择模态框 */}
      <Modal
        visible={showExportModal}
        title="选择导出范围"
        onCancel={() => setShowExportModal(false)}
        footer={null}
        style={{ width: 600 }}
      >
        <div className="export-options">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Button
              type="outline"
              long
              onClick={() => handleExport('thisWeek')}
              loading={exportLoading}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>本周舆情</div>
                <div style={{ fontSize: '12px', color: '#86909c' }}>导出本周一至今的舆情信息</div>
              </div>
            </Button>
            <Button
              type="outline"
              long
              onClick={() => handleExport('thisMonth')}
              loading={exportLoading}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>本月舆情</div>
                <div style={{ fontSize: '12px', color: '#86909c' }}>导出本月1日至今的舆情信息</div>
              </div>
            </Button>
            <Button
              type="outline"
              long
              onClick={() => handleExport('lastMonth')}
              loading={exportLoading}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>上月舆情</div>
                <div style={{ fontSize: '12px', color: '#86909c' }}>导出上个月的舆情信息</div>
              </div>
            </Button>
            <Button
              type="outline"
              long
              onClick={() => handleExport('all')}
              loading={exportLoading}
            >
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>全部舆情</div>
                <div style={{ fontSize: '12px', color: '#86909c' }}>导出所有舆情信息</div>
              </div>
            </Button>
          </Space>
        </div>
      </Modal>
    </div>
  )
}

export default NewsInfo

