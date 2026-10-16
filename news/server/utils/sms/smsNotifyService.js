const crypto = require('crypto');
const https = require('https');
const db = require('../../db');
const { generateId } = require('../idGenerator');
const { normalizeNotifyPhone, maskNotifyPhone } = require('./smsNotifyPhone');

function trimTo(value, max) {
  const s = String(value == null ? '' : value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeSignName(raw) {
  return trimTo(String(raw || '').replace(/^【/, '').replace(/】$/, ''), 64);
}

function normalizeProvider(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'aliyun' || s === '阿里' || s === '阿里云') return 'aliyun';
  if (s === 'tencent' || s === '腾讯' || s === '腾讯云') return 'tencent';
  return '';
}

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function aliyunTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function signAliyun(params, accessKeySecret) {
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonical)}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
}

function sha256(message, secret, encoding) {
  const hmac = crypto.createHmac('sha256', secret);
  return encoding ? hmac.update(message).digest(encoding) : hmac.update(message).digest();
}

function hash256(message) {
  return crypto.createHash('sha256').update(message).digest('hex');
}

function httpsPostJson(url, { headers, body, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = text;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { Message: text };
          }
          resolve({ statusCode: res.statusCode, data });
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('短信请求超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function loadConfigRow() {
  const rows = await db.query(
    `SELECT F_Id, provider, access_key_id, access_key_secret, sign_name, template_code, sdk_app_id, is_active
     FROM sms_notify_config
     WHERE F_DeleteMark = 0
     ORDER BY F_LastModifyTime DESC, F_Id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

function toPublicConfig(row) {
  if (!row) {
    return {
      provider: 'aliyun',
      access_key_id: '',
      sign_name: '',
      template_code: '',
      sdk_app_id: '',
      is_active: true,
      has_secret: false,
    };
  }
  return {
    provider: row.provider === 'tencent' ? 'tencent' : 'aliyun',
    access_key_id: row.access_key_id || '',
    sign_name: row.sign_name || '',
    template_code: row.template_code || '',
    sdk_app_id: row.sdk_app_id || '',
    is_active: Number(row.is_active) === 1,
    has_secret: !!String(row.access_key_secret || '').trim(),
  };
}

async function getSmsNotifyConfigPublic() {
  return toPublicConfig(await loadConfigRow());
}

async function saveSmsNotifyConfig(body) {
  const provider = normalizeProvider(body?.provider);
  if (!provider) {
    const e = new Error('请选择短信厂家');
    e.code = 400;
    throw e;
  }
  const accessKeyId = trimTo(body?.access_key_id, 128);
  const signName = normalizeSignName(body?.sign_name);
  const templateCode = trimTo(body?.template_code, 64);
  const sdkAppId = trimTo(body?.sdk_app_id, 64);
  const secretInput = trimTo(body?.access_key_secret, 255);
  const isActive = body?.is_active === false || body?.is_active === 0 ? 0 : 1;
  if (!accessKeyId) {
    const e = new Error('请填写用户编号');
    e.code = 400;
    throw e;
  }
  if (!signName) {
    const e = new Error('请填写签名内容');
    e.code = 400;
    throw e;
  }
  if (!templateCode) {
    const e = new Error('请填写模板编号');
    e.code = 400;
    throw e;
  }
  if (provider === 'tencent' && !sdkAppId) {
    const e = new Error('腾讯云请填写短信应用编号');
    e.code = 400;
    throw e;
  }

  const existing = await loadConfigRow();
  const secret = secretInput || (existing ? String(existing.access_key_secret || '').trim() : '');
  if (!secret) {
    const e = new Error('请填写用户密钥');
    e.code = 400;
    throw e;
  }

  if (existing) {
    await db.execute(
      `UPDATE sms_notify_config
       SET provider = ?, access_key_id = ?, access_key_secret = ?, sign_name = ?, template_code = ?,
           sdk_app_id = ?, is_active = ?, F_LastModifyTime = NOW()
       WHERE F_Id = ?`,
      [provider, accessKeyId, secret, signName, templateCode, sdkAppId || null, isActive, existing.F_Id]
    );
  } else {
    const id = await generateId('sms_notify_config');
    await db.execute(
      `INSERT INTO sms_notify_config (
         F_Id, provider, access_key_id, access_key_secret, sign_name, template_code, sdk_app_id, is_active,
         F_CreatorTime, F_LastModifyTime, F_DeleteMark
       ) VALUES (?,?,?,?,?,?,?,?,NOW(),NOW(),0)`,
      [id, provider, accessKeyId, secret, signName, templateCode, sdkAppId || null, isActive]
    );
  }
  return getSmsNotifyConfigPublic();
}

async function sendAliyun({ accessKeyId, accessKeySecret, signName, templateCode, phone, enterpriseFullName }) {
  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ name: enterpriseFullName }),
    Timestamp: aliyunTimestamp(),
    Version: '2017-05-25',
  };
  params.Signature = signAliyun(params, accessKeySecret);
  const body = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&');
  let data;
  try {
    const res = await httpsPostJson('https://dysmsapi.aliyuncs.com/', {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    data = res.data;
  } catch (err) {
    throw new Error(String(err.message || '阿里云短信请求失败').slice(0, 300));
  }
  if (data && data.Code === 'OK') return data.Message || 'OK';
  throw new Error(String(data?.Message || data?.Code || '阿里云短信发送失败').slice(0, 300));
}

async function sendTencent({
  accessKeyId,
  accessKeySecret,
  sdkAppId,
  signName,
  templateCode,
  phone,
  enterpriseFullName,
}) {
  const host = 'sms.tencentcloudapi.com';
  const service = 'sms';
  const action = 'SendSms';
  const version = '2021-01-11';
  const region = 'ap-guangzhou';
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify({
    PhoneNumberSet: String(phone || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `+86${item}`),
    SmsSdkAppId: sdkAppId,
    SignName: signName,
    TemplateId: templateCode,
    TemplateParamSet: [enterpriseFullName],
  });
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hash256(payload)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, hash256(canonicalRequest)].join('\n');
  const secretDate = sha256(date, `TC3${accessKeySecret}`);
  const secretService = sha256(service, secretDate);
  const secretSigning = sha256('tc3_request', secretService);
  const signature = sha256(stringToSign, secretSigning, 'hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  let data;
  try {
    const res = await httpsPostJson(`https://${host}/`, {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': version,
        'X-TC-Region': region,
      },
      body: payload,
    });
    data = res.data;
  } catch (err) {
    throw new Error(String(err.message || '腾讯云短信请求失败').slice(0, 300));
  }
  const apiErr = data?.Response?.Error;
  if (apiErr) throw new Error(String(apiErr.Message || apiErr.Code || '腾讯云短信发送失败').slice(0, 300));
  const set = data?.Response?.SendStatusSet || [];
  const failed = set.filter((item) => String(item.Code || '').toLowerCase() !== 'ok');
  if (!set.length || failed.length === set.length) {
    const send = failed[0] || set[0];
    throw new Error(String(send?.Message || send?.Code || '腾讯云短信发送失败').slice(0, 300));
  }
  if (failed.length) {
    const err = new Error(failed.map((item) => item.Message || item.Code).join('；').slice(0, 300));
    err.partial = true;
    err.failedPhones = failed.map((item) => String(item.PhoneNumber || '').replace(/^\+86/, ''));
    throw err;
  }
  return set[0]?.Message || 'OK';
}

async function writeSendLog(entry) {
  try {
    const id = await generateId('sms_notify_log');
    await db.execute(
      `INSERT INTO sms_notify_log (
         F_Id, provider, phone, template_code, enterprise_full_name, subject_type, subject_id,
         run_id, user_id, status, provider_message, F_CreatorTime
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())`,
      [
        id,
        entry.provider || null,
        entry.phone,
        entry.templateCode || null,
        entry.enterpriseFullName ? String(entry.enterpriseFullName).slice(0, 255) : null,
        entry.subjectType || null,
        entry.subjectId || null,
        entry.runId || null,
        entry.userId || null,
        entry.status,
        entry.message ? String(entry.message).slice(0, 500) : null,
      ]
    );
  } catch (err) {
    console.warn('[smsNotify] 写入发送记录失败', err.message);
  }
}

async function getLastNotifyPhone({ userId, subjectType, subjectId }) {
  const uid = String(userId || '').trim();
  const sid = String(subjectId || '').trim();
  if (!uid || !sid) return '';
  const pre = String(subjectType || '') === 'pre_investment_project';
  const table = pre ? 'sourcing_pre_investment_competitor_run' : 'sourcing_competitor_run';
  const column = pre ? 'pre_investment_project_id' : 'invested_enterprise_id';
  const rows = await db.query(
    `SELECT notify_phone
     FROM \`${table}\`
     WHERE \`${column}\` = ? AND triggered_by_user_id = ?
       AND notify_phone IS NOT NULL AND notify_phone <> ''
       AND F_DeleteMark = 0
     ORDER BY started_at DESC, F_Id DESC
     LIMIT 1`,
    [sid, uid]
  );
  return rows[0]?.notify_phone ? String(rows[0].notify_phone) : '';
}

/**
 * 竞品分析成功后发送完成通知。未填手机号时不发送。
 * 发送失败只记日志，不改变分析运行结果。
 */
async function notifyCompetitorAnalysisDone({ subjectType, runId, subjectId, enterpriseFullName, userId }) {
  const pre = subjectType === 'pre_investment_project';
  const table = pre ? 'sourcing_pre_investment_competitor_run' : 'sourcing_competitor_run';
  const rows = await db.query(
    `SELECT notify_phone, triggered_by_user_id FROM \`${table}\` WHERE F_Id = ? LIMIT 1`,
    [runId]
  );
  const parsed = normalizeNotifyPhone(rows[0]?.notify_phone);
  const phones = parsed.phones || [];
  if (!parsed.ok || !phones.length) return { attempted: false };
  const phone = phones.join(',');

  const name = trimTo(enterpriseFullName, 100);
  const actorId = userId || rows[0]?.triggered_by_user_id || null;
  const baseLog = {
    enterpriseFullName: name,
    subjectType,
    subjectId,
    runId,
    userId: actorId,
  };
  const logEach = async (status, message, onlyPhones, extra) => {
    for (const one of onlyPhones || phones) {
      await writeSendLog({ ...baseLog, ...(extra || {}), phone: one, status, message });
    }
  };
  if (!name) {
    await logEach('failed', '缺少企业全称，未发送');
    return { attempted: true, ok: false, message: '缺少企业全称，未发送短信' };
  }

  const config = await loadConfigRow();
  if (!config || Number(config.is_active) !== 1) {
    await logEach('failed', '短信通知未配置或未启用');
    return { attempted: true, ok: false, message: '短信通知未配置或未启用，未发送' };
  }

  const provider = config.provider === 'tencent' ? 'tencent' : 'aliyun';
  const providerExtra = { provider, templateCode: config.template_code };
  try {
    const providerMessage =
      provider === 'tencent'
        ? await sendTencent({
            accessKeyId: config.access_key_id,
            accessKeySecret: config.access_key_secret,
            sdkAppId: config.sdk_app_id,
            signName: config.sign_name,
            templateCode: config.template_code,
            phone,
            enterpriseFullName: name,
          })
        : await sendAliyun({
            accessKeyId: config.access_key_id,
            accessKeySecret: config.access_key_secret,
            signName: config.sign_name,
            templateCode: config.template_code,
            phone,
            enterpriseFullName: name,
          });
    await logEach('success', providerMessage, null, providerExtra);
    return { attempted: true, ok: true, message: `已向 ${maskNotifyPhone(phone)} 发送完成通知` };
  } catch (err) {
    const failedSet = new Set(err.failedPhones || []);
    if (err.partial && failedSet.size) {
      await logEach('success', 'OK', phones.filter((one) => !failedSet.has(one)), providerExtra);
      await logEach('failed', err.message, phones.filter((one) => failedSet.has(one)), providerExtra);
    } else {
      await logEach('failed', err.message, null, providerExtra);
    }
    return { attempted: true, ok: false, message: `短信发送失败：${err.message}` };
  }
}

module.exports = {
  normalizeNotifyPhone,
  getSmsNotifyConfigPublic,
  saveSmsNotifyConfig,
  getLastNotifyPhone,
  notifyCompetitorAnalysisDone,
};
