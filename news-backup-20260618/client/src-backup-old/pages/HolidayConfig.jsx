import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from '../utils/axios'
import Pagination from '../components/Pagination'
import './HolidayConfig.css'

const WORKDAY_TYPES = [
  { value: '法定节假日', label: '法定节假日' },
  { value: '周末', label: '周末' },
  { value: '调休', label: '调休' },
  { value: '工作日', label: '工作日' }
]

const pad2 = (num) => String(num).padStart(2, '0')

const formatDateForInput = (value) => {
  if (!value) return ''

  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = pad2(value.getMonth() + 1)
    const day = pad2(value.getDate())
    return `${year}-${month}-${day}`
  }

  if (typeof value === 'string') {
    if (value.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.slice(0, 10)
    }
    const normalized = value
      .replace(/[年\/\\.]/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/--+/g, '-')
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) {
      const date = new Date(normalized)
      if (!Number.isNaN(date.getTime())) {
        return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
      }
    }
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
  }

  return ''
}

const initialFormState = {
  holiday_date: '',
  is_workday: '0',
  workday_type: '法定节假日',
  holiday_name: ''
}

const currentYear = new Date().getFullYear()

function HolidayConfig() {
  const initialFilters = useMemo(() => ({
    year: '',
    month: '',
    isWorkday: '',
    workdayType: '',
    keyword: ''
  }), [])

  const [filters, setFilters] = useState(initialFilters)
  const [filterDraft, setFilterDraft] = useState(initialFilters)
  const [holidays, setHolidays] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState(initialFormState)
  const [currentHoliday, setCurrentHoliday] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState([])
  const fileInputRef = useRef(null)
  const [yearOptions, setYearOptions] = useState([])
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generateYear, setGenerateYear] = useState(String(currentYear))
  const [generating, setGenerating] = useState(false)
  const [showLogModal, setShowLogModal] = useState(false)
  const [logRecords, setLogRecords] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [logTarget, setLogTarget] = useState(null)

  useEffect(() => {
    fetchYearOptions()
  }, [])

  useEffect(() => {
    fetchHolidays()
  }, [filters, pagination.page, pagination.pageSize])
  const fetchYearOptions = async () => {
    try {
      const response = await axios.get('/api/system/holidays/years')
      if (response.data.success) {
        const years = (response.data.data || []).map((year) => String(year))
        setYearOptions(years)
        if (years.length > 0) {
          setFilters((prev) => {
            if (prev.year) return prev
            return { ...prev, year: years[0] }
          })
          setFilterDraft((prev) => {
            if (prev.year) return prev
            return { ...prev, year: years[0] }
          })
          setGenerateYear(years[0])
        } else {
          setGenerateYear(String(currentYear))
        }
      }
    } catch (err) {
      console.error('获取年份列表失败:', err)
    }
  }


  const fetchHolidays = async () => {
    setLoading(true)
    setError('')
    try {
      const params = {
        page: pagination.page,
        pageSize: pagination.pageSize
      }
      if (filters.year) params.year = filters.year
      if (filters.month) params.month = filters.month
      if (filters.isWorkday !== '') params.isWorkday = filters.isWorkday
      if (filters.workdayType) params.workdayType = filters.workdayType
      if (filters.keyword.trim() !== '') params.keyword = filters.keyword.trim()

      const response = await axios.get('/api/system/holidays', { params })
      if (response.data.success) {
        setHolidays(response.data.data || [])
        setPagination((prev) => ({
          ...prev,
          total: response.data.total || 0
        }))
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取节假日数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (page) => {
    setPagination((prev) => ({
      ...prev,
      page
    }))
  }

  const handleFilterDraftChange = (e) => {
    const { name, value } = e.target
    setFilterDraft((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handleApplyFilters = () => {
    setFilters({ ...filterDraft })
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const handleResetFilters = () => {
    setFilterDraft(initialFilters)
    setFilters(initialFilters)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  const handleAdd = () => {
    setCurrentHoliday(null)
    setFormData(initialFormState)
    setShowModal(true)
    setMessage('')
    setError('')
  }

  const handleOpenGenerate = () => {
    setGenerateYear(filters.year || String(currentYear))
    setShowGenerateModal(true)
    setMessage('')
    setError('')
  }

  const handleEdit = (holiday) => {
    setCurrentHoliday(holiday)
    setFormData({
      holiday_date: formatDateForInput(holiday.holiday_date),
      is_workday: String(holiday.is_workday),
      workday_type: holiday.workday_type,
      holiday_name: holiday.holiday_name || ''
    })
    setShowModal(true)
    setMessage('')
    setError('')
  }

  const handleGenerateSubmit = async (e) => {
    e.preventDefault()
    setGenerating(true)
    setError('')
    try {
      const response = await axios.post('/api/system/holidays/generate', { year: generateYear })
      if (response.data.success) {
        setMessage(response.data.message || '生成成功')
        setShowGenerateModal(false)
        fetchHolidays()
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        setError(err.response.data.errors.map((item) => item.msg).join('；'))
      } else {
        setError(err.response?.data?.message || '生成失败')
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleDelete = async (holiday) => {
    if (!window.confirm(`确定要删除 ${holiday.holiday_date} 的节假日记录吗？`)) {
      return
    }
    try {
      const response = await axios.delete(`/api/system/holidays/${holiday.id}`)
      if (response.data.success) {
        setMessage(response.data.message || '删除成功')
        fetchHolidays()
      }
    } catch (err) {
      setError(err.response?.data?.message || '删除失败')
    }
  }

  const handleFormChange = (e) => {
    const { name, value } = e.target
    if (name === 'is_workday') {
      const normalized = value
      setFormData((prev) => {
        let nextType = prev.workday_type
        if (normalized === '1' && (prev.workday_type === '法定节假日' || prev.workday_type === '周末')) {
          nextType = '工作日'
        }
        if (normalized === '0' && prev.workday_type === '工作日') {
          nextType = '法定节假日'
        }
        return {
          ...prev,
          [name]: normalized,
          workday_type: nextType
        }
      })
      return
    }
    setFormData((prev) => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const payload = {
        ...formData,
        is_workday: Number(formData.is_workday)
      }
      let response
      if (currentHoliday) {
        response = await axios.put(`/api/system/holidays/${currentHoliday.id}`, payload)
      } else {
        response = await axios.post('/api/system/holidays', payload)
      }
      if (response.data.success) {
        setMessage(response.data.message || '保存成功')
        setShowModal(false)
        fetchHolidays()
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        setError(err.response.data.errors.map((item) => item.msg).join('；'))
      } else {
        setError(err.response?.data?.message || '保存失败')
      }
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const response = await axios.get('/api/system/holidays/template', {
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '节假日维护模板.xlsx')
      document.body.appendChild(link)
      link.click()
      link.parentNode.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.response?.data?.message || '模板下载失败')
    }
  }

  const triggerImport = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  const handleImportFile = async (e) => {
    const file = e.target.files[0]
    if (!file) {
      return
    }
    const formDataToSend = new FormData()
    formDataToSend.append('file', file)
    setImporting(true)
    setImportErrors([])
    setMessage('')
    setError('')
    try {
      const response = await axios.post('/api/system/holidays/import', formDataToSend, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
      setMessage(response.data.message || '导入成功')
      setImportErrors(response.data.errors || [])
      fetchHolidays()
    } catch (err) {
      setError(err.response?.data?.message || '导入失败')
    } finally {
      setImporting(false)
      e.target.value = ''
    }
  }

  const openLogModal = async (holiday) => {
    setLogTarget(holiday)
    setShowLogModal(true)
    setLogLoading(true)
    setLogRecords([])
    setError('')
    try {
      const response = await axios.get(`/api/system/holidays/${holiday.id}/logs`)
      if (response.data.success) {
        setLogRecords(response.data.data || [])
      }
    } catch (err) {
      setError(err.response?.data?.message || '获取日志失败')
    } finally {
      setLogLoading(false)
    }
  }

  const totalPages = Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)
  return (
    <div className="holiday-config">
      <div className="holiday-toolbar">
        <div className="holiday-filters">
          <div className="filter-item">
            <label>年份</label>
            <select name="year" value={filterDraft.year} onChange={handleFilterDraftChange}>
              <option value="">全部</option>
              {yearOptions.map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>月份</label>
            <select name="month" value={filterDraft.month} onChange={handleFilterDraftChange}>
              <option value="">全部</option>
              {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => (
                <option key={month} value={month}>{month < 10 ? `0${month}` : month}</option>
              ))}
            </select>
          </div>
          <div className="filter-item">
            <label>是否工作日</label>
            <select name="isWorkday" value={filterDraft.isWorkday} onChange={handleFilterDraftChange}>
              <option value="">全部</option>
              <option value="1">是</option>
              <option value="0">否</option>
            </select>
          </div>
          <div className="filter-item">
            <label>工作日类型</label>
            <select name="workdayType" value={filterDraft.workdayType} onChange={handleFilterDraftChange}>
              <option value="">全部</option>
              {WORKDAY_TYPES.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <div className="filter-item keyword">
            <label>关键词</label>
            <input
              type="text"
              name="keyword"
              placeholder="节日名称/日期"
              value={filterDraft.keyword}
              onChange={handleFilterDraftChange}
            />
          </div>
          <div className="filter-actions">
            <button className="btn-primary" onClick={handleApplyFilters}>查询</button>
            <button className="btn-secondary" onClick={handleResetFilters}>重置</button>
          </div>
        </div>
        <div className="holiday-actions">
          <button className="btn-secondary" onClick={handleOpenGenerate}>生成假日</button>
          <button className="btn-primary" onClick={handleAdd}>新增</button>
          <button className="btn-secondary" onClick={triggerImport} disabled={importing}>
            {importing ? '导入中...' : '导入'}
          </button>
          <button className="btn-link" onClick={handleDownloadTemplate}>下载模板</button>
          <button className="btn-link" onClick={() => fetchHolidays()}>刷新</button>
          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
        </div>
      </div>

      {(message || error) && (
        <div className={`holiday-message ${error ? 'error' : 'success'}`}>
          {error || message}
        </div>
      )}

      {importErrors.length > 0 && (
        <div className="holiday-import-errors">
          <strong>部分数据导入失败：</strong>
          <ul>
            {importErrors.map((item) => (
              <li key={`${item.row}-${item.message}`}>
                第 {item.row} 行：{item.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="holiday-table">
        <table>
          <thead>
            <tr>
              <th>日期</th>
              <th>是否工作日</th>
              <th>工作日类型</th>
              <th>节日名称</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5" className="table-empty">数据加载中...</td>
              </tr>
            ) : holidays.length === 0 ? (
              <tr>
                <td colSpan="5" className="table-empty">暂无数据</td>
              </tr>
            ) : (
              holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td>{formatDateForInput(holiday.holiday_date)}</td>
                  <td>
                    <span className={`tag ${holiday.is_workday ? 'workday' : 'rest'}`}>
                      {holiday.is_workday ? '是' : '否'}
                    </span>
                  </td>
                  <td>{holiday.workday_type}</td>
                  <td>{holiday.holiday_name || '—'}</td>
                  <td className="table-actions">
                    <button onClick={() => handleEdit(holiday)}>编辑</button>
                    <button className="danger" onClick={() => handleDelete(holiday)}>删除</button>
                    <button onClick={() => openLogModal(holiday)}>日志</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {holidays.length > 0 && (
        <Pagination
          currentPage={pagination.page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />
      )}

      {showModal && (
        <div className="holiday-modal-overlay">
          <div className="holiday-modal">
            <div className="modal-header">
              <h3>{currentHoliday ? '编辑节假日' : '新增节假日'}</h3>
              <button className="close-button" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-content">
                <div className="form-group">
                  <label>日期</label>
                  <input
                    type="date"
                    name="holiday_date"
                    value={formData.holiday_date}
                    onChange={handleFormChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>是否工作日</label>
                  <select name="is_workday" value={formData.is_workday} onChange={handleFormChange}>
                    <option value={1}>是</option>
                    <option value={0}>否</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>工作日类型</label>
                  <select name="workday_type" value={formData.workday_type} onChange={handleFormChange}>
                    {WORKDAY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>节日名称</label>
                  <input
                    type="text"
                    name="holiday_name"
                    placeholder="普通周末可留空"
                    value={formData.holiday_name}
                    onChange={handleFormChange}
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showGenerateModal && (
        <div className="holiday-modal-overlay">
          <div className="holiday-modal small">
            <div className="modal-header">
              <h3>生成全年周末假日</h3>
              <button className="close-button" onClick={() => setShowGenerateModal(false)}>×</button>
            </div>
            <form onSubmit={handleGenerateSubmit}>
              <div className="modal-content">
                <div className="form-group">
                  <label>选择年份</label>
                  <select value={generateYear} onChange={(e) => setGenerateYear(e.target.value)}>
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <p style={{ fontSize: '12px', color: '#666' }}>
                  将自动生成该年度所有周六、周日记录（若已存在则跳过）。
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowGenerateModal(false)}>
                  取消
                </button>
                <button type="submit" className="btn-primary" disabled={generating}>
                  {generating ? '生成中...' : '开始生成'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showLogModal && (
        <div className="holiday-modal-overlay">
          <div className="holiday-modal log-modal">
            <div className="modal-header">
              <h3>操作日志 - {logTarget ? formatDateForInput(logTarget.holiday_date) : ''}</h3>
              <button className="close-button" onClick={() => setShowLogModal(false)}>×</button>
            </div>
            <div className="modal-content log-content">
              {logLoading ? (
                <div className="log-empty">日志加载中...</div>
              ) : logRecords.length === 0 ? (
                <div className="log-empty">暂无操作日志</div>
              ) : (
                <ul className="log-list">
                  {logRecords.map((log) => (
                    <li key={log.id}>
                      <div>
                        <strong>{log.change_user_account || '系统'}</strong> 在 {new Date(log.change_time).toLocaleString()}
                      </div>
                      <div>
                        字段「{log.changed_field}」由「{log.old_value || '空'}」改为「{log.new_value || '空'}」
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setShowLogModal(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default HolidayConfig


