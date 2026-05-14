/**
 * 企查查「企业简介」CompanyBrief/GetInfo（文档 955 企业简介 V1.0）
 * Token：Md5(key + Timespan + SecretKey) 大写；配置与 /api/qichacha/search 一致：企业信息 + 启用。
 */
const axios = require('axios');
const crypto = require('crypto');
const db = require('../db');
const { maskSearchKeyForLog, previewBodyForLog } = require('./qichachaApiLog');

/**
 * @returns {Promise<{ appKey: string, secretKey: string, dailyLimit: number }>}
 */
async function getActiveQichachaEnterpriseInfoConfig() {
  const rows = await db.query(
    `SELECT qichacha_app_key, qichacha_secret_key, qichacha_daily_limit
     FROM qichacha_config
     WHERE interface_type = '企业信息' AND is_active = 1 AND delete_mark = 0
     ORDER BY created_at DESC
     LIMIT 1`
  );
  if (!rows.length) {
    const err = new Error('未配置企查查「企业信息」接口或已停用，请在系统配置中维护 qichacha_config');
    err.code = 'NO_CONFIG';
    throw err;
  }
  const appKey = String(rows[0].qichacha_app_key || '').trim();
  const secretKey = String(rows[0].qichacha_secret_key || '').trim();
  const dailyLimit = Math.max(0, parseInt(rows[0].qichacha_daily_limit || '100', 10) || 100);
  if (!appKey || !secretKey) {
    const err = new Error('企查查应用凭证或秘钥为空');
    err.code = 'NO_CONFIG';
    throw err;
  }
  return { appKey, secretKey, dailyLimit };
}

function buildQichachaAuthHeaders(appKey, secretKey) {
  const timespan = Math.floor(Date.now() / 1000).toString();
  const token = crypto.createHash('md5').update(appKey + timespan + secretKey).digest('hex').toUpperCase();
  return { timespan, token };
}

/**
 * @param {string} searchKey 公司名或统一社会信用代码（文档要求，长度≥2）
 * @returns {Promise<{ status: string, message: string, desc: string|null, verifyResult: number|null, orderNumber?: string }>}
 */
async function fetchCompanyBriefGetInfo(searchKey) {
  const t0 = Date.now();
  const key = String(searchKey || '').trim();
  const keyHint = maskSearchKeyForLog(key);
  if (key.length < 2) {
    console.warn(`[企查查API] CompanyBrief/GetInfo 跳过 BAD_PARAM searchKey=${keyHint}`);
    const err = new Error('企查查 searchKey 长度不能小于 2');
    err.code = 'BAD_PARAM';
    throw err;
  }
  let appKey;
  let secretKey;
  try {
    const cfg = await getActiveQichachaEnterpriseInfoConfig();
    appKey = cfg.appKey;
    secretKey = cfg.secretKey;
  } catch (e) {
    if (e && e.code === 'NO_CONFIG') {
      console.warn(`[企查查API] CompanyBrief/GetInfo 配置不可用 searchKey=${keyHint} message=${e.message}`);
    }
    throw e;
  }
  const { timespan, token } = buildQichachaAuthHeaders(appKey, secretKey);
  const url = 'https://api.qichacha.com/CompanyBrief/GetInfo';
  console.log(`[企查查API] CompanyBrief/GetInfo 请求开始 searchKey=${keyHint} timeoutMs=20000`);
  let response;
  try {
    response = await axios.get(url, {
      params: { key: appKey, searchKey: key },
      headers: { Token: token, Timespan: timespan },
      timeout: 20000,
    });
  } catch (axiosErr) {
    const ms = Date.now() - t0;
    const st = axiosErr.response?.status;
    const prev = previewBodyForLog(axiosErr.response?.data);
    console.error(
      `[企查查API] CompanyBrief/GetInfo HTTP异常 durationMs=${ms} searchKey=${keyHint} httpStatus=${st ?? '-'} message=${axiosErr.message} bodyPreview=${prev}`
    );
    throw axiosErr;
  }
  const body = response.data || {};
  const httpStatus = response.status;
  const status = String(body.Status ?? body.status ?? '');
  const message = String(body.Message ?? body.message ?? '');
  const orderNumber = body.OrderNumber ?? body.orderNumber;
  const ms = Date.now() - t0;

  if (status === '201') {
    console.log(
      `[企查查API] CompanyBrief/GetInfo 完成 durationMs=${ms} searchKey=${keyHint} httpStatus=${httpStatus} bizStatus=${status} descLen=0`
    );
    return { status, message: message || '查询无结果', desc: null, verifyResult: 0, orderNumber };
  }
  if (status === '200') {
    const result = body.Result ?? body.result;
    const verifyResult = result != null ? Number(result.VerifyResult ?? result.verifyResult ?? 0) : 0;
    const data = result && (result.Data ?? result.data);
    const desc = data && (data.Desc ?? data.desc);
    const text = desc == null || String(desc).trim() === '' ? null : String(desc).trim();
    console.log(
      `[企查查API] CompanyBrief/GetInfo 完成 durationMs=${ms} searchKey=${keyHint} httpStatus=${httpStatus} bizStatus=${status} verifyResult=${verifyResult} descLen=${text ? text.length : 0}`
    );
    return { status, message: message || '查询成功', desc: text, verifyResult, orderNumber };
  }

  console.warn(
    `[企查查API] CompanyBrief/GetInfo 业务失败 durationMs=${ms} searchKey=${keyHint} httpStatus=${httpStatus} bizStatus=${status} message=${message} bodyPreview=${previewBodyForLog(body)}`
  );
  const err = new Error(message || `企查查返回状态 ${status || '(空)'}`);
  err.code = 'QCC_API';
  err.status = status;
  throw err;
}

module.exports = {
  getActiveQichachaEnterpriseInfoConfig,
  fetchCompanyBriefGetInfo,
};
