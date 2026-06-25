import axios from '../../utils/axios'

const BASE = '/api/competitor-analysis'

export function postInvestedEnterpriseAiEnrich(enterpriseId) {
  return axios.post(`${BASE}/invested-enterprises/${enterpriseId}/ai-enrich`)
}

export function postInvestedEnterpriseBatchAiEnrich(body) {
  return axios.post(`${BASE}/invested-enterprises/batch-ai-enrich`, body)
}

export function fetchInvestedEnterpriseAiEnrichLogs(params) {
  return axios.get(`${BASE}/invested-enterprises/ai-enrich-logs`, { params })
}

export function postInvestedEnterpriseQccCompanyBrief(enterpriseId) {
  return axios.post(`${BASE}/invested-enterprises/${enterpriseId}/qcc-company-brief`)
}

export function postInvestedEnterpriseBatchQccCompanyBrief(body) {
  return axios.post(`${BASE}/invested-enterprises/batch-qcc-company-brief`, body)
}

export function fetchCompetitorAnalysisIpoProjects(params) {
  return axios.get(`${BASE}/ipo-projects`, { params })
}

export function getCompetitorAnalysisIpoProjectsExport(params) {
  return axios.get(`${BASE}/ipo-projects/export`, {
    params,
    responseType: 'blob',
  })
}

export function postIpoProjectAiEnrich(fId) {
  return axios.post(`${BASE}/ipo-projects/${fId}/ai-enrich`)
}

export function postIpoProjectBatchAiEnrich(body) {
  return axios.post(`${BASE}/ipo-projects/batch-ai-enrich`, body)
}

export function fetchIpoProjectAiEnrichLogs(params) {
  return axios.get(`${BASE}/ipo-projects/ai-enrich-logs`, { params })
}

export function postIpoProjectQccCompanyBrief(fId) {
  return axios.post(`${BASE}/ipo-projects/${fId}/qcc-company-brief`)
}

export function postIpoProjectBatchQccCompanyBrief(body) {
  return axios.post(`${BASE}/ipo-projects/batch-qcc-company-brief`, body)
}

export function postIpoProjectQccCompanyBriefSyncAllFiltered(body) {
  return axios.post(`${BASE}/ipo-projects/qcc-company-brief-sync-all-filtered`, body, {
    timeout: 600000,
  })
}

export function fetchCompetitorAnalysisIpoProjectSqlSyncSetting(externalDbConfigId) {
  return axios.get(`${BASE}/ipo-projects/sql-sync-setting`, {
    params: externalDbConfigId ? { external_db_config_id: externalDbConfigId } : undefined,
  })
}

export function putCompetitorAnalysisIpoProjectSqlSyncSetting(body) {
  return axios.put(`${BASE}/ipo-projects/sql-sync-setting`, body)
}

export function postCompetitorAnalysisIpoProjectSqlSyncPreview(body) {
  return axios.post(`${BASE}/ipo-projects/sql-sync-preview`, body)
}

export function postCompetitorAnalysisIpoProjectSqlSyncRun(body) {
  return axios.post(`${BASE}/ipo-projects/sql-sync-run`, body, { timeout: 600000 })
}

export function postCompetitorAnalysisIpoProject(body) {
  return axios.post(`${BASE}/ipo-projects`, body)
}

export function putCompetitorAnalysisIpoProject(fId, body) {
  return axios.put(`${BASE}/ipo-projects/${encodeURIComponent(fId)}`, body)
}

export function deleteCompetitorAnalysisIpoProject(fId) {
  return axios.delete(`${BASE}/ipo-projects/${encodeURIComponent(fId)}`)
}

export function fetchCompetitorAnalysisIpoProjectChangeLog(fId) {
  return axios.get(`${BASE}/ipo-projects/${encodeURIComponent(fId)}/change-log`)
}

export function fetchInvestedEnterpriseCompetitorReadiness(enterpriseId) {
  return axios.get(`${BASE}/invested-enterprises/${enterpriseId}/competitor-readiness`)
}

export function postCompetitorExtractTagsFromNarrative(body) {
  return axios.post(`${BASE}/competitor-match/extract-tags-from-narrative`, body)
}

export function postInvestedEnterpriseCompetitorSupplement(enterpriseId, body) {
  return axios.post(`${BASE}/invested-enterprises/${enterpriseId}/competitor-supplement`, body)
}

export function postInvestedEnterpriseCompetitorAnalysisRun(enterpriseId) {
  return axios.post(`${BASE}/invested-enterprises/${enterpriseId}/competitor-analysis-run`)
}

export function fetchCompetitorRelations(params) {
  return axios.get(`${BASE}/competitor-analysis/relations`, { params })
}

export function postCompetitorRelation(body) {
  return axios.post(`${BASE}/competitor-analysis/relations`, body)
}

export function putCompetitorRelation(relationId, body) {
  return axios.put(`${BASE}/competitor-analysis/relations/${encodeURIComponent(relationId)}`, body)
}

export function deleteCompetitorRelation(relationId) {
  return axios.delete(`${BASE}/competitor-analysis/relations/${encodeURIComponent(relationId)}`)
}

export function fetchCompetitorAnalysisRuns(params) {
  return axios.get(`${BASE}/competitor-analysis/runs`, { params })
}

export function patchCompetitorRelationComparable(relationId, includeInComparable) {
  return axios.patch(`${BASE}/competitor-analysis/relations/${relationId}/comparable`, {
    include_in_comparable: !!includeInComparable,
  })
}

export function patchCompetitorRelationReview(relationId, body) {
  return axios.patch(`${BASE}/competitor-analysis/relations/${encodeURIComponent(relationId)}/review`, body)
}

export function fetchCompetitorExportYears(params) {
  return axios.get(`${BASE}/competitor-analysis/export/years`, { params })
}

export function postCompetitorAnalysisExport(body) {
  return axios.post(`${BASE}/competitor-analysis/export`, body, {
    responseType: 'blob',
  })
}

export function fetchCompetitorAnalysisSummary(params) {
  return axios.get(`${BASE}/competitor-analysis/summary`, { params })
}

export function fetchPreInvestmentProjects(params) {
  return axios.get(`${BASE}/pre-investment-projects`, { params })
}

export function postPreInvestmentProject(body) {
  return axios.post(`${BASE}/pre-investment-projects`, body)
}

export function putPreInvestmentProject(id, body) {
  return axios.put(`${BASE}/pre-investment-projects/${id}`, body)
}

export function deletePreInvestmentProject(id) {
  return axios.delete(`${BASE}/pre-investment-projects/${id}`)
}

export function postPreInvestmentQccFuzzyLookup(body) {
  return axios.post(`${BASE}/pre-investment-projects/qcc-fuzzy-lookup`, body)
}

export function postPreInvestmentQccBrief(id) {
  return axios.post(`${BASE}/pre-investment-projects/${id}/qcc-company-brief`)
}

export function postPreInvestmentBpExtract(id) {
  return axios.post(`${BASE}/pre-investment-projects/${id}/bp-extract`)
}

export function postPreInvestmentAiEnrich(id) {
  return axios.post(`${BASE}/pre-investment-projects/${id}/ai-enrich`)
}

export function postPreInvestmentCompetitorAnalysisRun(id) {
  return axios.post(`${BASE}/pre-investment-projects/${id}/competitor-analysis-run`)
}
