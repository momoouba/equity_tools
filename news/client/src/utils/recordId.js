/**
 * Resolve table row primary key after DB F_ column migration (F_Id / f_id / id).
 */
export function resolveRecordId(record, index) {
  if (!record || typeof record !== 'object') {
    return index != null ? `row-${index}` : undefined
  }
  const raw = record.F_Id ?? record.f_id ?? record.id
  if (raw == null || raw === '') {
    return index != null ? `row-${index}` : undefined
  }
  return String(raw)
}

/** Normalize list rows so legacy UI code can use f_id / id interchangeably. */
export function normalizeRecordId(record) {
  if (!record || typeof record !== 'object') return record
  const id = record.F_Id ?? record.f_id ?? record.id
  if (id == null || id === '') return record
  return {
    ...record,
    F_Id: record.F_Id ?? id,
    f_id: record.f_id ?? id,
    id: record.id ?? id,
  }
}

export function normalizeRecordList(list) {
  if (!Array.isArray(list)) return []
  return list.map(normalizeRecordId)
}
