import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import CompanyForm from './CompanyForm'
import LogModal from './LogModal'
import Pagination from '../components/Pagination'
import './CompanyManagement.css'

function CompanyManagement() {
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingCompany, setEditingCompany] = useState(null)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logCompanyId, setLogCompanyId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(10)

  useEffect(() => {
    fetchCompanies()
  }, [currentPage, pageSize])

  const fetchCompanies = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/companies', {
        params: {
          page: currentPage,
          pageSize
        }
      })
      if (response.data.success) {
        setCompanies(response.data.data)
        setTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取企业列表失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setEditingCompany(null)
    setShowForm(true)
  }

  const handleEdit = (company) => {
    setEditingCompany(company)
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条记录吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/companies/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchCompanies()
      }
    } catch (error) {
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingCompany(null)
  }

  const handleFormSubmit = () => {
    fetchCompanies()
    handleFormClose()
  }

  const handleViewLog = (id) => {
    setLogCompanyId(id)
    setShowLogModal(true)
  }

  const handlePageSizeChange = (e) => {
    const newPageSize = parseInt(e.target.value, 10)
    setPageSize(newPageSize)
    setCurrentPage(1) // 改变每页显示条数时重置到第一页
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="company-management">
      <div className="management-header">
        <h2>企业列表管理</h2>
        <div className="action-buttons">
          <button className="btn-primary" onClick={handleAdd}>
            新增
          </button>
          <button className="btn-primary" onClick={fetchCompanies} title="刷新列表">
            刷新
          </button>
        </div>
      </div>

      <div className="table-container">
        {loading ? (
          <div className="loading">加载中...</div>
        ) : (
          <table className="company-table">
            <thead>
              <tr>
                <th>序号</th>
                <th>企业简称</th>
                <th>企业全称</th>
                <th>统一信用代码</th>
                <th>公司官网</th>
                <th>微信公众号id</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {companies.length === 0 ? (
                <tr>
                  <td colSpan="7" className="empty-data">暂无数据</td>
                </tr>
              ) : (
                companies.map((company, index) => (
                  <tr key={company.id}>
                    <td>{(currentPage - 1) * pageSize + index + 1}</td>
                    <td>{company.enterprise_abbreviation || '-'}</td>
                    <td>{company.enterprise_full_name}</td>
                    <td>{company.unified_credit_code || '-'}</td>
                    <td>
                      {company.official_website ? (
                        <a href={company.official_website} target="_blank" rel="noopener noreferrer">
                          {company.official_website}
                        </a>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>{company.wechat_official_account_id || '-'}</td>
                    <td>
                      <button
                        className="btn-edit"
                        onClick={() => handleEdit(company)}
                      >
                        编辑
                      </button>
                      <button
                        className="btn-log"
                        onClick={() => handleViewLog(company.id)}
                      >
                        日志
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => handleDelete(company.id)}
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
          <span className="page-size-label">每页显示：</span>
          <select 
            className="page-size-select" 
            value={pageSize} 
            onChange={handlePageSizeChange}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
          <span className="page-size-unit">条</span>
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={total}
        />
      </div>

      {showForm && (
        <CompanyForm
          company={editingCompany}
          onClose={handleFormClose}
          onSubmit={handleFormSubmit}
        />
      )}

      {showLogModal && (
        <LogModal
          type="company"
          id={logCompanyId}
          onClose={() => {
            setShowLogModal(false)
            setLogCompanyId(null)
          }}
        />
      )}
    </div>
  )
}

export default CompanyManagement

