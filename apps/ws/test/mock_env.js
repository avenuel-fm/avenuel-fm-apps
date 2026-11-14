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
function mkSheet(name, store) {
  const rows = [];
  store = store || sheets;
  return store[name] = {
    rows,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    getLastColumn: () => rows[0] ? rows[0].length : 0, getLastRow: () => rows.length, getMaxRows: () => 1000,
    getRange(r, c, nr, nc) { return {
      getValues: () => { const out = []; for (let i = 0; i < (nr || 1); i++) { out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + (nc || 1))); } return out; },
      setValue: v => { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = cellIn(v); },
      setValues: vs => { vs.forEach((v, i) => { rows[r - 1 + i] = rows[r - 1 + i] || []; v.forEach((x, j) => rows[r - 1 + i][c - 1 + j] = cellIn(x)); }); },
      setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; } }; },
    appendRow: v => rows.push(v.map(cellIn)), deleteRow: n => rows.splice(n - 1, 1), setFrozenRows() {},
    setName(n) { delete store[name]; name = n; store[n] = this; }
  };
}
const ss = { getId: () => 'SS', getSheetByName: n => sheets[n] || null, insertSheet: n => mkSheet(n), getSheets: () => Object.values(sheets), deleteSheet() {} };
// 앱이 새로 만드는 시트 (종합업무일지) — 번호마다 따로
const books = {}; let bid = 0;
function mkBook(id) { const st = {}; const b = { getId: () => id, sheets: st, getSheetByName: n => st[n] || null, insertSheet: n => mkSheet(n, st), getSheets: () => Object.values(st), deleteSheet() {} }; mkSheet('Sheet1', st); return books[id] = b; }
global.SpreadsheetApp = { getActiveSpreadsheet: () => ss, openById: id => { if (books[id]) return books[id]; if (/^BOOK/.test(id)) throw new Error('없는 파일'); return ss; }, create: () => mkBook('BOOK' + (++bid)) };
const props = {};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => props[k] = v, setProperties: o => Object.assign(props, o), deleteProperty: k => delete props[k] }) };
const cache = {};
// 네이버 날씨 흉내: 시험이 global.NAVER.today·air에 화면 글을 넣음 (기본은 빈 화면 = 못 읽음)
global.NAVER = { today: '', air: '', calls: 0 };
// 온습도 앱 읽기 주소 흉내: global.AC.hvac·curtain = 기록 목록, AC.fail = 못 읽음
global.AC = { hvac: [], curtain: [], fail: false, calls: 0 };
global.UrlFetchApp = { fetch: u => { if (/script\.google\.com/.test(u)) { AC.calls++; const k = /kind=(\w+)/.exec(u)[1]; return { getResponseCode: () => AC.fail ? 500 : 200, getContentText: () => JSON.stringify({ ok: true, records: AC[k] }) }; } NAVER.calls++; const t = /\/air\//.test(u) ? NAVER.air : NAVER.today; return { getResponseCode: () => 200, getContentText: () => t }; } };
global.CacheService = { getScriptCache: () => ({ get: k => k in cache ? cache[k] : null, put: (k, v) => cache[k] = v, remove: k => delete cache[k] }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const files = {}; let fid = 0;
function mkFolder(name) { return { name, getName: () => name, isTrashed: () => false, getId: () => 'F_' + name, getFoldersByName: n => { const f = mkFolder(n); return { hasNext: () => false, next: () => f }; }, createFolder: n => mkFolder(n),
  createFile: b => { const id = 'file' + (++fid); files[id] = { name: b.name, blob: b, trashed: false, desc: '' }; return { getId: () => id, setDescription: d => files[id].desc = d }; } }; }
global.DriveApp = { getRootFolder: () => mkFolder('root'), getFolderById: id => mkFolder(id.replace('F_', '')),
  getFileById: id => ({ moveTo() {}, setTrashed: t => files[id].trashed = t, getBlob: () => files[id].blob, setSharing: (a, p) => { if (!global.NO_SHARE) files[id].sharing = a + ':' + p; }, getSharingAccess: () => String(files[id].sharing || 'PRIVATE').split(':')[0] }),
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' } };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => [] };
global.HtmlService = {}; global.ContentService = {};
(0,eval)(fs.readFileSync(require('path').join(__dirname, '..', 'src', 'Code.gs'), 'utf8').replace(/^const /gm, 'var '));


module.exports = { NOW, files, sheets, books };
