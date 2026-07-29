/**
 * 无依赖 ZIP 打包（DEFLATE；xlsx 等已压缩文件用 store 亦可，统一 deflate 更通用）。
 * files: [{ name: string, data: Buffer|string }]
 * @returns {Buffer}
 */
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i += 1) {
    c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function sanitizeZipEntryName(name) {
  return String(name || 'file')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '_')
    .slice(0, 200) || 'file';
}

function createZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const list = Array.isArray(files) ? files : [];

  for (const f of list) {
    const name = sanitizeZipEntryName(f.name);
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '');
    const compressed = zlib.deflateRawSync(data);
    const method = 8;
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);
    const localOffset = offset;
    localParts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(localOffset),
      nameBuf,
    ]);
    centralParts.push(central);
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(list.length),
    u16(list.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, centralDir, end]);
}

module.exports = { createZipBuffer };
