import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

function UserManagement() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  const [applications, setApplications] = useState([])
  const [membershipLevels, setMembershipLevels] = useState({}) // {appId: [levels]}
  
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [userMembershipConfig, setUserMembershipConfig] = useState({}) // {appId: membershipLevelId}

  useEffect(() => {
    fetchUsers()
    fetchApplications()
  }, [currentPage])

  useEffect(() => {
    if (showEditModal && editingUser) {
      // 初始化用户的应用会员等级配置
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
      alert('获取用户列表失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const fetchApplications = async () => {
    try {
      const response = await axios.get('/api/auth/applications')
      if (response.data.success) {
        setApplications(response.data.data || [])
        // 为每个应用获取会员等级
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
      // 构建批量更新数据（只包含有值的配置）
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

      // 批量更新用户的应用会员等级配置
      await axios.put(`/api/auth/users/${editingUser.id}/memberships`, {
        memberships: memberships
      })

      alert('保存成功')
      setShowEditModal(false)
      setEditingUser(null)
      setUserMembershipConfig({})
      fetchUsers()
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败：' + (error.response?.data?.message || '未知错误'))
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

  const getStatusBadge = (status) => {
    return status === 'active' ? (
      <span className="status-badge active">启用</span>
    ) : (
      <span className="status-badge inactive">禁用</span>
    )
  }

  return (
    <div className="email-config">
      <div className="config-header">
        <h3>用户管理</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={fetchUsers}>
            刷新
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : users.length === 0 ? (
        <div className="empty-data">暂无用户</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>手机号</th>
              <th>邮箱</th>
              <th>公司名称</th>
              <th>主会员等级</th>
              <th>应用会员等级</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.account}</td>
                <td>{user.phone || '-'}</td>
                <td>{user.email || '-'}</td>
                <td>{user.company_name || '-'}</td>
                <td>
                  {user.membership_level_name ? (
                    <span>{user.membership_level_name} ({user.membership_app_name || '-'})</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td>
                  {user.app_permissions && user.app_permissions.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {user.app_permissions.map((perm, index) => {
                        // 需要从applications和membershipLevels中查找名称
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
                  ) : (
                    '-'
                  )}
                </td>
                <td>{getStatusBadge(user.account_status)}</td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(user)}
                    >
                      编辑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {total > 0 && (
        <Pagination
          currentPage={currentPage}
          totalPages={Math.ceil(total / pageSize)}
          onPageChange={setCurrentPage}
        />
      )}

      {/* 编辑用户会员等级配置弹窗 */}
      {showEditModal && editingUser && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            // 不允许点击外部关闭
          }
        }}>
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>编辑用户会员等级配置 - {editingUser.account}</h3>
              <button className="close-button" onClick={() => {
                setShowEditModal(false)
                setEditingUser(null)
                setUserMembershipConfig({})
              }}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '20px' }}>
                <p><strong>账号：</strong>{editingUser.account}</p>
                <p><strong>邮箱：</strong>{editingUser.email || '-'}</p>
                <p><strong>主会员等级：</strong>{editingUser.membership_level_name || '-'}</p>
              </div>

              <div style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '15px' }}>应用会员等级配置</h4>
                {applications.map((app) => {
                  const levels = membershipLevels[app.id] || []
                  const currentLevelId = userMembershipConfig[app.id] || null
                  
                  return (
                    <div key={app.id} style={{ marginBottom: '20px', padding: '15px', border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                      <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                        {app.app_name}
                      </label>
                      <select
                        value={currentLevelId || ''}
                        onChange={(e) => handleMembershipChange(app.id, e.target.value || null)}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                      >
                        <option value="">无</option>
                        {levels.map((level) => (
                          <option key={level.id} value={level.id}>
                            {level.level_name} (有效期: {level.validity_days}天)
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
              </div>

              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingUser(null)
                    setUserMembershipConfig({})
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleSave}
                >
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default UserManagement

