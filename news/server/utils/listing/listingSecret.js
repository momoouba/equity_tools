const crypto = require('crypto');

const ALGO = 'aes-256-cbc';
const IV_LEN = 16;

function buildKey() {
  const secret =
    process.env.LISTING_SECRET_KEY ||
    process.env.APP_SECRET ||
    process.env.JWT_SECRET ||
    'listing-default-secret-change-me';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptText(plainText) {
  const text = String(plainText || '');
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LEN);
  const key = buildKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptText(cipherText) {
  const raw = String(cipherText || '');
  if (!raw) return '';
  const [ivHex, dataHex] = raw.split(':');
  if (!ivHex || !dataHex) return raw;
  const iv = Buffer.from(ivHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const key = buildKey();
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

function maskToken(token) {
  const s = String(token || '');
  if (!s) return '';
  if (s.length <= 12) return '******';
  return `${s.slice(0, 6)}******${s.slice(-4)}`;
}

module.exports = { encryptText, decryptText, maskToken };
