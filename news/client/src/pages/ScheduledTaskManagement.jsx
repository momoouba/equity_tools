import React, { useState, useEffect } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Card, Tabs, Form, Input, Select, InputNumber, Switch, Tag, Spin } from '@arco-design/web-react'
import axios from '../utils/axios'
import TaskProgressModal from '../components/TaskProgressModal'
import TaskLogModal from './TaskLogModal'
import CronGenerator from '../components/CronGenerator'
import './ScheduledTaskManagement.css'

const Option = Select.Option
const TabPane = Tabs.TabPane
const FormItem = Form.Item
const InputSearch = Input.Search

function ScheduledTaskManagement() {
  const [activeTab, setActiveTab] = useState('email')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [total, setTotal] = useState(0)
  const pageSize = 10

  const [aiAnalysisConfig, setAiAnalysisConfig] = useState({
    cron_expression: '0 0 2 * * ? *', // 默认每天凌晨2点
    isActive: true
  })
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false)
  const [showCronModal, setShowCronModal] = useState(false)

  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTask, setEditingTask] = useState(null)
  const [isNewTask, setIsNewTask] = useState(false)
  const [isCopyTask, setIsCopyTask] = useState(false)
  const [originalCopyData, setOriginalCopyData] = useState(null)
  const [formData, setFormData] = useState({
    app_id: '',
    app_name: '',
    interface_type: '新榜',
    request_url: '',
    send_frequency: 'daily',
    send_time: '09:00:00',
    is_active: true,
    skip_holiday: false,
    weekday: 'monday',
    month_day: 'first',
    retry_count: 0,
    retry_interval: 0
  })
  const [applications, setApplications] = useState([])
  const [showLogModal, setShowLogModal] = useState(false)
  const [logTaskId, setLogTaskId] = useState(null)
  const [showProgressModal, setShowProgressModal] = useState(false)
  const [progressTaskId, setProgressTaskId] = useState(null)

  useEffect(() => {
    if (activeTab === 'news_sync') {
      fetchApplications()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'ai_analysis') {
      fetchAiAnalysisConfig()
    } else {
      fetchTasks()
    }
  }, [currentPage, activeTab])

  const fetchApplications = async () => {
    try {
      const response = await axios.get('/api/system/applications')
      if (response.data.success) {
        setApplications(response.data.data || [])
      }
    } catch (error) {
      console.error('获取应用列表失败:', error)
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

  const fetchAiAnalysisConfig = async () => {
    setAiAnalysisLoading(true)
    try {
      const response = await axios.get('/api/scheduled-tasks/ai-analysis-config')
      if (response.data.success) {
        setAiAnalysisConfig({
          cron_expression: response.data.data.cronExpression || '0 0 2 * * ? *',
          isActive: response.data.data.isActive !== undefined ? response.data.data.isActive : true
        })
      }
    } catch (error) {
      console.error('获取AI分析定时任务配置失败:', error)
      Message.error('获取配置失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setAiAnalysisLoading(false)
    }
  }

  const handleSaveAiAnalysisConfig = async () => {
    if (!aiAnalysisConfig.cron_expression) {
      Message.warning('请配置Cron表达式')
      return
    }
    setAiAnalysisLoading(true)
    try {
      const response = await axios.put('/api/scheduled-tasks/ai-analysis-config', {
        cron_expression: aiAnalysisConfig.cron_expression,
        isActive: aiAnalysisConfig.isActive
      })
      if (response.data.success) {
        Message.success('保存成功')
        fetchAiAnalysisConfig()
      }
    } catch (error) {
      console.error('保存AI分析定时任务配置失败:', error)
      Message.error('保存失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setAiAnalysisLoading(false)
    }
  }

  const handleExecuteAiAnalysis = async () => {
    Modal.confirm({
      title: '确认执行',
      content: '确定要立即执行一次AI分析任务吗？这将会分析摘要为空的新闻数据。',
      onOk: async () => {
        setAiAnalysisLoading(true)
        try {
          const response = await axios.post('/api/scheduled-tasks/ai-analysis-config/execute')
          if (response.data.success) {
            Message.success('任务已开始执行，请查看日志了解执行结果')
          }
        } catch (error) {
          console.error('执行AI分析定时任务失败:', error)
          Message.error('执行失败：' + (error.response?.data?.message || '未知错误'))
        } finally {
          setAiAnalysisLoading(false)
        }
      }
    })
  }

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
      Message.error('获取定时任务列表失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (task) => {
    setIsNewTask(false)
    setIsCopyTask(false)
    setOriginalCopyData(null)
    setEditingTask(task)
    const frequency = task.sendFrequency || task.send_frequency || 'daily'
    const time = task.sendTime || task.send_time || '09:00:00'
    const active = task.isActive !== undefined ? task.isActive : (task.is_active !== undefined ? task.is_active : true)
    const skipHoliday = task.skipHoliday !== undefined ? task.skipHoliday : (task.skip_holiday !== undefined ? task.skip_holiday : false)
    
    setFormData({
      app_id: task.appId || '',
      app_name: task.appName || '',
      interface_type: task.interfaceType || '新榜',
      request_url: task.requestUrl || '',
      send_frequency: frequency,
      send_time: time,
      is_active: active,
      skip_holiday: skipHoliday,
      weekday: task.weekday || task.week_day || 'monday',
      month_day: task.monthDay || task.month_day || 'first',
      retry_count: task.retryCount || task.retry_count || 0,
      retry_interval: task.retryInterval || task.retry_interval || 0
    })
    setShowEditModal(true)
  }

  const handleSave = async (values) => {
    try {
      if (activeTab === 'news_sync') {
        if (isNewTask) {
          if (!values.app_id) {
            Message.warning('请选择应用')
            return
          }
          if (!values.request_url) {
            Message.warning('请输入请求地址')
            return
          }
          
          const createData = {
            app_id: values.app_id,
            interface_type: values.interface_type || '新榜',
            request_url: values.request_url,
            send_frequency: values.send_frequency || 'daily',
            send_time: values.send_time || '00:00:00',
            is_active: values.is_active !== undefined ? values.is_active : true,
            weekday: values.send_frequency === 'weekly' ? (values.weekday || null) : null,
            month_day: values.send_frequency === 'monthly' ? (values.month_day || null) : null,
            frequency_type: values.send_frequency === 'weekly' ? 'week' : (values.send_frequency === 'monthly' ? 'month' : 'day'),
            frequency_value: 1,
            retry_count: values.retry_count !== undefined ? parseInt(values.retry_count) : 0,
            retry_interval: values.retry_interval !== undefined ? parseInt(values.retry_interval) : 0
          }
          
          if (isCopyTask && originalCopyData) {
            createData.api_key = originalCopyData.api_key || ''
            createData.content_type = originalCopyData.content_type || null
            if (originalCopyData.frequency_value) {
              createData.frequency_value = originalCopyData.frequency_value
            }
          }
          
          const response = await axios.post('/api/system/news-config', createData)
          if (response.data.success) {
            Message.success(isCopyTask ? '复制成功' : '创建成功')
            setShowEditModal(false)
            setEditingTask(null)
            setIsNewTask(false)
            setIsCopyTask(false)
            setOriginalCopyData(null)
            fetchTasks()
          }
        } else {
          if (!editingTask) return
          
          const task = editingTask
          if (task && (
            values.app_id !== task.appId ||
            values.interface_type !== task.interfaceType ||
            values.request_url !== task.requestUrl
          )) {
            const systemUpdateData = {
              app_id: values.app_id || task.appId,
              interface_type: values.interface_type || task.interfaceType,
              request_url: values.request_url || task.requestUrl
            }
            await axios.put(`/api/system/news-config/${editingTask.id}`, systemUpdateData)
          }
          
          const updateData = {
            send_frequency: values.send_frequency,
            send_time: values.send_time,
            is_active: values.is_active,
            weekday: values.send_frequency === 'weekly' ? (values.weekday || null) : null,
            month_day: values.send_frequency === 'monthly' ? (values.month_day || null) : null,
            retry_count: values.retry_count !== undefined ? parseInt(values.retry_count) : 0,
            retry_interval: values.retry_interval !== undefined ? parseInt(values.retry_interval) : 0,
            task_type: 'news_sync'
          }
          const response = await axios.put(`/api/scheduled-tasks/${editingTask.id}`, updateData)
          if (response.data.success) {
            Message.success('保存成功')
            setShowEditModal(false)
            setEditingTask(null)
            setIsNewTask(false)
            setIsCopyTask(false)
            setOriginalCopyData(null)
            fetchTasks()
          }
        }
      } else {
        if (!editingTask) return

        const submitData = {
          ...values,
          task_type: 'email'
        }
        delete submitData.weekday
        delete submitData.month_day

        const response = await axios.put(`/api/scheduled-tasks/${editingTask.id}`, submitData)
        if (response.data.success) {
          Message.success('保存成功')
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
      Message.error('保存失败：' + (error.response?.data?.message || '未知错误'))
    }
  }

  const handleExecute = async (taskId) => {
    Modal.confirm({
      title: '确认执行',
      content: '确定要立即执行这个定时任务吗？',
      onOk: async () => {
        try {
          setProgressTaskId(taskId)
          setShowProgressModal(true)
          
          const response = await axios.post(`/api/scheduled-tasks/${taskId}/execute`, {
            task_type: activeTab === 'email' ? 'email' : 'news_sync'
          })
          
          if (!response.data.success) {
            setShowProgressModal(false)
            setProgressTaskId(null)
            Message.error('执行任务失败：' + (response.data.message || '未知错误'))
          }
        } catch (error) {
          console.error('执行任务失败:', error)
          setShowProgressModal(false)
          setProgressTaskId(null)
          Message.error('执行任务失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

  const handleViewLog = (taskId) => {
    setLogTaskId(taskId)
    setShowLogModal(true)
  }

  const handleDelete = async (taskId) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个定时任务吗？',
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/scheduled-tasks/${taskId}`, {
            params: {
              task_type: activeTab === 'email' ? 'email' : 'news_sync'
            }
          })
          if (response.data.success) {
            Message.success('删除成功')
            fetchTasks()
          }
        } catch (error) {
          console.error('删除失败:', error)
          Message.error('删除失败：' + (error.response?.data?.message || '未知错误'))
        }
      }
    })
  }

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
      skip_holiday: false,
      weekday: 'monday',
      month_day: 'first',
      retry_count: 0,
      retry_interval: 0
    })
    setShowEditModal(true)
  }

  const handleCopy = async (task) => {
    try {
      const response = await axios.get(`/api/system/news-config/${task.id}`)
      if (!response.data.success) {
        Message.error('获取原始数据失败：' + (response.data.message || '未知错误'))
        return
      }

      const originalData = response.data.data
      setOriginalCopyData(originalData)
      setIsNewTask(true)
      setIsCopyTask(true)
      setEditingTask(null)
      
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
        skip_holiday: originalData.skip_holiday !== undefined ? (originalData.skip_holiday === 1 || originalData.skip_holiday === true) : false,
        weekday: originalData.weekday || 'monday',
        month_day: originalData.month_day || 'first',
        retry_count: originalData.retry_count || 0,
        retry_interval: originalData.retry_interval || 0
      })
      setShowEditModal(true)
    } catch (error) {
      console.error('获取原始数据失败:', error)
      Message.error('获取原始数据失败：' + (error.response?.data?.message || '未知错误'))
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

  const formatCronExpression = (cron) => {
    if (!cron) return '-'
    // 简化显示：如果是常见的表达式，显示友好文本
    if (cron === '0 0 0 * * ? *') return '每天 00:00:00'
    if (cron === '0 0 0 ? * 1 *') return '每周日 00:00:00'
    if (cron === '0 0 0 ? * 2 *') return '每周一 00:00:00'
    if (cron === '0 0 0 ? * 3 *') return '每周二 00:00:00'
    if (cron === '0 0 0 ? * 4 *') return '每周三 00:00:00'
    if (cron === '0 0 0 ? * 5 *') return '每周四 00:00:00'
    if (cron === '0 0 0 ? * 6 *') return '每周五 00:00:00'
    if (cron === '0 0 0 ? * 7 *') return '每周六 00:00:00'
    if (cron === '0 0 0 1 * ? *') return '每月1号 00:00:00'
    // 返回原始表达式
    return cron
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

  const emailColumns = [
    {
      title: '用户账号',
      dataIndex: 'userAccount',
      width: 150
    },
    {
      title: '收件人邮箱',
      dataIndex: 'recipientEmail',
      width: 250,
      render: (text) => text ? (
        <div>
          {text.split(',').map((email, index) => (
            <div key={index} style={{ marginBottom: index < text.split(',').length - 1 ? '4px' : '0' }}>
              {email.trim()}
            </div>
          ))}
        </div>
      ) : '-'
    },
    {
      title: '邮件主题',
      dataIndex: 'emailSubject',
      width: 200,
      ellipsis: true,
      tooltip: true
    },
    {
      title: 'Cron表达式',
      dataIndex: 'cronExpression',
      width: 200,
      render: (text, record) => {
        // 兼容旧数据：如果有 send_frequency，显示旧的格式
        if (record.sendFrequency && !text) {
          const typeMap = { 'daily': '每天', 'weekly': '每周', 'monthly': '每月' }
          return `${typeMap[record.sendFrequency] || record.sendFrequency} - ${formatTime(record.sendTime || '')}`
        }
        return formatCronExpression(text)
      }
    },
    {
      title: '下次执行时间',
      dataIndex: 'nextExecutionTime',
      width: 180,
      render: (text) => text ? formatDate(text) : '-'
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 100,
      render: (isActive, record) => {
        if (record.isDeleted) {
          return <Tag color="gray">已删除</Tag>
        }
        return <Tag color={isActive ? 'green' : 'red'}>{isActive ? '启用' : '禁用'}</Tag>
      }
    },
    {
      title: '操作',
      width: 280,
      render: (_, record) => (
        <Space size={8}>
          <Button
            type="outline"
            size="small"
            onClick={() => handleEdit(record)}
            disabled={record.isDeleted}
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
            status="warning"
            onClick={() => handleExecute(record.id)}
            disabled={record.isDeleted || !record.isActive}
          >
            立即执行
          </Button>
          <Button
            type="outline"
            size="small"
            status="danger"
            onClick={() => handleDelete(record.id)}
            disabled={record.isDeleted}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  const newsSyncColumns = [
    {
      title: '应用名称',
      dataIndex: 'appName',
      width: 150
    },
    {
      title: '新闻接口类型',
      dataIndex: 'interfaceType',
      width: 120
    },
    {
      title: '请求地址',
      dataIndex: 'requestUrl',
      width: 300,
      ellipsis: true,
      tooltip: true
    },
    {
      title: 'Cron表达式',
      dataIndex: 'cronExpression',
      width: 200,
      render: (text, record) => {
        // 兼容旧数据：如果有 send_frequency，显示旧的格式
        if (record.sendFrequency && !text) {
          const typeMap = { 'daily': '每天', 'weekly': '每周', 'monthly': '每月' }
          let displayText = `${typeMap[record.sendFrequency] || record.sendFrequency} - ${formatTime(record.sendTime || '')}`
          if (record.sendFrequency === 'weekly' && record.weekday) {
            displayText += ` (${getWeekdayName(record.weekday)})`
          }
          if (record.sendFrequency === 'monthly' && record.monthDay) {
            displayText += ` (${getMonthDayName(record.monthDay)})`
          }
          return displayText
        }
        return formatCronExpression(text)
      }
    },
    {
      title: '下次执行时间',
      dataIndex: 'nextExecutionTime',
      width: 180,
      render: (text) => text ? formatDate(text) : '-'
    },
    {
      title: '最后同步时间',
      dataIndex: 'lastSyncTime',
      width: 180,
      render: (text) => text ? formatDate(text) : '-'
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 100,
      render: (isActive) => <Tag color={isActive ? 'green' : 'red'}>{isActive ? '启用' : '禁用'}</Tag>
    },
    {
      title: '操作',
      width: 320,
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
            status="warning"
            onClick={() => handleCopy(record)}
          >
            复制
          </Button>
          <Button
            type="outline"
            size="small"
            status="warning"
            onClick={() => handleExecute(record.id)}
            disabled={!record.isActive}
          >
            立即执行
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
    <div className="scheduled-task-management">
      <Card className="management-card" bordered={false}>
        <div className="management-header">
          <h2 className="management-title">定时任务管理</h2>
          <Space>
            {activeTab === 'news_sync' && (
              <Button type="primary" onClick={handleAddNew}>
                新增
              </Button>
            )}
            <Button onClick={fetchTasks} loading={loading}>
              刷新
            </Button>
          </Space>
        </div>

        <Tabs
          activeTab={activeTab}
          onChange={(key) => {
            setActiveTab(key)
            setCurrentPage(1)
          }}
          type="line"
          className="task-tabs"
        >
          <TabPane key="email" title="邮件发送舆情">
            <div className="table-container">
              {loading && tasks.length === 0 ? (
                <Skeleton
                  loading={true}
                  animation={true}
                  text={{ rows: 8, width: ['100%'] }}
                />
              ) : (
                <Table
                  columns={emailColumns}
                  data={tasks.filter(task => !task.isDeleted)}
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
          </TabPane>

          <TabPane key="news_sync" title="新闻接口同步">
            <div className="table-container">
              {loading && tasks.length === 0 ? (
                <Skeleton
                  loading={true}
                  animation={true}
                  text={{ rows: 8, width: ['100%'] }}
                />
              ) : (
                <Table
                  columns={newsSyncColumns}
                  data={tasks}
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
          </TabPane>

          <TabPane key="ai_analysis" title="AI分析定时任务">
            <div className="ai-analysis-config">
              {aiAnalysisLoading ? (
                <Spin style={{ width: '100%', padding: '40px' }} />
              ) : (
                <div>
                  <div style={{ marginBottom: '24px' }}>
                    <h4 style={{ marginBottom: '16px' }}>AI分析定时任务配置</h4>
                    <Card className="info-card" style={{ marginBottom: '16px' }}>
                      <p style={{ margin: '0 0 8px 0', color: '#4e5969' }}>
                        此定时任务用于自动检查并重新分析新闻摘要为空的新闻数据，确保所有有效新闻都有摘要内容。
                      </p>
                      <p style={{ margin: '0', color: '#86909c', fontSize: '14px' }}>
                        执行频率：每天执行一次
                      </p>
                    </Card>
                    <Form
                      initialValues={aiAnalysisConfig}
                      layout="vertical"
                      style={{ maxWidth: 600 }}
                    >
                      <FormItem
                        label="定时任务规则"
                        field="cron_expression"
                        rules={[{ required: true, message: '请配置定时任务规则' }]}
                        extra='点击"配置"按钮设置定时任务的执行规则，支持秒/分/时/日/月/周/年7个维度的可视化配置'
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <Input
                            value={aiAnalysisConfig.cron_expression}
                            readOnly
                            placeholder="请配置Cron表达式"
                            style={{ flex: 1 }}
                          />
                          <Button
                            type="primary"
                            onClick={() => setShowCronModal(true)}
                          >
                            配置
                          </Button>
                        </div>
                      </FormItem>
                      <FormItem
                        label="启用定时任务"
                        field="isActive"
                      >
                        <Switch
                          checked={aiAnalysisConfig.isActive}
                          onChange={(checked) => setAiAnalysisConfig({ ...aiAnalysisConfig, isActive: checked })}
                        />
                      </FormItem>
                      <FormItem>
                        <Space>
                          <Button
                            type="primary"
                            onClick={handleSaveAiAnalysisConfig}
                            loading={aiAnalysisLoading}
                          >
                            保存
                          </Button>
                          <Button
                            onClick={fetchAiAnalysisConfig}
                            disabled={aiAnalysisLoading}
                          >
                            刷新
                          </Button>
                          <Button
                            type="outline"
                            status="success"
                            onClick={handleExecuteAiAnalysis}
                            disabled={aiAnalysisLoading}
                          >
                            立即执行
                          </Button>
                        </Space>
                      </FormItem>
                    </Form>
                  </div>
                </div>
              )}
            </div>
          </TabPane>
        </Tabs>
      </Card>

      {/* Cron表达式配置弹窗 */}
      {showCronModal && (
        <CronGenerator
          visible={showCronModal}
          value={aiAnalysisConfig.cron_expression}
          onChange={(cron) => {
            setAiAnalysisConfig({
              ...aiAnalysisConfig,
              cron_expression: cron
            })
            setShowCronModal(false)
          }}
          onCancel={() => setShowCronModal(false)}
        />
      )}

      {/* 编辑任务弹窗 */}
      <Modal
        visible={showEditModal}
        title={activeTab === 'email' ? (isNewTask ? '新增定时任务' : '编辑定时任务') : (isCopyTask ? '复制新闻接口同步' : (isNewTask ? '新增新闻接口同步' : '编辑新闻接口同步'))}
        onCancel={() => {
          setShowEditModal(false)
          setEditingTask(null)
          setIsNewTask(false)
          setIsCopyTask(false)
          setOriginalCopyData(null)
        }}
        footer={null}
        style={{ width: 600 }}
      >
        <Form
          initialValues={formData}
          onSubmit={handleSave}
          layout="vertical"
        >
          {activeTab === 'email' && editingTask && (
            <Card className="info-card" style={{ marginBottom: '16px' }}>
              <p><strong>用户账号：</strong>{editingTask.userAccount || '-'}</p>
              <p><strong>收件人邮箱：</strong>{editingTask.recipientEmail || '-'}</p>
              <p><strong>邮件主题：</strong>{editingTask.emailSubject || '-'}</p>
            </Card>
          )}

          {activeTab === 'news_sync' && (
            <>
              <FormItem
                label="应用名称"
                field="app_id"
                rules={[{ required: true, message: '请选择应用' }]}
              >
                <Select
                  placeholder="请选择应用"
                  onChange={(value) => {
                    const selectedApp = applications.find(app => app.id === value)
                    setFormData({ 
                      ...formData, 
                      app_id: value,
                      app_name: selectedApp ? selectedApp.app_name : ''
                    })
                  }}
                >
                  {applications.map(app => (
                    <Option key={app.id} value={app.id}>{app.app_name}</Option>
                  ))}
                </Select>
              </FormItem>
              <FormItem
                label="新闻接口类型"
                field="interface_type"
                rules={[{ required: true, message: '请选择接口类型' }]}
              >
                <Select>
                  <Option value="新榜">新榜</Option>
                  <Option value="企查查">企查查</Option>
                </Select>
              </FormItem>
              <FormItem
                label="请求地址"
                field="request_url"
                rules={[{ required: true, message: '请输入请求地址' }]}
              >
                <Input placeholder="请输入请求地址" />
              </FormItem>
            </>
          )}

          <FormItem
            label={activeTab === 'email' ? '发送频率' : '同步频率'}
            field="send_frequency"
            rules={[{ required: true, message: '请选择频率' }]}
          >
            <Select>
              <Option value="daily">每天</Option>
              <Option value="weekly">每周</Option>
              <Option value="monthly">每月</Option>
            </Select>
          </FormItem>

          {activeTab === 'news_sync' && formData.send_frequency === 'weekly' && (
            <FormItem
              label="星期"
              field="weekday"
              rules={[{ required: true, message: '请选择星期' }]}
            >
              <Select>
                <Option value="monday">星期一</Option>
                <Option value="tuesday">星期二</Option>
                <Option value="wednesday">星期三</Option>
                <Option value="thursday">星期四</Option>
                <Option value="friday">星期五</Option>
                <Option value="saturday">星期六</Option>
                <Option value="sunday">星期日</Option>
              </Select>
            </FormItem>
          )}

          {activeTab === 'news_sync' && formData.send_frequency === 'monthly' && (
            <FormItem
              label="日期"
              field="month_day"
              rules={[{ required: true, message: '请选择日期' }]}
            >
              <Select>
                <Option value="first">第一天</Option>
                <Option value="last">最后一天</Option>
                <Option value="15">15日</Option>
              </Select>
            </FormItem>
          )}

          <FormItem
            label={activeTab === 'email' ? '发送时间' : '同步时间'}
            field="send_time"
            rules={[{ required: true, message: '请选择时间' }]}
          >
            <Input
              type="time"
              value={formData.send_time ? formData.send_time.substring(0, 5) : '00:00'}
              onChange={(value) => setFormData({ ...formData, send_time: value + ':00' })}
            />
          </FormItem>

          <FormItem
            label="启用"
            field="is_active"
          >
            <Switch checked={formData.is_active} />
          </FormItem>

          <FormItem
            label="跳过节假日"
            field="skip_holiday"
            extra="开启后，定时任务在节假日将不会执行"
          >
            <Switch checked={formData.skip_holiday} />
          </FormItem>

          {activeTab === 'news_sync' && (
            <>
              <FormItem
                label="重新抓取次数"
                field="retry_count"
                extra="当接口调用后未返回任何数据时，将根据此配置进行重试。设置为0表示不重试。"
              >
                <InputNumber min={0} placeholder="未获取数据时的重新抓取次数" />
              </FormItem>
              <FormItem
                label="重新抓取间隔（分钟）"
                field="retry_interval"
                extra="每次重试之间的等待时间（单位：分钟）。例如设置为5，表示在第一次调用后5分钟再次调用。"
              >
                <InputNumber min={0} placeholder="重新抓取的时间间隔" />
              </FormItem>
            </>
          )}

          <div className="form-actions">
            <Button
              type="secondary"
              onClick={() => {
                setShowEditModal(false)
                setEditingTask(null)
                setIsNewTask(false)
                setIsCopyTask(false)
                setOriginalCopyData(null)
              }}
            >
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
          </div>
        </Form>
      </Modal>

      {/* 日志弹窗 */}
      <TaskLogModal
        taskId={logTaskId}
        taskType={activeTab === 'email' ? 'email' : 'news_sync'}
        onClose={() => {
          setShowLogModal(false)
          setLogTaskId(null)
        }}
      />

      {/* 执行进度弹窗 */}
      {showProgressModal && progressTaskId && (
        <TaskProgressModal
          taskId={progressTaskId}
          taskType={activeTab === 'email' ? 'email' : 'news_sync'}
          onClose={() => {
            setShowProgressModal(false)
            setProgressTaskId(null)
            fetchTasks()
          }}
        />
      )}
    </div>
  )
}

export default ScheduledTaskManagement

