/**
 * 竞品分析完成通知的手机号。空值表示本次不发送。
 * @returns {{ ok: boolean, phone: string|null, message?: string }}
 */
function normalizeNotifyPhone(raw) {
  const phone = String(raw == null ? '' : raw).trim();
  if (!phone) return { ok: true, phone: null };
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return { ok: false, phone: null, message: '请输入正确的手机号码' };
  }
  return { ok: true, phone };
}

function maskNotifyPhone(phone) {
  const s = String(phone || '');
  if (s.length < 7) return s;
  return `${s.slice(0, 3)}****${s.slice(-4)}`;
}

module.exports = {
  normalizeNotifyPhone,
  maskNotifyPhone,
};
