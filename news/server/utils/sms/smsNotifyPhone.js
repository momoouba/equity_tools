const PHONE_RE = /^1[3-9]\d{9}$/;
const MAX_NOTIFY_PHONES = 20;

/**
 * 竞品分析完成通知的手机号。空值表示本次不发送。
 * 多个号码用中文或英文逗号分隔，存库时统一为英文逗号。
 * @returns {{ ok: boolean, phone: string|null, phones: string[], message?: string }}
 */
function normalizeNotifyPhone(raw) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: true, phone: null, phones: [] };
  const parts = text.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return { ok: true, phone: null, phones: [] };
  const invalid = parts.filter((item) => !PHONE_RE.test(item));
  if (invalid.length) {
    return { ok: false, phone: null, phones: [], message: `请输入正确的手机号码：${invalid.join('、')}` };
  }
  const phones = [];
  const seen = new Set();
  for (const item of parts) {
    if (seen.has(item)) continue;
    seen.add(item);
    phones.push(item);
  }
  if (phones.length > MAX_NOTIFY_PHONES) {
    return { ok: false, phone: null, phones: [], message: `最多填写 ${MAX_NOTIFY_PHONES} 个手机号` };
  }
  return { ok: true, phone: phones.join(','), phones };
}

function maskNotifyPhone(phone) {
  return String(phone || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.length < 7 ? item : `${item.slice(0, 3)}****${item.slice(-4)}`))
    .join('、');
}

module.exports = {
  normalizeNotifyPhone,
  maskNotifyPhone,
};
