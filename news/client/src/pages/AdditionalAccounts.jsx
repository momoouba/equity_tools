import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import Pagination from '../components/Pagination'
import './AdditionalAccounts.css'

function AdditionalAccounts() {
  const [accountsList, setAccountsList] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [logAccountId, setLogAccountId] = useState(null)
  const [formData, setFormData] = useState({
    account_name: '',
    wechat_account_id: '',
    status: 'active'
  })
  const [importFile, setImportFile] = useState(null)
  const [importLoading, setImportLoading] = useState(false)
  const pageSize = 10

  // 获取公众号列表
  const fetchAccounts = async (abortSignal) => {
    setLoading(true)
    try {
      const params = {
        page: currentPage,
        pageSize
      }
      if (search) {
        params.search = search
      }
      if (statusFilter) {
        params.status = statusFilter
      }
      
      const response = await axios.get('/api/additional-accounts', { 
        params,
        signal: abortSignal
      })
      if (!abortSignal?.aborted && response.data.success) {
        setAccountsList(response.data.data)
        setTotal(response.data.total)
      }
    } catch (error) {
      // 如果是取消请求，不显示错误
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        return
      }
      console.error('获取公众号列表失败:', error)
      // 只在组件仍然挂载时显示错误提示
      if (!abortSignal?.aborted) {
        alert('获取数据失败，请重试')
      }
    } finally {
      if (!abortSignal?.aborted) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const abortController = new AbortController()
    
    fetchAccounts(abortController.signal)
    
    return () => {
      abortController.abort()
    }
  }, [currentPage, search, statusFilter])

  const handleSearch = (e) => {
    e.preventDefault()
    setCurrentPage(1)
  }

  const handleSearchChange = (e) => {
    setSearch(e.target.value)
  }

  const handleStatusFilterChange = (e) => {
    setStatusFilter(e.target.value)
    setCurrentPage(1)
  }

  // 新增公众号
  const handleAdd = () => {
    setFormData({
      account_name: '',
      wechat_account_id: '',
      status: 'active'
    })
    setShowAddModal(true)
  }

  // 编辑公众号
  const handleEdit = (account) => {
    setSelectedAccount(account)
    setFormData({
      account_name: account.account_name,
      wechat_account_id: account.wechat_account_id,
      status: account.status
    })
    setShowEditModal(true)
  }

  // 查看日志
  const handleViewLog = (accountId) => {
    setLogAccountId(accountId)
    setShowLogModal(true)
  }

  // 删除公众号
  const handleDelete = async (id) => {
    if (!confirm('确定要删除这个公众号吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/additional-accounts/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败，请重试')
    }
  }

  // 提交表单
  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.account_name || !formData.wechat_account_id) {
      alert('请填写完整信息')
      return
    }

    try {
      let response
      if (showEditModal) {
        response = await axios.put(`/api/additional-accounts/${selectedAccount.id}`, formData)
      } else {
        response = await axios.post('/api/additional-accounts', formData)
      }

      if (response.data.success) {
        alert(showEditModal ? '更新成功' : '添加成功')
        setShowAddModal(false)
        setShowEditModal(false)
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('操作失败:', error)
      alert(error.response?.data?.message || '操作失败，请重试')
    }
  }

  // 下载模板
  const handleDownloadTemplate = async () => {
    try {
      const response = await axios.get('/api/additional-accounts/download-template', {
        responseType: 'blob'
      })

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = '公众号导入模板.xlsx'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('下载模板失败:', error)
      alert('下载失败，请重试')
    }
  }

  // 批量导入
  const handleImport = async () => {
    if (!importFile) {
      alert('请选择要导入的文件')
      return
    }

    setImportLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', importFile)

      const response = await axios.post('/api/additional-accounts/batch-import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        alert(response.data.message)
        setShowImportModal(false)
        setImportFile(null)
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('导入失败:', error)
      alert(error.response?.data?.message || '导入失败，请重试')
    } finally {
      setImportLoading(false)
    }
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
        minute: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="additional-accounts">
      <div className="accounts-header">
        <h2>额外公众号管理</h2>
        <div className="header-actions">
          <form onSubmit={handleSearch} className="search-form">
            <input
              type="text"
              placeholder="搜索公众号名称或账号ID..."
              value={search}
              onChange={handleSearchChange}
              className="search-input"
            />
            <select 
              value={statusFilter} 
              onChange={handleStatusFilterChange}
              className="status-filter"
            >
              <option value="">全部状态</option>
              <option value="active">生效</option>
              <option value="inactive">失效</option>
            </select>
            <button type="submit" className="search-button">
              搜索
            </button>
          </form>
          <div className="action-buttons">
            <button onClick={handleAdd} className="add-button">
              新增公众号
            </button>
            <button onClick={() => setShowImportModal(true)} className="import-button">
              批量导入
            </button>
            <button onClick={() => fetchAccounts(new AbortController().signal)} className="btn-primary btn-refresh" title="刷新列表">
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <table className="accounts-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>公众号名称</th>
                <th>账号ID</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {accountsList.length === 0 ? (
                <tr>
                  <td colSpan="6" className="empty-data">
                    {search || statusFilter ? '未找到相关数据' : '暂无数据'}
                  </td>
                </tr>
              ) : (
                accountsList.map((account, index) => (
                  <tr key={account.id}>
                    <td>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td>{account.account_name}</td>
                    <td>{account.wechat_account_id}</td>
                    <td>
                      <span className={`status-badge ${account.status}`}>
                        {account.status === 'active' ? '生效' : '失效'}
                      </span>
                    </td>
                    <td>{formatDate(account.created_at)}</td>
                    <td>
                      <div className="action-buttons">
                        <button 
                          onClick={() => handleEdit(account)}
                          className="edit-btn"
                        >
                          编辑
                        </button>
                        <button 
                          onClick={() => handleDelete(account.id)}
                          className="delete-btn"
                        >
                          删除
                        </button>
                        <button 
                          onClick={() => handleViewLog(account.id)}
                          className="log-btn"
                        >
                          日志
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
      />

      {/* 新增/编辑模态框 */}
      {(showAddModal || showEditModal) && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{showEditModal ? '编辑公众号' : '新增公众号'}</h3>
              <button className="close-btn" onClick={() => {
                setShowAddModal(false)
                setShowEditModal(false)
              }}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>公众号名称 *</label>
                  <input
                    type="text"
                    value={formData.account_name}
                    onChange={(e) => setFormData({...formData, account_name: e.target.value})}
                    placeholder="请输入公众号名称"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>账号ID *</label>
                  <input
                    type="text"
                    value={formData.wechat_account_id}
                    onChange={(e) => setFormData({...formData, wechat_account_id: e.target.value})}
                    placeholder="请输入微信账号ID"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>状态</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({...formData, status: e.target.value})}
                  >
                    <option value="active">生效</option>
                    <option value="inactive">失效</option>
                  </select>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => {
                    setShowAddModal(false)
                    setShowEditModal(false)
                  }}>
                    取消
                  </button>
                  <button type="submit">
                    {showEditModal ? '更新' : '添加'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 批量导入模态框 */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>批量导入公众号</h3>
              <button className="close-btn" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="import-steps">
                <div className="step">
                  <h4>第一步：下载导入模板</h4>
                  <button onClick={handleDownloadTemplate} className="download-template-btn">
                    下载Excel模板
                  </button>
                </div>
                <div className="step">
                  <h4>第二步：填写数据并上传</h4>
                  <div className="file-upload">
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => setImportFile(e.target.files[0])}
                      className="file-input"
                    />
                    {importFile && (
                      <p className="file-name">已选择文件：{importFile.name}</p>
                    )}
                  </div>
                </div>
                <div className="import-notes">
                  <h4>导入说明：</h4>
                  <ul>
                    <li>支持Excel格式文件（.xlsx, .xls）</li>
                    <li>必填字段：公众号名称、账号ID</li>
                    <li>重复的账号ID将被跳过，不会导入</li>
                    <li>导入后默认状态为"生效"</li>
                  </ul>
                </div>
              </div>
              <div className="form-actions">
                <button onClick={() => setShowImportModal(false)}>
                  取消
                </button>
                <button 
                  onClick={handleImport} 
                  disabled={!importFile || importLoading}
                >
                  {importLoading ? '导入中...' : '开始导入'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 日志模态框 */}
      {showLogModal && (
        <LogModal
          type="additional_account"
          id={logAccountId}
          onClose={() => {
            setShowLogModal(false)
            setLogAccountId(null)
          }}
        />
      )}
    </div>
  )
}

export default AdditionalAccounts
