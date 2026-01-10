import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Collapse, Select, Input } from '@arco-design/web-react'
import axios from '../utils/axios'
import CompanyForm from './CompanyForm'
import LogModal from './LogModal'
import './CompanyManagement.css'

const Option = Select.Option
const CollapseItem = Collapse.Item

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
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [filters, setFilters] = useState({
    keyword: ''
  })

  useEffect(() => {
    fetchCompanies()
  }, [currentPage, pageSize])

  const fetchCompanies = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/companies', {
        params: {
          page: currentPage,
          pageSize,
          ...filters
        }
      })
      if (response.data.success) {
        setCompanies(response.data.data)
        setTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取企业列表失败:', error)
      Message.error('获取企业列表失败')
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
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/companies/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchCompanies()
          }
        } catch (error) {
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
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

  const handleSearch = () => {
    setCurrentPage(1)
    fetchCompanies()
  }

  const handleReset = () => {
    setFilters({ keyword: '' })
    setCurrentPage(1)
  }

  const columns = [
    {
      title: '序号',
      width: 80,
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    },
    {
      title: '企业简称',
      dataIndex: 'enterprise_abbreviation',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: '企业全称',
      dataIndex: 'enterprise_full_name',
      width: 250,
      ellipsis: true,
      tooltip: true
    },
    {
      title: '统一信用代码',
      dataIndex: 'unified_credit_code',
      width: 180,
      render: (text) => text || '-'
    },
    {
      title: '公司官网',
      dataIndex: 'official_website',
      width: 200,
      ellipsis: true,
      tooltip: true,
      render: (text) => text ? (
        <a href={text} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : '-'
    },
    {
      title: '微信公众号id',
      dataIndex: 'wechat_official_account_id',
      width: 180,
      render: (text) => text || '-'
    },
    {
      title: '操作',
      width: 200,
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="outline"
            size="small"
            status="success"
            onClick={() => handleViewLog(record.id)}
          >
            日志
          </Button>
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="company-management">
      <Card className="management-card" bordered={false}>
        <div className="management-header">
          <h2 className="management-title">企业列表管理</h2>
          <Space>
            <Button
              onClick={fetchCompanies}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="primary"
              onClick={handleAdd}
            >
              新增
            </Button>
          </Space>
        </div>

        <Collapse
          activeKey={filterCollapsed ? [] : ['filters']}
          onChange={(keys) => setFilterCollapsed(keys.length === 0)}
          className="filter-collapse"
        >
          <CollapseItem header="筛选条件" name="filters">
            <div className="filter-content">
              <div className="filter-row">
                <div className="filter-item">
                  <label>关键词</label>
                  <Input.Search
                    value={filters.keyword}
                    onChange={(value) => setFilters({ ...filters, keyword: value })}
                    placeholder="企业简称/全称/统一信用代码"
                    style={{ width: 300 }}
                    allowClear
                    onSearch={handleSearch}
                  />
                </div>
                <div className="filter-actions">
                  <Button type="primary" onClick={handleSearch}>
                    查询
                  </Button>
                  <Button type="outline" onClick={handleReset}>
                    重置
                  </Button>
                </div>
              </div>
            </div>
          </CollapseItem>
        </Collapse>

        <div className="table-container">
          {loading && companies.length === 0 ? (
            <Skeleton
              loading={true}
              animation={true}
              text={{ rows: 8, width: ['100%'] }}
            />
          ) : (
            <Table
              columns={columns}
              data={companies}
              loading={loading}
              pagination={false}
              rowKey="id"
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
              className="company-table"
            />
          )}
        </div>

        <div className="pagination-wrapper">
          <div className="page-size-selector">
            <span className="page-size-label">每页显示：</span>
            <Select
              value={pageSize}
              onChange={(value) => {
                setPageSize(value)
                setCurrentPage(1)
              }}
              style={{ width: 100 }}
            >
              <Option value={10}>10</Option>
              <Option value={20}>20</Option>
              <Option value={50}>50</Option>
              <Option value={100}>100</Option>
            </Select>
            <span className="page-size-unit">条</span>
          </div>
          <Pagination
            current={currentPage}
            total={total}
            pageSize={pageSize}
            onChange={(page) => setCurrentPage(page)}
            showTotal
            showJumper
          />
        </div>
      </Card>

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

