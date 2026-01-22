import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Collapse, Select, Input, Tabs } from '@arco-design/web-react'
import axios from '../utils/axios'
import EnterpriseForm from './EnterpriseForm'
import BatchImportModal from './BatchImportModal'
import LogModal from './LogModal'
import EnterpriseSyncModal from './EnterpriseSyncModal'
import './EnterpriseManagement.css'

const Option = Select.Option
const InputSearch = Input.Search
const CollapseItem = Collapse.Item
const TabPane = Tabs.TabPane

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
  const [filterCollapsed, setFilterCollapsed] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [allEnterprises, setAllEnterprises] = useState([])
  const [allTotal, setAllTotal] = useState(0)

  useEffect(() => {
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
  }, [currentPage, selectedUserId, isAdmin, searchKeyword, pageSize, activeTab])

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
      if (currentIsAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }
      // 根据选中的tab添加企业类型筛选参数
      if (activeTab === 'invested') {
        // 被投企业
        params.entity_type = '被投企业'
      } else if (activeTab === 'main_fund') {
        // 基金
        params.entity_type = '基金'
      } else if (activeTab === 'fund') {
        // 子基金
        params.entity_type = '子基金'
      } else if (activeTab === 'manager') {
        // 子基金管理人及GP（后端会处理为OR条件）
        params.entity_type = 'manager'
      }
      // activeTab === 'all' 时不传entity_type，显示所有数据
      
      const response = await axios.get('/api/enterprises', { params })
      if (response.data.success) {
        setEnterprises(response.data.data)
        setTotal(response.data.total)
        // 保存所有数据用于统计（如果需要）
        setAllEnterprises(response.data.data)
        setAllTotal(response.data.total)
      }
    } catch (error) {
      console.error('获取企业列表失败:', error)
      Message.error('获取企业列表失败')
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
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条记录吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/enterprises/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchEnterprises()
          }
        } catch (error) {
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleFormClose = () => {
    setShowForm(false)
    setEditingEnterprise(null)
  }

  const handleFormSubmit = () => {
    fetchEnterprises()
    handleFormClose()
  }

  const handleExport = async () => {
    try {
      const params = {}
      if (isAdmin && selectedUserId) {
        params.filter_user_id = selectedUserId
      }
      if (searchKeyword && searchKeyword.trim()) {
        params.search = searchKeyword.trim()
      }

      const response = await axios.get('/api/enterprises/export', {
        params,
        responseType: 'blob'
      })

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      
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

      Message.success('导出成功！')
    } catch (error) {
      console.error('导出失败：', error)
      if (error.response?.data) {
        const blob = error.response.data
        if (blob instanceof Blob) {
          blob.text().then(text => {
            try {
              const errorData = JSON.parse(text)
              Message.error('导出失败：' + (errorData.message || '未知错误'))
            } catch {
              Message.error('导出失败：服务器错误')
            }
          })
        } else {
          Message.error('导出失败：' + (error.response.data.message || '未知错误'))
        }
      } else {
        Message.error('导出失败：' + (error.message || '未知错误'))
      }
    }
  }

  const handleSearch = () => {
    setCurrentPage(1)
    fetchEnterprises()
  }

  const handleReset = () => {
    setSearchKeyword('')
    setSelectedUserId('')
    setCurrentPage(1)
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    setCurrentPage(1) // 切换tab时重置到第一页
  }

  const columns = [
    {
      title: '序号',
      width: 80,
      align: 'center',
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    },
    {
      title: '项目编号',
      dataIndex: 'project_number',
      ellipsis: true,
      tooltip: true
    },
    {
      title: '企业类型',
      dataIndex: 'entity_type',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '项目简称',
      dataIndex: 'project_abbreviation',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '关联基金',
      dataIndex: 'fund',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '关联子基金',
      dataIndex: 'sub_fund',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '被投企业全称',
      dataIndex: 'enterprise_full_name',
      ellipsis: true,
      tooltip: true
    },
    {
      title: '统一信用代码',
      dataIndex: 'unified_credit_code',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '企业公众号id',
      dataIndex: 'wechat_official_account_id',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '企业官网',
      dataIndex: 'official_website',
      ellipsis: true,
      tooltip: true,
      render: (text) => text ? (
        <a href={text} target="_blank" rel="noopener noreferrer">
          {text}
        </a>
      ) : '-'
    },
    {
      title: '退出状态',
      dataIndex: 'exit_status',
      ellipsis: true,
      tooltip: true,
      render: (text) => text || '-'
    },
    {
      title: '操作',
      width: 220,
      align: 'left',
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
            onClick={() => {
              setLogEnterpriseId(record.id)
              setShowLogModal(true)
            }}
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
    <div className="enterprise-management">
      <Card className="management-card" bordered={false}>
        <div className="management-header">
          <h2 className="management-title">舆情监控对象</h2>
          <Space>
            <Button
              onClick={fetchEnterprises}
              loading={loading}
            >
              刷新
            </Button>
            <Button
              type="outline"
              onClick={() => setShowBatchModal(true)}
            >
              批量导入
            </Button>
            <Button
              type="outline"
              onClick={() => setShowSyncModal(true)}
            >
              定时更新
            </Button>
            <Button
              type="outline"
              onClick={handleExport}
            >
              导出
            </Button>
            <Button
              type="primary"
              onClick={handleAdd}
            >
              新增
            </Button>
          </Space>
        </div>

        {/* Tab页签 */}
        <Tabs
          activeTab={activeTab}
          onChange={handleTabChange}
          type="line"
          className="entity-type-tabs"
          style={{ marginBottom: 16 }}
        >
          <TabPane key="all" title="全部" />
          <TabPane key="invested" title="被投企业" />
          <TabPane key="main_fund" title="基金" />
          <TabPane key="fund" title="子基金" />
          <TabPane key="manager" title="子基金管理人及GP" />
        </Tabs>

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
                  <InputSearch
                    value={searchKeyword}
                    onChange={(value) => setSearchKeyword(value)}
                    placeholder="搜索项目编号、简称、企业全称、统一信用代码、公众号ID、官网、退出状态..."
                    style={{ width: 400 }}
                    allowClear
                    onSearch={handleSearch}
                  />
                </div>
                {isAdmin && (
                  <div className="filter-item">
                    <label>筛选用户</label>
                    <Select
                      value={selectedUserId}
                      onChange={(value) => {
                        setSelectedUserId(value)
                        setCurrentPage(1)
                      }}
                      placeholder="全部用户"
                      style={{ width: 200 }}
                      allowClear
                    >
                      {users.map(user => (
                        <Option key={user.id} value={user.id}>
                          {user.account}
                        </Option>
                      ))}
                    </Select>
                  </div>
                )}
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
          {loading && enterprises.length === 0 ? (
            <Skeleton
              loading={true}
              animation={true}
              text={{ rows: 8, width: ['100%'] }}
            />
          ) : (
            <Table
              columns={columns}
              data={enterprises}
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

