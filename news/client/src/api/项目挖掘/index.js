import axios from '../../utils/axios'

export function fetchFinancingEvents(params) {
  return axios.get('/api/project-sourcing/events', { params })
}

export function postFinancingSync(body) {
  return axios.post('/api/project-sourcing/sync', body)
}

/** 管理员：单条融资事件手动触发联网 AI 取数（异步，HTTP 202） */
export function postFinancingEventAiEnrich(eventId) {
  return axios.post(`/api/project-sourcing/events/${eventId}/ai-enrich`)
}

/** 管理员：按融资日期区间批量 AI 取数（服务端队列，HTTP 202）；body.only_failed=true 时仅重试 ai_enrich_status=failed */
export function postFinancingBatchAiEnrich(body) {
  return axios.post('/api/project-sourcing/batch-ai-enrich', body)
}

/** 管理员：融资事件 AI 增强日志列表 */
export function fetchFinancingAiEnrichLogs(params) {
  return axios.get('/api/project-sourcing/ai-enrich-logs', { params })
}

/** 管理员：单条被投企业（invested_enterprises）手动触发联网 AI 取数（异步，HTTP 202） */
export function postInvestedEnterpriseAiEnrich(enterpriseId) {
  return axios.post(`/api/project-sourcing/invested-enterprises/${enterpriseId}/ai-enrich`)
}

/** 管理员：按 invested_enterprises 创建日期区间批量 AI；body.only_failed=true 时仅重试 ai_enrich_status=failed */
export function postInvestedEnterpriseBatchAiEnrich(body) {
  return axios.post('/api/project-sourcing/invested-enterprises/batch-ai-enrich', body)
}

/** 管理员：被投企业 AI 增强日志列表 */
export function fetchInvestedEnterpriseAiEnrichLogs(params) {
  return axios.get('/api/project-sourcing/invested-enterprises/ai-enrich-logs', { params })
}

/** 管理员：单条被投企业企查查企业简介写库（同步，可能较慢） */
export function postInvestedEnterpriseQccCompanyBrief(enterpriseId) {
  return axios.post(`/api/project-sourcing/invested-enterprises/${enterpriseId}/qcc-company-brief`)
}

/** 管理员：批量企查查企业简介；body.enterprise_ids 为 id 数组，可选 gap_ms */
export function postInvestedEnterpriseBatchQccCompanyBrief(body) {
  return axios.post('/api/project-sourcing/invested-enterprises/batch-qcc-company-brief', body)
}

export function fetchTrackTree() {
  return axios.get('/api/project-sourcing/tracks/tree')
}

export function createTrack(body) {
  return axios.post('/api/project-sourcing/tracks', body)
}

export function updateTrack(id, body) {
  return axios.put(`/api/project-sourcing/tracks/${id}`, body)
}

export function deleteTrack(id) {
  return axios.delete(`/api/project-sourcing/tracks/${id}`)
}

export function createTrackLv1(body) {
  return axios.post('/api/project-sourcing/tracks/lv1', body)
}

export function updateTrackLv1(id, body) {
  return axios.put(`/api/project-sourcing/tracks/lv1/${id}`, body)
}

export function deleteTrackLv1(id) {
  return axios.delete(`/api/project-sourcing/tracks/lv1/${id}`)
}

export function createTrackLv2(body) {
  return axios.post('/api/project-sourcing/tracks/lv2', body)
}

export function updateTrackLv2(id, body) {
  return axios.put(`/api/project-sourcing/tracks/lv2/${id}`, body)
}

export function deleteTrackLv2(id) {
  return axios.delete(`/api/project-sourcing/tracks/lv2/${id}`)
}

export function createTrackLv3(body) {
  return axios.post('/api/project-sourcing/tracks/lv3', body)
}

export function updateTrackLv3(id, body) {
  return axios.put(`/api/project-sourcing/tracks/lv3/${id}`, body)
}

export function deleteTrackLv3(id) {
  return axios.delete(`/api/project-sourcing/tracks/lv3/${id}`)
}

export function postTrackApplyMatch(body) {
  return axios.post('/api/project-sourcing/tracks/apply-match', body)
}

export function getTrackImportTemplate() {
  return axios.get('/api/project-sourcing/tracks/import/template', { responseType: 'blob' })
}

export function getTrackExportExcel() {
  return axios.get('/api/project-sourcing/tracks/export/excel', { responseType: 'blob' })
}

export function postTrackImport(formData) {
  return axios.post('/api/project-sourcing/tracks/import/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}
