import React, { useState, useEffect } from 'react'
import axios from '../utils/axios'
import './CompanyForm.css'

function CompanyForm({ company, onClose, onSubmit }) {
  const [formData, setFormData] = useState({
    enterprise_abbreviation: '',
    enterprise_full_name: '',
    unified_credit_code: '',
    official_website: '',
    wechat_official_account_id: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (company) {
      setFormData({
        enterprise_abbreviation: company.enterprise_abbreviation || '',
        enterprise_full_name: company.enterprise_full_name || '',
        unified_credit_code: company.unified_credit_code || '',
        official_website: company.official_website || '',
        wechat_official_account_id: company.wechat_official_account_id || ''
      })
    }
  }, [company])

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
      if (company) {
        const response = await axios.put(`/api/companies/${company.id}`, formData)
        if (response.data.success) {
          alert('更新成功')
          onSubmit()
        }
      } else {
        const response = await axios.post('/api/companies', formData)
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
          <h3>{company ? '编辑企业信息' : '新增企业信息'}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="company-form">
          <div className="form-group">
            <label>企业简称 *</label>
            <input
              type="text"
              name="enterprise_abbreviation"
              value={formData.enterprise_abbreviation}
              onChange={handleChange}
              required
              placeholder="请输入企业简称"
            />
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
            <label>公司官网</label>
            <input
              type="text"
              name="official_website"
              value={formData.official_website}
              onChange={handleChange}
              placeholder="请输入公司官网"
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

export default CompanyForm

