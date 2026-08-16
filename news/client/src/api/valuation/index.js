import axios from '../../utils/axios'

const BASE = '/api/valuation'

export function fetchValuationPreProjects(params) {
  return axios.get(`${BASE}/pre-projects`, { params })
}

export function fetchCompetitorPreProjectsForValuation(params) {
  return axios.get(`${BASE}/competitor-pre-projects`, { params })
}

export function postValuationPreProject(body) {
  return axios.post(`${BASE}/pre-projects`, body)
}

export function postValuationQccFuzzyLookup(body) {
  return axios.post(`${BASE}/qcc-fuzzy-lookup`, body)
}

export function openValuationCaseFromPreProject(preProjectId) {
  return axios.post(`${BASE}/pre-projects/${preProjectId}/open-case`)
}

export function openValuationCaseFromInvested(enterpriseId) {
  return axios.post(`${BASE}/invested-enterprises/${enterpriseId}/open-case`)
}

export function fetchValuationPostCases(params) {
  return axios.get(`${BASE}/post-cases`, { params })
}

export function fetchValuationCase(caseId) {
  return axios.get(`${BASE}/cases/${caseId}`)
}

export function patchValuationCase(caseId, body) {
  return axios.patch(`${BASE}/cases/${caseId}`, body)
}

export function fetchValuationDraft(caseId) {
  return axios.get(`${BASE}/cases/${caseId}/draft`)
}

export function putValuationDraft(caseId, payload) {
  return axios.put(`${BASE}/cases/${caseId}/draft`, { payload })
}

export function fetchComparablePreview(caseId) {
  return axios.get(`${BASE}/cases/${caseId}/comparables/preview`)
}

export function fetchCaseComparables(caseId) {
  return axios.get(`${BASE}/cases/${caseId}/comparables`)
}

export function fetchComparableFinancials(caseId) {
  return axios.get(`${BASE}/cases/${caseId}/comparables/financials`)
}

export function putCaseComparables(caseId, list) {
  return axios.put(`${BASE}/cases/${caseId}/comparables`, { list })
}

export function postManualComparable(caseId, body) {
  return axios.post(`${BASE}/cases/${caseId}/comparables/manual`, body)
}

export function importComparablesExcel(caseId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return axios.post(`${BASE}/cases/${caseId}/comparables/import`, fd)
}

export function importTargetFinancialsExcel(caseId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return axios.post(`${BASE}/cases/${caseId}/target-financials/import`, fd)
}

export function fetchIndustryMultiplesStatus() {
  return axios.get(`${BASE}/industry-multiples/status`)
}

export function fetchSwIndustryNames() {
  return axios.get(`${BASE}/industry-multiples/industries`)
}

export function downloadTargetFinancialsTemplate(caseId) {
  const path = caseId
    ? `${BASE}/cases/${caseId}/target-financials/template`
    : `${BASE}/target-financials/template`
  return axios.get(path, { responseType: 'blob' })
}

export function patchCaseComparable(caseId, cid, body) {
  return axios.patch(`${BASE}/cases/${caseId}/comparables/${cid}`, body)
}

export function postValuationJob(caseId, body) {
  return axios.post(`${BASE}/cases/${caseId}/jobs`, body)
}

export function fetchValuationJob(jobId) {
  return axios.get(`${BASE}/jobs/${jobId}`)
}

export function postValuationVersion(caseId, body) {
  return axios.post(`${BASE}/cases/${caseId}/versions`, body)
}

export function postValuationDraftFromVersion(caseId, fromVersionId) {
  return axios.post(`${BASE}/cases/${caseId}/draft/from-version`, {
    from_version_id: fromVersionId || undefined,
  })
}

export function fetchValuationVersion(versionId) {
  return axios.get(`${BASE}/versions/${versionId}`)
}

export function getValuationExportUrl(caseId, versionId) {
  const q = versionId ? `?version_id=${encodeURIComponent(versionId)}` : ''
  return `${BASE}/cases/${caseId}/export${q}`
}

export function downloadValuationExport(caseId, versionId) {
  return axios.get(getValuationExportUrl(caseId, versionId), { responseType: 'blob' })
}

export function fetchValuationChangeLog(caseId, params) {
  return axios.get(`${BASE}/cases/${caseId}/change-log`, { params })
}
