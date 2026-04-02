import axios from '../../utils/axios'

const base = '/api/listing'

export function fetchIpoProjectList(params) {
  return axios.get(`${base}/ipo-project`, { params })
}

export function fetchIpoProgressList(params) {
  return axios.get(`${base}/ipo-progress`, { params })
}

export function fetchIpoProgressStats() {
  return axios.get(`${base}/ipo-progress/stats`)
}

export function fetchIpoProjectProgressList(params) {
  return axios.get(`${base}/ipo-project-progress`, { params })
}

export function postListingMatch(body) {
  return axios.post(`${base}/match`, body)
}

export function fetchListingConfig() {
  return axios.get(`${base}/listing-config`)
}

export function fetchListingContext() {
  return axios.get(`${base}/context`)
}

export function fetchListingRecipients() {
  return axios.get(`${base}/recipients`)
}

export function createListingRecipient(body) {
  return axios.post(`${base}/recipients`, body)
}

export function updateListingRecipient(id, body) {
  return axios.put(`${base}/recipients/${id}`, body)
}

export function deleteListingRecipient(id) {
  return axios.delete(`${base}/recipients/${id}`)
}

export function sendListingRecipientTest(id) {
  return axios.post(`${base}/recipients/${id}/send-test`)
}

export function fetchIpoProjectSqlSyncSetting(externalDbConfigId) {
  return axios.get(`${base}/ipo-project/sql-sync-setting`, {
    params: externalDbConfigId ? { external_db_config_id: externalDbConfigId } : undefined,
  })
}

export function putIpoProjectSqlSyncSetting(body) {
  return axios.put(`${base}/ipo-project/sql-sync-setting`, body)
}

export function postIpoProjectSqlSyncPreview(body) {
  return axios.post(`${base}/ipo-project/sql-sync-preview`, body)
}

export function postIpoProjectSqlSyncRun(body) {
  return axios.post(`${base}/ipo-project/sql-sync-run`, body, { timeout: 600000 })
}

export function postListingConfigSync(id, body) {
  return axios.post(`${base}/listing-config/${id}/sync`, body, { timeout: 600000 })
}

export function postListingConfigCopy(id) {
  return axios.post(`${base}/listing-config/${id}/copy`)
}

export function fetchListingDataChangeLog(params) {
  return axios.get(`${base}/listing-data-change-log`, { params })
}

export function downloadIpoProjectProgressExport(params) {
  return axios.get(`${base}/ipo-project-progress/export`, { params, responseType: 'blob' })
}

export function downloadIpoProjectExport(params) {
  return axios.get(`${base}/ipo-project/export`, { params, responseType: 'blob' })
}

export function downloadIpoProgressExport(params) {
  return axios.get(`${base}/ipo-progress/export`, { params, responseType: 'blob' })
}

export function putIpoProjectProgress(fId, body) {
  return axios.put(`${base}/ipo-project-progress/${fId}`, body)
}

export function deleteIpoProjectProgress(fId) {
  return axios.delete(`${base}/ipo-project-progress/${fId}`)
}

export function postIpoProjectBatchImport(body) {
  return axios.post(`${base}/ipo-project/batch-import`, body)
}

export function postIpoProjectBatchImportUpload(formData) {
  return axios.post(`${base}/ipo-project/batch-import/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 600000,
  })
}

export function downloadIpoProjectBatchImportTemplate() {
  return axios.get(`${base}/ipo-project/batch-import/template`, { responseType: 'blob' })
}

export function createIpoProject(body) {
  return axios.post(`${base}/ipo-project`, body)
}

export function updateIpoProject(fId, body) {
  return axios.put(`${base}/ipo-project/${fId}`, body)
}

export function deleteIpoProject(fId) {
  return axios.delete(`${base}/ipo-project/${fId}`)
}

export function updateIpoProgress(fId, body) {
  return axios.put(`${base}/ipo-progress/${fId}`, body)
}

export function deleteIpoProgress(fId) {
  return axios.delete(`${base}/ipo-progress/${fId}`)
}

export function getListingProjectProgressShareCurrent() {
  return axios.get('/api/listing-share/current')
}

export function createListingProjectProgressShare(body) {
  return axios.post('/api/listing-share/create', body)
}

export function verifyListingProjectProgressShare(token) {
  return axios.get(`/api/listing-share/verify/${token}`)
}

export function verifyListingProjectProgressSharePassword(token, body) {
  return axios.post(`/api/listing-share/verify-password/${token}`, body)
}

export function fetchListingProjectProgressShareData(token, params) {
  return axios.get(`/api/listing-share/data/${token}`, { params })
}

export function downloadListingProjectProgressShareExport(token, params) {
  return axios.get(`/api/listing-share/project-progress-export/${token}`, { params, responseType: 'blob' })
}

export function fetchListingIpoProgressShareStats(token) {
  return axios.get(`/api/listing-share/ipo-progress-stats/${token}`)
}

export function fetchListingIpoProgressShareData(token, params) {
  return axios.get(`/api/listing-share/ipo-progress-data/${token}`, { params })
}

export function downloadListingIpoProgressShareExport(token, params) {
  return axios.get(`/api/listing-share/ipo-progress-export/${token}`, { params, responseType: 'blob' })
}
