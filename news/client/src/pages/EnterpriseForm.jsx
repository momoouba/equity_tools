import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import axios from '../utils/axios'
import './EnterpriseForm.css'

const DATA_APP_PROJECT = '项目挖掘'
const DATA_APP_COMPETITOR = '竞品分析'
const DATA_APP_VALUATION = '项目估值'

function qccSyncViaLabel(v) {
  const s = String(v || '').trim()
  if (!s) return '-'
  const map = {
    qcc_api: '接口拉取',
    cross_table_propagate: '跨表补全',
    legacy_api: '接口(单条)',
  }
  return map[s] || s
}

function displayOrDash(v) {
  const s = v == null ? '' : String(v).trim()
  return s || '-'
}

function ReadonlyTextField({ label, value, multiline = false }) {
  const text = displayOrDash(value)
  const lineCount = String(value ?? '').split('\n').length
  const approxRows = Math.ceil(text.length / 52)
  const rows = multiline ? Math.min(20, Math.max(3, lineCount, approxRows)) : undefined
  return (
    <div className="form-group form-group-multiline">
      <label>{label}</label>
      {multiline ? (
        <textarea
          readOnly
          className="readonly-input form-textarea form-textarea-readonly"
          rows={rows}
          value={text}
        />
      ) : (
        <input type="text" readOnly className="readonly-input" value={text} />
      )}
    </div>
  )
}

function MultilineTextField({ label, name, value, onChange, minRows = 4, placeholder }) {
  const ref = useRef(null)
  const text = value ?? ''

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const minPx = minRows * 26
    el.style.height = `${Math.max(minPx, el.scrollHeight)}px`
  }, [text, minRows])

  return (
    <div className="form-group form-group-multiline">
      <label>{label}</label>
      <textarea
        ref={ref}
        name={name}
        value={text}
        onChange={onChange}
        rows={minRows}
        className="form-textarea form-textarea-auto"
        placeholder={placeholder || `请输入${label}`}
      />
    </div>
  )
}


function decimalFieldToString(v) {
  if (v == null || v === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

function EnterpriseForm({ enterprise, onClose, onSubmit, dataAppName = '新闻舆情', competitorInvestedForm = false }) {
  const isCompetitorInvestedForm = competitorInvestedForm || dataAppName === DATA_APP_COMPETITOR || dataAppName === DATA_APP_VALUATION
  const showCostFields = dataAppName === DATA_APP_PROJECT || isCompetitorInvestedForm
  const [formData, setFormData] = useState({
    project_abbreviation: '',
    enterprise_full_name: '',
    unified_credit_code: '',
    wechat_official_account_id: '',
    official_website: '',
    entity_type: '',
    exit_status: '未退出',
    investment_cost: '',
    ai_product_intro: '',
    ai_industry_tags_display: '',
    qcc_company_intro: '',
    exited_cost: '',
    remaining_cost: '',
    residual_value: '',
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
        entity_type: enterprise.entity_type || '',
        exit_status: enterprise.exit_status !== undefined && enterprise.exit_status !== null ? enterprise.exit_status : '未退出',
        investment_cost: decimalFieldToString(enterprise.investment_cost),
        exited_cost: decimalFieldToString(enterprise.exited_cost),
        remaining_cost: decimalFieldToString(enterprise.remaining_cost),
        residual_value: decimalFieldToString(enterprise.residual_value),
        ai_product_intro: enterprise.ai_product_intro || '',
        ai_industry_tags_display: enterprise.ai_industry_tags_display || '',
        qcc_company_intro: enterprise.qcc_company_intro || '',
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
      if (isCompetitorInvestedForm) {
        setFormData((prev) => ({ ...prev, entity_type: '被投企业' }))
      }
    }
  }, [enterprise, isCompetitorInvestedForm])

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

    if (value.trim() && !enterprise && !isCompetitorInvestedForm) {
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
      const basePayload = {
        project_abbreviation: formData.project_abbreviation,
        enterprise_full_name: formData.enterprise_full_name,
        unified_credit_code: formData.unified_credit_code,
        wechat_official_account_id: formData.wechat_official_account_id,
        official_website: formData.official_website,
        entity_type: isCompetitorInvestedForm ? '被投企业' : formData.entity_type,
        exit_status: formData.exit_status,
        data_app_name: dataAppName,
      }
      if (isCompetitorInvestedForm && enterprise) {
        basePayload.unified_credit_code = enterprise.unified_credit_code || ''
        basePayload.wechat_official_account_id = enterprise.wechat_official_account_id || ''
        basePayload.official_website = enterprise.official_website || ''
        basePayload.entity_type = enterprise.entity_type || '被投企业'
      }
      if (showCostFields) {
        basePayload.investment_cost = formData.investment_cost
        basePayload.exited_cost = formData.exited_cost
        basePayload.remaining_cost = formData.remaining_cost
        basePayload.residual_value = formData.residual_value
      }
      if (isCompetitorInvestedForm) {
        basePayload.ai_product_intro = formData.ai_product_intro
        basePayload.ai_industry_tags_display = formData.ai_industry_tags_display
        basePayload.qcc_company_intro = formData.qcc_company_intro
      }

      if (enterprise) {
        // 更新
        const response = await axios.put(`/api/enterprises/${enterprise.id}`, basePayload)
        if (response.data.success) {
          alert('更新成功')
          onSubmit()
        }
      } else {
        // 新增
        const response = await axios.post('/api/enterprises', basePayload)
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
      <div className={`modal-content${isCompetitorInvestedForm ? ' modal-content-wide' : ''}`}>
        <div className="modal-header">
          <h3>{enterprise ? '编辑企业信息' : '新增企业信息'}</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className={`enterprise-form${isCompetitorInvestedForm ? ' enterprise-form--competitor' : ''}`}>
          <div className="form-group">
            <label>项目编号</label>
            <input
              type="text"
              value={projectNumber}
              readOnly
              className="readonly-input"
            />
          </div>


          {isCompetitorInvestedForm ? (
            <>
              {enterprise ? (
                <>
                  <ReadonlyTextField label="企业类型" value={enterprise.entity_type || '被投企业'} />
                  <ReadonlyTextField label="项目简称" value={enterprise.project_abbreviation} />
                  <ReadonlyTextField label="关联基金" value={enterprise.fund} />
                </>
              ) : (
                <div className="form-group" ref={dropdownRef}>
                  <label>项目简称</label>
                  <input
                    type="text"
                    name="project_abbreviation"
                    value={formData.project_abbreviation}
                    onChange={handleAbbreviationChange}
                    placeholder="请输入项目简称"
                  />
                </div>
              )}

              <div className="form-group">
                <label>被投企业全称 *</label>
                <input
                  type="text"
                  name="enterprise_full_name"
                  value={formData.enterprise_full_name}
                  onChange={handleChange}
                  required
                  placeholder="请输入被投企业全称"
                />
              </div>

              <MultilineTextField
                label="产品简介(AI)"
                name="ai_product_intro"
                value={formData.ai_product_intro}
                onChange={handleChange}
                minRows={6}
              />
              <MultilineTextField
                label="企业标签(AI)"
                name="ai_industry_tags_display"
                value={formData.ai_industry_tags_display}
                onChange={handleChange}
                minRows={4}
                placeholder="多个标签请用顿号、逗号分隔"
              />
              <MultilineTextField
                label="企业介绍（企查查）"
                name="qcc_company_intro"
                value={formData.qcc_company_intro}
                onChange={handleChange}
                minRows={8}
              />

              {enterprise ? (
                <>
                  <ReadonlyTextField label="企查查来源" value={qccSyncViaLabel(enterprise.qcc_sync_via)} />
                  <ReadonlyTextField
                    label="企查查同步时间"
                    value={
                      enterprise.qcc_sync_at == null || String(enterprise.qcc_sync_at).trim() === ''
                        ? '-'
                        : String(enterprise.qcc_sync_at)
                    }
                  />
                </>
              ) : null}

              {showCostFields && (
                <>
                  <div className="form-group">
                    <label>投资成本</label>
                    <input type="number" name="investment_cost" value={formData.investment_cost} onChange={handleChange} step="0.01" min="0" placeholder="可选，数字" />
                  </div>
                  <div className="form-group">
                    <label>已退出成本</label>
                    <input type="number" name="exited_cost" value={formData.exited_cost} onChange={handleChange} step="0.01" min="0" placeholder="可选，数字" />
                  </div>
                  <div className="form-group">
                    <label>剩余成本</label>
                    <input type="number" name="remaining_cost" value={formData.remaining_cost} onChange={handleChange} step="0.01" min="0" placeholder="可选，数字" />
                  </div>
                  <div className="form-group">
                    <label>剩余价值</label>
                    <input type="number" name="residual_value" value={formData.residual_value} onChange={handleChange} step="0.01" min="0" placeholder="可选，数字" />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>退出状态</label>
                <select name="exit_status" value={formData.exit_status} onChange={handleChange}>
                  <option value="未退出">未退出</option>
                  <option value="部分退出">部分退出</option>
                  <option value="完全退出">完全退出</option>
                  <option value="继续观察">继续观察</option>
                  <option value="不再观察">不再观察</option>
                  <option value="已上市">已上市</option>
                </select>
              </div>

              {enterprise ? <ReadonlyTextField label="AI状态" value={enterprise.ai_enrich_status} /> : null}
            </>
          ) : (
            <>
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

          {!isCompetitorInvestedForm && dataAppName !== DATA_APP_PROJECT && (
          <>
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
          </>
          )}

          {!isCompetitorInvestedForm && dataAppName === DATA_APP_PROJECT && (
            <>
              <div className="form-group">
                <label>投资成本</label>
                <input
                  type="number"
                  name="investment_cost"
                  value={formData.investment_cost}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  placeholder="可选，数字"
                />
              </div>
              <div className="form-group">
                <label>已退出成本</label>
                <input
                  type="number"
                  name="exited_cost"
                  value={formData.exited_cost}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  placeholder="可选，数字"
                />
              </div>
              <div className="form-group">
                <label>剩余成本</label>
                <input
                  type="number"
                  name="remaining_cost"
                  value={formData.remaining_cost}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  placeholder="可选，数字"
                />
              </div>
              <div className="form-group">
                <label>剩余价值</label>
                <input
                  type="number"
                  name="residual_value"
                  value={formData.residual_value}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  placeholder="可选，数字"
                />
              </div>
            </>
          )}

          <div className="form-group">
            <label>企业类型</label>
            <select
              name="entity_type"
              value={formData.entity_type}
              onChange={handleChange}
            >
              <option value="">请选择企业类型</option>
              <option value="被投企业">被投企业</option>
              <option value="基金">基金</option>
              <option value="子基金">子基金</option>
              <option value="子基金管理人">子基金管理人</option>
              <option value="子基金GP">子基金GP</option>
            </select>
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
            </>
          )}

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
