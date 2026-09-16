import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Collapse, Select, Input, Form, Upload, Tag } from '@arco-design/web-react'
import axios from '../utils/axios'
import { getUser } from '../utils/auth'
import LogModal from './LogModal'
import SheetModal, { SheetActions, SheetViewer, sheetPopupContainer } from '../components/SheetModal'
import { ListOpButton, ListOps } from '../components/listTableOps'
import '../styles/listTable.css'
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
    status: 'active',
    industry_tag_code: undefined
  })
  const [industryTagOptions, setIndustryTagOptions] = useState([])
  const [importFile, setImportFile] = useState(null)
  const [importLoading, setImportLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [showImportErrorModal, setShowImportErrorModal] = useState(false)
  const [importErrors, setImportErrors] = useState([])
  const [importSummary, setImportSummary] = useState({
    successCount: 0,
    skipCount: 0,
    errorCount: 0,
    hasMoreErrors: false
  })
  const [userRole, setUserRole] = useState('user')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [usersList, setUsersList] = useState([])
  const pageSize = 10
  const [filterCollapsed, setFilterCollapsed] = useState(true)

  useEffect(() => {
    const user = getUser()
    if (user) {
      try {
        setUserRole(user.role || 'user')
        if (user.role === 'admin') {
          fetchUsers()
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
  }, [])

  const fetchIndustryTagOptions = async () => {
    try {
      const res = await axios.get('/api/additional-accounts/industry-tag-options')
      if (res.data?.success) {
        setIndustryTagOptions(res.data.data || [])
      }
    } catch (e) {
      console.error('获取行业标签选项失败:', e)
    }
  }

  useEffect(() => {
    fetchIndustryTagOptions()
  }, [])

  useEffect(() => {
    if (showAddModal || showEditModal || showImportModal) {
      fetchIndustryTagOptions()
    }
  }, [showAddModal, showEditModal, showImportModal])

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
      status: 'active',
      industry_tag_code: undefined
    })
    setShowAddModal(true)
  }

  const handleEdit = (account) => {
    setSelectedAccount(account)
    setFormData({
      account_name: account.account_name,
      wechat_account_id: account.wechat_account_id,
      status: account.status,
      industry_tag_code: account.industry_tag_code || undefined
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
      console.warn('[AdditionalAccounts] handleImport called without importFile')
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
        const importData = response.data.data || {}
        const errors = Array.isArray(importData.errors) ? importData.errors : []
        setImportErrors(errors)
        setImportSummary({
          successCount: importData.successCount || 0,
          skipCount: importData.skipCount || 0,
          errorCount: importData.errorCount || 0,
          hasMoreErrors: importData.hasMoreErrors === true
        })
        if (errors.length > 0) {
          setShowImportErrorModal(true)
        }
        fetchAccounts(new AbortController().signal)
      }
    } catch (error) {
      console.error('导入失败:', error)
      Message.error(error.response?.data?.message || '导入失败，请重试')
    } finally {
      setImportLoading(false)
    }
  }

  const handleDownloadImportErrors = () => {
    if (!importErrors.length) {
      Message.warning('暂无可导出的错误明细')
      return
    }
    const header = ['行号', '错误原因', '公众号名称', '账号ID', '行业标签']
    const escapeCsv = (value) => {
      const text = String(value ?? '')
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`
      }
      return text
    }
    const rows = importErrors.map((item) => [
      item.rowNum || '',
      item.message || '',
      item.account_name || '',
      item.wechat_account_id || '',
      item.industry_tag_code || ''
    ])
    const csvContent = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `公众号导入错误明细_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    Message.success('错误明细导出成功')
  }

  const handleDownloadRetryTemplate = () => {
    if (!importErrors.length) {
      Message.warning('暂无可导出的失败数据')
      return
    }
    const header = ['公众号名称', '账号ID', '行业标签', '错误原因']
    const escapeCsv = (value) => {
      const text = String(value ?? '')
      if (text.includes('"') || text.includes(',') || text.includes('\n')) {
        return `"${text.replace(/"/g, '""')}"`
      }
      return text
    }
    const rows = importErrors.map((item) => [
      item.account_name || '',
      item.wechat_account_id || '',
      item.industry_tag_code || '',
      item.message || ''
    ])
    const csvContent = [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `公众号导入失败重试模板_${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    Message.success('失败数据模板导出成功')
  }

  const handleExport = async () => {
    setExportLoading(true)
    try {
      const params = {}
      if (search) {
        params.search = search
      }
      if (statusFilter) {
        params.status = statusFilter
      }
      if (userRole === 'admin' && selectedUserId) {
        params.userId = selectedUserId
      }

      const response = await axios.get('/api/additional-accounts/export', {
        params,
        responseType: 'blob'
      })

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `第三方公众号导出_${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      Message.success('导出成功')
    } catch (error) {
      console.error('导出失败:', error)
      Message.error('导出失败，请重试')
    } finally {
      setExportLoading(false)
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
      title: '标签',
      dataIndex: 'industry_tag_name',
      width: 140,
      render: (_, record) => {
        if (record.industry_tag_name) return record.industry_tag_name
        if (record.industry_tag_code) return record.industry_tag_code
        return '-'
      }
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
      width: 168,
      fixed: 'right',
      className: 'list-ops-col',
      align: 'left',
      render: (_, record) => (
        <ListOps>
          <ListOpButton name="编辑" onClick={() => handleEdit(record)} />
          <ListOpButton name="日志" onClick={() => handleViewLog(record.id)} />
          <ListOpButton name="删除" onClick={() => handleDelete(record.id)} />
        </ListOps>
      )
    }
  ]

  return (
    <div className="additional-accounts list-table-page" style={{ '--list-ops-col-width': '168px' }}>
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
              onClick={() => {
                setImportFile(null)
                setShowImportModal(true)
              }}
              type="outline"
              disabled={userRole !== 'admin' && quota && typeof quota.remaining === 'number' && quota.remaining <= 0}
            >
              批量导入
            </Button>
            <Button
              onClick={handleExport}
              loading={exportLoading}
            >
              导出
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
              className="list-table"
              border={{
                wrapper: true,
                cell: true
              }}
              stripe
              scroll={{ x: 'max-content' }}
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
      <SheetModal
        visible={showAddModal || showEditModal}
        title={showEditModal ? '编辑公众号' : '新增公众号'}
        onClose={() => {
          setShowAddModal(false)
          setShowEditModal(false)
        }}
      >
        <Form
          key={showAddModal ? 'account-form-add' : `account-form-edit-${selectedAccount?.id || ''}`}
          initialValues={formData}
          onSubmit={handleSubmit}
          layout="vertical"
          className="enterprise-form enterprise-form--sheet"
        >
          <div className="modal-body enterprise-form-grid">
            <FormItem
              label="公众号名称"
              field="account_name"
              rules={[{ required: true, message: '请输入公众号名称' }]}
              className="form-span-2"
            >
              <Input placeholder="请输入公众号名称" />
            </FormItem>
            <FormItem
              label="账号ID"
              field="wechat_account_id"
              rules={[{ required: true, message: '请输入微信账号ID' }]}
              className="form-span-2"
            >
              <Input placeholder="请输入微信账号ID" />
            </FormItem>
            <FormItem label="状态" field="status">
              <Select getPopupContainer={sheetPopupContainer}>
                <Option value="active">生效</Option>
                <Option value="inactive">失效</Option>
              </Select>
            </FormItem>
            <FormItem
              label="标签"
              field="industry_tag_code"
              extra="行业分类，选项来自管理员设置中的数据字典「行业」"
              className="form-span-2"
            >
              <Select placeholder="请选择行业标签" allowClear getPopupContainer={sheetPopupContainer}>
                {industryTagOptions.map((o) => (
                  <Option key={o.value} value={o.value}>
                    {o.label}
                  </Option>
                ))}
              </Select>
            </FormItem>
          </div>
          <SheetActions
            onCancel={() => {
              setShowAddModal(false)
              setShowEditModal(false)
            }}
            submitLabel={showEditModal ? '更新' : '添加'}
          />
        </Form>
      </SheetModal>

      {/* 批量导入模态框 */}
      <SheetModal
        visible={showImportModal}
        title="批量导入公众号"
        onClose={() => {
          setShowImportModal(false)
          setImportFile(null)
        }}
      >
        <div className="enterprise-form enterprise-form--sheet">
          <div className="modal-body enterprise-form-grid">
            <div className="form-group form-span-2">
              <label>1. 下载模板</label>
              <p className="form-hint">表头固定，勿改列顺序。必填：公众号名称、账号ID。</p>
              <Button type="outline" onClick={handleDownloadTemplate}>
                下载Excel模板
              </Button>
            </div>
            <div className="form-group form-span-2">
              <label>2. 上传文件</label>
              <p className="form-hint">填写后选择 .xlsx/.xls 文件导入。</p>
              <Upload
                accept=".xlsx,.xls"
                showUploadList={false}
                beforeUpload={(file) => {
                  setImportFile(file || null)
                  return false
                }}
              >
                <Button>选择文件</Button>
              </Upload>
              {importFile ? <p className="form-hint">已选择：{importFile.name}</p> : null}
            </div>
            <p className="form-hint form-span-4">
              行业标签优先填数据字典「行业」中文名（也支持编码），留空表示不设置。重复账号ID将跳过。导入后默认生效。
            </p>
          </div>
          <SheetActions
            onCancel={() => {
              setShowImportModal(false)
              setImportFile(null)
            }}
            submitLabel="开始导入"
            submitType="button"
            submitDisabled={!importFile}
            submitLoading={importLoading}
            onSubmitClick={handleImport}
          />
        </div>
      </SheetModal>

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

      {/* 导入错误明细 */}
      <SheetViewer
        visible={showImportErrorModal}
        title="导入错误明细"
        onClose={() => setShowImportErrorModal(false)}
        extra={
          <button type="button" className="btn-cancel" onClick={handleDownloadRetryTemplate}>
            导出失败重试模板
          </button>
        }
        submitLabel="导出错误原因"
        submitType="button"
        onSubmitClick={handleDownloadImportErrors}
      >
        <div style={{ marginBottom: 12, color: '#4e5969' }}>
          导入结果：成功 {importSummary.successCount} 条，跳过 {importSummary.skipCount} 条，错误 {importSummary.errorCount} 条
          {importSummary.hasMoreErrors ? '（错误较多，仅展示/导出前1000条）' : ''}
        </div>
        <Table
          columns={[
            { title: '行号', dataIndex: 'rowNum', width: 90 },
            { title: '错误原因', dataIndex: 'message', width: 360 },
            { title: '公众号名称', dataIndex: 'account_name', width: 180 },
            { title: '账号ID', dataIndex: 'wechat_account_id', width: 180 },
            { title: '行业标签', dataIndex: 'industry_tag_code', width: 140 }
          ]}
          data={importErrors}
          pagination={false}
          rowKey={(record, index) => `${record.rowNum || 'unknown'}-${index}`}
          border={{ cell: true, wrapper: false }}
          scroll={{ y: 360 }}
        />
      </SheetViewer>
    </div>
  )
}

export default AdditionalAccounts

