import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './EmailConfig.css'

function ScheduledTaskManagement() {
  const [activeTab, setActiveTab] = useState('email') // 'email' 或 'news_sync'
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [isNewTask, setIsNewTask] = useState(false) // 是否为新增任务
  const [isCopyTask, setIsCopyTask] = useState(false) // 是否为复制任务
  const [originalCopyData, setOriginalCopyData] = useState(null) // 复制时的原始数据
  const [formData, setFormData] = useState({
    app_id: '',
    app_name: '',
    interface_type: '新榜',
    request_url: '',
    send_frequency: 'daily',
    send_time: '09:00:00',
    is_active: true,
    weekday: 'monday', // 星期字段：monday到sunday
    month_day: 'first' // 日期字段：first(第一天), last(最后一天), 15(15日)
  })
  const [applications, setApplications] = useState([]) // 应用列表

  useEffect(() => {
    if (activeTab === 'news_sync') {
      fetchApplications()
    }
  }, [activeTab])

  const fetchApplications = async () => {
    try {
      const response = await axios.get('/api/system/applications')
      if (response.data.success) {
        setApplications(response.data.data || [])
      }
    } catch (error) {
      console.error('获取应用列表失败:', error)
      // 如果系统接口失败，尝试从auth接口获取
      try {
        const authResponse = await axios.get('/api/auth/applications')
        if (authResponse.data.success) {
          setApplications(authResponse.data.data || [])
        }
      } catch (authError) {
        console.error('从auth接口获取应用列表也失败:', authError)
      }
    }
  }

  const [showLogModal, setShowLogModal] = useState(false)
  const [logTaskId, setLogTaskId] = useState(null)
  const [logs, setLogs] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [logCurrentPage, setLogCurrentPage] = useState(1)
  const [logTotal, setLogTotal] = useState(0)

  useEffect(() => {
    fetchTasks()
  }, [currentPage, activeTab])

  useEffect(() => {
    if (showLogModal && logTaskId) {
      fetchTaskLogs()
    }
  }, [showLogModal, logTaskId, logCurrentPage])

  const fetchTasks = async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/scheduled-tasks', {
        params: {
          page: currentPage,
          pageSize: pageSize,
          task_type: activeTab === 'email' ? 'email' : 'news_sync'
        }
      })
      if (response.data.success) {
        setTasks(response.data.data || [])
        setTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取定时任务列表失败:', error)
      alert('获取定时任务列表失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const fetchTaskLogs = async () => {
    if (!logTaskId) return
    setLogLoading(true)
    try {
      const response = await axios.get(`/api/scheduled-tasks/${logTaskId}/logs`, {
        params: {
          page: logCurrentPage,
          pageSize: 10,
          task_type: activeTab === 'email' ? 'email' : 'news_sync'
        }
      })
      if (response.data.success) {
        setLogs(response.data.data || [])
        setLogTotal(response.data.total || 0)
      }
    } catch (error) {
      console.error('获取定时任务日志失败:', error)
      alert('获取定时任务日志失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLogLoading(false)
    }
  }

  const handleEdit = (task) => {
    setIsNewTask(false)
    setIsCopyTask(false)
    setOriginalCopyData(null)
    setEditingTask(task)
    // 确保字段名正确映射，支持多种可能的字段名
    const frequency = task.sendFrequency || task.send_frequency || 'daily'
    const time = task.sendTime || task.send_time || '09:00:00'
    const active = task.isActive !== undefined ? task.isActive : (task.is_active !== undefined ? task.is_active : true)
    
    setFormData({
      app_id: task.appId || '',
      app_name: task.appName || '',
      interface_type: task.interfaceType || '新榜',
      request_url: task.requestUrl || '',
      send_frequency: frequency,
      send_time: time,
      is_active: active,
      weekday: task.weekday || task.week_day || 'monday',
      month_day: task.monthDay || task.month_day || 'first'
    })
    setShowEditModal(true)
  }

  const handleSave = async () => {
    try {
      if (activeTab === 'news_sync') {
        // 新闻接口同步
        if (isNewTask) {
          // 新增或复制
          if (!formData.app_id) {
            alert('请选择应用')
            return
          }
          if (!formData.request_url) {
            alert('请输入请求地址')
            return
          }
          
          const createData = {
            app_id: formData.app_id,
            interface_type: formData.interface_type || '新榜',
            request_url: formData.request_url,
            send_frequency: formData.send_frequency || 'daily',
            send_time: formData.send_time || '00:00:00',
            is_active: formData.is_active !== undefined ? formData.is_active : true,
            weekday: formData.send_frequency === 'weekly' ? (formData.weekday || null) : null,
            month_day: formData.send_frequency === 'monthly' ? (formData.month_day || null) : null,
            frequency_type: formData.send_frequency === 'weekly' ? 'week' : (formData.send_frequency === 'monthly' ? 'month' : 'day'),
            frequency_value: 1
          }
          
          // 如果是复制任务，需要包含原始数据中的 api_key 和 content_type
          if (isCopyTask && originalCopyData) {
            createData.api_key = originalCopyData.api_key || ''
            createData.content_type = originalCopyData.content_type || null
            // 如果原始数据有 frequency_value，也使用它
            if (originalCopyData.frequency_value) {
              createData.frequency_value = originalCopyData.frequency_value
            }
          }
          
          const response = await axios.post('/api/system/news-config', createData)
          if (response.data.success) {
            alert(isCopyTask ? '复制成功' : '创建成功')
            setShowEditModal(false)
            setEditingTask(null)
            setIsNewTask(false)
            setIsCopyTask(false)
            setOriginalCopyData(null)
            fetchTasks()
          }
        } else {
          // 更新
          if (!editingTask) return
          
          // 如果修改了应用、接口类型或请求地址，需要通过系统配置接口更新
          const task = editingTask
          if (task && (
            formData.app_id !== task.appId ||
            formData.interface_type !== task.interfaceType ||
            formData.request_url !== task.requestUrl
          )) {
            const systemUpdateData = {
              app_id: formData.app_id || task.appId,
              interface_type: formData.interface_type || task.interfaceType,
              request_url: formData.request_url || task.requestUrl
            }
            await axios.put(`/api/system/news-config/${editingTask.id}`, systemUpdateData)
          }
          
          const updateData = {
            send_frequency: formData.send_frequency,
            send_time: formData.send_time,
            is_active: formData.is_active,
            weekday: formData.send_frequency === 'weekly' ? (formData.weekday || null) : null,
            month_day: formData.send_frequency === 'monthly' ? (formData.month_day || null) : null,
            task_type: 'news_sync'
          }
          const response = await axios.put(`/api/scheduled-tasks/${editingTask.id}`, updateData)
          if (response.data.success) {
            alert('保存成功')
            setShowEditModal(false)
            setEditingTask(null)
            setIsNewTask(false)
            setIsCopyTask(false)
            setOriginalCopyData(null)
            fetchTasks()
          }
        }
      } else {
        // 邮件发送舆情
        if (!editingTask) return

        const submitData = {
          ...formData,
          task_type: 'email'
        }
        // 邮件发送时清除这两个字段
        delete submitData.weekday
        delete submitData.month_day

        const response = await axios.put(`/api/scheduled-tasks/${editingTask.id}`, submitData)
        if (response.data.success) {
          alert('保存成功')
          setShowEditModal(false)
          setEditingTask(null)
          setIsNewTask(false)
          setIsCopyTask(false)
          setOriginalCopyData(null)
          fetchTasks()
        }
      }
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleExecute = async (taskId) => {
    if (!window.confirm('确定要立即执行这个定时任务吗？')) {
      return
    }

    try {
      const response = await axios.post(`/api/scheduled-tasks/${taskId}/execute`, {
        task_type: activeTab === 'email' ? 'email' : 'news_sync'
      })
      if (response.data.success) {
        alert('任务执行完成')
      }
    } catch (error) {
      console.error('执行任务失败:', error)
      alert('执行任务失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleViewLog = (taskId) => {
    setLogTaskId(taskId)
    setShowLogModal(true)
    setLogCurrentPage(1)
  }

  const handleDelete = async (taskId) => {
    if (!window.confirm('确定要删除这个定时任务吗？')) {
      return
    }

    try {
      const response = await axios.delete(`/api/scheduled-tasks/${taskId}`, {
        params: {
          task_type: activeTab === 'email' ? 'email' : 'news_sync'
        }
      })
      if (response.data.success) {
        alert('删除成功')
        fetchTasks()
      }
    } catch (error) {
      console.error('删除失败:', error)
      alert('删除失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  // 新增新闻接口配置
  const handleAddNew = () => {
    setIsNewTask(true)
    setIsCopyTask(false)
    setOriginalCopyData(null)
    setEditingTask(null)
    setFormData({
      app_id: applications.length > 0 ? applications[0].id : '',
      app_name: applications.length > 0 ? applications[0].app_name : '',
      interface_type: '新榜',
      request_url: '',
      send_frequency: 'daily',
      send_time: '00:00:00',
      is_active: true,
      weekday: 'monday',
      month_day: 'first'
    })
    setShowEditModal(true)
  }

  // 复制任务 - 打开弹窗显示复制的数据，用户确认后保存
  const handleCopy = async (task) => {
    try {
      // 获取原始记录的完整数据
      const response = await axios.get(`/api/system/news-config/${task.id}`)
      if (!response.data.success) {
        alert('获取原始数据失败：' + (response.data.message || '未知错误'))
        return
      }

      const originalData = response.data.data
      
      // 保存原始数据，用于复制时包含所有字段（api_key, content_type等）
      setOriginalCopyData(originalData)
      
      // 设置表单数据，排除id，其他字段都使用原始数据
      setIsNewTask(true)
      setIsCopyTask(true)
      setEditingTask(null)
      
      // 处理时间格式
      let sendTime = '00:00:00'
      if (originalData.send_time) {
        const timeStr = originalData.send_time.toString()
        sendTime = timeStr.length >= 8 ? timeStr.substring(0, 8) : timeStr
      }
      
      setFormData({
        app_id: originalData.app_id || '',
        app_name: originalData.app_name || '',
        interface_type: originalData.interface_type || '新榜',
        request_url: originalData.request_url || '',
        send_frequency: originalData.send_frequency || (originalData.frequency_type === 'week' ? 'weekly' : (originalData.frequency_type === 'month' ? 'monthly' : 'daily')),
        send_time: sendTime,
        is_active: originalData.is_active !== undefined ? (originalData.is_active === 1 || originalData.is_active === true) : true,
        weekday: originalData.weekday || 'monday',
        month_day: originalData.month_day || 'first'
      })
      
      // 打开弹窗
      setShowEditModal(true)
    } catch (error) {
      console.error('获取原始数据失败:', error)
      alert('获取原始数据失败：' + (error.response?.data?.message || '未知错误'))
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
        minute: '2-digit',
        second: '2-digit'
      })
    } catch (e) {
      return dateString
    }
  }

  const formatTime = (timeString) => {
    if (!timeString) return '-'
    try {
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

  const getWeekdayName = (weekday) => {
    const weekdayMap = {
      monday: '星期一',
      tuesday: '星期二',
      wednesday: '星期三',
      thursday: '星期四',
      friday: '星期五',
      saturday: '星期六',
      sunday: '星期日'
    }
    return weekdayMap[weekday] || '-'
  }

  const getMonthDayName = (monthDay) => {
    const monthDayMap = {
      first: '第一天',
      last: '最后一天',
      '15': '15日'
    }
    return monthDayMap[monthDay] || '-'
  }

  const getStatusBadge = (isActive, isDeleted) => {
    if (isDeleted) {
      return <span className="status-badge inactive">已删除</span>
    }
    return isActive ? (
      <span className="status-badge active">启用</span>
    ) : (
      <span className="status-badge inactive">禁用</span>
    )
  }

  const getOperationTypeName = (type) => {
    return type === 'send' ? '发送' : '接收'
  }

  return (
    <div className="email-config">
      <div className="config-header">
        <h3>定时任务管理</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'news_sync' && (
            <button className="btn-primary" onClick={handleAddNew}>
              新增
            </button>
          )}
          <button className="btn-primary" onClick={fetchTasks}>
            刷新
          </button>
        </div>
      </div>

      {/* Tab切换 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #ddd' }}>
        <button
          className={`tab-button ${activeTab === 'email' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('email')
            setCurrentPage(1)
          }}
          style={{
            padding: '10px 20px',
            border: 'none',
            borderBottom: activeTab === 'email' ? '2px solid #357abd' : '2px solid transparent',
            background: 'none',
            cursor: 'pointer',
            color: activeTab === 'email' ? '#357abd' : '#666',
            fontWeight: activeTab === 'email' ? 'bold' : 'normal'
          }}
        >
          邮件发送舆情
        </button>
        <button
          className={`tab-button ${activeTab === 'news_sync' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('news_sync')
            setCurrentPage(1)
          }}
          style={{
            padding: '10px 20px',
            border: 'none',
            borderBottom: activeTab === 'news_sync' ? '2px solid #357abd' : '2px solid transparent',
            background: 'none',
            cursor: 'pointer',
            color: activeTab === 'news_sync' ? '#357abd' : '#666',
            fontWeight: activeTab === 'news_sync' ? 'bold' : 'normal'
          }}
        >
          新闻接口同步
        </button>
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="empty-data">暂无定时任务</div>
      ) : (
        <table className="config-table">
          <thead>
            <tr>
              {activeTab === 'email' ? (
                <>
                  <th>用户账号</th>
                  <th>收件人邮箱</th>
                  <th>邮件主题</th>
                  <th>发送频率</th>
                  <th>发送时间</th>
                  <th>下次执行时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </>
              ) : (
                <>
                  <th>应用名称</th>
                  <th>新闻接口类型</th>
                  <th>请求地址</th>
                  <th>同步频率</th>
                  <th>星期</th>
                  <th>日期</th>
                  <th>同步时间</th>
                  <th>下次执行时间</th>
                  <th>最后同步时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {tasks
              .filter(task => activeTab === 'email' ? !task.isDeleted : true)
              .map((task) => (
              <tr key={task.id}>
                {activeTab === 'email' ? (
                  <>
                    <td>{task.userAccount || '-'}</td>
                    <td>
                      {task.recipientEmail ? (
                        task.recipientEmail.split(',').map((email, index) => (
                          <div key={index} style={{ marginBottom: index < task.recipientEmail.split(',').length - 1 ? '4px' : '0' }}>
                            {email.trim()}
                          </div>
                        ))
                      ) : '-'}
                    </td>
                    <td>{task.emailSubject || '-'}</td>
                    <td>{getFrequencyName(task.sendFrequency)}</td>
                    <td>{formatTime(task.sendTime)}</td>
                    <td>{task.nextExecutionTime ? formatDate(task.nextExecutionTime) : '-'}</td>
                    <td>{getStatusBadge(task.isActive, task.isDeleted)}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-edit"
                          onClick={() => handleEdit(task)}
                          disabled={task.isDeleted}
                        >
                          编辑
                        </button>
                        <button
                          className="btn-log"
                          onClick={() => handleViewLog(task.id)}
                        >
                          日志
                        </button>
                        <button
                          className="btn-send-email"
                          onClick={() => handleExecute(task.id)}
                          disabled={task.isDeleted || !task.isActive}
                        >
                          立即执行
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDelete(task.id)}
                          disabled={task.isDeleted}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{task.appName || '-'}</td>
                    <td>{task.interfaceType || '新榜'}</td>
                    <td style={{ maxWidth: '300px', wordBreak: 'break-word' }}>{task.requestUrl || '-'}</td>
                    <td>{task.sendFrequency ? getFrequencyName(task.sendFrequency) : '-'}</td>
                    <td>{task.sendFrequency === 'weekly' ? getWeekdayName(task.weekday || task.week_day) : '-'}</td>
                    <td>{task.sendFrequency === 'monthly' ? getMonthDayName(task.monthDay || task.month_day) : '-'}</td>
                    <td>{task.sendTime ? formatTime(task.sendTime) : '-'}</td>
                    <td>{task.nextExecutionTime ? formatDate(task.nextExecutionTime) : '-'}</td>
                    <td>{task.lastSyncTime ? formatDate(task.lastSyncTime) : '-'}</td>
                    <td>{getStatusBadge(task.isActive, false)}</td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn-edit"
                          onClick={() => handleEdit(task)}
                        >
                          编辑
                        </button>
                        <button
                          className="btn-log"
                          onClick={() => handleViewLog(task.id)}
                        >
                          日志
                        </button>
                        <button
                          className="btn-copy"
                          onClick={() => handleCopy(task)}
                          style={{ background: '#ffc107', color: '#000' }}
                        >
                          复制
                        </button>
                        <button
                          className="btn-send-email"
                          onClick={() => handleExecute(task.id)}
                          disabled={!task.isActive}
                        >
                          立即执行
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDelete(task.id)}
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </>
                )}
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

      {/* 编辑定时任务弹窗 */}
      {showEditModal && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            setShowEditModal(false)
            setEditingTask(null)
            setIsNewTask(false)
            setIsCopyTask(false)
            setOriginalCopyData(null)
          }
        }}>
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>{activeTab === 'email' ? (isNewTask ? '新增定时任务' : '编辑定时任务') : (isCopyTask ? '复制新闻接口同步' : (isNewTask ? '新增新闻接口同步' : '编辑新闻接口同步'))}</h3>
              <button className="close-button" onClick={() => {
                setShowEditModal(false)
                setEditingTask(null)
                setIsNewTask(false)
                setIsCopyTask(false)
                setOriginalCopyData(null)
              }}>×</button>
            </div>
            <div className="modal-body">
              {activeTab === 'email' && editingTask && (
                <div style={{ marginBottom: '20px' }}>
                  <p><strong>用户账号：</strong>{editingTask.userAccount || '-'}</p>
                  <p><strong>收件人邮箱：</strong>{editingTask.recipientEmail || '-'}</p>
                  <p><strong>邮件主题：</strong>{editingTask.emailSubject || '-'}</p>
                </div>
              )}

              {activeTab === 'news_sync' && (
                <>
                  <div className="form-group">
                    <label>应用名称 *</label>
                    <select
                      value={formData.app_id || ''}
                      onChange={(e) => {
                        const selectedApp = applications.find(app => app.id === e.target.value)
                        setFormData({ 
                          ...formData, 
                          app_id: e.target.value,
                          app_name: selectedApp ? selectedApp.app_name : ''
                        })
                      }}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                    >
                      <option value="">请选择应用</option>
                      {applications.map(app => (
                        <option key={app.id} value={app.id}>{app.app_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>新闻接口类型 *</label>
                    <select
                      value={formData.interface_type || '新榜'}
                      onChange={(e) => setFormData({ ...formData, interface_type: e.target.value })}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                    >
                      <option value="新榜">新榜</option>
                      <option value="企查查">企查查</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>请求地址 *</label>
                    <input
                      type="text"
                      value={formData.request_url || ''}
                      onChange={(e) => setFormData({ ...formData, request_url: e.target.value })}
                      style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>{activeTab === 'email' ? '发送频率' : '同步频率'} *</label>
                <select
                  value={formData.send_frequency}
                  onChange={(e) => {
                    const newFrequency = e.target.value
                    setFormData({ ...formData, send_frequency: newFrequency })
                  }}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="monthly">每月</option>
                </select>
              </div>

              {/* 每周时显示星期选择 - 只在新闻接口同步时显示 */}
              {activeTab === 'news_sync' && formData.send_frequency === 'weekly' && (
                <div className="form-group">
                  <label>星期 *</label>
                  <select
                    value={formData.weekday}
                    onChange={(e) => setFormData({ ...formData, weekday: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="monday">星期一</option>
                    <option value="tuesday">星期二</option>
                    <option value="wednesday">星期三</option>
                    <option value="thursday">星期四</option>
                    <option value="friday">星期五</option>
                    <option value="saturday">星期六</option>
                    <option value="sunday">星期日</option>
                  </select>
                </div>
              )}

              {/* 每月时显示日期选择 - 只在新闻接口同步时显示 */}
              {activeTab === 'news_sync' && formData.send_frequency === 'monthly' && (
                <div className="form-group">
                  <label>日期 *</label>
                  <select
                    value={formData.month_day}
                    onChange={(e) => setFormData({ ...formData, month_day: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                  >
                    <option value="first">第一天</option>
                    <option value="last">最后一天</option>
                    <option value="15">15日</option>
                  </select>
                </div>
              )}

              <div className="form-group">
                <label>{activeTab === 'email' ? '发送时间' : '同步时间'} *</label>
                <input
                  type="time"
                  value={formData.send_time ? formData.send_time.substring(0, 5) : '00:00'}
                  onChange={(e) => setFormData({ ...formData, send_time: e.target.value + ':00' })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                />
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    style={{ marginRight: '8px' }}
                  />
                  启用
                </label>
              </div>

              <div className="form-actions" style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false)
                    setEditingTask(null)
                    setIsNewTask(false)
                    setIsCopyTask(false)
                    setOriginalCopyData(null)
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

      {/* 查看日志弹窗 */}
      {showLogModal && (
        <div className="modal-overlay" onClick={(e) => {
          if (e.target === e.currentTarget) {
            // 不允许点击外部关闭
          }
        }}>
          <div className="modal-content" style={{ maxWidth: '1000px', maxHeight: '80vh' }}>
            <div className="modal-header">
              <h3>{activeTab === 'email' ? '定时任务发送日志' : '新闻同步执行日志'}</h3>
              <button className="close-button" onClick={() => {
                setShowLogModal(false)
                setLogTaskId(null)
                setLogs([])
                setLogCurrentPage(1)
              }}>×</button>
            </div>
            <div className="modal-body">
              {logLoading ? (
                <div className="loading">加载中...</div>
              ) : logs.length === 0 ? (
                <div className="empty-data">暂无日志</div>
              ) : activeTab === 'email' ? (
                <>
                  <table className="config-table" style={{ marginBottom: '20px' }}>
                    <thead>
                      <tr>
                        <th>操作类型</th>
                        <th>发件人</th>
                        <th>收件人</th>
                        <th>主题</th>
                        <th>状态</th>
                        <th>错误信息</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.id}>
                          <td>{getOperationTypeName(log.operation_type)}</td>
                          <td>{log.from_email || '-'}</td>
                          <td>{log.to_email || '-'}</td>
                          <td>{log.subject || '-'}</td>
                          <td>
                            {log.status === 'success' ? (
                              <span className="status-badge active">成功</span>
                            ) : (
                              <span className="status-badge inactive">失败</span>
                            )}
                          </td>
                          <td style={{ maxWidth: '200px', wordBreak: 'break-word', fontSize: '12px' }}>{log.error_message || '-'}</td>
                          <td>{formatDate(log.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {logTotal > 0 && (
                    <Pagination
                      currentPage={logCurrentPage}
                      totalPages={Math.ceil(logTotal / 10)}
                      onPageChange={setLogCurrentPage}
                    />
                  )}
                </>
              ) : (
                <>
                  <table className="config-table" style={{ marginBottom: '20px' }}>
                    <thead>
                      <tr>
                        <th>执行类型</th>
                        <th>开始时间</th>
                        <th>结束时间</th>
                        <th>耗时（秒）</th>
                        <th>状态</th>
                        <th>同步数量</th>
                        <th>企业/公众号总数</th>
                        <th>处理数量</th>
                        <th>错误数量</th>
                        <th>错误信息</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <React.Fragment key={log.id}>
                          <tr>
                            <td>{log.execution_type === 'manual' ? '手动触发' : '定时任务'}</td>
                            <td>{formatDate(log.start_time)}</td>
                            <td>{log.end_time ? formatDate(log.end_time) : '-'}</td>
                            <td>{log.duration_seconds !== null ? log.duration_seconds : '-'}</td>
                            <td>
                              {log.status === 'success' ? (
                                <span className="status-badge active">成功</span>
                              ) : log.status === 'failed' ? (
                                <span className="status-badge inactive">失败</span>
                              ) : (
                                <span className="status-badge" style={{ background: '#ffc107', color: '#000' }}>执行中</span>
                              )}
                            </td>
                            <td>{log.synced_count || 0}</td>
                            <td>{log.total_enterprises || 0}</td>
                            <td>{log.processed_enterprises || 0}</td>
                            <td>{log.error_count || 0}</td>
                            <td style={{ maxWidth: '200px', wordBreak: 'break-word', fontSize: '12px' }}>
                              {log.error_message || '-'}
                              {log.execution_details && (
                                <div style={{ marginTop: '4px', fontSize: '11px', color: '#666' }}>
                                  {log.execution_details.interfaceType && (
                                    <div>接口类型: {log.execution_details.interfaceType}</div>
                                  )}
                                  {log.execution_details.timeRange && (
                                    <div>时间范围: {log.execution_details.timeRange.from || log.execution_details.timeRange.startDate} 至 {log.execution_details.timeRange.to || log.execution_details.timeRange.endDate}</div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {log.execution_details && (
                                  <button
                                    onClick={() => {
                                      const detailRow = document.getElementById(`execution-detail-${log.id}`);
                                      if (detailRow) {
                                        detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
                                      }
                                    }}
                                    style={{
                                      padding: '4px 8px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      background: '#28a745',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px'
                                    }}
                                    title="查看接口触发详细信息"
                                  >
                                    接口详情
                                  </button>
                                )}
                                {log.detail_logs && log.detail_logs.length > 0 && (
                                  <button
                                    onClick={() => {
                                      const detailRow = document.getElementById(`detail-${log.id}`);
                                      if (detailRow) {
                                        detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
                                      }
                                    }}
                                    style={{
                                      padding: '4px 8px',
                                      fontSize: '12px',
                                      cursor: 'pointer',
                                      background: '#007bff',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: '4px'
                                    }}
                                    title="查看详细同步记录"
                                  >
                                    同步记录 ({log.detail_logs.length})
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {log.execution_details && (
                            <tr id={`execution-detail-${log.id}`} style={{ display: 'none' }}>
                              <td colSpan="11" style={{ padding: '15px', background: '#e8f5e9' }}>
                                <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#2e7d32' }}>接口触发详细信息：</div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '13px' }}>
                                  {/* 接口类型 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>接口类型：</div>
                                  <div>{log.execution_details.interfaceType || '-'}</div>
                                  
                                  {/* 请求地址 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>请求地址：</div>
                                  <div style={{ wordBreak: 'break-all' }}>
                                    {log.execution_details.requestUrl || '-'}
                                  </div>
                                  
                                  {/* 配置ID */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>配置ID：</div>
                                  <div>{log.execution_details.configId || log.config_id || '-'}</div>
                                  
                                  {/* 时间范围 */}
                                  {log.execution_details.timeRange && (
                                    <>
                                      <div style={{ fontWeight: 'bold', color: '#555' }}>时间范围：</div>
                                      <div>
                                        {log.execution_details.timeRange.from || log.execution_details.timeRange.startDate || '-'} 
                                        {' → '}
                                        {log.execution_details.timeRange.to || log.execution_details.timeRange.endDate || '-'}
                                      </div>
                                    </>
                                  )}
                                  
                                  {/* 公众号总数（新榜接口） */}
                                  {log.execution_details.totalAccounts !== undefined && (
                                    <>
                                      <div style={{ fontWeight: 'bold', color: '#555' }}>公众号总数：</div>
                                      <div>{log.execution_details.totalAccounts}</div>
                                    </>
                                  )}
                                  
                                  {/* 企业总数（企查查接口） */}
                                  {log.execution_details.totalEnterprises !== undefined && (
                                    <>
                                      <div style={{ fontWeight: 'bold', color: '#555' }}>企业总数：</div>
                                      <div>{log.execution_details.totalEnterprises}</div>
                                    </>
                                  )}
                                  
                                  {/* 处理数量 */}
                                  {log.execution_details.processedEnterprises !== undefined && (
                                    <>
                                      <div style={{ fontWeight: 'bold', color: '#555' }}>处理数量：</div>
                                      <div>{log.execution_details.processedEnterprises}</div>
                                    </>
                                  )}
                                  
                                  {/* 同步数量 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>同步数量：</div>
                                  <div style={{ color: (log.execution_details.syncedCount || log.synced_count || 0) > 0 ? '#28a745' : '#666' }}>
                                    {log.execution_details.syncedCount !== undefined ? log.execution_details.syncedCount : (log.synced_count || 0)}
                                  </div>
                                  
                                  {/* 错误数量 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>错误数量：</div>
                                  <div style={{ color: (log.execution_details.errorCount || log.error_count || 0) > 0 ? '#dc3545' : '#28a745' }}>
                                    {log.execution_details.errorCount !== undefined ? log.execution_details.errorCount : (log.error_count || 0)}
                                  </div>
                                  
                                  {/* 执行类型 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>执行类型：</div>
                                  <div>{log.execution_type === 'manual' ? '手动触发' : '定时任务'}</div>
                                  
                                  {/* 执行状态 */}
                                  <div style={{ fontWeight: 'bold', color: '#555' }}>执行状态：</div>
                                  <div>
                                    {log.status === 'success' ? (
                                      <span style={{ color: '#28a745' }}>成功</span>
                                    ) : log.status === 'failed' ? (
                                      <span style={{ color: '#dc3545' }}>失败</span>
                                    ) : (
                                      <span style={{ color: '#ffc107' }}>执行中</span>
                                    )}
                                  </div>
                                </div>
                                
                                {/* 调试信息：显示完整的execution_details（仅在开发环境或需要时） */}
                                {process.env.NODE_ENV === 'development' && (
                                  <div style={{ marginTop: '15px', padding: '10px', background: '#f5f5f5', borderRadius: '4px', fontSize: '11px' }}>
                                    <div style={{ fontWeight: 'bold', marginBottom: '5px' }}>调试信息（execution_details原始数据）：</div>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                      {JSON.stringify(log.execution_details, null, 2)}
                                    </pre>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                          {log.detail_logs && log.detail_logs.length > 0 && (
                            <tr id={`detail-${log.id}`} style={{ display: 'none' }}>
                              <td colSpan="11" style={{ padding: '10px', background: '#f5f5f5' }}>
                                <div style={{ marginBottom: '10px', fontWeight: 'bold' }}>详细同步记录：</div>
                                <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                                  <thead>
                                    <tr style={{ background: '#e9ecef' }}>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'left' }}>接口类型</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'left' }}>公众号ID/企业代码</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center' }}>有数据</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center' }}>返回条数</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center' }}>入库成功</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center' }}>入库条数</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'left' }}>错误信息</th>
                                      <th style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'left' }}>操作时间</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {log.detail_logs.map((detail) => (
                                      <tr key={detail.id}>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{detail.interface_type}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', wordBreak: 'break-word', maxWidth: '150px' }}>{detail.account_id}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', textAlign: 'center' }}>
                                          {detail.has_data ? (
                                            <span style={{ color: '#28a745' }}>是</span>
                                          ) : (
                                            <span style={{ color: '#dc3545' }}>否</span>
                                          )}
                                        </td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', textAlign: 'center' }}>{detail.data_count || 0}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', textAlign: 'center' }}>
                                          {detail.insert_success ? (
                                            <span style={{ color: '#28a745' }}>是</span>
                                          ) : (
                                            <span style={{ color: '#dc3545' }}>否</span>
                                          )}
                                        </td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', textAlign: 'center' }}>{detail.insert_count || 0}</td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6', wordBreak: 'break-word', maxWidth: '200px', color: detail.error_message ? '#dc3545' : '#666' }}>
                                          {detail.error_message || '-'}
                                        </td>
                                        <td style={{ padding: '6px', border: '1px solid #dee2e6' }}>{formatDate(detail.created_at)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                  {logTotal > 0 && (
                    <Pagination
                      currentPage={logCurrentPage}
                      totalPages={Math.ceil(logTotal / 10)}
                      onPageChange={setLogCurrentPage}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ScheduledTaskManagement

