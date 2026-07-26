'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const { resolvePythonBin, pythonArgs } = require('../../scripts/resolvePython');
const { fetchCompanyBriefGetInfo } = require('../qichachaCompanyBrief');

const PY_INTRO_BULK = path.join(__dirname, 'listed_profile_intro_bulk_fetch.py');
const PY_BAIKE = path.join(__dirname, '../project-sourcing/baidu_baike_fetch.py');
const MIN_INTRO_LEN = 20;

function hasText(v) {
  return v != null && String(v).trim() !== '';
}

function isValidIntro(v, minLen = MIN_INTRO_LEN) {
  return hasText(v) && String(v).trim().length >= minLen;
}

function needsIntro(row) {
  return !isValidIntro(row.product_intro);
}

function needsCompanyIntro(row) {
  return !isValidIntro(row.company_intro);
}

function runBulkIntroFetch(limit = 0) {
  const py = resolvePythonBin();
  const args = pythonArgs(PY_INTRO_BULK, limit > 0 ? [`--limit=${limit}`] : []);
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', TQDM_DISABLE: '1' },
    maxBuffer: 60 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || r.stdout || 'listed_profile_intro_bulk_fetch failed');
  }
  const line = String(r.stdout || '').trim().split('\n').filter(Boolean).pop();
  const payload = JSON.parse(line);
  if (!payload.ok || !Array.isArray(payload.rows)) {
    throw new Error('listed_profile_intro_bulk_fetch output invalid');
  }
  const map = new Map();
  for (const row of payload.rows) {
    const code = String(row.stock_code || '').trim();
    if (code) map.set(code, row);
  }
  return { payload, map };
}

function fetchBaikeSync(companyName, sleepMs = 1200) {
  const name = String(companyName || '').trim();
  if (name.length < 2) return null;
  const py = resolvePythonBin();
  const args = pythonArgs(PY_BAIKE, ['--name', name, '--sleep-ms', String(sleepMs), '--dry-json']);
  const r = spawnSync(py, args, {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
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

function buildSwIndustryTags(row) {
  const tags = [];
  for (const t of [row.sw_industry_l1, row.sw_industry_l2, row.industry_category_4]) {
    const s = String(t || '').trim();
    if (s && !tags.includes(s)) tags.push(s);
  }
  return {
    industry_tags_display: tags.join('、'),
    industry_tags_json: tags.length ? JSON.stringify(tags) : null,
  };
}

function mergeEastmoneyIntro(row, source, force = false) {
  const out = {
    company_intro: String(row.company_intro || '').trim(),
    product_intro: String(row.product_intro || '').trim(),
    profile_source: String(row.profile_source || '').trim(),
    industry_tags_display: String(row.industry_tags_display || '').trim(),
    industry_tags_json: row.industry_tags_json,
    changed: false,
    filled_company: false,
    filled_product: false,
  };
  const companyIntro = String(source.company_intro || '').trim();
  const productIntro = String(source.product_intro || '').trim();

  if (companyIntro && (force || needsCompanyIntro(row))) {
    if (!out.company_intro || force) {
      out.company_intro = companyIntro;
      out.filled_company = true;
      out.changed = true;
    }
  }
  if (productIntro && (force || needsIntro(row))) {
    if (!out.product_intro || force) {
      out.product_intro = productIntro;
      out.filled_product = true;
      out.changed = true;
    }
  }
  if (out.changed && !out.profile_source) {
    out.profile_source = 'eastmoney_f10';
  }
  return out;
}

function mergeBaikeIntro(row, baike, force = false) {
  const out = {
    company_intro: String(row.company_intro || '').trim(),
    product_intro: String(row.product_intro || '').trim(),
    profile_source: String(row.profile_source || '').trim(),
    baike_lemma_url: row.baike_lemma_url || null,
    baike_lemma_status: row.baike_lemma_status || null,
    baike_miss_reason: row.baike_miss_reason || null,
    industry_tags_display: String(row.industry_tags_display || '').trim(),
    industry_tags_json: row.industry_tags_json,
    changed: false,
    filled_product: false,
  };
  if (!baike || !baike.ok) {
    if (baike) {
      out.baike_lemma_status = baike.lemma_status || null;
      out.baike_miss_reason = baike.miss_reason || null;
    }
    return out;
  }
  const companyIntro = String(baike.company_intro || '').trim();
  const productIntro = String(baike.product_intro || companyIntro || '').trim();
  if (companyIntro && (force || needsCompanyIntro(row)) && !out.company_intro) {
    out.company_intro = companyIntro;
    out.changed = true;
  }
  if (productIntro && (force || needsIntro(row))) {
    out.product_intro = productIntro;
    out.filled_product = true;
    out.changed = true;
  }
  if (out.changed) {
    out.profile_source = out.profile_source || 'baike';
    out.baike_lemma_url = baike.lemma_url || baike.url || null;
    out.baike_lemma_status = baike.lemma_status || 'found';
    out.baike_miss_reason = null;
  }
  return out;
}

async function tryQichachaIntro(row, opts = {}) {
  const keyword =
    String(row.enterprise_full_name_cn || '').trim() ||
    String(row.enterprise_full_name_display || '').trim() ||
    String(row.stock_name || '').trim();
  if (keyword.length < 2) return null;
  try {
    const res = await fetchCompanyBriefGetInfo(keyword);
    const desc = String(res.desc || '').trim();
    if (!isValidIntro(desc)) return null;
    const out = {
      company_intro: String(row.company_intro || '').trim(),
      product_intro: String(row.product_intro || '').trim(),
      profile_source: String(row.profile_source || '').trim(),
      industry_tags_display: String(row.industry_tags_display || '').trim(),
      industry_tags_json: row.industry_tags_json,
      changed: false,
      filled_company: false,
      filled_product: false,
    };
    if (opts.force || needsCompanyIntro(row)) {
      if (!out.company_intro || opts.force) {
        out.company_intro = desc;
        out.filled_company = true;
        out.changed = true;
      }
    }
    if (opts.force || needsIntro(row)) {
      if (!out.product_intro || opts.force) {
        out.product_intro = desc;
        out.filled_product = true;
        out.changed = true;
      }
    }
    if (out.changed) {
      out.profile_source = out.profile_source || 'qichacha';
    }
    return out;
  } catch (e) {
    if (e.code === 'NO_CONFIG') return null;
    throw e;
  }
}

function applySwTags(row, merged) {
  const tags = buildSwIndustryTags(row);
  if (!merged.industry_tags_display && tags.industry_tags_display) {
    merged.industry_tags_display = tags.industry_tags_display;
    merged.industry_tags_json = tags.industry_tags_json;
    merged.changed = true;
  }
  return merged;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  MIN_INTRO_LEN,
  hasText,
  isValidIntro,
  needsIntro,
  needsCompanyIntro,
  runBulkIntroFetch,
  fetchBaikeSync,
  buildSwIndustryTags,
  mergeEastmoneyIntro,
  mergeBaikeIntro,
  tryQichachaIntro,
  applySwTags,
  sleep,
};
