import axios from '../../utils/axios'

export function fetchFinancingEvents(params) {
  return axios.get('/api/project-sourcing/events', { params })
}

export function postFinancingSync(body) {
  return axios.post('/api/project-sourcing/sync', body)
}
