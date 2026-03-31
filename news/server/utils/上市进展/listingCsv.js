/**
 * UTF-8 CSV（带 BOM，便于 Excel 打开）
 */
function csvEscape(val) {
  if (val === null || val === undefined) return '""';
  const s = String(val);
  return `"${s.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows, columnDefs) {
  const header = columnDefs.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) =>
    columnDefs.map((c) => csvEscape(c.get ? c.get(row) : row[c.key])).join(',')
  );
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

function formatCsvDateYmdSlash(val) {
  if (val === null || val === undefined || val === '') return '';
  const s = String(val).trim();
  // Prefer exact date substring parse to avoid timezone shifts.
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    return `${m[1]}/${Number(m[2])}/${Number(m[3])}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function sendCsv(res, filename, csvBody) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csvBody);
}

module.exports = { rowsToCsv, sendCsv, formatCsvDateYmdSlash };
