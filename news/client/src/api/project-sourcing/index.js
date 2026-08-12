import axios from '../../utils/axios'

export function fetchFinancingEvents(params) {
  return axios.get('/api/project-sourcing/events', { params })
}

export function fetchMarketOverview(params) {
  return axios.get('/api/project-sourcing/market-overview', { params })
}

export function fetchMarketOverviewTrackSecondary(params) {
  return axios.get('/api/project-sourcing/market-overview/track-secondary', { params })
}

export function postFinancingSync(body) {
  return axios.post('/api/project-sourcing/sync', body)
}

export function postFinancingEventAiEnrich(eventId) {
  return axios.post(`/api/project-sourcing/events/${eventId}/ai-enrich`)
}

export function postFinancingBatchAiEnrich(body) {
  return axios.post('/api/project-sourcing/batch-ai-enrich', body)
}

export function fetchFinancingAiEnrichLogs(params) {
  return axios.get('/api/project-sourcing/ai-enrich-logs', { params })
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

export function postFinancingEventBaikeLookup(eventId) {
  return axios.post(`/api/project-sourcing/events/${eventId}/baike-lookup`)
}

export function postFinancingBatchBaikeLookup(body) {
  return axios.post('/api/project-sourcing/batch-baike-lookup', body)
}
