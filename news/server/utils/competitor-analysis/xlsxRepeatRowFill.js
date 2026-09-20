/**
 * 给 xlsx 工作簿指定行加实心底色（SheetJS 社区版不写填充，需补 styles.xml）。
 */
const zlib = require('zlib');

const REPEAT_FILL_ARGB = 'FFFFECE8';

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function unzipXlsx(buf) {
  const files = {};
  let i = 0;
  while (i + 30 <= buf.length) {
    const sig = buf.readUInt32LE(i);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) break;
    const method = buf.readUInt16LE(i + 8);
    const comp = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nlen).toString('utf8');
    const dataStart = i + 30 + nlen + elen;
    const compressed = buf.slice(dataStart, dataStart + comp);
    files[name] = method === 0 ? compressed : zlib.inflateRawSync(compressed);
    i = dataStart + comp;
  }
  return files;
}

function zipXlsx(files) {
  const chunks = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const n = Object.keys(files).length;
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(n, 8);
  eocd.writeUInt16LE(n, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

function ensureRepeatFillStyle(stylesXml) {
  const xml = String(stylesXml || '');
  if (xml.includes(`rgb="${REPEAT_FILL_ARGB}"`)) {
    const xfMatch = xml.match(/<cellXfs[^>]*count="(\d+)"/);
    const count = xfMatch ? parseInt(xfMatch[1], 10) : 1;
    return { xml, styleIndex: Math.max(0, count - 1) };
  }

  let next = xml;
  const fillTag = `<fill><patternFill patternType="solid"><fgColor rgb="${REPEAT_FILL_ARGB}"/><bgColor indexed="64"/></patternFill></fill>`;
  next = next.replace(/<fills count="(\d+)">/, (m, n) => {
    const count = parseInt(n, 10) + 1;
    return `<fills count="${count}">`;
  });
  if (next.includes('</fills>')) {
    next = next.replace('</fills>', `${fillTag}</fills>`);
  }

  const fillsCountMatch = next.match(/<fills count="(\d+)"/);
  const fillId = fillsCountMatch ? parseInt(fillsCountMatch[1], 10) - 1 : 2;
  const xfTag = `<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="0" xfId="0" applyFill="1"/>`;

  let styleIndex = 1;
  next = next.replace(/<cellXfs count="(\d+)">/, (m, n) => {
    const count = parseInt(n, 10);
    styleIndex = count;
    return `<cellXfs count="${count + 1}">`;
  });
  if (next.includes('</cellXfs>')) {
    next = next.replace('</cellXfs>', `${xfTag}</cellXfs>`);
  }
  return { xml: next, styleIndex };
}

function markRowsWithStyle(sheetXml, excelRows, styleIndex) {
  const set = new Set((excelRows || []).map(Number).filter((n) => n > 1));
  if (!set.size) return sheetXml;
  return String(sheetXml).replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (full, r, attrs, inner) => {
    if (!set.has(Number(r))) return full;
    const nextInner = inner.replace(/<c /g, (tag) => {
      if (/\bs="/.test(tag)) return tag;
      return `<c s="${styleIndex}" `;
    });
    return `<row r="${r}"${attrs}>${nextInner}</row>`;
  });
}

/**
 * @param {Buffer} buffer
 * @param {number[][]} fillsBySheetIndex Excel 行号（含表头，数据从 2 起）
 */
function applyRepeatRowFills(buffer, fillsBySheetIndex) {
  const list = Array.isArray(fillsBySheetIndex) ? fillsBySheetIndex : [];
  if (!list.some((rows) => rows && rows.length)) return buffer;

  const files = unzipXlsx(buffer);
  const stylesPath = Object.keys(files).find((k) => /xl\/styles\.xml$/i.test(k));
  if (!stylesPath) return buffer;
  const { xml, styleIndex } = ensureRepeatFillStyle(files[stylesPath].toString('utf8'));
  files[stylesPath] = Buffer.from(xml, 'utf8');

  list.forEach((rows, idx) => {
    if (!rows || !rows.length) return;
    const name = `xl/worksheets/sheet${idx + 1}.xml`;
    if (!files[name]) return;
    files[name] = Buffer.from(
      markRowsWithStyle(files[name].toString('utf8'), rows, styleIndex),
      'utf8'
    );
  });
  return zipXlsx(files);
}

module.exports = {
  REPEAT_FILL_ARGB,
  applyRepeatRowFills,
};
