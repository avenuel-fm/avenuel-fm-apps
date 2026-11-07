// Apps Script 흉내: 시트·캐시·드라이브를 메모리로 두고 서버 함수를 실제로 돌려 봄
const crypto = require('crypto');
const fs = require('fs');
const NOW = { d: new Date('2026-11-03T10:00:00+09:00') };
global.Utilities = {
  formatDate(d, tz, f) {
    const k = new Date(d.getTime() + 9 * 3600e3);
    const p = n => String(n).padStart(2, '0');
    return f.replace('yyyy', k.getUTCFullYear()).replace('MM', p(k.getUTCMonth() + 1)).replace('dd', p(k.getUTCDate()))
      .replace('HH', p(k.getUTCHours())).replace('mm', p(k.getUTCMinutes())).replace('ss', p(k.getUTCSeconds())).replace(/\bd\b/, String(k.getUTCDate()));
  },
  getUuid: () => crypto.randomUUID(),
  computeDigest: (a, s) => [...crypto.createHash('sha256').update(s, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
  computeHmacSha256Signature: (t, k) => [...crypto.createHmac('sha256', k).update(t).digest()],
  base64EncodeWebSafe: b => Buffer.from(b.map(x => x & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64Encode: b => Buffer.from(b).toString('base64'),
  base64Decode: s => [...Buffer.from(s, 'base64')],
  newBlob: (bytes, type) => ({ bytes, type, name: '', setName(n) { this.name = n; }, getBytes() { return this.bytes; }, getContentType() { return this.type; } }),
  DigestAlgorithm: { SHA_256: 1 }, Charset: { UTF_8: 1 }
};
global.Date = class extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW.d.getTime()); } static now() { return NOW.d.getTime(); } };
const sheets = {};
/* 진짜 구글 시트처럼 넣은 글자를 해석함 (글자 형식 '@'을 지정해도 appendRow·setValues는 이렇게 바뀜 — v0.3.1 현황 0대 문제의 원인)
   - 앞에 ' 가 있으면 글자 그대로 (' 는 빠짐)
   - 2026-11, 2026-11-04, 2026-11-04 23:05 → 날짜 값 / 숫자 모양 → 숫자 */
const REAL_SHEETS = !process.env.TEXT_SHEETS;
function cellIn(v) {
  if (typeof v !== 'string' || !REAL_SHEETS) return v;
  if (v[0] === "'") return v.slice(1);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1), +(m[4] || 0) - 9, +(m[5] || 0), +(m[6] || 0)));
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) return Number(v);
  return v;
}
function mkSheet(name) {
  const rows = [];
  return sheets[name] = {
    rows,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastColumn: () => rows[0] ? rows[0].length : 0, getLastRow: () => rows.length, getMaxRows: () => 1000,
    getRange(r, c, nr, nc) { return {
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + (nc || 1))); } return out; },
      setValue: v => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = cellIn(v); },
      setValues: vs => { vs.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => rows[r - 1 + i][c - 1 + j] = cellIn(x)); }); },
      setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; } }; },
    appendRow: v => rows.push(v.map(cellIn)), deleteRow: n => rows.splice(n - 1, 1), setFrozenRows() {}
  };
}
const ss = { getId: () => 'SS', getSheetByName: n => sheets[n] || null, insertSheet: n => mkSheet(n), getSheets: () => Object.values(sheets), deleteSheet() {} };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ss, openById: () => ss };
const props = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v }) };
const cache = {};
global.CacheService = { getScriptCache: () => ({ get: k => k in cache ? cache[k] : null, put: (k, v) => cache[k] = v, remove: k => delete cache[k] }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const files = {}; let fid = 0;
function mkFolder(name) { return { name, getName: () => name, isTrashed: () => false, getId: () => 'F_' + name, getFoldersByName: n => { const f = mkFolder(n); return { hasNext: () => false, next: () => f }; }, createFolder: n => mkFolder(n),
  createFile: b => { const id = 'file' + (++fid); files[id] = { name: b.name, blob: b, trashed: false, desc: '' }; return { getId: () => id, setDescription: d => files[id].desc = d }; } }; }
global.DriveApp = { getRootFolder: () => mkFolder('root'), getFolderById: id => mkFolder(id.replace('F_', '')),
  getFileById: id => ({ setTrashed: t => files[id].trashed = t, getBlob: () => files[id].blob, setSharing: (a, p) => { if (!global.NO_SHARE) files[id].sharing = a + ':' + p; }, getSharingAccess: () => String(files[id].sharing || 'PRIVATE').split(':')[0] }),
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' } };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => [] };
global.HtmlService = {}; global.ContentService = {};
(0,eval)(fs.readFileSync(require('path').join(__dirname, '..', 'src', 'Code.gs'), 'utf8').replace(/^const /gm, 'var '));


module.exports = { NOW, files, sheets };
