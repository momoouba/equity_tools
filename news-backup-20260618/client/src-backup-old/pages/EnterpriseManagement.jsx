import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import EnterpriseForm from './EnterpriseForm'
import BatchImportModal from './BatchImportModal'
import LogModal from './LogModal'
import EnterpriseSyncModal from './EnterpriseSyncModal'
import Pagination from '../components/Pagination'
import './EnterpriseManagement.css'

function EnterpriseManagement() {
  const [enterprises, setEnterprises] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingEnterprise, setEditingEnterprise] = useState(null)
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logEnterpriseId, setLogEnterpriseId] = useState(null)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    // 检查用户角色
    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const user = JSON.parse(userData)
        setIsAdmin(user.role === 'admin')
        if (user.role === 'admin') {
          fetchUsers()
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
  }, [])

  useEffect(() => {
    fetchEnterprises()
  }, [currentPage, selectedUserId, isAdmin, searchKeyword, pageSize])

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/auth/users')
      if (response.data.success) {
        setUsers(response.data.data || [])
      }
    } catch (error) {
      console.error('获取用户列表失败:', error)
    }
  }

  const fetchEnterprises = async () => {
    setLoading(true)
    try {
      // 从localStorage获取用户角色，确保实时性
      const userData = localStorage.getItem('user')
      let currentIsAdmin = isAdmin
      if (userData) {
        try {
          const user = JSON.parse(userData)
          currentIsAdmin = user.role === 'admin'
        } catch (e) {
          console.error('解析用户信息失败:', e)
        }
      }

      const params = {
        page: currentPage,
        pageSize
      }
      // 如果是admin且选择了用户筛选，添加筛选参数
      if (currentIsAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      // 如果有搜索关键词，添加搜索参数
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }
      const response = await axios.get('/api/enterprises', { params })
      if (response.data.success) {
        setEnterprises(response.data.data)
        setTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取企业列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingEnterprise(null)
    setShowForm(true)
  }

  const handleEdit = (enterprise) => {
    setEditingEnterprise(enterprise)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条记录吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/enterprises/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchEnterprises()
      }
    } catch (error) {
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingEnterprise(null)
  }

  const handleFormSubmit = () => {
    fetchEnterprises()
    handleFormClose()
  }

  const handleBatchImport = () => {
    setShowBatchModal(true)
  }

  const handleViewLog = (id) => {
    setLogEnterpriseId(id)
    setShowLogModal(true)
  }

  const totalPages = Math.ceil(total / pageSize)

  const handleUserFilterChange = (e) => {
    setSelectedUserId(e.target.value)
    setCurrentPage(1) // 重置到第一页
  }

  const handleSearch = () => {
    setCurrentPage(1) // 搜索时重置到第一页
    fetchEnterprises()
  }

  const handleSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  const handleClearSearch = () => {
    setSearchKeyword('')
    setCurrentPage(1)
  }

  const handlePageSizeChange = (e) => {
    const newPageSize = parseInt(e.target.value, 10)
    setPageSize(newPageSize)
    setCurrentPage(1) // 改变每页显示条数时重置到第一页
  }

  const handleExport = async () => {
    try {
      // 构建导出参数
      const params = {}
      // 如果是admin且选择了用户筛选，添加筛选参数
      if (isAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      // 如果有搜索关键词，添加搜索参数
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }

      // 使用axios下载文件
      const response = await axios.get('/api/enterprises/export', {
        params,
        responseType: 'blob' // 重要：指定响应类型为blob
      })

      // 创建Blob对象并下载
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
      // 从响应头获取文件名，如果没有则使用默认名称
      const contentDisposition = response.headers['content-disposition']
      let fileName = '被投企业数据.xlsx'
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = decodeURIComponent(fileNameMatch[1].replace(/['"]/g, ''))
        }
      }
      
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      // 显示成功提示
      alert('导出成功！')
    } catch (error) {
      console.error('导出失败：', error)
      if (error.response?.data) {
        // 如果是blob响应，尝试解析错误消息
        const blob = error.response.data
        if (blob instanceof Blob) {
          blob.text().then(text => {
            try {
              const errorData = JSON.parse(text)
              alert('导出失败：' + (errorData.message || '未知错误'))
            } catch {
              alert('导出失败：服务器错误')
            }
          })
        } else {
          alert('导出失败：' + (error.response.data.message || '未知错误'))
        }
      } else {
        alert('导出失败：' + (error.message || '未知错误'))
      }
    }
  }

  return (
    <div className="enterprise-management">
      <div className="management-header">
        <div className="header-actions">
          <h2>被投企业管理</h2>
          <div className="header-controls">
            <div className="search-box">
              <input
                type="text"
                className="search-input"
                placeholder="搜索项目编号、简称、企业全称、统一信用代码、公众号ID、官网、退出状态..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyPress={handleSearchKeyPress}
              />
              <button className="btn-search" onClick={handleSearch}>
                搜索
              </button>
              {searchKeyword && (
                <button className="btn-clear-search" onClick={handleClearSearch} title="清除搜索">
                  ×
                </button>
              )}
            </div>
            <button className="btn-secondary" onClick={handleBatchImport}>
              批量导入
            </button>
            <button className="btn-secondary" onClick={() => setShowSyncModal(true)}>
              定时更新
            </button>
            <button className="btn-secondary" onClick={handleExport} title="导出为Excel">
              导出
            </button>
            <button className="btn-primary btn-refresh" onClick={fetchEnterprises} title="刷新列表">
              刷新
            </button>
            <button className="btn-primary btn-add" onClick={handleAdd}>
              新增
            </button>
            {isAdmin && (
              <div className="user-filter">
                <label htmlFor="user-filter">筛选用户：</label>
                <select
                  id="user-filter"
                  value={selectedUserId}
                  onChange={handleUserFilterChange}
                  className="filter-select"
                >
                  <option value="">全部用户</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.account}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <table className="enterprise-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>项目编号</th>
                <th>项目简称</th>
                <th>被投企业全称</th>
                <th>统一信用代码</th>
                <th>企业公众号id</th>
                <th>企业官网</th>
                <th>退出状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {enterprises.length === 0 ? (
                <tr>
                  <td colSpan="9" className="empty-data">暂无数据</td>
                </tr>
              ) : (
                enterprises.map((enterprise, index) => (
                  <tr key={enterprise.id}>
                    <td>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td>{enterprise.project_number}</td>
                    <td>{enterprise.project_abbreviation || '-'}</td>
                    <td>{enterprise.enterprise_full_name}</td>
                    <td>{enterprise.unified_credit_code || '-'}</td>
                    <td>{enterprise.wechat_official_account_id || '-'}</td>
                    <td>
                      {enterprise.official_website ? (
                        <a href={enterprise.official_website} target="_blank" rel="noopener noreferrer">
                          {enterprise.official_website}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{enterprise.exit_status}</td>
                    <td className="action-cell">
                      <button
                        className="btn-edit"
                        onClick={() => handleEdit(enterprise)}
                      >
                        编辑
                      </button>
                      <button
                        className="btn-log"
                        onClick={() => handleViewLog(enterprise.id)}
                      >
                        日志
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(enterprise.id)}
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="pagination-wrapper">
        <div className="page-size-selector">
          <label htmlFor="page-size">每页显示：</label>
          <select
            id="page-size"
            className="page-size-select"
            value={pageSize}
            onChange={handlePageSizeChange}
          >
            <option value="10">10 条</option>
            <option value="20">20 条</option>
            <option value="50">50 条</option>
            <option value="100">100 条</option>
          </select>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={total}
          onPageChange={setCurrentPage}
        />
      </div>

      {showForm && (
        <EnterpriseForm
          enterprise={editingEnterprise}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      )}

      {showBatchModal && (
        <BatchImportModal
          onClose={() => setShowBatchModal(false)}
          onSuccess={() => {
            fetchEnterprises()
            setShowBatchModal(false)
          }}
        />
      )}

      {showLogModal && (
        <LogModal
          type="enterprise"
          id={logEnterpriseId}
          onClose={() => {
            setShowLogModal(false)
            setLogEnterpriseId(null)
          }}
        />
      )}

      {showSyncModal && (
        <EnterpriseSyncModal
          onClose={() => setShowSyncModal(false)}
          onSuccess={() => {
            fetchEnterprises()
          }}
        />
      )}
    </div>
  )
}

export default EnterpriseManagement

