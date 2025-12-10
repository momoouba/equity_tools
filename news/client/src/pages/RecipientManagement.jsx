import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import LogModal from './LogModal'
import './EmailConfig.css'

function RecipientManagement() {
  const [recipients, setRecipients] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10
  const [showForm, setShowForm] = useState(false)
  const [editingRecipient, setEditingRecipient] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [formData, setFormData] = useState({
    recipient_email: '',
    email_subject: '',
    send_frequency: 'daily',
    send_time: '09:00:00',
    is_active: true,
    qichacha_category_codes: null // null表示使用默认类别，数组表示自定义类别
  })
  const [showLogModal, setShowLogModal] = useState(false)
  const [logRecipientId, setLogRecipientId] = useState(null)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState([])
  const [categoryMap, setCategoryMap] = useState({})

  useEffect(() => {
    let isMounted = true
    
    // 检查用户角色
    const userData = localStorage.getItem('user')
    if (userData) {
      try {
        const user = JSON.parse(userData)
        if (isMounted) {
          setIsAdmin(user.role === 'admin')
        }
      } catch (e) {
        console.error('解析用户信息失败:', e)
      }
    }
    
    const loadData = async () => {
      setLoading(true)
      try {
        const response = await axios.get('/api/news/recipients', {
          params: {
            page: currentPage,
            pageSize: pageSize
          }
        })
        if (isMounted && response.data && response.data.success) {
          setRecipients(response.data.data || [])
          setTotal(response.data.total || 0)
        } else if (isMounted) {
          console.error('获取收件管理列表失败: 响应格式错误', response.data)
          setRecipients([])
          setTotal(0)
        }
      } catch (error) {
        // 忽略连接被拒绝的错误（通常是服务器未启动或正在重启）
        if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
          console.warn('后端服务器连接被拒绝，可能正在启动中...')
          if (isMounted) {
            setRecipients([])
            setTotal(0)
          }
          return
        }
        console.error('获取收件管理列表失败:', error)
        // 只在组件仍然挂载时显示错误提示，且不是刷新列表时（避免频繁弹窗）
        if (isMounted && currentPage === 1) {
          alert('获取列表失败：' + (error.response?.data?.message || '未知错误'))
        }
        if (isMounted) {
          setRecipients([])
          setTotal(0)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }
    
    // 加载企查查类别映射（从数据库获取）
    const loadCategoryMap = async () => {
      try {
        const response = await axios.get('/api/system/qichacha-news-categories', {
          params: {
            page: 1,
            pageSize: 1000 // 获取所有类别
          }
        })
        if (response.data.success && isMounted) {
          // 将数组转换为对象，key为category_code，value为category_name
          const categories = response.data.data || []
          const map = {}
          categories.forEach(cat => {
            map[cat.category_code] = cat.category_name
          })
          setCategoryMap(map)
        }
      } catch (error) {
        console.error('获取企查查类别映射失败:', error)
        // 如果新API失败，尝试使用旧API作为后备
        try {
          const fallbackResponse = await axios.get('/api/news/qichacha-categories')
          if (fallbackResponse.data.success && isMounted) {
            setCategoryMap(fallbackResponse.data.data || {})
          }
        } catch (fallbackError) {
          console.error('获取企查查类别映射（后备方案）失败:', fallbackError)
        }
      }
    }
    
    loadData()
    loadCategoryMap()
    
    return () => {
      isMounted = false
    }
  }, [currentPage])

  // 定义 fetchRecipients 函数供外部调用
  const fetchRecipients = async () => {
    let isMounted = true
    setLoading(true)
    try {
      const response = await axios.get('/api/news/recipients', {
        params: {
          page: currentPage,
          pageSize: pageSize
        }
      })
      if (isMounted && response.data && response.data.success) {
        setRecipients(response.data.data || [])
        setTotal(response.data.total || 0)
      } else if (isMounted) {
        console.error('获取收件管理列表失败: 响应格式错误', response.data)
        setRecipients([])
        setTotal(0)
      }
    } catch (error) {
      // 忽略连接被拒绝的错误（通常是服务器未启动或正在重启）
      if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
        console.warn('后端服务器连接被拒绝，可能正在启动中...')
        if (isMounted) {
          setRecipients([])
          setTotal(0)
        }
        return
      }
      console.error('获取收件管理列表失败:', error)
      if (isMounted && currentPage === 1) {
        alert('获取列表失败：' + (error.response?.data?.message || '未知错误'))
      }
      if (isMounted) {
        setRecipients([])
        setTotal(0)
      }
    } finally {
      if (isMounted) {
        setLoading(false)
      }
    }
  }

  const handleAdd = () => {
    setEditingRecipient(null)
    setFormData({
      recipient_email: '',
      email_subject: '',
      send_frequency: 'daily',
      send_time: '09:00:00',
      is_active: true,
      qichacha_category_codes: null
    })
    setSelectedCategories([])
    setShowForm(true)
  }

  const handleEdit = async (id) => {
    try {
      const response = await axios.get(`/api/news/recipients/${id}`)
      if (response.data.success) {
        const recipient = response.data.data
        setEditingRecipient(recipient)
        const categoryCodes = recipient.qichacha_category_codes || null
        setFormData({
          recipient_email: recipient.recipient_email || '',
          email_subject: recipient.email_subject || '',
          send_frequency: recipient.send_frequency || 'daily',
          send_time: recipient.send_time || '09:00:00',
          is_active: recipient.is_active === 1,
          qichacha_category_codes: categoryCodes
        })
        setSelectedCategories(Array.isArray(categoryCodes) ? categoryCodes : [])
        setShowForm(true)
      }
    } catch (error) {
      console.error('获取收件管理信息失败:', error)
      alert('获取信息失败')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('确定要删除这条收件管理记录吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/news/recipients/${id}`)
      if (response.data.success) {
        alert('删除成功')
        fetchRecipients()
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleSendEmail = async (id) => {
    if (!window.confirm('确定要发送邮件吗？将发送前一天的舆情信息。')) {
      return
    }

    try {
      const response = await axios.post(`/api/news/recipients/${id}/send-email`)
      if (response.data.success) {
        alert('邮件发送成功')
      }
    } catch (error) {
      console.error('发送邮件失败:', error)
      alert('发送邮件失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleViewLog = (id) => {
    setLogRecipientId(id)
    setShowLogModal(true)
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!formData.recipient_email || !formData.send_frequency || !formData.send_time) {
      alert('请填写所有必填字段')
      return
    }

    try {
      // 准备提交数据，包含企查查类别编码
      const submitData = {
        ...formData,
        qichacha_category_codes: selectedCategories.length > 0 ? selectedCategories : null
      }
      
      let response
      if (editingRecipient) {
        response = await axios.put(`/api/news/recipients/${editingRecipient.id}`, submitData)
      } else {
        response = await axios.post('/api/news/recipients', submitData)
      }

      // 检查响应格式
      if (response && response.data && response.data.success === true) {
        // 创建/更新成功
        alert(editingRecipient ? '更新成功' : '创建成功')
        setShowForm(false)
        setEditingRecipient(null)
        // 重置表单
        setFormData({
          recipient_email: '',
          email_subject: '',
          send_frequency: 'daily',
          send_time: '09:00:00',
          is_active: true,
          qichacha_category_codes: null
        })
        setSelectedCategories([])
        // 延迟刷新列表，确保数据已保存，并捕获可能的错误
        setTimeout(() => {
          fetchRecipients().catch(err => {
            console.error('刷新列表失败:', err)
            // 刷新失败不显示错误，避免干扰用户
          })
        }, 100)
      } else {
        // 如果响应成功但 success 为 false 或 undefined
        const errorMsg = response?.data?.message || '响应格式错误'
        console.error('保存失败:', response?.data)
        alert('保存失败：' + errorMsg)
      }
    } catch (error) {
      console.error('保存失败:', error)
      console.error('错误详情:', error.response?.data)
      console.error('错误状态码:', error.response?.status)
      // 检查是否是网络错误还是业务错误
      if (error.response && error.response.status === 200) {
        // 如果状态码是200，说明请求成功但可能响应格式有问题
        console.error('响应状态码200但可能格式有问题:', error.response.data)
        alert('保存失败：响应格式错误')
      } else {
        const errorMsg = error.response?.data?.message || error.message || '未知错误'
        alert('保存失败：' + errorMsg)
      }
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

  const formatTime = (timeString) => {
    if (!timeString) return '-'
    try {
      // timeString格式为 HH:mm:ss
      const [hours, minutes] = timeString.split(':')
      return `${hours}:${minutes}`
    } catch (e) {
      return timeString
    }
  }

  const getFrequencyName = (frequency) => {
    const frequencyMap = {
      daily: '每天',
      weekly: '每周',
      monthly: '每月'
    }
    return frequencyMap[frequency] || frequency
  }

  // 调试信息
  console.log('RecipientManagement 组件开始渲染, recipients:', recipients.length, 'loading:', loading, 'currentPage:', currentPage)
  
  return (
    <div className="email-config" style={{ background: 'transparent', boxShadow: 'none', padding: '0', minHeight: '400px', width: '100%' }}>
      <div className="config-header">
        <h3>收件管理</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={fetchRecipients} title="刷新列表">
            刷新
          </button>
          <button className="btn-primary" onClick={handleAdd}>
            新增收件人
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : recipients.length === 0 ? (
        <div className="empty-data">暂无收件管理记录</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              {isAdmin && <th>用户名称</th>}
              <th>收件人邮箱</th>
              <th>邮件主题</th>
              <th>发送频率</th>
              <th>发送时间</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((recipient) => (
              <tr key={recipient.id}>
                {isAdmin && <td>{recipient.user_account || '-'}</td>}
                <td>
                  {recipient.recipient_email ? (
                    recipient.recipient_email.split(',').map((email, index) => (
                      <div key={index} style={{ marginBottom: index < recipient.recipient_email.split(',').length - 1 ? '4px' : '0' }}>
                        {email.trim()}
                      </div>
                    ))
                  ) : '-'}
                </td>
                <td>{recipient.email_subject || '-'}</td>
                <td>{getFrequencyName(recipient.send_frequency)}</td>
                <td>{formatTime(recipient.send_time)}</td>
                <td>
                  <span className={`status-badge ${recipient.is_active ? 'active' : 'inactive'}`}>
                    {recipient.is_active ? '启用' : '禁用'}
                  </span>
                </td>
                <td>{formatDate(recipient.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn-edit"
                      onClick={() => handleEdit(recipient.id)}
                    >
                      编辑
                    </button>
                    <button
                      className="btn-log"
                      onClick={() => handleViewLog(recipient.id)}
                    >
                      日志
                    </button>
                    <button
                      className="btn-delete"
                      onClick={() => handleDelete(recipient.id)}
                    >
                      删除
                    </button>
                    <button
                      className="btn-send-email"
                      onClick={() => handleSendEmail(recipient.id)}
                    >
                      发送邮件
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* 分页 */}
      {total > 0 && (() => {
        const totalPages = Math.ceil(total / pageSize)
        return totalPages > 1 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        )
      })()}

      {/* 新增/编辑表单 */}
      {showForm && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>{editingRecipient ? '编辑收件管理' : '新增收件管理'}</h3>
              <button className="close-btn" onClick={() => {
                setShowForm(false)
                setEditingRecipient(null)
              }}>×</button>
            </div>
            <div className="modal-body">
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>收件人邮箱 *</label>
                  <textarea
                    name="recipient_email"
                    value={formData.recipient_email}
                    onChange={handleChange}
                    placeholder="请输入收件人邮箱，多个邮箱可用逗号、分号或换行分隔&#10;例如：&#10;user1@example.com&#10;user2@example.com&#10;或：user1@example.com, user2@example.com"
                    rows={4}
                    required
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                  />
                  <p className="form-hint" style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                    支持多个邮箱，可用逗号、分号或换行分隔
                  </p>
                </div>

                <div className="form-group">
                  <label>邮件主题</label>
                  <input
                    type="text"
                    name="email_subject"
                    value={formData.email_subject}
                    onChange={handleChange}
                    placeholder="请输入邮件主题"
                  />
                </div>

                <div className="form-group">
                  <label>发送频率 *</label>
                  <select
                    name="send_frequency"
                    value={formData.send_frequency}
                    onChange={handleChange}
                    required
                  >
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                    <option value="monthly">每月</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>发送时间 *</label>
                  <input
                    type="time"
                    name="send_time"
                    value={formData.send_time ? formData.send_time.substring(0, 5) : '09:00'}
                    onChange={(e) => {
                      // 将HH:mm转换为HH:mm:ss格式
                      const timeValue = e.target.value + ':00'
                      setFormData({
                        ...formData,
                        send_time: timeValue
                      })
                    }}
                    required
                  />
                  <p className="form-hint">格式：HH:mm（例如：09:00）</p>
                </div>

                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      name="is_active"
                      checked={formData.is_active}
                      onChange={handleChange}
                    />
                    启用
                  </label>
                </div>

                <div className="form-group">
                  <label>企查查接口消息类型</label>
                  <button
                    type="button"
                    onClick={() => setShowCategoryModal(true)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007bff',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    选择消息类型
                  </button>
                  {selectedCategories.length > 0 && (
                    <p style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                      已选择 {selectedCategories.length} 个类别
                    </p>
                  )}
                  {selectedCategories.length === 0 && (
                    <p style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
                      未选择时，将使用默认类别（80000系列、40000系列、14004）
                    </p>
                  )}
                </div>

                <div className="form-actions">
                  <button type="button" onClick={() => {
                    setShowForm(false)
                    setEditingRecipient(null)
                  }}>
                    取消
                  </button>
                  <button type="submit">
                    {editingRecipient ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 日志弹窗 */}
      {showLogModal && (
        <LogModal
          type="recipient_management"
          id={logRecipientId}
          onClose={() => {
            setShowLogModal(false)
            setLogRecipientId(null)
          }}
        />
      )}

      {/* 企查查类别选择弹窗 */}
      {showCategoryModal && (
        <div className="modal-overlay" style={{ zIndex: 1001 }}>
          <div className="modal-content" style={{ maxWidth: '800px', maxHeight: '80vh', overflow: 'auto' }}>
            <div className="modal-header">
              <h3>选择企查查消息类型</h3>
              <button className="close-btn" onClick={() => setShowCategoryModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const allCodes = Object.keys(categoryMap)
                    setSelectedCategories(allCodes)
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedCategories([])}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // 默认类别：80000系列、40000系列、14004
                    const defaultCodes = [
                      '80000', '80001', '80002', '80003', '80004', '80005', '80006', '80007', '80008',
                      '40000', '40001', '40002', '40003', '40004', '40005', '40006', '40007', '40008',
                      '40009', '40010', '40011', '40012', '40013', '40014', '40015', '40016', '40017',
                      '40018', '40019', '40020', '40021', '40022', '40023', '40024', '40025', '40026',
                      '40027', '40028', '40029', '40030',
                      '14004'
                    ]
                    setSelectedCategories(defaultCodes.filter(code => categoryMap[code]))
                  }}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#17a2b8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  使用默认类别
                </button>
              </div>
              <div style={{
                maxHeight: '400px',
                overflowY: 'auto',
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '8px'
              }}>
                {Object.keys(categoryMap).length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                    正在加载类别数据...
                  </div>
                ) : (
                  Object.entries(categoryMap).map(([code, name]) => (
                    <label
                      key={code}
                      style={{
                        display: 'block',
                        padding: '8px',
                        marginBottom: '4px',
                        cursor: 'pointer',
                        backgroundColor: selectedCategories.includes(code) ? '#e7f3ff' : 'transparent',
                        borderRadius: '4px'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(code)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCategories([...selectedCategories, code])
                          } else {
                            setSelectedCategories(selectedCategories.filter(c => c !== code))
                          }
                        }}
                        style={{ marginRight: '8px' }}
                      />
                      <span style={{ fontWeight: 'bold', marginRight: '8px' }}>{code}</span>
                      <span>{name}</span>
                    </label>
                  ))
                )}
              </div>
              <div style={{ marginTop: '16px', fontSize: '14px', color: '#666' }}>
                已选择 {selectedCategories.length} 个类别
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: '16px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowCategoryModal(false)
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCategoryModal(false)
                }}
                style={{ backgroundColor: '#007bff' }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default RecipientManagement

