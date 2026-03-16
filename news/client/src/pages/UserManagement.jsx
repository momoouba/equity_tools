import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, Form } from '@arco-design/web-react'
import axios from '../utils/axios'
import './UserManagement.css'

const Option = Select.Option
const FormItem = Form.Item

function UserManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [applications, setApplications] = useState([])
  const [membershipLevels, setMembershipLevels] = useState({})
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userMembershipConfig, setUserMembershipConfig] = useState({})

  useEffect(() => {
    fetchUsers()
    fetchApplications()
  }, [currentPage])

  useEffect(() => {
    if (showEditModal && editingUser) {
      const config = {}
      if (editingUser.app_permissions && Array.isArray(editingUser.app_permissions)) {
        editingUser.app_permissions.forEach(perm => {
          config[perm.app_id] = perm.membership_level_id
        })
      }
      setUserMembershipConfig(config)
    }
  }, [showEditModal, editingUser])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/auth/users', {
        params: {
          page: currentPage,
          pageSize: pageSize
        }
      })
      if (response.data.success) {
        setUsers(response.data.data || [])
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取用户列表失败:', error)
      Message.error('获取用户列表失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const fetchApplications = async () => {
    try {
      const response = await axios.get('/api/auth/applications')
      if (response.data.success) {
        setApplications(response.data.data || [])
        const levelsMap = {}
        for (const app of response.data.data) {
          try {
            const levelsResponse = await axios.get(`/api/auth/membership-levels/${app.id}`)
            if (levelsResponse.data.success) {
              levelsMap[app.id] = levelsResponse.data.data || []
            }
          } catch (error) {
            console.error(`获取应用 ${app.app_name} 的会员等级失败:`, error)
            levelsMap[app.id] = []
          }
        }
        setMembershipLevels(levelsMap)
      }
    } catch (error) {
      console.error('获取应用列表失败:', error)
    }
  }

  const handleEdit = (user) => {
    setEditingUser(user)
    setShowEditModal(true)
  }

  const handleMembershipChange = (appId, membershipLevelId) => {
    setUserMembershipConfig(prev => ({
      ...prev,
      [appId]: membershipLevelId || null
    }))
  }

  const handleSave = async () => {
    if (!editingUser) return

    try {
      const memberships = []
      for (const app of applications) {
        const membershipLevelId = userMembershipConfig[app.id]
        if (membershipLevelId) {
          memberships.push({
            app_id: app.id,
            membership_level_id: membershipLevelId
          })
        }
      }

      await axios.put(`/api/auth/users/${editingUser.id}/memberships`, {
        memberships: memberships
      })

      Message.success('保存成功')
      setShowEditModal(false)
      setEditingUser(null)
      setUserMembershipConfig({})
      fetchUsers()
    } catch (error) {
      console.error('保存失败:', error)
      Message.error('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleResetPassword = async (user) => {
    Modal.confirm({
      title: '确认重置密码',
      content: `确定要将用户 "${user.account}" 的密码重置为 "123456" 吗？`,
      onOk: async () => {
        try {
          await axios.put(`/api/auth/users/${user.id}/reset-password`)
          Message.success(`用户 "${user.account}" 的密码已重置为 "123456"`)
          fetchUsers()
        } catch (error) {
          console.error('重置密码失败:', error)
          Message.error('重置密码失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
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
      title: '账号',
      dataIndex: 'account',
      width: 150
    },
    {
      title: '手机号',
      dataIndex: 'phone',
      width: 150,
      render: (text) => text || '-'
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '公司名称',
      dataIndex: 'company_name',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '主会员等级',
      width: 200,
      render: (_, record) => {
        if (record.membership_level_name) {
          return `${record.membership_level_name} (${record.membership_app_name || '-'})`
        }
        return '-'
      }
    },
    {
      title: '应用会员等级',
      width: 250,
      render: (_, record) => {
        if (record.app_permissions && record.app_permissions.length > 0) {
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {record.app_permissions.map((perm, index) => {
                const app = applications.find(a => a.id === perm.app_id)
                const levels = membershipLevels[perm.app_id] || []
                const level = levels.find(l => l.id === perm.membership_level_id)
                return (
                  <span key={index} style={{ fontSize: '12px' }}>
                    {app?.app_name || perm.app_id}: {level?.level_name || perm.membership_level_id || '-'}
                  </span>
                )
              })}
            </div>
          )
        }
        return '-'
      }
    },
    {
      title: '状态',
      dataIndex: 'account_status',
      width: 100,
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '启用' : '禁用'}
        </Tag>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 180,
      render: (text) => formatDate(text)
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
            status="warning"
            onClick={() => handleResetPassword(record)}
          >
            重置密码
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="user-management">
      <div className="management-header">
        <h2>用户管理</h2>
        <Button
          onClick={fetchUsers}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      <div className="table-container">
        {loading && users.length === 0 ? (
          <Skeleton
            loading={true}
            animation={true}
            text={{ rows: 8, width: ['100%'] }}
          />
        ) : (
          <Table
            columns={columns}
            data={users}
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

      <Modal
        visible={showEditModal}
        title={`编辑用户会员等级配置 - ${editingUser?.account || ''}`}
        onCancel={() => {
          setShowEditModal(false)
          setEditingUser(null)
          setUserMembershipConfig({})
        }}
        footer={null}
        style={{ width: 600 }}
      >
        {editingUser && (
          <div>
            <div style={{ marginBottom: '24px', padding: '16px', background: '#f7f8fa', borderRadius: '4px' }}>
              <p><strong>账号：</strong>{editingUser.account}</p>
              <p><strong>邮箱：</strong>{editingUser.email || '-'}</p>
              <p><strong>主会员等级：</strong>{editingUser.membership_level_name || '-'}</p>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <h4 style={{ marginBottom: '16px' }}>应用会员等级配置</h4>
              {applications.map((app) => {
                const levels = membershipLevels[app.id] || []
                const currentLevelId = userMembershipConfig[app.id] || null
                const displayAppName = app.app_name === '业绩看板应用' ? '业绩看板' : app.app_name
                
                return (
                  <div key={app.id} style={{ marginBottom: '16px', padding: '16px', border: '1px solid #e5e6eb', borderRadius: '4px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>
                      {displayAppName}
                    </label>
                    <Select
                      value={currentLevelId || ''}
                      onChange={(value) => handleMembershipChange(app.id, value || null)}
                      placeholder="无"
                      style={{ width: '100%' }}
                      allowClear
                    >
                      {levels.map((level) => (
                        <Option key={level.id} value={level.id}>
                          {level.level_name} (有效期: {level.validity_days}天)
                        </Option>
                      ))}
                    </Select>
                  </div>
                )
              })}
            </div>

            <div className="form-actions">
              <Button
                type="secondary"
                onClick={() => {
                  setShowEditModal(false)
                  setEditingUser(null)
                  setUserMembershipConfig({})
                }}
              >
                取消
              </Button>
              <Button
                type="primary"
                onClick={handleSave}
              >
                保存
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default UserManagement

