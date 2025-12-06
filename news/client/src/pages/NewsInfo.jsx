import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import AdditionalAccounts from './AdditionalAccounts'
import RecipientManagement from './RecipientManagement'
import UserEmailRecords from './UserEmailRecords'
import Pagination from '../components/Pagination'
import './NewsInfo.css'

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
  const [adminActiveTab, setAdminActiveTab] = useState('news') // 管理员tab切换
  const [recipientTab, setRecipientTab] = useState('recipients') // 收件管理tab切换：recipients, records, logs
  // 批量选择相关状态
  const [selectedNewsIds, setSelectedNewsIds] = useState([])
  const [selectAll, setSelectAll] = useState(false)
  const [batchAnalysisLoading, setBatchAnalysisLoading] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [analysisStatus, setAnalysisStatus] = useState(null)
  const [analysisProgress, setAnalysisProgress] = useState(null)
  const [currentTaskId, setCurrentTaskId] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 获取用户信息
  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      const userInfo = JSON.parse(userData)
      setUser(userInfo)
      setIsAdmin(userInfo.role === 'admin')
    }
  }, [])

  // 获取用户统计信息
  const fetchUserStats = async () => {
    if (!isAdmin) { // 只有普通用户需要获取统计信息
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

  // 当用户信息加载完成后获取统计信息
  useEffect(() => {
    if (user !== null && !isAdmin) {
      fetchUserStats()
    }
  }, [user, isAdmin])

  // 提取数据获取逻辑为独立函数
  const fetchNews = async () => {
    // 如果不在舆情信息tab，不执行请求
    if (isAdmin && adminActiveTab !== 'news') {
      return
    }
    
    // 如果用户信息未加载，不执行请求
    if (user === null) {
      return
    }
    
    setLoading(true)
    try {
      const params = {
        page: currentPage,
        pageSize,
        timeRange: activeTab
      }
      if (search) {
        params.search = search
      }
      
      // 根据用户角色选择不同的API端点
      const endpoint = isAdmin ? '/api/news/' : '/api/news/user-news'
      const response = await axios.get(endpoint, { params })
      
      if (response.data.success) {
        setNewsList(response.data.data || [])
        setTotal(response.data.total || 0)
      } else {
        console.error('获取舆情信息失败:', response.data.message)
        setNewsList([])
        setTotal(0)
        throw new Error(response.data.message || '获取舆情信息失败')
      }
    } catch (error) {
      // 忽略连接被拒绝的错误（通常是服务器未启动或正在重启）
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        console.warn('后端服务器连接被拒绝，可能正在启动中...')
        setNewsList([])
        setTotal(0)
        throw error
      }
      console.error('获取舆情信息失败:', error)
      console.error('错误详情:', error.response?.data)
      setNewsList([])
      setTotal(0)
      // 只在第一次加载失败时显示错误提示
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
        // 错误已在 fetchNews 中处理
        if (isMounted && currentPage === 1 && !search) {
          // 只在第一次加载失败时显示错误提示
          if (error.message && !error.message.includes('ECONNREFUSED')) {
            alert(error.message)
          }
        }
      }
    }
    
    // 如果不在舆情信息tab，不执行请求
    if (isAdmin && adminActiveTab !== 'news') {
      return
    }
    
    // 如果用户信息未加载，不执行请求
    if (user === null) {
      return
    }
    
    loadData()
    
    return () => {
      isMounted = false
    }
  }, [currentPage, search, isAdmin, user, activeTab, pageSize, adminActiveTab])

  // 切换tab时重置页码
  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1)
  }

  // 处理每页显示数量变更
  const handlePageSizeChange = (newPageSize) => {
    setPageSize(newPageSize)
    setCurrentPage(1) // 重置到第一页
    setSelectedNewsIds([])
    setSelectAll(false)
  }

  // 检查AI分析状态
  const checkAnalysisStatus = async () => {
    try {
      const response = await axios.get('/api/news-analysis/analysis-status')
      if (response.data.success) {
        setAnalysisStatus(response.data.data)
        if (response.data.data.isProcessing) {
          // 如果还在处理中，3秒后再次检查
          setTimeout(checkAnalysisStatus, 3000)
        }
      }
    } catch (error) {
      console.error('检查分析状态失败:', error)
    }
  }

  // 检查分析进度
  const checkAnalysisProgress = async (taskId) => {
    console.log('检查分析进度，任务ID:', taskId)
    try {
      const response = await axios.get(`/api/news-analysis/analysis-progress/${taskId}`)
      console.log('进度响应:', response.data)
      if (response.data.success) {
        const progressData = response.data.data
        console.log('设置进度数据:', progressData)
        setAnalysisProgress(progressData)
        
        if (progressData.status === 'processing') {
          // 如果还在处理中，2秒后再次检查
          console.log('继续处理中，2秒后再次检查')
          setTimeout(() => checkAnalysisProgress(taskId), 2000)
        } else if (progressData.status === 'completed') {
          // 分析完成，显示结果并清理状态
          console.log('分析完成')
          setTimeout(() => {
            setAnalysisProgress(null)
            setCurrentTaskId(null)
            fetchNews() // 刷新新闻列表
          }, 3000) // 3秒后清理状态
        } else if (progressData.status === 'not_found') {
          // 任务不存在，清理状态
          console.log('任务不存在')
          setAnalysisProgress(null)
          setCurrentTaskId(null)
        }
      }
    } catch (error) {
      console.error('检查分析进度失败:', error)
      // 出错时也清理状态
      setAnalysisProgress(null)
      setCurrentTaskId(null)
    }
  }


  // 清理无效的企业关联
  const cleanInvalidAssociations = async () => {
    const confirmMessage = `此操作将检查所有新闻的企业关联，并清理不在被投企业数据库中的关联。\n\n这可能会影响大量数据，是否继续？`
    if (!window.confirm(confirmMessage)) {
      return
    }

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

        alert(resultMessage)
        
        // 刷新新闻列表
        fetchNews()
      } else {
        alert('清理失败：' + response.data.message)
      }
    } catch (error) {
      console.error('清理无效关联失败:', error)
      alert('清理失败：' + (error.response?.data?.message || error.message))
    }
  }

  // 取消分析
  const cancelAnalysis = () => {
    if (window.confirm('确定要取消当前的AI分析吗？\n\n已处理的数据不会回滚。')) {
      setAnalysisProgress(null)
      setCurrentTaskId(null)
      alert('已取消AI分析监控\n\n注意：后台分析可能仍在继续，但不再显示进度。')
    }
  }

  // 刷新列表
  const handleRefreshList = async () => {
    if (isRefreshing || loading) return
    
    console.log('手动刷新新闻列表')
    setIsRefreshing(true)
    
    try {
      await fetchNews()
      console.log('新闻列表刷新完成')
    } catch (error) {
      console.error('刷新新闻列表失败:', error)
      alert('刷新失败，请稍后重试')
    } finally {
      // 延迟一点时间让用户看到刷新动画
      setTimeout(() => {
        setIsRefreshing(false)
      }, 800)
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setCurrentPage(1)
  }

  const handleSearchChange = (e) => {
    setSearch(e.target.value)
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
    if (!window.confirm('确定要删除这条新闻记录吗？此操作不可恢复。')) {
      return
    }

    try {
      const response = await axios.delete(`/api/news/${newsId}`, {
        headers: {
          'user-id': user?.id,
          'user-role': user?.role
        }
      })
      if (response.data.success) {
        alert('删除成功')
        // 重新获取数据
        fetchNews()
      } else {
        alert('删除失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('删除新闻失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '网络错误'))
    }
  }


  const closeModal = () => {
    setShowDetailModal(false)
    setShowContentModal(false)
    setSelectedNews(null)
  }

  const handleExport = async (exportTimeRange = null) => {
    setExportLoading(true)
    try {
      const response = await axios.post('/api/news/export', {
        timeRange: activeTab,
        exportTimeRange: exportTimeRange
      }, {
        responseType: 'blob'
      })

      // 创建下载链接
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // 从响应头获取文件名，如果没有则使用默认名称
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
    } catch (error) {
      console.error('导出失败:', error)
      alert('导出失败，请重试')
    } finally {
      setExportLoading(false)
    }
  }


  // 处理复选框选择
  const handleSelectNews = (newsId) => {
    setSelectedNewsIds(prev => {
      if (prev.includes(newsId)) {
        return prev.filter(id => id !== newsId)
      } else {
        return [...prev, newsId]
      }
    })
  }

  // 处理全选
  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedNewsIds([])
    } else {
      setSelectedNewsIds(newsList.map(news => news.id))
    }
    setSelectAll(!selectAll)
  }

  // 批量AI分析
  const handleBatchAnalysis = async () => {
    if (selectedNewsIds.length === 0) {
      alert('请先选择要分析的新闻')
      return
    }

    // 检查用户信息
    if (!user || !user.id) {
      alert('用户信息未加载，请刷新页面重试')
      return
    }

    // 添加确认对话框
    const confirmMessage = `确定要对选中的 ${selectedNewsIds.length} 条新闻进行AI重新分析吗？\n\n分析过程可能需要一些时间，请耐心等待。`
    if (!window.confirm(confirmMessage)) {
      return
    }

    setBatchAnalysisLoading(true)

    console.log('开始AI分析，用户ID:', user.id, '选中新闻数量:', selectedNewsIds.length)
    console.log('选中的新闻IDs:', selectedNewsIds)


    try {
      console.log('发送请求到:', '/api/news-analysis/batch-analyze-selected')
      const response = await axios.post('/api/news-analysis/batch-analyze-selected', {
        newsIds: selectedNewsIds
      })

      console.log('AI分析响应:', response.data)

      console.log('收到响应:', response.data)
      
      if (response.data.success) {
        if (response.data.status === 'processing') {
          // 异步处理模式
          const taskId = response.data.taskId
          console.log('收到任务ID:', taskId)
          setCurrentTaskId(taskId)
          
          // 立即设置初始进度状态
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
          
          alert(`AI分析已开始！\n\n正在后台处理 ${response.data.data.total} 条新闻\n您可以在页面上方看到实时进度条`)
          
          // 清空选择
          setSelectedNewsIds([])
          setSelectAll(false)
          
          // 开始检查分析进度
          console.log('开始检查分析进度，任务ID:', taskId)
          setTimeout(() => checkAnalysisProgress(taskId), 1000)
          
        } else {
          // 同步处理完成
          alert(`AI分析完成！\n\n处理了 ${response.data.processed || selectedNewsIds.length} 条新闻\n成功: ${response.data.successCount || 0} 条\n失败: ${response.data.errorCount || 0} 条`)
          // 刷新新闻列表
          fetchNews()
          // 清空选择
          setSelectedNewsIds([])
          setSelectAll(false)
        }
      } else {
        console.error('分析失败，响应数据:', response.data)
        alert('分析失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      console.error('批量分析失败:', error)
      console.error('错误详情:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText
      })
      
      let errorMessage = '分析失败：'
      if (error.code === 'ECONNABORTED') {
        // 请求超时
        errorMessage += '请求超时\n\n如果您看到此消息，AI分析可能仍在后台进行中\n请等待几分钟后刷新页面查看结果'
      } else if (error.response) {
        // 服务器响应了错误状态码
        errorMessage += `服务器错误 (${error.response.status}): ${error.response.data?.message || error.response.statusText}`
      } else if (error.request) {
        // 请求发送了但没有收到响应
        errorMessage += '网络连接超时或服务器无响应\n\n分析可能仍在后台进行，请稍后刷新页面查看结果'
      } else {
        // 其他错误
        errorMessage += error.message || '未知错误'
      }
      
      alert(errorMessage)
    } finally {
      setBatchAnalysisLoading(false)
    }
  }



  return (
    <div className="news-info">
      {/* 管理员Tab页签 */}
      {isAdmin && (
        <div className="admin-tabs">
          <button 
            className={`admin-tab-button ${adminActiveTab === 'news' ? 'active' : ''}`}
            onClick={() => setAdminActiveTab('news')}
          >
            舆情信息
          </button>
          <button 
            className={`admin-tab-button ${adminActiveTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setAdminActiveTab('accounts')}
          >
            公众号管理
          </button>
          <button 
            className={`admin-tab-button ${adminActiveTab === 'recipients' ? 'active' : ''}`}
            onClick={() => {
              console.log('点击收件管理按钮, 当前 adminActiveTab:', adminActiveTab)
              setAdminActiveTab('recipients')
              console.log('设置 adminActiveTab 为 recipients')
            }}
          >
            收件管理
          </button>
        </div>
      )}

      {/* 用户Tab页签 */}
      {!isAdmin && (
        <div className="admin-tabs">
          <button 
            className={`admin-tab-button ${adminActiveTab === 'news' ? 'active' : ''}`}
            onClick={() => setAdminActiveTab('news')}
          >
            舆情信息
          </button>
          <button 
            className={`admin-tab-button ${adminActiveTab === 'recipients' ? 'active' : ''}`}
            onClick={() => {
              console.log('点击收件管理按钮, 当前 adminActiveTab:', adminActiveTab)
              setAdminActiveTab('recipients')
              setRecipientTab('recipients')
              console.log('设置 adminActiveTab 为 recipients')
            }}
          >
            收件管理
          </button>
        </div>
      )}

      {/* 根据选中的tab显示不同内容 */}
      {adminActiveTab === 'news' && (
        <>
          <div className="news-header">
            <h2>
              舆情信息
              {isAdmin && <span className="admin-badge">（管理员 - 全部数据）</span>}
              {!isAdmin && <span className="user-badge">（我的企业相关）</span>}
            </h2>
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

      {/* 管理员统计面板 */}
      {isAdmin && (
        <div className="stats-panel">
          <div className="stats-item">
            <span className="stats-label">总舆情数量</span>
            <span className="stats-value">{total.toLocaleString()}</span>
          </div>
          <div className="stats-item">
            <span className="stats-label">当前页显示</span>
            <span className="stats-value">{newsList.length}</span>
          </div>
          <div className="stats-item">
            <span className="stats-label">总页数</span>
            <span className="stats-value">{totalPages}</span>
          </div>
        </div>
      )}

      {/* 用户统计面板 */}
      {!isAdmin && userStats && (
        <div className="user-stats-panel">
          <div className="user-stats-item highlight">
            <span className="stats-label">昨日发布新闻企业个数</span>
            <span className="stats-value">{userStats.yesterdayAccountsCount || 0}</span>
          </div>
          <div className="user-stats-item highlight">
            <span className="stats-label">昨日累计新闻条数</span>
            <span className="stats-value">{userStats.yesterdayCount || 0}</span>
          </div>
          <div className="user-stats-item highlight-blue">
            <span className="stats-label">当前总关注被投企业个数</span>
            <span className="stats-value blue">{userStats.totalEnterprises || 0}</span>
          </div>
        </div>
      )}

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
        <div className="tabs-right">
          {activeTab === 'all' ? (
            <button 
              className="export-button"
              onClick={() => setShowExportModal(true)}
              disabled={exportLoading}
            >
              {exportLoading ? '导出中...' : '导出'}
            </button>
          ) : (
            <button 
              className="export-button"
              onClick={() => handleExport()}
              disabled={exportLoading}
            >
              {exportLoading ? '导出中...' : '导出'}
            </button>
          )}
          
          {/* AI重新分析按钮 - 只在昨日和本周tab显示 */}
          {(activeTab === 'yesterday' || activeTab === 'thisWeek') && selectedNewsIds.length > 0 && (
            <button 
              className="batch-analysis-btn"
              onClick={handleBatchAnalysis}
              disabled={batchAnalysisLoading}
              title="对选中的新闻进行AI重新分析"
            >
              {batchAnalysisLoading ? '分析中...' : `AI分析(${selectedNewsIds.length})`}
            </button>
          )}


          {/* 分析进度条显示 */}
          {(analysisProgress && analysisProgress.status === 'processing') && (
            <div className="analysis-progress-container">
              <div className="progress-header">
                <span className="progress-title">AI分析进行中</span>
                <span className="progress-stats">
                  {analysisProgress?.processed || 0}/{analysisProgress?.total || 0} 
                  ({analysisProgress?.percentage || 0}%)
                </span>
              </div>
              
              <div className="progress-bar-container">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${analysisProgress?.percentage || 0}%` }}
              ></div>
              </div>
              
              <div className="progress-details">
                {analysisProgress?.currentItem && (
                  <div className="current-item">
                    正在处理: {analysisProgress.currentItem.title}
                  </div>
                )}
                {!analysisProgress?.currentItem && currentTaskId && (
                  <div className="current-item">
                    正在初始化分析任务...
                  </div>
                )}
                <div className="progress-info">
                  <span>成功: {analysisProgress?.successCount || 0}</span>
                  <span>失败: {analysisProgress?.errorCount || 0}</span>
                  {analysisProgress?.estimatedTimeLeft && (
                    <span>预计剩余: {Math.floor(analysisProgress.estimatedTimeLeft / 60)}分{analysisProgress.estimatedTimeLeft % 60}秒</span>
                  )}
                  <button 
                    className="cancel-analysis-btn"
                    onClick={() => cancelAnalysis()}
                    title="取消分析"
                  >
                    取消
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 分析完成显示 */}
          {analysisProgress && analysisProgress.status === 'completed' && (
            <div className="analysis-completed">
              <span className="completed-icon">✅</span>
              <span className="completed-text">
                分析完成！处理了 {analysisProgress.total} 条新闻，
                成功 {analysisProgress.successCount} 条，
                失败 {analysisProgress.errorCount} 条
              </span>
            </div>
          )}

          {/* 分析状态显示 */}
          {analysisStatus && analysisStatus.isProcessing && !analysisProgress && (
            <div className="analysis-status">
              <span className="status-text">
                AI分析进行中: {analysisStatus.analyzed}/{analysisStatus.total}
              </span>
              <button 
                className="status-refresh-btn"
                onClick={checkAnalysisStatus}
                title="刷新分析状态"
              >
                🔄
              </button>
            </div>
          )}

          {/* 管理员清理功能 */}
          {isAdmin && (
            <button 
              className="clean-associations-btn"
              onClick={cleanInvalidAssociations}
              title="清理无效的企业关联"
            >
              清理无效关联
            </button>
          )}

          {/* 刷新列表按钮 */}
          <button 
            className={`btn-primary btn-refresh ${isRefreshing ? 'refreshing' : ''}`}
            onClick={handleRefreshList}
            disabled={loading || isRefreshing}
            title="刷新新闻列表"
          >
            {isRefreshing ? '刷新中...' : '刷新'}
          </button>
          

        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <table className={`news-table ${(activeTab === 'yesterday' || activeTab === 'thisWeek') ? 'has-checkbox' : ''}`}>
            <thead>
              <tr>
                {/* 在昨日和本周tab中显示复选框列 */}
                {(activeTab === 'yesterday' || activeTab === 'thisWeek') && (
                  <th className="checkbox-cell">
                    <input
                      type="checkbox"
                      checked={selectAll}
                      onChange={handleSelectAll}
                      title="全选/取消全选"
                    />
                  </th>
                )}
                <th className="sequence-number-cell">序号</th>
                <th className="enterprise-name-cell">被投企业全称</th>
                <th className="keywords-cell">关键词</th>
                <th className="publish-time-cell">发布时间</th>
                <th className="title-cell">标题</th>
                <th className="abstract-cell">新闻摘要</th>
                <th className="article-link-cell">文章链接</th>
                <th className="account-name-cell">公众号名称</th>
                <th className="wechat-account-cell">微信账号</th>
                {isAdmin && <th className="created-time-cell">创建时间</th>}
                {isAdmin && <th className="action-cell">操作</th>}
              </tr>
            </thead>
            <tbody>
              {newsList.length === 0 ? (
                <tr>
                  <td colSpan={
                    (activeTab === 'yesterday' || activeTab === 'thisWeek') 
                      ? (isAdmin ? "12" : "10") 
                      : (isAdmin ? "11" : "9")
                  } className="empty-data">
                    {search ? '未找到相关数据' : '暂无数据'}
                  </td>
                </tr>
              ) : (
                newsList.map((news, index) => (
                  <tr key={news.id || index}>
                    {/* 在昨日和本周tab中显示复选框 */}
                    {(activeTab === 'yesterday' || activeTab === 'thisWeek') && (
                      <td className="checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedNewsIds.includes(news.id)}
                          onChange={() => handleSelectNews(news.id)}
                        />
                      </td>
                    )}
                    {/* 序号 */}
                    <td className="sequence-number-cell">{(currentPage - 1) * pageSize + index + 1}</td>
                    {/* 被投企业全称 */}
                    <td className="enterprise-name-cell" title={news.enterprise_full_name || ''}>
                      {news.enterprise_full_name || '-'}
                    </td>
                    {/* 关键词 */}
                    <td className="keywords-cell">
                      {news.keywords && Array.isArray(news.keywords) && news.keywords.length > 0 ? (
                        <div className="keywords-list" title={news.keywords.join(', ')}>
                          {news.keywords.slice(0, 3).map((keyword, idx) => (
                            <span key={idx} className="keyword-tag" title={keyword}>
                              {keyword.length > 4 ? `${keyword.substring(0, 4)}...` : keyword}
                            </span>
                          ))}
                          {news.keywords.length > 3 && (
                            <span className="keyword-more" title={news.keywords.slice(3).join(', ')}>
                              +{news.keywords.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    {/* 发布时间 */}
                    <td className="publish-time-cell" title={formatDate(news.public_time)}>
                      {formatDateWithLineBreak(news.public_time)}
                    </td>
                    {/* 标题 */}
                    <td className="title-cell" title={news.title || ''}>
                      {news.title || '-'}
                    </td>
                    {/* 新闻摘要 */}
                    <td className="abstract-cell" title={news.news_abstract || ''}>
                      {news.news_abstract || '-'}
                    </td>
                    {/* 文章链接 */}
                    <td className="article-link-cell">
                      {news.source_url ? (
                        <a
                          href={news.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="article-link"
                        >
                          查看文章
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    {/* 公众号名称 */}
                    <td className="account-name-cell" title={news.account_name || ''}>
                      {news.account_name || '-'}
                    </td>
                    {/* 微信账号 */}
                    <td className="wechat-account-cell" title={news.wechat_account || ''}>
                      {news.wechat_account || '-'}
                    </td>
                    {/* 创建时间 */}
                    {isAdmin && (
                      <td className="created-time-cell" title={formatDate(news.created_at)}>
                        {formatDateWithLineBreak(news.created_at)}
                      </td>
                    )}
                    {/* 操作 */}
                    {isAdmin && (
                      <td className="action-cell">
                        <div className="action-buttons">
                          <button 
                            className="view-detail-btn"
                            onClick={() => handleViewDetail(news)}
                            title="查看详情"
                          >
                            详情
                          </button>
                          {news.content && (
                            <button 
                              className="view-content-btn"
                              onClick={() => handleViewContent(news)}
                              title="查看正文"
                            >
                              正文
                            </button>
                          )}
                          {isAdmin && (
                            <button 
                              className="delete-btn"
                              onClick={() => handleDelete(news.id)}
                              title="删除"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="pagination-container">
        {/* 每页显示数量选择器 */}
        <div className="page-size-selector">
          <label>每页显示：</label>
          <select 
            value={pageSize} 
            onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
            className="page-size-select"
          >
            <option value={10}>10条</option>
            <option value={20}>20条</option>
            <option value={30}>30条</option>
            <option value={50}>50条</option>
            <option value={100}>100条</option>
          </select>
        </div>

        {/* 分页信息和按钮 */}
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />

        {/* 总数信息 */}
        <div className="total-info">
          共 {total} 条记录
        </div>
      </div>

      {/* 详情模态框 */}
      {showDetailModal && selectedNews && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>舆情详情</h3>
              <button className="close-btn" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
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
                    <a href={selectedNews.source_url} target="_blank" rel="noopener noreferrer" className="article-link">
                      {selectedNews.source_url}
                    </a>
                  ) : '-'}
                </span>
              </div>
              {selectedNews.keywords && selectedNews.keywords.length > 0 && (
                <div className="detail-row">
                  <label>关键词：</label>
                  <div className="keywords-list">
                    {selectedNews.keywords.map((keyword, idx) => (
                      <span key={idx} className="keyword-tag">
                        {keyword}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 正文模态框 */}
      {showContentModal && selectedNews && (
        <div className="modal-overlay">
          <div className="modal-content modal-large">
            <div className="modal-header">
              <h3>文章正文</h3>
              <button className="close-btn" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body">
              <div className="content-header">
                <h4>{selectedNews.title}</h4>
                <p className="content-meta">
                  {selectedNews.account_name} · {formatDate(selectedNews.public_time)}
                </p>
              </div>
              <div className="content-body">
                {selectedNews.content ? (
                  <div dangerouslySetInnerHTML={{ __html: selectedNews.content }} />
                ) : (
                  <p>暂无正文内容</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 导出选择模态框 */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-content export-modal">
            <div className="modal-header">
              <h3>选择导出范围</h3>
              <button className="close-btn" onClick={() => setShowExportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="export-options">
                <button 
                  className="export-option-btn"
                  onClick={() => handleExport('thisWeek')}
                  disabled={exportLoading}
                >
                  <div className="option-title">本周舆情</div>
                  <div className="option-desc">导出本周一至今的舆情信息</div>
                </button>
                <button 
                  className="export-option-btn"
                  onClick={() => handleExport('thisMonth')}
                  disabled={exportLoading}
                >
                  <div className="option-title">本月舆情</div>
                  <div className="option-desc">导出本月1日至今的舆情信息</div>
                </button>
                <button 
                  className="export-option-btn"
                  onClick={() => handleExport('lastMonth')}
                  disabled={exportLoading}
                >
                  <div className="option-title">上月舆情</div>
                  <div className="option-desc">导出上个月的舆情信息</div>
                </button>
                <button 
                  className="export-option-btn"
                  onClick={() => handleExport('all')}
                  disabled={exportLoading}
                >
                  <div className="option-title">全部舆情</div>
                  <div className="option-desc">导出所有舆情信息</div>
                </button>
              </div>
              {exportLoading && (
                <div className="export-loading">
                  正在生成Excel文件，请稍候...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
        </>
      )}



      {/* 公众号管理页面 */}
      {isAdmin && adminActiveTab === 'accounts' && (
        <AdditionalAccounts />
      )}

      {/* 收件管理页面 */}
      {adminActiveTab === 'recipients' && (
        <div style={{ marginTop: '24px', minHeight: '400px' }}>
          {/* 普通用户显示三个tab：收件管理、收发记录、邮件日志 */}
          {!isAdmin && (
            <>
              <div className="email-management-tabs" style={{ marginBottom: '20px' }}>
                <button
                  className={`tab-button ${recipientTab === 'recipients' ? 'active' : ''}`}
                  onClick={() => setRecipientTab('recipients')}
                >
                  收件管理
                </button>
                <button
                  className={`tab-button ${recipientTab === 'records' ? 'active' : ''}`}
                  onClick={() => setRecipientTab('records')}
                >
                  收发记录
                </button>
                <button
                  className={`tab-button ${recipientTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setRecipientTab('logs')}
                >
                  邮件日志
                </button>
              </div>
              
              {recipientTab === 'recipients' && (
                <RecipientManagement />
              )}
              
              {recipientTab === 'records' && (
                <UserEmailRecords activeTab="records" />
              )}
              
              {recipientTab === 'logs' && (
                <UserEmailRecords activeTab="logs" />
              )}
            </>
          )}
          
          {/* 管理员只显示收件管理 */}
          {isAdmin && (
            <RecipientManagement />
          )}
        </div>
      )}
    </div>
  )
}

export default NewsInfo

