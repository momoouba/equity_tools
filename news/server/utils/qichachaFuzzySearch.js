'use strict';

const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');
const { maskSearchKeyForLog, previewBodyForLog } = require('./qichachaApiLog');

/**
 * 企查查「企业模糊搜索」FuzzySearch/GetList（与 routes/qichacha.js 一致：企业信息 + 启用配置）。
 * @param {string} keyword
 * @param {{ pageIndex?: number }} [opts]
 * @returns {Promise<{ status: string, message: string, companies: Array<{ name: string, creditCode: string, website: string, startDate: string, operName: string, status: string, address: string }> }>}
 */
async function fetchQichachaFuzzyCompanies(keyword, opts = {}) {
  const t0 = Date.now();
  const searchKey = String(keyword || '').trim();
  const keyHint = maskSearchKeyForLog(searchKey);
  if (searchKey.length < 2) {
    console.warn(`[企查查API] FuzzySearch/GetList 跳过 BAD_PARAM searchKey=${keyHint}`);
    const e = new Error('搜索关键词至少 2 个字符');
    e.code = 400;
    throw e;
  }
  const pageIndex = Math.max(1, parseInt(opts.pageIndex ?? '1', 10) || 1);

  const configs = await db.query(
    `SELECT qichacha_app_key, qichacha_secret_key, qichacha_daily_limit
     FROM qichacha_config
     WHERE interface_type = '企业信息' AND is_active = 1 AND delete_mark = 0
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (!configs.length) {
    console.warn(`[企查查API] FuzzySearch/GetList 配置缺失 searchKey=${keyHint} pageIndex=${pageIndex}`);
    const e = new Error('请先配置企查查「企业信息」接口的应用凭证与秘钥');
    e.code = 'NO_CONFIG';
    throw e;
  }
  const appKey = String(configs[0].qichacha_app_key || '').trim();
  const secretKey = String(configs[0].qichacha_secret_key || '').trim();
  if (!appKey || !secretKey) {
    console.warn(`[企查查API] FuzzySearch/GetList 凭证为空 searchKey=${keyHint} pageIndex=${pageIndex}`);
    const e = new Error('企查查应用凭证或秘钥为空');
    e.code = 'NO_CONFIG';
    throw e;
  }

  const timespan = Math.floor(Date.now() / 1000).toString();
  const token = crypto.createHash('md5').update(appKey + timespan + secretKey).digest('hex').toUpperCase();

  console.log(`[企查查API] FuzzySearch/GetList 请求开始 searchKey=${keyHint} pageIndex=${pageIndex} timeoutMs=15000`);
  let response;
  try {
    response = await axios.get('https://api.qichacha.com/FuzzySearch/GetList', {
      params: { key: appKey, searchKey, pageIndex },
      headers: { Token: token, Timespan: timespan },
      timeout: 15000,
    });
  } catch (axiosErr) {
    const ms = Date.now() - t0;
    const st = axiosErr.response?.status;
    const prev = previewBodyForLog(axiosErr.response?.data);
    console.error(
      `[企查查API] FuzzySearch/GetList HTTP异常 durationMs=${ms} searchKey=${keyHint} pageIndex=${pageIndex} httpStatus=${st ?? '-'} message=${axiosErr.message} bodyPreview=${prev}`
    );
    throw axiosErr;
  }

  const body = response.data || {};
  const httpStatus = response.status;
  const status = String(body.Status ?? body.status ?? '');
  const message = String(body.Message ?? body.message ?? '');

  if (status === '201' || status === '204') {
    const ms = Date.now() - t0;
    console.log(
      `[企查查API] FuzzySearch/GetList 完成 durationMs=${ms} searchKey=${keyHint} pageIndex=${pageIndex} httpStatus=${httpStatus} bizStatus=${status} companyCount=0`
    );
    return { status, message: message || '查询无结果', companies: [] };
  }
  if (status !== '200') {
    const msFail = Date.now() - t0;
    console.warn(
      `[企查查API] FuzzySearch/GetList 业务失败 durationMs=${msFail} searchKey=${keyHint} pageIndex=${pageIndex} httpStatus=${httpStatus} bizStatus=${status} message=${message} bodyPreview=${previewBodyForLog(body)}`
    );
    const err = new Error(message || `企查查返回状态 ${status || '(空)'}`);
    err.code = 'QCC_API';
    err.status = status;
    throw err;
  }

  const result = body.Result || body.result;
  let list = Array.isArray(result) ? result : [];
  if (!list.length && result && typeof result === 'object' && !Array.isArray(result)) {
    const data = result.Data ?? result.data ?? result.List ?? result.list;
    if (Array.isArray(data)) list = data;
  }
  const companies = list.map((item) => ({
    name: item.Name || item.name || '',
    creditCode: item.CreditCode || item.creditCode || '',
    website: item.Website || item.website || '',
    startDate: item.StartDate || item.startDate || '',
    operName: item.OperName || item.operName || '',
    status: item.Status || item.status || '',
    address: item.Address || item.address || '',
  }));

  const msDone = Date.now() - t0;
  console.log(
    `[企查查API] FuzzySearch/GetList 完成 durationMs=${msDone} searchKey=${keyHint} pageIndex=${pageIndex} httpStatus=${httpStatus} bizStatus=${status} companyCount=${companies.length}`
  );
  return { status, message: message || 'ok', companies };
}

module.exports = { fetchQichachaFuzzyCompanies };
