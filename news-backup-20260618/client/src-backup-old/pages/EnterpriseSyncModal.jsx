import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import './EnterpriseSyncModal.css'

function EnterpriseSyncModal({ onClose, onSuccess }) {
  const [databases, setDatabases] = useState([])
  const [formData, setFormData] = useState({
    db_config_id: '',
    sql_query: '',
    cron_expression: '0 0 * * *',
    description: '',
    schedule_time: '00:00'
  })
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [savedTask, setSavedTask] = useState(null) // 已保存的任务信息

  useEffect(() => {
    fetchDatabases()
  }, [])

  const fetchDatabases = async () => {
    try {
      const response = await axios.get('/api/system/database-configs', {
        params: { page: 1, pageSize: 100 }
      })
      if (response.data.success) {
        const activeDatabases = (response.data.data || []).filter(db => db.is_active === 1 || db.is_active === true)
        setDatabases(activeDatabases)
        if (activeDatabases.length === 0) {
          console.warn('没有启用的数据库配置')
        }
      } else {
        console.error('获取数据库列表失败:', response.data.message)
        setDatabases([])
      }
    } catch (error) {
      console.error('获取数据库列表失败:', error)
      setDatabases([])
      // 不显示alert，避免干扰用户操作
      // alert('获取数据库列表失败：' + (error.response?.data?.message || error.message))
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    const newFormData = {
      ...formData,
      [name]: value
    }
    setFormData(newFormData)
    
    // 如果选择了数据库，自动加载已保存的任务
    if (name === 'db_config_id' && value) {
      fetchSavedTask(value)
    } else if (name === 'db_config_id' && !value) {
      // 清空选择时，清空已保存的任务
      setSavedTask(null)
      setFormData({
        ...newFormData,
        sql_query: '',
        cron_expression: '0 0 * * *',
        schedule_time: '00:00',
        description: ''
      })
    }
  }

  // 获取已保存的任务
  const fetchSavedTask = async (dbConfigId) => {
    try {
      const response = await axios.get(`/api/enterprises/sync-task/by-db/${dbConfigId}`)
      if (response.data.success && response.data.data) {
        const task = response.data.data
        setSavedTask(task)
        // 自动填充已保存的SQL和时间
        const cron = task.cron_expression || '0 0 * * *'
        const [minutes, hours] = cron.split(' ')
        const time = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`
        setFormData(prev => ({
          ...prev,
          db_config_id: dbConfigId, // 确保数据库ID已设置
          sql_query: task.sql_query || '',
          cron_expression: cron,
          schedule_time: time,
          description: task.description || ''
        }))
      } else {
        setSavedTask(null)
      }
    } catch (error) {
      // 如果没有找到任务，不显示错误，只是清空已保存的任务
      setSavedTask(null)
    }
  }

  const convertTimeToCron = (time) => {
    // 将 HH:mm 格式转换为 cron 表达式 (每天执行)
    const [hours, minutes] = time.split(':')
    return `${minutes} ${hours} * * *`
  }

  const handleTimeChange = (e) => {
    const time = e.target.value
    const cron = convertTimeToCron(time)
    setFormData({
      ...formData,
      schedule_time: time,
      cron_expression: cron
    })
  }

  const handleSave = async () => {
    if (!formData.db_config_id) {
      if (databases.length === 0) {
        alert('没有可用的数据库配置，请先到"系统配置" -> "数据库连接"中添加数据库配置')
      } else {
        alert('请先选择数据库')
      }
      return
    }
    if (!formData.sql_query || !formData.cron_expression) {
      alert('请填写所有必填字段')
      return
    }

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = formData.sql_query.trim().toUpperCase()
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      alert('SQL语句必须以SELECT或WITH开头')
      return
    }

    setLoading(true)
    try {
      const response = await axios.post('/api/enterprises/sync-task', {
        db_config_id: formData.db_config_id,
        sql_query: formData.sql_query,
        cron_expression: formData.cron_expression,
        description: formData.description || '被投企业数据同步任务'
      })

      if (response.data.success) {
        alert('保存成功')
        if (onSuccess) {
          onSuccess()
        }
        onClose()
      }
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  const handleManualExecute = async () => {
    if (!formData.db_config_id) {
      if (databases.length === 0) {
        alert('没有可用的数据库配置，请先到"系统配置" -> "数据库连接"中添加数据库配置')
      } else {
        alert('请先选择数据库')
      }
      return
    }

    // 如果SQL为空，尝试使用已保存的SQL
    let sqlToExecute = formData.sql_query
    if (!sqlToExecute || sqlToExecute.trim() === '') {
      if (savedTask && savedTask.sql_query) {
        sqlToExecute = savedTask.sql_query
      } else {
        alert('请先输入SQL代码或保存定时任务')
        return
      }
    }

    // 验证SQL语句（支持WITH语句和SELECT语句）
    const sql = sqlToExecute.trim().toUpperCase()
    if (!sql.startsWith('SELECT') && !sql.startsWith('WITH')) {
      alert('SQL语句必须以SELECT或WITH开头')
      return
    }

    if (!window.confirm('确定要手动执行数据同步吗？')) {
      return
    }

    setExecuting(true)
    try {
      // 如果使用已保存的SQL，可以不传sql_query，后端会自动从数据库读取
      const response = await axios.post('/api/enterprises/sync-task/execute', {
        db_config_id: formData.db_config_id,
        sql_query: sqlToExecute // 如果为空，后端会从数据库读取
      })

      if (response.data.success) {
        alert('执行成功！\n' + (response.data.message || ''))
        if (onSuccess) {
          onSuccess()
        }
      }
    } catch (error) {
      console.error('执行失败:', error)
      alert('执行失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="enterprise-sync-modal-overlay">
      <div className="enterprise-sync-modal-content">
        <div className="enterprise-sync-modal-header">
          <h3>定时更新配置</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="enterprise-sync-modal-body">
          <div className="form-group">
            <label>选择数据库 *</label>
            <select
              name="db_config_id"
              value={formData.db_config_id}
              onChange={handleChange}
              required
              className="form-select"
              disabled={databases.length === 0}
            >
              <option value="">
                {databases.length === 0 ? '暂无可用的数据库配置，请先在系统配置中添加数据库连接' : '请选择数据库'}
              </option>
              {databases.map((db) => (
                <option key={db.id} value={db.id}>
                  {db.name} ({db.host}:{db.port}/{db.database})
                </option>
              ))}
            </select>
            <p className="form-hint">
              {databases.length === 0 
                ? '没有可用的数据库配置，请先到"系统配置" -> "数据库连接"中添加数据库配置' 
                : '选择要连接的外部数据库'}
            </p>
            {savedTask && (
              <div style={{ marginTop: '8px', padding: '8px', background: '#e7f3ff', borderRadius: '4px', fontSize: '12px', color: '#0066cc' }}>
                ✓ 已加载已保存的任务：{savedTask.description || '无描述'}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>SQL查询语句 *</label>
            <textarea
              name="sql_query"
              value={formData.sql_query}
              onChange={handleChange}
              placeholder="请输入SELECT查询语句，查询结果将同步到被投企业表"
              rows="8"
              required
              className="form-textarea"
            />
            <p className="form-hint">
              请输入SELECT或WITH查询语句。支持WITH语句的复杂查询（CTE，公共表表达式）。
              <br />
              查询结果字段需要匹配被投企业表的字段：
              <br />
              项目编号(project_number)、项目简称(project_abbreviation)、被投企业全称(enterprise_full_name)、
              <br />
              统一信用代码(unified_credit_code)、企业公众号id(wechat_official_account_id)、
              <br />
              企业官网(official_website)、退出状态(exit_status)
            </p>
          </div>

          <div className="form-group">
            <label>定时更新时间 *</label>
            <input
              type="time"
              name="schedule_time"
              value={formData.schedule_time}
              onChange={handleTimeChange}
              required
              className="form-time"
            />
            <p className="form-hint">设置每天执行的时间，格式：HH:mm（如：00:00 表示每天凌晨执行）</p>
          </div>

          <div className="form-group">
            <label>任务描述</label>
            <input
              type="text"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="例如：每天凌晨同步被投企业数据"
              className="form-input"
            />
          </div>

          <div className="form-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={loading || executing}
            >
              取消
            </button>
            <button
              type="button"
              className="btn-execute"
              onClick={handleManualExecute}
              disabled={loading || executing}
            >
              {executing ? '执行中...' : '手动执行'}
            </button>
            <button
              type="button"
              className="btn-save"
              onClick={handleSave}
              disabled={loading || executing}
            >
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EnterpriseSyncModal

