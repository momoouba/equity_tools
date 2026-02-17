import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Table, Button, Space, Pagination, Modal, Message, Skeleton, Tag, Input, Select, DatePicker, Collapse, Upload } from '@arco-design/web-react'
import axios from '../utils/axios'
import './HolidayConfig.css'

const Option = Select.Option
const CollapseItem = Collapse.Item

const WORKDAY_TYPES = [
  { value: '法定节假日', label: '法定节假日' },
  { value: '周末', label: '周末' },
  { value: '调休', label: '调休' },
  { value: '工作日', label: '工作日' }
]

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
  const [showModal, setShowModal] = useState(false)
  const [formData, setFormData] = useState({
    holiday_date: '',
    is_workday: '0',
    workday_type: '法定节假日',
    holiday_name: ''
  })
  const [currentHoliday, setCurrentHoliday] = useState(null)
  const [importing, setImporting] = useState(false)
  const [yearOptions, setYearOptions] = useState([])
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [generateYear, setGenerateYear] = useState(String(currentYear))
  const [generating, setGenerating] = useState(false)
  const [filterCollapsed, setFilterCollapsed] = useState(true)

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
      Message.error(err.response?.data?.message || '获取节假日数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAdd = () => {
    setCurrentHoliday(null)
    setFormData({
      holiday_date: '',
      is_workday: '0',
      workday_type: '法定节假日',
      holiday_name: ''
    })
    setShowModal(true)
  }

  const handleEdit = (holiday) => {
    setCurrentHoliday(holiday)
    setFormData({
      holiday_date: holiday.holiday_date,
      is_workday: String(holiday.is_workday),
      workday_type: holiday.workday_type,
      holiday_name: holiday.holiday_name || ''
    })
    setShowModal(true)
  }

  const handleDelete = async (holiday) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 ${holiday.holiday_date} 的节假日记录吗？`,
      onOk: async () => {
        try {
          const response = await axios.delete(`/api/system/holidays/${holiday.id}`)
          if (response.data.success) {
            Message.success('删除成功')
            fetchHolidays()
          }
        } catch (err) {
          Message.error(err.response?.data?.message || '删除失败')
        }
      }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
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
        Message.success('保存成功')
        setShowModal(false)
        fetchHolidays()
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        Message.error(err.response.data.errors.map((item) => item.msg).join('；'))
      } else {
        Message.error(err.response?.data?.message || '保存失败')
      }
    }
  }

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const response = await axios.post('/api/system/holidays/generate', { year: generateYear })
      if (response.data.success) {
        Message.success('生成成功')
        setShowGenerateModal(false)
        fetchHolidays()
        fetchYearOptions()
      }
    } catch (err) {
      if (err.response?.data?.errors) {
        Message.error(err.response.data.errors.map((item) => item.msg).join('；'))
      } else {
        Message.error(err.response?.data?.message || '生成失败')
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleImport = async (file) => {
    setImporting(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await axios.post('/api/system/holidays/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data.success) {
        Message.success(`导入成功：成功 ${response.data.success_count || 0} 条，失败 ${response.data.fail_count || 0} 条`)
        fetchHolidays()
        fetchYearOptions()
      } else {
        Message.error('导入失败：' + (response.data.message || '未知错误'))
      }
    } catch (error) {
      Message.error('导入失败：' + (error.response?.data?.message || '未知错误'))
    } finally {
      setImporting(false)
    }
    return false
  }

  const handleDownloadTemplate = async () => {
    try {
      const response = await axios.get('/api/system/holidays/template', {
        responseType: 'blob'
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', '节假日模板.xlsx')
      document.body.appendChild(link)
      link.click()
      link.remove()
      Message.success('模板下载成功')
    } catch (error) {
      Message.error('模板下载失败')
    }
  }

  const handleFilterChange = (name, value) => {
    setFilterDraft(prev => ({
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

  const columns = [
    {
      title: '日期',
      dataIndex: 'holiday_date',
      width: 150
    },
    {
      title: '是否工作日',
      dataIndex: 'is_workday',
      width: 120,
      render: (isWorkday) => (
        <Tag color={isWorkday ? 'green' : 'red'}>
          {isWorkday ? '是' : '否'}
        </Tag>
      )
    },
    {
      title: '类型',
      dataIndex: 'workday_type',
      width: 150
    },
    {
      title: '节假日名称',
      dataIndex: 'holiday_name',
      width: 200,
      render: (text) => text || '-'
    },
    {
      title: '操作',
      width: 150,
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
            status="danger"
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  return (
    <div className="holiday-config">
      <div className="config-header">
        <h3>节假日维护</h3>
        <Space>
          <Button
            onClick={fetchHolidays}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            type="primary"
            onClick={handleAdd}
          >
            新增节假日
          </Button>
          <Button
            type="outline"
            onClick={() => setShowGenerateModal(true)}
          >
            生成节假日
          </Button>
          <Button
            type="outline"
            onClick={handleDownloadTemplate}
          >
            下载模板
          </Button>
          <Upload
            accept=".xlsx,.xls"
            beforeUpload={handleImport}
            showUploadList={false}
          >
            <Button
              type="outline"
              loading={importing}
            >
              批量导入
            </Button>
          </Upload>
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
              <div className="filter-item">
                <label>年份</label>
                <Select
                  value={filterDraft.year}
                  onChange={(value) => handleFilterChange('year', value)}
                  placeholder="请选择年份"
                  style={{ width: 150 }}
                  allowClear
                >
                  {yearOptions.map(year => (
                    <Option key={year} value={year}>{year}</Option>
                  ))}
                </Select>
              </div>

              <div className="filter-item">
                <label>月份</label>
                <Select
                  value={filterDraft.month}
                  onChange={(value) => handleFilterChange('month', value)}
                  placeholder="请选择月份"
                  style={{ width: 150 }}
                  allowClear
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                    <Option key={month} value={String(month).padStart(2, '0')}>
                      {month}月
                    </Option>
                  ))}
                </Select>
              </div>

              <div className="filter-item">
                <label>是否工作日</label>
                <Select
                  value={filterDraft.isWorkday}
                  onChange={(value) => handleFilterChange('isWorkday', value)}
                  placeholder="请选择"
                  style={{ width: 150 }}
                  allowClear
                >
                  <Option value="1">是</Option>
                  <Option value="0">否</Option>
                </Select>
              </div>

              <div className="filter-item">
                <label>类型</label>
                <Select
                  value={filterDraft.workdayType}
                  onChange={(value) => handleFilterChange('workdayType', value)}
                  placeholder="请选择类型"
                  style={{ width: 150 }}
                  allowClear
                >
                  {WORKDAY_TYPES.map(type => (
                    <Option key={type.value} value={type.value}>{type.label}</Option>
                  ))}
                </Select>
              </div>

              <div className="filter-item">
                <label>关键词</label>
                <Input
                  value={filterDraft.keyword}
                  onChange={(value) => handleFilterChange('keyword', value)}
                  placeholder="节假日名称"
                  style={{ width: 200 }}
                  allowClear
                />
              </div>

              <div className="filter-actions">
                <Button type="primary" onClick={handleApplyFilters}>
                  查询
                </Button>
                <Button type="outline" onClick={handleResetFilters}>
                  重置
                </Button>
              </div>
            </div>
          </div>
        </CollapseItem>
      </Collapse>

      <div className="table-container">
        {loading && holidays.length === 0 ? (
          <Skeleton
            loading={true}
            animation={true}
            text={{ rows: 8, width: ['100%'] }}
          />
        ) : (
          <Table
            columns={columns}
            data={holidays}
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

      {pagination.total > 0 && (
        <div className="pagination-wrapper">
          <Pagination
            current={pagination.page}
            total={pagination.total}
            pageSize={pagination.pageSize}
            onChange={(page) => setPagination(prev => ({ ...prev, page }))}
            showTotal
            showJumper
          />
        </div>
      )}

      <Modal
        visible={showModal}
        title={currentHoliday ? '编辑节假日' : '新增节假日'}
        onCancel={() => {
          setShowModal(false)
          setCurrentHoliday(null)
        }}
        footer={null}
        style={{ width: 500 }}
      >
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>日期 *</label>
            <DatePicker
              value={formData.holiday_date}
              onChange={(dateString, date) => {
                const dateStr = (dateString && typeof dateString === 'string')
                  ? dateString.trim()
                  : (date && typeof date?.format === 'function')
                    ? date.format('YYYY-MM-DD')
                    : ''
                setFormData(prev => ({ ...prev, holiday_date: dateStr }))
              }}
              format="YYYY-MM-DD"
              style={{ width: '100%' }}
            />
          </div>

          <div className="form-group">
            <label>是否工作日 *</label>
            <Select
              value={formData.is_workday}
              onChange={(value) => {
                setFormData(prev => {
                  let nextType = prev.workday_type
                  if (value === '1' && (prev.workday_type === '法定节假日' || prev.workday_type === '周末')) {
                    nextType = '工作日'
                  }
                  if (value === '0' && prev.workday_type === '工作日') {
                    nextType = '法定节假日'
                  }
                  return {
                    ...prev,
                    is_workday: value,
                    workday_type: nextType
                  }
                })
              }}
            >
              <Option value="0">否</Option>
              <Option value="1">是</Option>
            </Select>
          </div>

          <div className="form-group">
            <label>类型 *</label>
            <Select
              value={formData.workday_type}
              onChange={(value) => handleChange('workday_type', value)}
            >
              {WORKDAY_TYPES.map(type => (
                <Option key={type.value} value={type.value}>{type.label}</Option>
              ))}
            </Select>
          </div>

          <div className="form-group">
            <label>节假日名称</label>
            <Input
              value={formData.holiday_name}
              onChange={(value) => handleChange('holiday_name', value)}
              placeholder="请输入节假日名称（可选）"
            />
          </div>

          <div className="form-actions">
            <Button type="secondary" onClick={() => {
              setShowModal(false)
              setCurrentHoliday(null)
            }}>
              取消
            </Button>
            <Button type="primary" htmlType="submit">
              {currentHoliday ? '更新' : '创建'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        visible={showGenerateModal}
        title="生成节假日"
        onCancel={() => setShowGenerateModal(false)}
        footer={null}
        style={{ width: 400 }}
      >
        <div className="form-group">
          <label>年份 *</label>
          <Input
            value={generateYear}
            onChange={(value) => setGenerateYear(value)}
            placeholder="请输入年份，如：2024"
          />
        </div>
        <div className="form-actions">
          <Button type="secondary" onClick={() => setShowGenerateModal(false)}>
            取消
          </Button>
          <Button type="primary" onClick={handleGenerate} loading={generating}>
            生成
          </Button>
        </div>
      </Modal>
    </div>
  )

  function handleChange(name, value) {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }
}

export default HolidayConfig

