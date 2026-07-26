'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { resolvePythonBin, pythonArgs } = require('../../scripts/resolvePython');
const { fetchQichachaFuzzyCompanies } = require('../qichachaFuzzySearch');
const { normalizeCreditCode, strTrim } = require('../competitor-analysis/competitorMatchUtils');

const PY_BULK = path.join(__dirname, 'listed_name_uscc_bulk_fetch.py');
const PY_PROBE = path.join(__dirname, 'new_share_profile_probe.py');

function hasText(v) {
  return v != null && String(v).trim() !== '';
}

function needsName(row) {
  return !hasText(row.enterprise_full_name_cn) && !hasText(row.enterprise_full_name_display);
}

function needsUscc(row) {
  return !hasText(row.unified_credit_code);
}

function needsProfile(row) {
  return needsName(row) || needsUscc(row);
}

function hasAssociableProfile(row) {
  return (
    hasText(row.unified_credit_code) ||
    hasText(row.enterprise_full_name_cn) ||
    hasText(row.enterprise_full_name_display)
  );
}

function runBulkNameUsccFetch(limit = 0) {
  const py = resolvePythonBin();
  const args = pythonArgs(PY_BULK, limit > 0 ? [`--limit=${limit}`] : []);
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TQDM_DISABLE: '1' },
    maxBuffer: 40 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'listed_name_uscc_bulk_fetch failed');
  }
  const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
  const payload = JSON.parse(line);
  if (!payload.ok || !Array.isArray(payload.rows)) {
    throw new Error('listed_name_uscc_bulk_fetch output invalid');
  }
  const map = new Map();
  for (const row of payload.rows) {
    const code = strTrim(row.stock_code);
    if (code) map.set(code, row);
  }
  return { payload, map };
}

function probeProfileSync(stockCode, exchange) {
  const py = resolvePythonBin();
  const r = spawnSync(py, pythonArgs(PY_PROBE, ['--code', String(stockCode), '--exchange', String(exchange || '')]), {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TQDM_DISABLE: '1' },
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  try {
    const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function pickQichachaMatch(stockName, companies) {
  const sn = strTrim(stockName);
  const valid = (companies || []).filter((c) => normalizeCreditCode(c.creditCode).length >= 15);
  if (!valid.length) return null;
  const exact = valid.find((c) => strTrim(c.name) === sn);
  if (exact) return exact;
  const partial = valid.find((c) => {
    const n = strTrim(c.name);
    return n.includes(sn) || sn.includes(n);
  });
  if (partial) return partial;
  if (valid.length === 1) return valid[0];
  return null;
}

function mergeEastmoneyFields(row, source, force = false) {
  const out = {
    enterprise_full_name_cn: strTrim(row.enterprise_full_name_cn),
    enterprise_full_name_display: strTrim(row.enterprise_full_name_display),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    profile_source: strTrim(row.profile_source),
    changed: false,
    filled_name: false,
    filled_uscc: false,
  };
  const fullName = strTrim(source.enterprise_full_name);
  const uscc = normalizeCreditCode(source.unified_credit_code);
  if (fullName && (force || needsName(row))) {
    if (!out.enterprise_full_name_cn) {
      out.enterprise_full_name_cn = fullName;
      out.filled_name = true;
      out.changed = true;
    }
    if (!out.enterprise_full_name_display) {
      out.enterprise_full_name_display = fullName;
      out.changed = true;
    }
  }
  if (uscc.length >= 15 && (force || needsUscc(row))) {
    if (!out.unified_credit_code || force) {
      out.unified_credit_code = uscc;
      out.filled_uscc = true;
      out.changed = true;
    }
  }
  if (out.changed && !out.profile_source) {
    out.profile_source = 'eastmoney_f10';
  }
  return out;
}

function mergeQichachaFields(row, match, force = false) {
  const out = {
    enterprise_full_name_cn: strTrim(row.enterprise_full_name_cn),
    enterprise_full_name_display: strTrim(row.enterprise_full_name_display),
    unified_credit_code: normalizeCreditCode(row.unified_credit_code),
    profile_source: strTrim(row.profile_source),
    changed: false,
    filled_name: false,
    filled_uscc: false,
  };
  if (!match) return out;
  const fullName = strTrim(match.name);
  const uscc = normalizeCreditCode(match.creditCode);
  if (fullName && (force || needsName(row))) {
    if (!out.enterprise_full_name_cn) {
      out.enterprise_full_name_cn = fullName;
      out.filled_name = true;
      out.changed = true;
    }
    if (!out.enterprise_full_name_display) {
      out.enterprise_full_name_display = fullName;
      out.changed = true;
    }
  }
  if (uscc.length >= 15 && (force || needsUscc(row))) {
    if (!out.unified_credit_code) {
      out.unified_credit_code = uscc;
      out.filled_uscc = true;
      out.changed = true;
    }
  }
  if (out.changed) {
    out.profile_source = out.profile_source || 'qichacha';
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryQichachaForRow(row, opts = {}) {
  const keyword = strTrim(row.stock_name);
  if (keyword.length < 2) return null;
  try {
    const res = await fetchQichachaFuzzyCompanies(keyword, { pageIndex: 1 });
    const match = pickQichachaMatch(keyword, res.companies);
    if (!match) return null;
    return mergeQichachaFields(row, match, opts.force);
  } catch (e) {
    if (e.code === 'NO_CONFIG') return null;
    throw e;
  }
}

module.exports = {
  hasText,
  needsName,
  needsUscc,
  needsProfile,
  hasAssociableProfile,
  runBulkNameUsccFetch,
  probeProfileSync,
  pickQichachaMatch,
  mergeEastmoneyFields,
  mergeQichachaFields,
  tryQichachaForRow,
  sleep,
};
