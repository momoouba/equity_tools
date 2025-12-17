import React, { useState, useEffect, useRef } from 'react'
import axios from '../utils/axios'
import './EnterpriseForm.css'

function EnterpriseForm({ enterprise, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    project_abbreviation: '',
    enterprise_full_name: '',
    unified_credit_code: '',
    wechat_official_account_id: '',
    official_website: '',
    exit_status: '未退出'
  })
  const [projectNumber, setProjectNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [companySuggestions, setCompanySuggestions] = useState([])
  const [qichachaResults, setQichachaResults] = useState([])
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const [showQichachaDropdown, setShowQichachaDropdown] = useState(false)
  const [querying, setQuerying] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (enterprise) {
      // 编辑模式
      setFormData({
        project_abbreviation: enterprise.project_abbreviation || '',
        enterprise_full_name: enterprise.enterprise_full_name || '',
        unified_credit_code: enterprise.unified_credit_code || '',
        wechat_official_account_id: enterprise.wechat_official_account_id || '',
        official_website: enterprise.official_website || '',
        exit_status: enterprise.exit_status || '未退出'
      })
      setProjectNumber(enterprise.project_number)
    } else {
      // 新增模式，生成临时项目编号（实际由后端生成）
      const date = new Date()
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      setProjectNumber(`P${year}${month}${day}${random}`)
    }
  }, [enterprise])

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowCompanyDropdown(false)
        setShowQichachaDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 输入项目简称时，自动查询 company 表
  const handleAbbreviationChange = async (e) => {
    const value = e.target.value
    setFormData({
      ...formData,
      project_abbreviation: value
    })
    setError('')

    if (value.trim() && !enterprise) {
      // 查询 company 表
      try {
        const response = await axios.get('/api/companies/search', {
          params: { abbreviation: value }
        })
        if (response.data.success) {
          setCompanySuggestions(response.data.data)
          setShowCompanyDropdown(response.data.data.length > 0)
        }
      } catch (error) {
        console.error('查询企业列表失败:', error)
      }
    } else {
      setCompanySuggestions([])
      setShowCompanyDropdown(false)
    }
  }

  // 选择 company 表中的企业
  const handleSelectCompany = (company) => {
    setFormData({
      ...formData,
      project_abbreviation: company.enterprise_abbreviation,
      enterprise_full_name: company.enterprise_full_name,
      unified_credit_code: company.unified_credit_code || '',
      wechat_official_account_id: company.wechat_official_account_id || '',
      official_website: company.official_website || ''
    })
    setShowCompanyDropdown(false)
    setCompanySuggestions([])
  }

  // 查询企查查接口
  const handleQuery = async () => {
    if (!formData.project_abbreviation.trim()) {
      alert('请输入企业简称')
      return
    }

    setQuerying(true)
    setError('')
    try {
      const response = await axios.get('/api/qichacha/search', {
        params: { keyword: formData.project_abbreviation }
      })
      if (response.data.success) {
        setQichachaResults(response.data.data)
        setShowQichachaDropdown(response.data.data.length > 0)
        if (response.data.data.length === 0) {
          alert('未找到相关企业信息')
        }
      }
    } catch (error) {
      setError(error.response?.data?.message || '查询失败，请重试')
      setQichachaResults([])
      setShowQichachaDropdown(false)
    } finally {
      setQuerying(false)
    }
  }

  // 选择企查查返回的企业
  const handleSelectQichacha = (company) => {
    setFormData({
      ...formData,
      enterprise_full_name: company.name || '',
      unified_credit_code: company.creditCode || '',
      official_website: company.website || ''
    })
    setShowQichachaDropdown(false)
    setQichachaResults([])
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value
    })
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (enterprise) {
        // 更新
        const response = await axios.put(`/api/enterprises/${enterprise.id}`, formData)
        if (response.data.success) {
          alert('更新成功')
          onSubmit()
        }
      } else {
        // 新增
        const response = await axios.post('/api/enterprises', formData)
        if (response.data.success) {
          alert('创建成功')
          onSubmit()
        }
      }
    } catch (error) {
      setError(error.response?.data?.message || '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h3>{enterprise ? '编辑企业信息' : '新增企业信息'}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="enterprise-form">
          <div className="form-group">
            <label>项目编号</label>
            <input
              type="text"
              value={projectNumber}
              readOnly
              className="readonly-input"
            />
          </div>

          <div className="form-group" ref={dropdownRef}>
            <label>企业简称</label>
            <div className="input-with-button">
              <input
                type="text"
                name="project_abbreviation"
                value={formData.project_abbreviation}
                onChange={handleAbbreviationChange}
                placeholder="请输入企业简称"
                disabled={!!enterprise}
              />
              {!enterprise && (
                <button type="button" className="query-button" onClick={handleQuery} disabled={querying}>
                  {querying ? '查询中...' : '查询'}
                </button>
              )}
            </div>
            
            {/* company 表查询结果下拉菜单 */}
            {showCompanyDropdown && companySuggestions.length > 0 && (
              <div className="dropdown-menu">
                {companySuggestions.map((company) => (
                  <div
                    key={company.id}
                    className="dropdown-item"
                    onClick={() => handleSelectCompany(company)}
                  >
                    <div className="dropdown-item-main">
                      {company.enterprise_abbreviation} - {company.enterprise_full_name}
                    </div>
                    {company.unified_credit_code && (
                      <div className="dropdown-item-sub">
                        统一信用代码：{company.unified_credit_code}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 企查查查询结果下拉菜单 */}
            {showQichachaDropdown && qichachaResults.length > 0 && (
              <div className="dropdown-menu">
                {qichachaResults.map((company, index) => (
                  <div
                    key={index}
                    className="dropdown-item"
                    onClick={() => handleSelectQichacha(company)}
                  >
                    <div className="dropdown-item-main">
                      {company.name}
                    </div>
                    {company.creditCode && (
                      <div className="dropdown-item-sub">
                        统一信用代码：{company.creditCode}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>企业全称 *</label>
            <input
              type="text"
              name="enterprise_full_name"
              value={formData.enterprise_full_name}
              onChange={handleChange}
              required
              placeholder="请输入企业全称"
            />
          </div>

          <div className="form-group">
            <label>统一信用代码</label>
            <input
              type="text"
              name="unified_credit_code"
              value={formData.unified_credit_code}
              onChange={handleChange}
              placeholder="请输入统一信用代码"
            />
          </div>

          <div className="form-group">
            <label>微信公众号id</label>
            <input
              type="text"
              name="wechat_official_account_id"
              value={formData.wechat_official_account_id}
              onChange={handleChange}
              placeholder="请输入微信公众号id"
            />
          </div>

          <div className="form-group">
            <label>官网地址</label>
            <input
              type="text"
              name="official_website"
              value={formData.official_website}
              onChange={handleChange}
              placeholder="请输入官网地址"
            />
          </div>

          <div className="form-group">
            <label>退出状态</label>
            <select
              name="exit_status"
              value={formData.exit_status}
              onChange={handleChange}
            >
              <option value="未退出">未退出</option>
              <option value="部分退出">部分退出</option>
              <option value="完全退出">完全退出</option>
              <option value="继续观察">继续观察</option>
              <option value="不再观察">不再观察</option>
              <option value="已上市">已上市</option>
            </select>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn-confirm" disabled={loading}>
              {loading ? '提交中...' : '确定'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default EnterpriseForm
