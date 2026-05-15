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

/** 项目挖掘 — 底层项目（ipo_project.data_app_id = 项目挖掘） */
export function fetchProjectSourcingIpoProjects(params) {
  return axios.get('/api/project-sourcing/ipo-projects', { params })
}

/** 导出 CSV（含 data_app_id）；与列表相同筛选参数 */
export function getProjectSourcingIpoProjectsExport(params) {
  return axios.get('/api/project-sourcing/ipo-projects/export', {
    params,
    responseType: 'blob',
  })
}

export function postIpoProjectAiEnrich(fId) {
  return axios.post(`/api/project-sourcing/ipo-projects/${fId}/ai-enrich`)
}

export function postIpoProjectBatchAiEnrich(body) {
  return axios.post('/api/project-sourcing/ipo-projects/batch-ai-enrich', body)
}

export function fetchIpoProjectAiEnrichLogs(params) {
  return axios.get('/api/project-sourcing/ipo-projects/ai-enrich-logs', { params })
}

export function postIpoProjectQccCompanyBrief(fId) {
  return axios.post(`/api/project-sourcing/ipo-projects/${fId}/qcc-company-brief`)
}

export function postIpoProjectBatchQccCompanyBrief(body) {
  return axios.post('/api/project-sourcing/ipo-projects/batch-qcc-company-brief', body)
}

/** 管理员：当前筛选下全部底层项目企查查同步（按统一社会信用代码/企业名称去重） */
export function postIpoProjectQccCompanyBriefSyncAllFiltered(body) {
  return axios.post('/api/project-sourcing/ipo-projects/qcc-company-brief-sync-all-filtered', body, {
    timeout: 600000,
  })
}

export function fetchProjectSourcingIpoProjectSqlSyncSetting(externalDbConfigId) {
  return axios.get('/api/project-sourcing/ipo-projects/sql-sync-setting', {
    params: externalDbConfigId ? { external_db_config_id: externalDbConfigId } : undefined,
  })
}

export function putProjectSourcingIpoProjectSqlSyncSetting(body) {
  return axios.put('/api/project-sourcing/ipo-projects/sql-sync-setting', body)
}

export function postProjectSourcingIpoProjectSqlSyncPreview(body) {
  return axios.post('/api/project-sourcing/ipo-projects/sql-sync-preview', body)
}

export function postProjectSourcingIpoProjectSqlSyncRun(body) {
  return axios.post('/api/project-sourcing/ipo-projects/sql-sync-run', body, { timeout: 600000 })
}

/** 项目挖掘底层项目：新增（写入 data_app_id=项目挖掘） */
export function postProjectSourcingIpoProject(body) {
  return axios.post('/api/project-sourcing/ipo-projects', body)
}

export function putProjectSourcingIpoProject(fId, body) {
  return axios.put(`/api/project-sourcing/ipo-projects/${encodeURIComponent(fId)}`, body)
}

export function deleteProjectSourcingIpoProject(fId) {
  return axios.delete(`/api/project-sourcing/ipo-projects/${encodeURIComponent(fId)}`)
}

export function fetchProjectSourcingIpoProjectChangeLog(fId) {
  return axios.get(`/api/project-sourcing/ipo-projects/${encodeURIComponent(fId)}/change-log`)
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

/** 管理员：竞品匹配就绪校验 */
export function fetchInvestedEnterpriseCompetitorReadiness(enterpriseId) {
  return axios.get(`/api/project-sourcing/invested-enterprises/${enterpriseId}/competitor-readiness`)
}

/** 管理员：从自由文本抽取标签（不落库） */
export function postCompetitorExtractTagsFromNarrative(body) {
  return axios.post('/api/project-sourcing/competitor-match/extract-tags-from-narrative', body)
}

/** 管理员：写入竞品补录 */
export function postInvestedEnterpriseCompetitorSupplement(enterpriseId, body) {
  return axios.post(`/api/project-sourcing/invested-enterprises/${enterpriseId}/competitor-supplement`, body)
}

/** 管理员：发起竞品分析（MVP 写运行记录） */
export function postInvestedEnterpriseCompetitorAnalysisRun(enterpriseId) {
  return axios.post(`/api/project-sourcing/invested-enterprises/${enterpriseId}/competitor-analysis-run`)
}

/** 管理员：竞品关系列表 */
export function fetchCompetitorRelations(params) {
  return axios.get('/api/project-sourcing/competitor-analysis/relations', { params })
}

/** 竞品导出可选年度（项目编号前四位） */
export function fetchCompetitorExportYears() {
  return axios.get('/api/project-sourcing/competitor-analysis/export/years')
}

/** 竞品明细 Excel 导出（多 Sheet，按项目简称） */
export function postCompetitorAnalysisExport(body) {
  return axios.post('/api/project-sourcing/competitor-analysis/export', body, {
    responseType: 'blob',
  })
}

/** 竞品分析说明（流程 + 保留原因） */
export function fetchCompetitorAnalysisSummary(params) {
  return axios.get('/api/project-sourcing/competitor-analysis/summary', { params })
}

/** 投前项目列表 */
export function fetchPreInvestmentProjects(params) {
  return axios.get('/api/project-sourcing/pre-investment-projects', { params })
}

/** 新建投前项目 */
export function postPreInvestmentProject(body) {
  return axios.post('/api/project-sourcing/pre-investment-projects', body)
}

/** 投前：企查查模糊搜索（回填全称与信用代码，不落库） */
export function postPreInvestmentQccFuzzyLookup(body) {
  return axios.post('/api/project-sourcing/pre-investment-projects/qcc-fuzzy-lookup', body)
}

/** 投前：企查查简介 */
export function postPreInvestmentQccBrief(id) {
  return axios.post(`/api/project-sourcing/pre-investment-projects/${id}/qcc-company-brief`)
}

/** 投前：手动 AI 取数（异步，202） */
export function postPreInvestmentAiEnrich(id) {
  return axios.post(`/api/project-sourcing/pre-investment-projects/${id}/ai-enrich`)
}

/** 投前：竞品分析（MVP 写运行记录，202） */
export function postPreInvestmentCompetitorAnalysisRun(id) {
  return axios.post(`/api/project-sourcing/pre-investment-projects/${id}/competitor-analysis-run`)
}
