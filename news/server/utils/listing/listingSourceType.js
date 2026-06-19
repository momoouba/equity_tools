function normalizeSourceType(config = {}) {
  const type = String(config.interface_type || '').toLowerCase();
  const source = String(config.news_interface_type || '').toLowerCase();
  const name = String(config.name || '').toLowerCase();
  const merged = `${source}|${name}`;

  if (merged.includes('打新') || merged.includes('new_share')) return 'new_share';
  if (merged.includes('辅导') || merged.includes('guidance')) return 'guidance_progress';
  if (merged.includes('境外') || merged.includes('overseas')) return 'overseas_filing';

  if (type === 'crawler') return 'exchange_crawler';
  if (type === 'api') return 'api_generic';
  return 'unknown';
}

function buildTaskKey(config = {}, startDate, endDate) {
  const sourceType = normalizeSourceType(config);
  const cfgId = String(config.id || 'unknown');
  const s = String(startDate || '');
  const e = String(endDate || '');
  return `${sourceType}:${cfgId}:${s}:${e}`;
}

module.exports = {
  normalizeSourceType,
  buildTaskKey,
};

