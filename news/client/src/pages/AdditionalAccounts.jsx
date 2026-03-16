import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Collapse, Select, Input, Form, Upload, Tag } from '@arco-design/web-react'
import axios from '../utils/axios'
import LogModal from './LogModal'
import './AdditionalAccounts.css'

const Option = Select.Option
const InputSearch = Input.Search
const FormItem = Form.Item
const CollapseItem = Collapse.Item

function AdditionalAccounts() {
  const [accountsList, setAccountsList] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [quota, setQuota] = useState(null)
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
  const [userRole, setUserRole] = useState('user')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [usersList, setUsersList] = useState([])
  const pageSize = 10
  const [filterCollapsed, setFilterCollapsed] = useState(true)

  useEffect(() => {
    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const user = JSON.parse(userData)
        setUserRole(user.role || 'user')
        if (user.role === 'admin') {
          fetchUsers()
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await axios.get('/api/auth/users', {
        params: { page: 1, pageSize: 1000 }
      })
      if (response.data.success) {
        setUsersList(response.data.data || [])
      }
    } catch (error) {
      console.error('获取用户列表失败:', error)
    }
  }

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
      if (userRole === 'admin' && selectedUserId) {
        params.userId = selectedUserId
      }
      
      const response = await axios.get('/api/additional-accounts', { 
        params,
        signal: abortSignal
      })
      if (!abortSignal?.aborted && response.data.success) {
        setAccountsList(response.data.data)
        setTotal(response.data.total)
        // 仅当后端返回quota字段时更新额度信息
        if (Object.prototype.hasOwnProperty.call(response.data, 'quota')) {
          setQuota(response.data.quota)
        }
      }
    } catch (error) {
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        return
      }
      console.error('获取公众号列表失败:', error)
      if (!abortSignal?.aborted) {
        Message.error('获取数据失败，请重试')
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
  }, [currentPage, search, statusFilter, selectedUserId])

  const handleSearch = () => {
    setCurrentPage(1)
  }

  const handleReset = () => {
    setSearch('')
    setStatusFilter('')
    setSelectedUserId('')
    setCurrentPage(1)
  }

  const handleAdd = () => {
    // 如果有额度信息且已用完，则不弹出新增窗口
    if (quota && typeof quota.remaining === 'number' && quota.remaining <= 0) {
      Message.warning('当前会员等级的额外公众号数量已用完，如需增加请联系管理员升级会员等级')
      return
    }
    setFormData({
      account_name: '',
      wechat_account_id: '',
      status: 'active'
    })
    setShowAddModal(true)
  }

  const handleEdit = (account) => {
    setSelectedAccount(account)
    setFormData({
      account_name: account.account_name,
      wechat_account_id: account.wechat_account_id,
      status: account.status
    })
    setShowEditModal(true)
  }

  const handleViewLog = (accountId) => {
    setLogAccountId(accountId)
    setShowLogModal(true)
  }

  const handleDelete = async (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个公众号吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/additional-accounts/${id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchAccounts(new AbortController().signal)
          }
        } catch (error) {
          console.error('删除失败:', error)
          Message.error('删除失败，请重试')
        }
      }
    })
  }

  const handleSubmit = async (values) => {
    try {
      let response
      if (showEditModal) {
        response = await axios.put(`/api/additional-accounts/${selectedAccount.id}`, values)
      } else {
        response = await axios.post('/api/additional-accounts', values)
      }

      if (response.data.success) {
        Message.success(showEditModal ? '更新成功' : '添加成功')
        setShowAddModal(false)
        setShowEditModal(false)
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('操作失败:', error)
      Message.error(error.response?.data?.message || '操作失败，请重试')
    }
  }

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
      Message.success('模板下载成功')
    } catch (error) {
      console.error('下载模板失败:', error)
      Message.error('下载失败，请重试')
    }
  }

  const handleImport = async () => {
    if (quota && typeof quota.remaining === 'number' && quota.remaining <= 0) {
      Message.warning('当前会员等级的额外公众号数量已用完，无法继续导入，如需增加请联系管理员升级会员等级')
      return
    }
    if (!importFile) {
      Message.warning('请选择要导入的文件')
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
        Message.success(response.data.message)
        setShowImportModal(false)
        setImportFile(null)
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('导入失败:', error)
      Message.error(error.response?.data?.message || '导入失败，请重试')
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

  const columns = [
    {
      title: '序号',
      width: 80,
      render: (_, record, index) => (currentPage - 1) * pageSize + index + 1
    },
    {
      title: '公众号名称',
      dataIndex: 'account_name',
      width: 200
    },
    {
      title: '账号ID',
      dataIndex: 'wechat_account_id',
      width: 200
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '生效' : '失效'}
        </Tag>
      )
    },
    {
      title: '创建人',
      dataIndex: 'creator_account',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text) => formatDate(text)
    },
    {
      title: '操作',
      width: 250,
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
    <div className="additional-accounts">
      <Card className="management-card" bordered={false}>
        <div className="management-header">
          <h2 className="management-title">第三方公众号管理</h2>
          {userRole !== 'admin' && quota && typeof quota.totalLimit === 'number' && (
            <div style={{ marginRight: 16, color: '#666', fontSize: 13 }}>
              已用额度：{quota.usedCount || 0} / {quota.totalLimit}（剩余 {Math.max(0, quota.remaining || 0)}）
            </div>
          )}
          <Space>
            <Button
              onClick={handleAdd}
              type="primary"
              disabled={userRole !== 'admin' && quota && typeof quota.remaining === 'number' && quota.remaining <= 0}
            >
              新增公众号
            </Button>
            <Button
              onClick={() => setShowImportModal(true)}
              type="outline"
              disabled={userRole !== 'admin' && quota && typeof quota.remaining === 'number' && quota.remaining <= 0}
            >
              批量导入
            </Button>
            <Button
              onClick={() => fetchAccounts(new AbortController().signal)}
              loading={loading}
            >
              刷新
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
                {userRole === 'admin' && (
                  <div className="filter-item">
                    <label>切换用户查看</label>
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
                      {usersList.map(user => (
                        <Option key={user.id} value={user.id}>
                          {user.account || user.id}
                        </Option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className="filter-item">
                  <label>关键词</label>
                  <InputSearch
                    value={search}
                    onChange={(value) => setSearch(value)}
                    placeholder="搜索公众号名称或账号ID..."
                    style={{ width: 300 }}
                    allowClear
                    onSearch={handleSearch}
                  />
                </div>
                <div className="filter-item">
                  <label>状态</label>
                  <Select
                    value={statusFilter}
                    onChange={(value) => {
                      setStatusFilter(value)
                      setCurrentPage(1)
                    }}
                    placeholder="全部状态"
                    style={{ width: 150 }}
                    allowClear
                  >
                    <Option value="active">生效</Option>
                    <Option value="inactive">失效</Option>
                  </Select>
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
          {loading && accountsList.length === 0 ? (
            <Skeleton
              loading={true}
              animation={true}
              text={{ rows: 8, width: ['100%'] }}
            />
          ) : (
            <Table
              columns={columns}
              data={accountsList}
              loading={loading}
              pagination={false}
              rowKey="id"
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
            />
          )}
        </div>

        {total > 0 && (
          <div className="pagination-wrapper">
            <Pagination
              current={currentPage}
              total={total}
              pageSize={pageSize}
              onChange={(page) => setCurrentPage(page)}
              showTotal
              showJumper
            />
          </div>
        )}
      </Card>

      {/* 新增/编辑模态框 */}
      <Modal
        visible={showAddModal || showEditModal}
        title={showEditModal ? '编辑公众号' : '新增公众号'}
        onCancel={() => {
          setShowAddModal(false)
          setShowEditModal(false)
        }}
        footer={null}
        style={{ width: 500 }}
      >
        <Form
          initialValues={formData}
          onSubmit={handleSubmit}
          layout="vertical"
        >
          <FormItem
            label="公众号名称"
            field="account_name"
            rules={[{ required: true, message: '请输入公众号名称' }]}
          >
            <Input placeholder="请输入公众号名称" />
          </FormItem>
          <FormItem
            label="账号ID"
            field="wechat_account_id"
            rules={[{ required: true, message: '请输入微信账号ID' }]}
          >
            <Input placeholder="请输入微信账号ID" />
          </FormItem>
          <FormItem
            label="状态"
            field="status"
          >
            <Select>
              <Option value="active">生效</Option>
              <Option value="inactive">失效</Option>
            </Select>
          </FormItem>
          <div className="form-actions">
            <Button
              type="secondary"
              onClick={() => {
                setShowAddModal(false)
                setShowEditModal(false)
              }}
            >
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              {showEditModal ? '更新' : '添加'}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 批量导入模态框 */}
      <Modal
        visible={showImportModal}
        title="批量导入公众号"
        onCancel={() => {
          setShowImportModal(false)
          setImportFile(null)
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <div className="import-steps">
          <Card className="import-step-card" style={{ marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>第一步：下载导入模板</h4>
            <Button
              type="outline"
              onClick={handleDownloadTemplate}
            >
              下载Excel模板
            </Button>
          </Card>
          <Card className="import-step-card" style={{ marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>第二步：填写数据并上传</h4>
            <Upload
              accept=".xlsx,.xls"
              fileList={importFile ? [importFile] : []}
              onChange={(fileList) => {
                setImportFile(fileList[0]?.originFile || null)
              }}
              beforeUpload={() => false}
            >
              <Button>选择文件</Button>
            </Upload>
            {importFile && (
              <p style={{ marginTop: '8px', color: '#165dff' }}>
                已选择文件：{importFile.name}
              </p>
            )}
          </Card>
          <Card className="info-card" style={{ marginBottom: '16px' }}>
            <h4 style={{ marginBottom: '12px' }}>导入说明：</h4>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li>支持Excel格式文件（.xlsx, .xls）</li>
              <li>必填字段：公众号名称、账号ID</li>
              <li>重复的账号ID将被跳过，不会导入</li>
              <li>导入后默认状态为"生效"</li>
            </ul>
          </Card>
          <div className="form-actions">
            <Button
              type="secondary"
              onClick={() => {
                setShowImportModal(false)
                setImportFile(null)
              }}
            >
              取消
            </Button>
            <Button
              type="primary"
              onClick={handleImport}
              disabled={!importFile || importLoading}
              loading={importLoading}
            >
              开始导入
            </Button>
          </div>
        </div>
      </Modal>

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

