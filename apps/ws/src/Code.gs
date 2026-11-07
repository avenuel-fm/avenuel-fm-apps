/**
 * 시설팀 업무지원(WS) — 소화기 점검 테스트판
 * 기준: claude/통합_업무지원앱_설계정의서.md (RC4) + 수정요청_대기목록 WS-13·WS-14
 * 범위: 로그인(PIN + 근무일 첫 서명) → 메인 → 점검 → 소화기 점검 (QR 관리·인쇄, 월별·층별 현황, QR 점검 입력)
 *       서류작업 → TBM (서명란·작업 표·위험성·사진 2장·PDF), 명일 작업 예정 — docs/설계/WS_서류작업.md
 * 나머지 메뉴는 화면만 두고 "준비 중"으로 표시합니다.
 *
 * 테스트판에서 단순화한 것 (정식판에서 공통 DB·cdb로 바꿈)
 *  - 직원 목록: 공통 DB 대신 이 시트의 `직원` 탭
 *  - 매장: 도면협의 매장 목록 대신 직접 입력한 매장명
 */

const APP = { id: 'WS', title: '업무지원', version: '0.6.5', specVersion: 'v1.2', commonVersion: '0.1' };
const TZ = 'Asia/Seoul';
const FLOORS = ['B1', '1F', '2F', '3F', '4F', '5F', '6F'];
const ROLES = ['소장', '부소장', '파트장', '직원', '관리자'];
const STATE_OK = '이상없음';
const STATE_BAD = '이상있음';

const SHEETS = {
  '설정': ['키', '값', '설명'],
  '직원': ['staff_id', '이름', '파트명', '역할', 'pin_hash', 'pin_salt', '사용여부', '수정일시'],
  '소화기': ['fe_id', '층', '매장명', 'store_id', '번호', '이름', 'qr_token', '사용여부', '등록일시', '등록자', '삭제일시'],
  '소화기점검': ['check_id', '연월', 'fe_id', '층', '매장명', '소화기이름', '상태', '사진_id', '문구_id', '이름_id', '입력일시', '기한후입력', '덮어쓴횟수', '삭제여부'],
  '서명': ['sign_id', '근무일', 'staff_id', '이름', '파트명', '서명_id', '서명시각', '들어온길', 'TBM사용', '삭제여부'],
  '명일작업': ['일자', '순번', '부서', '작업장소', '작업내용', '비고', '고친사람', '고친시각'],
  'TBM': ['tbm_id', '근무일', '작성자_id', '작성자명', '회의사진_id', '구호사진_id', '작업표', '체크칸', '서명수', 'pdf_id', 'PDF만든시각', '작성시각', '수정시각', '삭제여부'],
  '위험성목록': ['순서', '낱말', '위험요인', '재해형태', '가능성', '중대성', '개선조치1', '개선조치2', '개선조치3', '개선조치4', '사용여부'],
  '변경기록': ['일시', '누가', '무엇을', '대상ID', '내용']
};

const DEFAULT_SETTINGS = [
  ['점검시작일', '1', '매월 소화기 점검 입력 시작일'],
  ['점검마감일', '5', '매월 소화기 점검 입력 마감일 (지나도 입력은 받고 "기한 후 입력"으로 표시)'],
  ['라벨가로mm', '50', 'QR 라벨 가로 (BIXOLON SLP-TX400 · 50×50 라벨)'],
  ['라벨세로mm', '50', 'QR 라벨 세로'],
  ['프린터dpi', '203', '라벨 프린터 해상도 (BIXOLON SLP-TX400 = 203dpi, 8점/mm). QR 칸을 점에 맞춰 또렷하게 찍음'],
  ['사진긴변px', '640', '압력계 사진 가로 (4:3)'],
  ['사진품질', '0.6', '압력계 사진 JPEG 품질'],
  ['바로가기주소', '', '바로가기 페이지(껍데기) 주소. 예: https://계정.github.io/fm/ws/ — 넣으면 QR과 링크가 이 주소를 씀 (여러 구글 계정 오류 방지)'],
  ['FOLDER_CACHE_JSON', '{}', '드라이브 폴더 ID 기억 (자동)']
];

/* ───────────────────────── 시트 메뉴 · 초기 설정 ───────────────────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('업무지원')
    .addItem('① 초기 설정', 'setupMenu_')
    .addItem('② 테스트 직원 등록', 'addStaffMenu_')
    .addItem('③ 웹앱 주소 보기', 'showUrlMenu_')
    .addItem('④ QR 고유번호 짧게 바꾸기 (32자리 → 12자리)', 'shortenTokensMenu_')
    .addItem('⑤ 데이터 점검 (날짜·숫자로 바뀐 칸, 빈 칸)', 'dataCheckMenu_')
    .addItem('⑥ 서명 정리 예약 켜기 (90일 지난 안 쓴 서명 → 휴지통, 매일 새벽 3시)', 'cleanSignsTriggerMenu_')
    .addToUi();
}

/* QR이 덜 빽빽하도록 고유번호 12자리 (헷갈리는 l·o·0·1 제외, 60비트) */
const TOKEN_ABC = '23456789abcdefghijkmnpqrstuvwxyz';
function shortToken_(used) {
  for (let n = 0; n < 20; n++) {
    const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + n);
    let t = '';
    for (let i = 0; i < 12; i++) t += TOKEN_ABC.charAt(b[i] & 31);
    if (!used || !used[t]) return t;
  }
  throw new Error('고유번호를 만들지 못했습니다. 다시 시도해 주세요.');
}

/* ⑤ 데이터 점검 (결정 54): 시트가 날짜·숫자로 바꿔 저장한 칸과 꼭 있어야 할 칸이 빈 줄을 찾고, 원하면 글자로 고쳐 씀 */
const REQUIRED = { '소화기': ['fe_id', '층', '매장명', '이름', 'qr_token'], '소화기점검': ['check_id', '연월', 'fe_id', '상태'], '직원': ['staff_id', '이름', 'pin_hash'], '서명': ['sign_id', '근무일', 'staff_id', '서명_id'] };
function dataCheck_(fix) {
  const out = [];
  let changed = 0, bad = 0, empty = 0;
  Object.keys(SHEETS).forEach(function (name) {
    const sh = db_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const values = sh.getDataRange().getValues();
    const head = values[0].map(String);
    let nBad = 0, nEmpty = 0;
    values.forEach(function (row, i) {
      if (i === 0 || row.every(function (x) { return x === '' || x === null; })) return;
      let rowBad = false;
      row.forEach(function (x, j) { if (typeof x !== 'string' && x !== '' && x !== null) { nBad++; rowBad = true; } });
      (REQUIRED[name] || []).forEach(function (h) { const j = head.indexOf(h); if (j !== -1 && cellOut_(h, row[j]) === '') nEmpty++; });
      if (fix && rowBad) {
        sh.getRange(i + 1, 1, 1, head.length).setValues([head.map(function (h, j) { return asText_(cellOut_(h, row[j])); })]);
        changed++;
      }
    });
    bad += nBad; empty += nEmpty;
    if (nBad || nEmpty) out.push('- ' + name + ': 날짜·숫자로 바뀐 칸 ' + nBad + '개' + (nEmpty ? ', 빈 필수 칸 ' + nEmpty + '개' : ''));
  });
  return { bad: bad, empty: empty, changed: changed, lines: out };
}
function dataCheckMenu_() {
  const ui = SpreadsheetApp.getUi();
  const r = dataCheck_(false);
  if (!r.bad && !r.empty) { ui.alert('데이터 점검', '이상 없습니다. 모든 칸이 글자로 저장되어 있습니다.', ui.ButtonSet.OK); return; }
  const msg = r.lines.join('\n') + '\n\n날짜·숫자로 바뀐 칸은 앱이 읽을 때 되돌려 쓰므로 집계는 맞습니다.' + (r.bad ? '\n지금 글자로 고쳐 저장할까요? (내용은 그대로, 형식만 바뀝니다)' : '');
  if (!r.bad) { ui.alert('데이터 점검', msg + '\n\n빈 필수 칸은 시트에서 직접 확인해 주세요.', ui.ButtonSet.OK); return; }
  if (ui.alert('데이터 점검', msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const f = dataCheck_(true);
  log_('시트 메뉴', '데이터 점검 고침', '', f.changed + '줄');
  ui.alert('데이터 점검', f.changed + '줄을 글자로 고쳐 저장했습니다.', ui.ButtonSet.OK);
}

function shortenTokensMenu_() {
  const ui = SpreadsheetApp.getUi();
  const yes = ui.alert('QR 고유번호 짧게 바꾸기', '32자리 고유번호를 쓰는 소화기의 번호를 12자리로 새로 만듭니다.\n바뀐 소화기는 예전에 인쇄한 QR이 더 이상 열리지 않으니, 끝난 뒤 QR을 다시 인쇄해 주세요.\n\n계속할까요?', ui.ButtonSet.YES_NO);
  if (yes !== ui.Button.YES) return;
  ui.alert(shortenTokens_() + '개를 바꿨습니다. 웹앱 ① 소화기 QR 관리에서 다시 인쇄해 주세요.');
}

function shortenTokens_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('소화기');
    const used = {};
    t.rows.forEach(function (r) { used[r['qr_token']] = 1; });
    let n = 0;
    t.rows.forEach(function (r) {
      if (/^[a-f0-9]{32}$/.test(r['qr_token'])) {
        const nt = shortToken_(used); used[nt] = 1;
        updateRow_('소화기', r._row, { 'qr_token': nt }); n++;
      }
    });
    log_('시트 메뉴', 'QR 고유번호 짧게', '', n + '개');
    return n;
  } finally {
    lock.releaseLock();
  }
}

function setupMenu_() {
  const msg = setup_();
  SpreadsheetApp.getUi().alert(msg);
}

function setup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('APP_DB_ID', ss.getId());
  if (!props.getProperty('HUB_KEY')) props.setProperty('HUB_KEY', randomHex_(32));
  linkKey_();

  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    const cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    head.forEach(function (h, i) {
      if (cur.indexOf(h) === -1) {
        const col = cur.filter(String).length + 1;
        sh.getRange(1, col).setValue(h);
        cur[col - 1] = h;
      }
    });
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#EDF0F3');
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), head.length).setNumberFormat('@');
  });

  const set = readTable_('설정');
  DEFAULT_SETTINGS.forEach(function (d) {
    if (!set.rows.some(function (r) { return r['키'] === d[0]; })) appendRow_('설정', { '키': d[0], '값': d[1], '설명': d[2] });
  });

  seedRisks_();

  const s1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  const folder = monthFolder_(ym_(new Date()));
  return '초기 설정을 마쳤습니다.\n\n- 탭: ' + Object.keys(SHEETS).join(', ') +
    '\n- 사진 폴더: 시설팀 통합업무 › 20_업무지원 › 소화기점검 › ' + folder.getName() +
    '\n\n다음: 메뉴 ② 테스트 직원 등록 → 웹앱 배포';
}

function addStaffMenu_() {
  const ui = SpreadsheetApp.getUi();
  const n = ui.prompt('테스트 직원 등록 (1/4)', '이름', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const p = ui.prompt('테스트 직원 등록 (2/4)', 'PIN 4자리 (휴대폰 뒷 4자리, 겹치면 앞 4자리)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const part = ui.prompt('테스트 직원 등록 (3/4)', '파트명 (예: 전방파트)', ui.ButtonSet.OK_CANCEL);
  if (part.getSelectedButton() !== ui.Button.OK) return;
  const r = ui.prompt('테스트 직원 등록 (4/4)', '역할: ' + ROLES.join(' / '), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const res = addStaff_(n.getResponseText(), p.getResponseText(), part.getResponseText(), r.getResponseText());
  ui.alert(res.ok ? (res.name + ' 님을 등록했습니다 (' + res.staff_id + ')') : res.error);
}

function addStaff_(name, pin, part, role) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();
  part = String(part || '').trim() || '전방파트';
  role = String(role || '').trim() || '직원';
  if (!name) return { ok: false, error: '이름을 넣어 주세요.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4자리입니다.' };
  if (ROLES.indexOf(role) === -1) return { ok: false, error: '역할은 ' + ROLES.join(' / ') + ' 중 하나입니다.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('직원');
    const dup = t.rows.some(function (s) { return s['사용여부'] !== 'N' && hashPin_(pin, s['pin_salt']) === s['pin_hash']; });
    if (dup) return { ok: false, error: '이 PIN은 다른 직원이 쓰고 있습니다. 휴대폰 번호 앞 4자리(010 다음)를 넣어 주세요.' };
    let max = 0;
    t.rows.forEach(function (s) { const m = /^S(\d+)$/.exec(s['staff_id']); if (m) max = Math.max(max, Number(m[1])); });
    const id = 'S' + ('00' + (max + 1)).slice(-3);
    const salt = randomHex_(8);
    appendRow_('직원', { 'staff_id': id, '이름': name, '파트명': part, '역할': role, 'pin_hash': hashPin_(pin, salt), 'pin_salt': salt, '사용여부': 'Y', '수정일시': now_() });
    CacheService.getScriptCache().remove('staff');
    log_('관리자(시트)', '직원 등록', id, name + ' · ' + role);
    return { ok: true, staff_id: id, name: name };
  } finally {
    lock.releaseLock();
  }
}

function showUrlMenu_() {
  const url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? ('웹앱 주소\n\n' + url + '\n\n앱 연결 키 (통합 대시보드가 ?api=summary 부를 때)\n\n' + linkKey_()) : '아직 웹앱으로 배포하지 않았습니다. 설치 안내 4단계를 보세요.');
}

/* 앱 사이 연결 키 (?api=summary). 로그인 표를 만드는 비밀키 HUB_KEY와 따로 둠 — 연결 키가 새어 바꿔도 직원 로그인은 그대로 (결정 80) */
function linkKey_() {
  const props = PropertiesService.getScriptProperties();
  let k = props.getProperty('LINK_KEY');
  if (!k) { k = randomHex_(20); props.setProperty('LINK_KEY', k); }
  return k;
}

/* ───────────────────────── 웹 진입 ───────────────────────── */

/** GitHub check.html이 보내는 점검 입력 (본문 text/plain JSON — 미리 묻기(preflight) 없이 다른 주소에서 보낼 수 있음) */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'checkSubmit') out = checkSubmit(body.qr, body.d);
    else throw new Error('알 수 없는 요청');
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.api) return api_(p);
  if (p.fe !== undefined) {
    const t = HtmlService.createTemplateFromFile('Check');
    t.qr = isQrToken_(p.fe) ? String(p.fe) : '';
    return t.evaluate()
      .setTitle('소화기 점검')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  const t = HtmlService.createTemplateFromFile('Index');
  t.execUrl = publicUrl_();
  return t.evaluate()
    .setTitle('업무지원')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 밖으로 알려 주는 주소 (QR · 링크).
 * 바로가기 페이지(껍데기)를 쓰면 그 주소, 아니면 웹앱 /exec 주소.
 * 껍데기를 쓰는 이유: 휴대폰 브라우저에 구글 계정이 여러 개 로그인되어 있으면
 * /exec 주소가 /u/1/ 주소로 바뀌면서 "현재 파일을 열 수 없습니다" 오류가 남.
 */
function publicUrl_() {
  const s = String(setting_('바로가기주소') || '').trim();
  if (/^https:\/\/[^\s"'<>]+$/.test(s)) return s.replace(/[?#].*$/, '');
  return ScriptApp.getService().getUrl() || '';
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function api_(p) {
  let out;
  try {
    if (p.api === 'ping') {
      out = { ok: true, app: APP.id, title: APP.title, version: APP.version, specVersion: APP.specVersion, commonVersion: APP.commonVersion };
    } else if (p.api === 'check') {
      // GitHub 바로가기 페이지의 QR 입력 화면(check.html)용 — 고유번호만으로 열림 (결정 42)
      out = checkInit(p.fe);
    } else if (p.api === 'summary') {
      if (!p.key || p.key !== PropertiesService.getScriptProperties().getProperty('LINK_KEY')) throw new Error('키가 맞지 않습니다');
      out = summary_();
    } else {
      throw new Error('알 수 없는 요청');
    }
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 개선 A: HUB 할 일용 요약 (4일부터 마감 임박, 마감 뒤 미입력) */
function summary_() {
  const st = buildStatus_(ym_(new Date()));
  const c = countStates_(st.items);
  const todos = [];
  const d = Number(Utilities.formatDate(new Date(), TZ, 'd'));
  if (c.wait > 0 && d >= st.window.end - 1 && d <= st.window.end) {
    todos.push({ key: 'fe_due', label: '소화기 점검 마감 임박 (' + st.window.end + '일)', count: c.wait, level: 'or', role: ['소장', '부소장', '파트장'], url: '' });
  }
  if (c.miss > 0) todos.push({ key: 'fe_miss', label: '소화기 점검 미입력', count: c.miss, level: 'rd', role: ['소장', '부소장', '파트장'], url: '' });
  if (c.bad > 0) todos.push({ key: 'fe_bad', label: '소화기 이상 있음', count: c.bad, level: 'or', role: ['소장', '부소장', '파트장'], url: '' });
  return { ok: true, app: APP.id, counts: c, labels: { ok: '점검완료', bad: '이상 있음', wait: '점검 전', miss: '미입력' }, todos: todos };
}

/* ───────────────────────── 로그인 ───────────────────────── */

/**
 * 로그인 = PIN + 근무일 첫 서명 (결정 56·60)
 * - PIN이 맞고 오늘(근무일) 서명이 있으면 바로 기기 표
 * - 오늘 서명이 없고 signPng도 없으면 { needSign, name } 만 돌려줌 (표는 주지 않음 → 서명 안 하면 로그인 안 됨)
 * - 서명과 함께 다시 부르면 서명을 저장하고 기기 표
 */
function login(pin, deviceId, signPng) {
  pin = String(pin || '');
  deviceId = String(deviceId || 'none').slice(0, 64);
  const cache = CacheService.getScriptCache();
  const lockKey = 'pinlock_' + deviceId;
  if (cache.get(lockKey)) return { ok: false, error: '5번 틀려서 이 기기는 5분 동안 입력할 수 없습니다.' };
  const allLock = cache.get(PIN_ALL_LOCK);
  if (allLock) return { ok: false, error: 'PIN이 여러 번 틀려 ' + Math.max(1, Math.ceil((Number(allLock) - Date.now()) / 60000)) + '분 동안 모든 로그인을 막았습니다. 잠시 뒤 다시 해 주세요.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN 4자리를 넣어 주세요.' };
  const staff = staffRows_().filter(function (s) { return s['사용여부'] !== 'N'; });
  const me = staff.filter(function (s) { return hashPin_(pin, s['pin_salt']) === s['pin_hash']; })[0];
  if (!me) {
    pinFailAll_(cache);
    const failKey = 'pinfail_' + deviceId;
    const n = Number(cache.get(failKey) || 0) + 1;
    if (n >= 5) { cache.put(lockKey, '1', 300); cache.remove(failKey); return { ok: false, error: '5번 틀려서 이 기기는 5분 동안 입력할 수 없습니다.' }; }
    cache.put(failKey, String(n), 300);
    return { ok: false, error: 'PIN이 맞지 않습니다. (' + n + '/5)' };
  }
  cache.remove('pinfail_' + deviceId);
  const day = workDay_(Date.now());
  let sign = todaySign_(me['staff_id'], day);
  if (!sign) {
    if (!signPng) return { ok: false, needSign: true, name: me['이름'], part: me['파트명'], day: day };
    const saved = saveSign_(me, signPng, 'PIN');
    if (!saved.ok) return saved;
    sign = saved.sign;
  }
  log_(me['이름'], '로그인', me['staff_id'], sign ? '서명 ' + sign['sign_id'] : '');
  return { ok: true, token: makeToken_(me), user: userOut_(me) };
}

/* 기기 번호는 화면이 보내는 값이라 바꿔 가며 끝없이 시도할 수 있음 → 기기와 상관없이 10분 안에 30번 틀리면 모두 10분 막음 (점검 1, 결정 74).
   잠금 뒤 6시간 안에 3번째 잠금부터는 1시간 — 풀릴 때마다 다시 30번씩 시도하는 것을 늦춤 (결정 80). 잠금 값 = 풀리는 시각(ms)
   shortcut: 동시에 틀린 요청은 몇 번 덜 셀 수 있음(잠금 없이 셈) — 막는 목적에는 충분 */
const PIN_ALL_MAX = 30, PIN_ALL_LOCK = 'pinlock_all';
function pinFailAll_(cache) {
  const n = Number(cache.get('pinfail_all') || 0) + 1;
  if (n >= PIN_ALL_MAX) {
    const locks = Number(cache.get('pinlock_cnt') || 0) + 1, sec = locks >= 3 ? 3600 : 600;
    cache.put(PIN_ALL_LOCK, String(Date.now() + sec * 1000), sec);
    cache.put('pinlock_cnt', String(locks), 21600);   // 캐시는 6시간까지 기억
    cache.remove('pinfail_all');
    log_('보안', 'PIN 전체 잠금', '', '10분 안에 ' + n + '번 틀림 · ' + (sec / 60) + '분 잠금 (6시간 안 ' + locks + '번째)');
  }
  else cache.put('pinfail_all', String(n), 600);
}

/** 기기 표는 있는데 오늘 서명이 없을 때 (시트에서 지웠거나 입장표로 들어온 경우) */
function signToday(token, signPng) {
  const me = auth_(token);
  const day = workDay_(Date.now());
  if (todaySign_(me['staff_id'], day)) return { ok: true, already: true };
  const saved = saveSign_(me, signPng, '기기 표');
  if (!saved.ok) return saved;
  log_(me['이름'], '오늘 서명', me['staff_id'], saved.sign['sign_id']);
  return { ok: true };
}

function bootstrap(token) {
  const me = auth_(token);
  const day = workDay_(Date.now());
  const signs = daySigns_(day);
  return {
    ok: true, user: userOut_(me), app: APP,
    needSign: !signs.some(function (r) { return r['staff_id'] === me['staff_id']; }),
    docs: { day: day, signs: signs.length },
    fire: fireSummary_()
  };
}

/* 메인 칸 「소화기 n / n대」: 1분 기억 — 로그인 때마다 소화기 시트 2개를 다 읽지 않게 (로딩 개선, 결정 76).
   소화기를 등록·삭제하거나 점검을 입력하면 바로 지움 */
function fireSummary_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('fire_sum');
  if (hit) return JSON.parse(hit);
  const st = buildStatus_(ym_(new Date()));
  const o = { counts: countStates_(st.items), window: st.window, day: st.day, ym: st.ym };
  cache.put('fire_sum', JSON.stringify(o), 60);
  return o;
}
function fireChanged_() { CacheService.getScriptCache().remove('fire_sum'); }

/* 직원 목록: 서버를 부를 때마다(로그인 확인) 직원 시트를 읽지 않게 1분 기억 (결정 78).
   shortcut: 시트에서 직원을 직접 고치면(사용여부 N, 역할 등) 최대 1분 늦게 반영 — 즉시 막아야 하면 PIN·표가 틀리게 바꿈 */
function staffRows_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('staff');
  if (hit) return JSON.parse(hit);
  const rows = readTable_('직원').rows;
  try { cache.put('staff', JSON.stringify(rows), 60); } catch (e) { /* 100KB 넘으면 기억 안 함 */ }
  return rows;
}

function userOut_(s) {
  return { staff_id: s['staff_id'], name: s['이름'], part: s['파트명'], role: s['역할'] };
}

/* ───────────────────────── 근무일 · 기기 표 ───────────────────────── */

/** 근무일 시작 = 오전 6시 (한국 시간, 결정 60). 기기 표 만료도 같은 경계 */
const WORKDAY_START_H = 6;
const KST_MS = 9 * 3600 * 1000, DAY_MS = 24 * 3600 * 1000;

/** 로그인 뒤 처음 오는 오전 6시. 한국은 서머타임이 없어 +9시간 고정 */
function nextWorkStart_(nowMs) {
  const k = new Date(nowMs + KST_MS);
  let t = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), WORKDAY_START_H, 0, 0) - KST_MS;
  if (t <= nowMs) t += DAY_MS;
  return t;
}

/** 근무일 'yyyy-MM-dd' — 오전 6시 전이면 전날 */
function workDay_(nowMs) {
  return new Date(nowMs + KST_MS - WORKDAY_START_H * 3600 * 1000).toISOString().slice(0, 10);
}

function makeToken_(s) {
  const exp = nextWorkStart_(Date.now());
  const payload = s['staff_id'] + '.' + exp;
  return payload + '.' + sign_(payload + '|' + String(s['pin_hash']).slice(0, 8));
}

function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('LOGIN');
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) throw new Error('LOGIN');
  if (exp > nextWorkStart_(Date.now())) throw new Error('LOGIN');   // 예전 30일·8시 표는 받지 않음 → 한 번 다시 로그인하면 6시 규칙 (결정 60)
  const s = staffRows_().filter(function (r) { return r['staff_id'] === parts[0] && r['사용여부'] !== 'N'; })[0];
  if (!s) throw new Error('LOGIN');
  if (sign_(parts[0] + '.' + parts[1] + '|' + String(s['pin_hash']).slice(0, 8)) !== parts[2]) throw new Error('LOGIN');
  return s;
}

/* ───────────────────────── 서명 (WS_서류작업 2~4장) ───────────────────────── */

const SIGN_TAIL = 400;   // 서명은 하루 20줄 안팎 → 맨 아래 400줄(약 20일)만 보면 오늘 줄이 다 있음
function daySigns_(day) {
  return readTail_('서명', SIGN_TAIL).rows
    .filter(function (r) { return r['근무일'] === day && r['삭제여부'] !== 'Y'; })
    .sort(function (a, b) { return a['서명시각'] < b['서명시각'] ? -1 : a['서명시각'] > b['서명시각'] ? 1 : 0; });
}

function todaySign_(staffId, day) {
  return daySigns_(day).filter(function (r) { return r['staff_id'] === staffId; })[0] || null;
}

/** 서명 저장: 흑백 600px PNG(화면에서 줄여 보냄) → 드라이브, 시트에는 파일 번호만 (결정 60) */
function saveSign_(me, signPng, via) {
  const blob = parseDataUrl_(signPng, 'image/png', 300, 400000);
  if (!blob) return { ok: false, error: '서명이 비어 있거나 너무 짧습니다. 다시 써 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const nowMs = Date.now();
    const day = workDay_(nowMs);
    const t = readTail_('서명', SIGN_TAIL);
    const dup = t.rows.filter(function (r) { return r['근무일'] === day && r['staff_id'] === me['staff_id'] && r['삭제여부'] !== 'Y'; })[0];
    if (dup) return { ok: true, sign: dup };   // 두 기기에서 동시에 서명해도 한 줄만
    const key = day.replace(/-/g, '');
    let seq = 0;
    t.rows.forEach(function (r) { const m = new RegExp('^WS-SG-' + key + '-(\\d+)$').exec(r['sign_id']); if (m) seq = Math.max(seq, Number(m[1])); });
    const id = 'WS-SG-' + key + '-' + ('00' + (seq + 1)).slice(-3);
    const folder = folderPath_(['시설팀 통합업무', '20_업무지원', '서류작업', '서명', day.slice(0, 7)]);
    const at = Utilities.formatDate(new Date(nowMs), TZ, 'yyyy-MM-dd HH:mm:ss');
    const fileId = saveBlob_(folder, blob, day + '_서명-' + safeName_(me['이름']) + '.png', id + ' · ' + me['이름'] + ' · ' + at);
    const row = { 'sign_id': id, '근무일': day, 'staff_id': me['staff_id'], '이름': me['이름'], '파트명': me['파트명'], '서명_id': fileId, '서명시각': at, '들어온길': via, 'TBM사용': 'N', '삭제여부': 'N' };
    appendRow_('서명', row);
    return { ok: true, sign: row };
  } finally {
    lock.releaseLock();
  }
}

/* ───────────────────────── TBM 작성 · PDF (WS_서류작업 4-1~5장, 결정 58·66·70) ───────────────────────── */

const TBM_CHECKS = ['사다리', '비계', '우마', '테이블리프트', '크레인', '스카이', '달비계', '용접기'];
const TBM_MAX_ROWS = 30;

/* 첫 위험성 목록 (4-3, 11-06 확정): [낱말, 위험요인, 재해형태, 가능성, 중대성, 개선조치(✓ = 미리 체크)] — 시트 `위험성목록` 탭에서 고침 */
const RISK_SEED = [
  ['사다리', 'A형 사다리 미끄러짐·상부 균형 상실', '떨어짐', 2, 3, ['✓2인 1조, 1명은 아래에서 사다리 지지', '✓안전모(턱끈) 착용, 미끄럼 방지 발판·벌림 고정 확인', '최상단 발판 위 작업 금지']],
  ['비계', '작업발판 끝에서 헛디딤, 안전난간 없는 곳 접근', '떨어짐', 3, 3, ['✓안전대 부착설비에 안전대 걸고 작업', '✓안전난간·발끝막이판 설치 확인', '작업 전 발판 고정 점검']],
  ['우마, 말비계', '우마 위에서 움직이다 중심 잃음', '떨어짐', 2, 2, ['✓바퀴 잠금 확인 뒤 올라감', '✓안전모 착용', '우마에 탄 채 옮기지 않음']],
  ['테이블리프트, 고소작업대, 렌탈', '작업대 올라가다 천장 배관·보에 몸 끼임', '끼임', 2, 3, ['✓유도자 배치, 위쪽 장애물 확인', '✓비상정지 위치·작동 확인', '안전대 체결', '작업 반경 출입 통제']],
  ['스카이', '버킷에서 떨어짐, 차량 기울어짐', '떨어짐', 2, 3, ['✓버킷 안에서 안전대 체결', '✓아웃트리거 설치·바닥 확인', '아래쪽 출입 통제']],
  ['크레인, 양중, 인양', '들어 올린 짐 흔들림·와이어로프 끊어짐', '맞음', 2, 3, ['✓짐 아래 출입금지 구역 설정', '✓와이어로프·훅 해지장치 사전 점검', '신호수 배치']],
  ['달비계', '로프 풀림·끊어짐', '떨어짐', 2, 3, ['✓작업 로프와 따로 구명줄에 안전대 체결', '✓로프 고정점·손상 사전 점검', '아래쪽 출입 통제']],
  ['용접, 용단, 화기', '불티가 주변 가연물에 튀어 불남', '화재', 2, 3, ['✓주변 가연물 치우거나 방염포 덮음', '✓소화기 비치, 화재감시인 배치', '작업 뒤 30분 불씨 확인']],
  ['그라인더, 절단', '숫돌 깨져 파편 튐, 옷 말려 들어감', '맞음', 2, 2, ['✓방호덮개 장착 확인', '✓보안면·보호장갑 착용', '소매·끈 정리']],
  ['페인트, 도장, 약품', '유기용제 증기 마심·불붙음', '화학물질 노출', 2, 2, ['✓환기(창문·송풍기)', '✓방독마스크·보호장갑 착용', '주변 화기 금지']],
  ['분전반, 차단기, 배선, 전기', '전기 흐르는 부분 노출·접촉', '감전', 1, 3, ['✓작업 전 검전, 되도록 차단 뒤 작업', '✓절연장갑·절연화 착용', '차단기 잠금·「작업 중」 표지']],
  ['펌프, 팬, 공조기, 모터, 벨트', '돌아가는 부분이 멈추기 전에 손 넣음', '끼임', 1, 3, ['✓전원 차단·잠금·표지 뒤 작업', '✓완전히 멈춘 것 확인 뒤 손 넣기']],
  ['정화조, 맨홀, 집수정, 밀폐', '산소 부족·유해가스', '질식', 1, 3, ['✓들어가기 전 산소·가스 농도 측정', '✓환기 뒤 들어감, 밖에 감시인 배치', '송기마스크 비치']],
  ['옥상, 냉각탑', '옥상 끝 쪽 접근', '떨어짐', 1, 3, ['✓안전난간 안쪽에서만 작업', '✓2인 1조']],
  ['운반, 중량물, 자재', '무거운 물건 혼자 들다 허리 다침', '무리한 동작', 2, 2, ['✓대차 사용, 무거운 것은 2인 운반', '✓무릎 굽혀 들기']],
  ['배수, 물기, 청소', '바닥 물기·기름에 미끄러짐', '넘어짐', 2, 1, ['✓작업 전 바닥 물기 닦기', '✓미끄럼 방지 안전화 착용', '통로 정리']],
  ['천장, 점검구', '천장 안 튀어나온 철골에 머리 부딪힘', '부딪힘', 2, 1, ['✓안전모 착용', '✓랜턴 휴대, 조명 확보']],
  ['(기본)', '공구·자재 다루다 손 다침', '절단·베임·찔림', 1, 1, ['✓보호장갑 착용', '공구 사용 전 상태 확인']]
];

/** TBM·위험성목록 탭이 없으면 만들고 첫 목록을 넣음 (시트 메뉴 ①을 다시 하지 않아도 TBM이 열리게).
 *  두 사람이 처음 동시에 열어도 목록이 두 번 들어가지 않게 잠금 안에서 (점검 4) */
function ensureTbmTabs_() {
  const ss = db_(), risk = ss.getSheetByName('위험성목록');
  if (ss.getSheetByName('TBM') && risk && risk.getLastRow() > 1) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ['TBM', '위험성목록'].forEach(function (name) {
      if (ss.getSheetByName(name)) return;
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
      sh.setFrozenRows(1);
    });
    seedRisks_();
  } finally {
    lock.releaseLock();
  }
}
function seedRisks_() {
  const sh = db_().getSheetByName('위험성목록');
  if (!sh || sh.getLastRow() > 1) return;
  RISK_SEED.forEach(function (r, i) {
    const o = { '순서': String(i + 1), '낱말': r[0], '위험요인': r[1], '재해형태': r[2], '가능성': String(r[3]), '중대성': String(r[4]), '사용여부': 'Y' };
    r[5].forEach(function (f, j) { o['개선조치' + (j + 1)] = f; });
    appendRow_('위험성목록', o);
  });
}

/** 위험성 목록: 순서대로. 낱말이 처음 맞는 줄을 화면에서 미리 고름, 「(기본)」은 맞는 줄이 없을 때 */
function riskList_() {
  const n3 = function (v) { v = Number(v); return v >= 1 && v <= 3 ? Math.round(v) : 1; };
  return readTable_('위험성목록').rows.filter(function (r) { return r['사용여부'] !== 'N' && r['위험요인']; })
    .sort(function (a, b) { return Number(a['순서']) - Number(b['순서']); })
    .map(function (r) {
      return {
        words: String(r['낱말']).split(/[,，]/).map(function (w) { return w.trim(); }).filter(String),
        risk: r['위험요인'], kind: r['재해형태'], p: n3(r['가능성']), s: n3(r['중대성']),
        fixes: [1, 2, 3, 4].map(function (k) { return String(r['개선조치' + k] || '').trim(); }).filter(String)
          .map(function (f) { return { t: f.replace(/^✓\s*/, ''), on: /^✓/.test(f) }; })
      };
    });
}

function tbmRow_(day) {
  return readTable_('TBM').rows.filter(function (r) { return r['근무일'] === day && r['삭제여부'] !== 'Y'; })[0] || null;
}

function tbmFolder_(day) {
  return folderPath_(['시설팀 통합업무', '20_업무지원', '서류작업', 'TBM', day.slice(0, 4), day.slice(0, 7)]);
}

function jsonOr_(s, dflt) { try { const v = JSON.parse(s); return v == null ? dflt : v; } catch (e) { return dflt; } }

/**
 * TBM 화면 불러오기: 오늘 서명(로그인 순) · 관리감독자(역할 소장, 없으면 부소장) · 위험성 목록 · 저장한 작업 표·사진.
 * 아직 저장 안 했으면 작업 표는 오늘 근무일 날짜의 명일 작업 예정에서 가져옴 (위험성은 화면에서 낱말로 미리 고름)
 */
function tbmGet(token) {
  auth_(token);
  ensureTbmTabs_();
  const day = workDay_(Date.now());
  const roles = {};
  staffRows_().forEach(function (s) { roles[s['staff_id']] = s['역할']; });
  const signs = daySigns_(day).map(function (r, i) {
    return { no: i + 1, id: r['sign_id'], name: r['이름'], part: r['파트명'], role: roles[r['staff_id']] || '', at: String(r['서명시각']).slice(11, 16), img: fileB64_(r['서명_id']) };
  });
  const mgr = signs.filter(function (s) { return s.role === '소장'; })[0] || signs.filter(function (s) { return s.role === '부소장'; })[0] || null;
  const row = tbmRow_(day);
  const works = row ? jsonOr_(row['작업표'], []) : nwSheet_(day).rows.map(function (r) { return { place: r.place, work: r.work, note: r.note, dept: r.dept, n: '' }; });   // note(비고)는 위험성 미리 고르기에만 씀
  return {
    ok: true, day: day, signs: signs, manager: mgr ? { name: mgr.name, img: mgr.img } : null, risks: riskList_(),
    works: works, checks: row ? jsonOr_(row['체크칸'], {}) : null, saved: !!row, by: row ? row['작성자명'] : '', at: row ? row['수정시각'] : '',
    photos: { meet: row ? fileB64_(row['회의사진_id']) : '', chant: row ? fileB64_(row['구호사진_id']) : '' },
    pdf: row && row['pdf_id'] ? { id: row['pdf_id'], at: row['PDF만든시각'], signs: Number(row['서명수']) || 0, url: driveUrl_(row['pdf_id']) } : null
  };
}

function cleanWorks_(list) {
  if (!Array.isArray(list) || list.length > TBM_MAX_ROWS) return null;
  const n3 = function (v) { v = Number(v); return v >= 1 && v <= 3 ? Math.round(v) : ''; };
  return list.map(function (w) {
    w = w || {};
    return {
      place: cleanText_(w.place, 40), work: cleanText_(w.work, 100), dept: NW_DEPTS.indexOf(w.dept) !== -1 ? w.dept : '',
      n: /^\d{1,3}$/.test(String(w.n == null ? '' : w.n)) ? String(w.n) : '',
      risk: cleanText_(w.risk, 60), kind: cleanText_(w.kind, 20), p: n3(w.p), s: n3(w.s),
      fixes: (Array.isArray(w.fixes) ? w.fixes : []).slice(0, 6).map(function (f) { return cleanText_(f, 80); }).filter(String)
    };
  });
}

/** [저장]: 작업 표·체크 칸·사진 2장 (사진은 바꾼 것만 보냄, 1600px JPEG). PDF는 만들지 않음 (결정 58) */
function tbmSave(token, d) {
  const me = auth_(token);
  d = d || {};
  const works = cleanWorks_(d.works);
  if (!works) return { ok: false, error: '작업 표는 ' + TBM_MAX_ROWS + '줄까지 넣을 수 있습니다' };
  const checks = {};
  TBM_CHECKS.forEach(function (k) { if (d.checks && d.checks[k]) checks[k] = true; });
  const pics = {};
  for (const k of ['meet', 'chant']) {
    if (!d[k]) continue;
    pics[k] = parseDataUrl_(d[k], 'image/jpeg', 1000, 4000000);
    if (!pics[k]) return { ok: false, error: (k === 'meet' ? '회의' : '구호') + ' 사진을 읽지 못했습니다. 다시 골라 주세요.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const day = workDay_(Date.now());
    const row = tbmRow_(day);
    const at = now_();
    const patch = { '작업표': JSON.stringify(works), '체크칸': JSON.stringify(checks), '수정시각': at };
    const name = { meet: ['회의사진_id', '_001'], chant: ['구호사진_id', '_002'] };
    const oldIds = [];
    Object.keys(pics).forEach(function (k) {
      if (row) oldIds.push(row[name[k][0]]);
      patch[name[k][0]] = saveBlob_(tbmFolder_(day), pics[k], day + '_TBM-' + (k === 'meet' ? '회의사진' : '구호사진') + name[k][1] + '.jpg', 'TBM ' + day + ' · ' + me['이름']);
    });
    if (row) updateRow_('TBM', row._row, patch);
    else appendRow_('TBM', Object.assign(patch, { 'tbm_id': 'WS-TB-' + day.replace(/-/g, '') + '-001', '근무일': day, '작성자_id': me['staff_id'], '작성자명': me['이름'], '서명수': '0', '작성시각': at, '삭제여부': 'N' }));
    oldIds.forEach(trashFile_);   // 새 사진과 시트를 다 쓴 뒤에 옛 사진을 버림 — 중간 오류에도 사진이 남음
    log_(me['이름'], 'TBM 저장', day, works.length + '줄 · 사진 ' + Object.keys(pics).length + '장');
    return { ok: true, at: at };
  } finally {
    lock.releaseLock();
  }
}

/** [PDF로 저장]: 화면이 만든 A4 가로 2쪽 PDF를 드라이브에 저장. 다시 누르면 새로 만들고 예전 PDF는 휴지통. 쓰인 서명은 TBM사용=Y */
function tbmSavePdf(token, dataUri, signIds, d) {
  const me = auth_(token);
  if (d) { const s = tbmSave(token, d); if (!s.ok) return s; }   // 저장 + PDF를 서버 한 번 부르기로 (결정 78)
  const m = /^data:application\/pdf[^,]*;base64,(.+)$/.exec(String(dataUri || ''));
  if (!m || m[1].length < 100) return { ok: false, error: 'PDF 내용이 올바르지 않습니다' };
  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 30 * 1024 * 1024) return { ok: false, error: 'PDF가 너무 큽니다' };
  const ids = (Array.isArray(signIds) ? signIds : []).map(String);
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const day = workDay_(Date.now());
    const row = tbmRow_(day);
    if (!row) return { ok: false, error: '먼저 [저장]을 눌러 주세요' };
    const oldPdf = row['pdf_id'];
    const id = saveBlob_(tbmFolder_(day), Utilities.newBlob(bytes, 'application/pdf'), day + '_TBM.pdf', 'TBM ' + day + ' · 서명 ' + ids.length + '명 · ' + me['이름']);
    const at = now_();
    updateRow_('TBM', row._row, { 'pdf_id': id, 'PDF만든시각': at, '서명수': String(ids.length) });
    trashFile_(oldPdf);   // 새 PDF를 저장한 뒤에 옛 PDF를 버림
    readTable_('서명').rows.forEach(function (r) {
      if (ids.indexOf(r['sign_id']) !== -1 && r['TBM사용'] !== 'Y') updateRow_('서명', r._row, { 'TBM사용': 'Y' });
    });
    log_(me['이름'], 'TBM PDF 저장', day, '서명 ' + ids.length + '명');
    return { ok: true, pdf: { id: id, at: at, signs: ids.length, url: driveUrl_(id) } };
  } finally {
    lock.releaseLock();
  }
}

function driveUrl_(id) { return 'https://drive.google.com/file/d/' + id + '/view'; }

/* ───────────────────────── 명일 작업 예정 (WS_서류작업 9장, 결정 62·68) ───────────────────────── */

const NW_DEPTS = ['전방파트', '기건파트'];
const NW_MAX_ROWS = 30;

/** 일자 기본값 = 작성일(근무일, 오전 6시 경계)의 다음 날 */
function nwDefaultDate_(nowMs) {
  return new Date(Date.parse(workDay_(nowMs) + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
}

function nwSheet_(date) {
  const rows = readTable_('명일작업').rows.filter(function (r) { return r['일자'] === date; })
    .sort(function (a, b) { return Number(a['순번']) - Number(b['순번']); });
  const last = rows.reduce(function (m, r) { return r['고친시각'] > m['고친시각'] ? r : m; }, { '고친시각': '', '고친사람': '' });
  return {
    date: date, ver: last['고친시각'], by: last['고친사람'],
    rows: rows.map(function (r) { return { dept: r['부서'], place: r['작업장소'], work: r['작업내용'], note: r['비고'] }; })
  };
}

/** 불러오기 — date 비우면 기본 일자(내일). 로그인한 직원 모두 */
function nextWorkGet(token, date) {
  auth_(token);
  const def = nwDefaultDate_(Date.now());
  const d = date || def;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '일자 형식이 맞지 않습니다' };
  return Object.assign({ ok: true, defaultDate: def, workDay: workDay_(Date.now()) }, nwSheet_(d));
}

/** 저장 — 그 일자 줄을 모두 지우고 새로 씀. ver(불러올 때의 마지막 고친시각)가 다르면 덮어쓰지 않고 새 내용을 돌려줌 */
function nextWorkSave(token, date, rows, ver) {
  const me = auth_(token);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { ok: false, error: '일자 형식이 맞지 않습니다' };
  const clean = [];
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    const x = { dept: String(r && r.dept || ''), place: cleanText_(r && r.place, 40), work: cleanText_(r && r.work, 100), note: cleanText_(r && r.note, 40) };
    if (x.place || x.work || x.note) clean.push(x);   // 입력한 줄만 (결정 62)
  });
  if (clean.length > NW_MAX_ROWS) return { ok: false, error: '줄은 ' + NW_MAX_ROWS + '줄까지 넣을 수 있습니다' };
  if (clean.some(function (x) { return NW_DEPTS.indexOf(x.dept) === -1; })) return { ok: false, error: '부서(전방파트·기건파트)를 골라 주세요' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cur = nwSheet_(date);
    if (String(ver || '') !== cur.ver) return Object.assign({ ok: false, conflict: true, error: (cur.by || '다른 사람') + '님이 먼저 고쳤어요. 새 내용을 불러왔습니다.' }, cur);
    const t = readTable_('명일작업');
    const old = t.rows.filter(function (r) { return r['일자'] === date; }).map(function (r) { return r._row; });
    let at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    if (at <= cur.ver) at = cur.ver + '+';   // 같은 초에 두 번 저장해도 ver가 바뀌게
    // 새 줄을 먼저 쓰고 예전 줄을 지움 — 중간에 시트 오류가 나도 그 날짜 내용이 사라지지 않음 (점검 5)
    clean.forEach(function (x, i) {
      appendRow_('명일작업', { '일자': date, '순번': String(i + 1), '부서': x.dept, '작업장소': x.place, '작업내용': x.work, '비고': x.note, '고친사람': me['이름'], '고친시각': at });
    });
    old.sort(function (a, b) { return b - a; }).forEach(function (n) { t.sheet.deleteRow(n); });   // 아래부터 지워 위쪽 줄 번호가 안 바뀜
    log_(me['이름'], '명일 작업 저장', date, clean.length + '줄');
    return Object.assign({ ok: true }, nwSheet_(date));
  } finally {
    lock.releaseLock();
  }
}

/** 개선 C: TBM PDF에 쓰이지 않은 서명은 90일 뒤 휴지통 (매일 예약 작업) */
function cleanSigns_() {
  const limit = workDay_(Date.now() - 90 * DAY_MS);
  const t = readTable_('서명');
  let n = 0;
  t.rows.forEach(function (r) {
    if (r['삭제여부'] !== 'Y' && r['TBM사용'] !== 'Y' && r['근무일'] && r['근무일'] < limit) {
      trashFile_(r['서명_id']);
      updateRow_('서명', r._row, { '삭제여부': 'Y' });
      n++;
    }
  });
  if (n) log_('예약 작업', '서명 정리', '', n + '개 휴지통');
  return n;
}

function cleanSignsTriggerMenu_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'cleanSigns_') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('cleanSigns_').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
  SpreadsheetApp.getUi().alert('서명 정리 예약을 켰습니다. 매일 새벽 3시에 90일 지난 안 쓴 서명을 휴지통으로 옮깁니다.');
}

function sign_(text) {
  const key = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!key) throw new Error('초기 설정을 먼저 해 주세요');
  const raw = Utilities.computeHmacSha256Signature(text, key);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

function hashPin_(pin, salt) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + String(pin), Utilities.Charset.UTF_8));
}

/* ───────────────────────── 소화기 QR 관리 ───────────────────────── */

function feList(token) {
  auth_(token);
  const items = readTable_('소화기').rows
    .filter(function (r) { return r['사용여부'] !== 'N'; })
    .map(feOut_)
    .sort(feSort_);
  return { ok: true, items: items, execUrl: publicUrl_(), label: labelSize_() };
}

function feAdd(token, d) {
  const me = auth_(token);
  const floor = String(d && d.floor || '');
  const store = cleanText_(d && d.store, 30);
  const count = Math.min(Math.max(Number(d && d.count) || 1, 1), 20);
  if (FLOORS.indexOf(floor) === -1) return { ok: false, error: '층을 골라 주세요.' };
  if (!store) return { ok: false, error: '매장명을 넣어 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('소화기');
    let maxNo = 0;
    t.rows.forEach(function (r) { if (r['매장명'] === store) maxNo = Math.max(maxNo, Number(r['번호']) || 0); });
    const day = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
    let seq = 0;
    t.rows.forEach(function (r) { const m = new RegExp('^WS-FE-' + day + '-(\\d+)$').exec(r['fe_id']); if (m) seq = Math.max(seq, Number(m[1])); });
    const added = [];
    const used = {};
    t.rows.forEach(function (r) { used[r['qr_token']] = 1; });
    for (let i = 1; i <= count; i++) {
      seq++;
      const no = maxNo + i;
      const row = {
        'fe_id': 'WS-FE-' + day + '-' + ('00' + seq).slice(-3),
        '층': floor, '매장명': store, 'store_id': '', '번호': String(no), '이름': store + '-소화기' + no,
        'qr_token': (function () { const k = shortToken_(used); used[k] = 1; return k; })(), '사용여부': 'Y', '등록일시': now_(), '등록자': me['이름'], '삭제일시': ''
      };
      appendRow_('소화기', row);
      added.push(row['이름']);
    }
    fireChanged_();
    log_(me['이름'], '소화기 등록', '', floor + ' · ' + added.join(', '));
    return Object.assign(feList(token), { added: added });   // 새 목록도 같이 → 화면이 다시 부르지 않음 (결정 78)
  } finally {
    lock.releaseLock();
  }
}

function feDelete(token, ids) {
  const me = auth_(token);
  ids = (ids || []).map(String);
  if (!ids.length) return { ok: false, error: '지울 소화기를 골라 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('소화기');
    const names = [];
    t.rows.forEach(function (r) {
      if (ids.indexOf(r['fe_id']) !== -1 && r['사용여부'] !== 'N') {
        updateRow_('소화기', r._row, { '사용여부': 'N', '삭제일시': now_() });
        names.push(r['이름']);
      }
    });
    fireChanged_();
    log_(me['이름'], '소화기 삭제', '', names.join(', '));
    return Object.assign(feList(token), { count: names.length });
  } finally {
    lock.releaseLock();
  }
}

function feOut_(r) {
  return { id: r['fe_id'], floor: r['층'], store: r['매장명'], no: Number(r['번호']) || 0, name: r['이름'], token: r['qr_token'], created: r['등록일시'] };
}

function feSort_(a, b) {
  const f = FLOORS.indexOf(a.floor) - FLOORS.indexOf(b.floor);
  if (f) return f;
  if (a.store !== b.store) return a.store < b.store ? -1 : 1;
  return a.no - b.no;
}

function labelSave(token, w, h) {
  const me = auth_(token);
  w = Math.round(Number(w) * 10) / 10; h = Math.round(Number(h) * 10) / 10;
  if (!(w >= 15 && w <= 100 && h >= 15 && h <= 100)) return { ok: false, error: '라벨 크기는 15~100mm 사이로 넣어 주세요.' };
  const old = labelSize_();
  if (old.w === w && old.h === h) return { ok: true, label: old };
  setSetting_('라벨가로mm', String(w)); setSetting_('라벨세로mm', String(h));
  log_(me['이름'], 'QR 라벨 크기', '', old.w + '×' + old.h + ' → ' + w + '×' + h + 'mm');
  return { ok: true, label: { w: w, h: h, dpi: old.dpi } };
}

function labelSize_() {
  return { w: Number(setting_('라벨가로mm')) || 50, h: Number(setting_('라벨세로mm')) || 50, dpi: Number(setting_('프린터dpi')) || 203 };
}

/* ───────────────────────── 점검 현황 ───────────────────────── */

function feStatus(token, ym) {
  auth_(token);
  if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) ym = ym_(new Date());
  const st = buildStatus_(ym);
  st.ok = true;
  st.counts = countStates_(st.items);
  st.months = monthList_();
  return st;
}

function buildStatus_(ym) {
  const now = new Date();
  const curYm = ym_(now);
  const day = Number(Utilities.formatDate(now, TZ, 'd'));
  const win = { start: Number(setting_('점검시작일')) || 1, end: Number(setting_('점검마감일')) || 5 };
  const monthEnd = ym + '-31 23:59';
  const monthStart = ym + '-01 00:00';
  const checks = {};
  readTable_('소화기점검').rows.forEach(function (c) {
    if (c['연월'] === ym && c['삭제여부'] !== 'Y') checks[c['fe_id']] = c;
  });
  // 삭제한 소화기는 삭제한 달 이전에만 보이고, 삭제한 달이라도 이미 점검 기록이 있으면 보임
  const fes = readTable_('소화기').rows.filter(function (r) {
    if (String(r['등록일시']) > monthEnd) return false;
    if (r['사용여부'] === 'N') {
      const del = String(r['삭제일시']);
      if (del < monthStart) return false;
      if (del <= monthEnd && !checks[r['fe_id']]) return false;
    }
    return true;
  }).map(feOut_);
  const items = fes.sort(feSort_).map(function (f) {
    const c = checks[f.id];
    let state;
    if (c) state = c['상태'] === STATE_BAD ? 'bad' : 'ok';
    else if (ym > curYm) state = 'wait';
    else if (ym === curYm && day <= win.end) state = 'wait';
    else state = 'miss';
    return {
      id: f.id, floor: f.floor, store: f.store, name: f.name, no: f.no, state: state,
      checkId: c ? c['check_id'] : '', at: c ? c['입력일시'] : '', late: c ? c['기한후입력'] === 'Y' : false
    };
  });
  return { ym: ym, curYm: curYm, day: day, window: win, isCurrent: ym === curYm, items: items };
}

function countStates_(items) {
  const c = { ok: 0, bad: 0, wait: 0, miss: 0, total: items.length };
  items.forEach(function (i) { c[i.state]++; });
  return c;
}

function monthList_() {
  const now = ym_(new Date());
  let first = now;
  readTable_('소화기').rows.forEach(function (r) { const m = String(r['등록일시']).slice(0, 7); if (/^\d{4}-\d{2}$/.test(m) && m < first) first = m; });
  const out = [];
  let y = Number(first.slice(0, 4)), m = Number(first.slice(5, 7));
  for (let guard = 0; guard < 120; guard++) {
    const s = y + '-' + ('0' + m).slice(-2);
    out.push(s);
    if (s === now) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

function feDetail(token, checkId) {
  auth_(token);
  const c = readTable_('소화기점검').rows.filter(function (r) { return r['check_id'] === String(checkId) && r['삭제여부'] !== 'Y'; })[0];
  if (!c) return { ok: false, error: '입력 내용을 찾지 못했습니다.' };
  return {
    ok: true,
    name: c['소화기이름'], floor: c['층'], ym: c['연월'], state: c['상태'], at: c['입력일시'], late: c['기한후입력'] === 'Y',
    photo: fileB64_(c['사진_id']), signA: fileB64_(c['문구_id']), signB: fileB64_(c['이름_id'])
  };
}

/** 드라이브 파일 → data URL. 작은 파일(서명 등)은 6시간 기억해 TBM을 열 때마다 드라이브를 다시 읽지 않음 (점검 3).
 *  파일 번호마다 내용이 바뀌지 않으므로(바꾸면 새 번호) 기억해도 틀리지 않음 */
function fileB64_(id) {
  if (!id) return '';
  const cache = CacheService.getScriptCache(), key = 'f_' + id;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const b = DriveApp.getFileById(id).getBlob();
    const s = 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
    if (s.length < 90000) cache.put(key, s, 21600);   // 캐시 한 칸 100KB 제한
    return s;
  } catch (e) {
    return '';
  }
}

/* ───────────────────────── QR 점검 입력 (로그인 없음) ───────────────────────── */

function checkInit(qr) {
  const f = feByToken_(qr);
  if (!f) return { ok: false, error: '등록되지 않았거나 삭제된 QR입니다. 시설팀에 알려 주세요.' };
  const now = new Date();
  const ym = ym_(now);
  const day = Number(Utilities.formatDate(now, TZ, 'd'));
  const win = { start: Number(setting_('점검시작일')) || 1, end: Number(setting_('점검마감일')) || 5 };
  const exists = readTable_('소화기점검').rows.some(function (c) { return c['fe_id'] === f.id && c['연월'] === ym && c['삭제여부'] !== 'Y'; });
  return {
    ok: true,
    fe: { name: f.name, floor: f.floor, store: f.store },
    ym: ym, monthLabel: Number(ym.slice(0, 4)) + '년 ' + Number(ym.slice(5, 7)) + '월',
    window: win, day: day, late: day > win.end, early: day < win.start, exists: exists,
    photo: { w: Number(setting_('사진긴변px')) || 640, q: Number(setting_('사진품질')) || 0.6 }
  };
}

function checkSubmit(qr, d) {
  const f = feByToken_(qr);
  if (!f) return { ok: false, error: '등록되지 않았거나 삭제된 QR입니다.' };
  d = d || {};
  const state = d.state === STATE_BAD ? STATE_BAD : STATE_OK;
  const photo = parseDataUrl_(d.photo, 'image/jpeg', 2000, 600000);
  const signA = parseDataUrl_(d.signA, 'image/png', 200, 300000);
  const signB = parseDataUrl_(d.signB, 'image/png', 200, 300000);
  const missing = [];
  if (!photo) missing.push('압력계 사진');
  if (!signA) missing.push(state === STATE_BAD ? '이상 내용 칸' : '외관·압력 이상무 칸');
  if (!signB) missing.push('이름 칸');
  if (missing.length) return { ok: false, error: missing.join(', ') + '이(가) 비어 있습니다.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const now = new Date();
    const ym = ym_(now);
    const day = Number(Utilities.formatDate(now, TZ, 'd'));
    const end = Number(setting_('점검마감일')) || 5;
    const t = readTable_('소화기점검');
    const old = t.rows.filter(function (c) { return c['fe_id'] === f.id && c['연월'] === ym && c['삭제여부'] !== 'Y'; })[0];
    if (old && !d.overwrite) return { ok: false, exists: true, error: '이번 달 입력이 이미 있습니다.' };

    const folder = monthFolder_(ym);
    const base = Utilities.formatDate(now, TZ, 'yyyy-MM-dd') + '_소화기점검-' + safeName_(f.name);
    const desc = f.floor + ' · ' + f.store + ' · ' + f.name + ' · ' + ym + ' · ' + state;
    const pId = saveBlob_(folder, photo, base + '_001.jpg', desc);
    const aId = saveBlob_(folder, signA, base + '_002.png', desc + ' · 문구 손글씨');
    const bId = saveBlob_(folder, signB, base + '_003.png', desc + ' · 이름 손글씨');
    const at = now_();
    const row = {
      '연월': ym, 'fe_id': f.id, '층': f.floor, '매장명': f.store, '소화기이름': f.name, '상태': state,
      '사진_id': pId, '문구_id': aId, '이름_id': bId, '입력일시': at, '기한후입력': day > end ? 'Y' : 'N', '삭제여부': 'N'
    };
    let checkId;
    if (old) {
      checkId = old['check_id'];
      row['덮어쓴횟수'] = String((Number(old['덮어쓴횟수']) || 0) + 1);
      updateRow_('소화기점검', old._row, row);
    } else {
      const dayKey = Utilities.formatDate(now, TZ, 'yyyyMMdd');
      let seq = 0;
      t.rows.forEach(function (c) { const m = new RegExp('^WS-FC-' + dayKey + '-(\\d+)$').exec(c['check_id']); if (m) seq = Math.max(seq, Number(m[1])); });
      checkId = 'WS-FC-' + dayKey + '-' + ('00' + (seq + 1)).slice(-3);
      row['check_id'] = checkId;
      row['덮어쓴횟수'] = '0';
      appendRow_('소화기점검', row);
    }
    if (old) ['사진_id', '문구_id', '이름_id'].forEach(function (k) { trashFile_(old[k]); });   // 새 파일과 시트를 다 쓴 뒤에 옛 파일을 버림
    fireChanged_();
    log_('매장 직원(QR)', old ? '소화기 점검 다시 입력' : '소화기 점검 입력', checkId, f.name + ' · ' + state + (row['기한후입력'] === 'Y' ? ' · 기한 후' : ''));
    return { ok: true, state: state, late: row['기한후입력'] === 'Y', checkId: checkId, name: f.name, at: at };
  } finally {
    lock.releaseLock();
  }
}

// QR 고유번호 모양 검사 — 12자리(v0.2.2~)와 예전 32자리 모두. 주소 받는 곳(doGet)과 읽는 곳이 같은 검사를 씀
function isQrToken_(qr) { return /^([a-f0-9]{32}|[2-9a-km-np-z]{12})$/.test(String(qr || '')); }

function feByToken_(qr) {
  qr = String(qr || '');
  if (!isQrToken_(qr)) return null;
  const r = readTable_('소화기').rows.filter(function (x) { return x['qr_token'] === qr && x['사용여부'] !== 'N'; })[0];
  return r ? feOut_(r) : null;
}

function parseDataUrl_(s, type, minLen, maxLen) {
  s = String(s || '');
  const prefix = 'data:' + type + ';base64,';
  if (s.indexOf(prefix) !== 0) return null;
  const b64 = s.slice(prefix.length);
  if (b64.length < minLen || b64.length > maxLen) return null;
  try {
    return Utilities.newBlob(Utilities.base64Decode(b64), type);
  } catch (e) {
    return null;
  }
}

function saveBlob_(folder, blob, name, desc) {
  blob.setName(name);
  const file = folder.createFile(blob);
  file.setDescription(desc);
  return file.getId();
}

function trashFile_(id) {
  if (!id) return;
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* 이미 없음 */ }
}

/* ───────────────────────── 드라이브 폴더 ───────────────────────── */

function monthFolder_(ym) {
  return folderPath_(['시설팀 통합업무', '20_업무지원', '소화기점검', ym]);
}

function folderPath_(path) {
  const cacheRaw = setting_('FOLDER_CACHE_JSON') || '{}';
  let cache;
  try { cache = JSON.parse(cacheRaw); } catch (e) { cache = {}; }
  const key = path.join('/');
  if (cache[key]) {
    try { const f = DriveApp.getFolderById(cache[key]); if (!f.isTrashed()) return f; } catch (e) { /* 다시 찾음 */ }
  }
  let parent = DriveApp.getRootFolder();
  path.forEach(function (name) {
    const it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  });
  cache[key] = parent.getId();
  setSetting_('FOLDER_CACHE_JSON', JSON.stringify(cache));
  return parent;
}

/* ───────────────────────── 시트 도우미 ───────────────────────── */

function db_() {
  const id = PropertiesService.getScriptProperties().getProperty('APP_DB_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/* 시트 값은 모두 글자로 저장·읽음 (결정 54)
   - 구글 시트는 '2026-11', '2026-11-04 23:05', '0012' 같은 글자를 날짜·숫자로 바꿔 저장함 (글자 형식을 지정해도 appendRow·setValues는 바뀜)
   - 쓸 때: 앞에 ' 를 붙이면 시트가 글자 그대로 둠(화면에는 ' 가 안 보임). 줄 하나를 한 번에 쓰는 방식은 그대로라 느려지지 않음. = 로 시작하는 글자가 수식이 되는 것도 막음
   - 읽을 때: 예전에 날짜·숫자로 바뀌어 저장된 칸도 열 이름에 맞춰 글자로 되돌림 → 이미 쌓인 기록도 그대로 집계됨 */
function asText_(v) {
  if (v === undefined || v === null || v === '') return '';
  return "'" + String(v);
}
function cellOut_(h, v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    if (h === '연월') return Utilities.formatDate(v, TZ, 'yyyy-MM');
    if (h === '일자') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
  }
  return String(v);
}

function readTable_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('시트 메뉴 「업무지원 › ① 초기 설정」을 먼저 해 주세요 (' + name + ' 탭 없음)');
  const values = sh.getDataRange().getValues();
  const head = values.shift().map(String);
  return { head: head, rows: rowsOf_(head, values, 2), sheet: sh };
}

/** 시트 맨 아래 n줄만 읽음 — 앱이 덧붙이기만 하는 탭에서 최근 줄을 찾을 때 (점검 8)
 *  shortcut: 시트를 손으로 정렬하면 최근 줄이 맨 아래가 아닐 수 있음 — 그때는 readTable_로 바꿈 */
function readTail_(name, n) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('시트 메뉴 「업무지원 › ① 초기 설정」을 먼저 해 주세요 (' + name + ' 탭 없음)');
  const last = sh.getLastRow(), cols = sh.getLastColumn();
  const head = sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
  if (last < 2) return { head: head, rows: [], sheet: sh };
  const start = Math.max(2, last - n + 1);
  return { head: head, rows: rowsOf_(head, sh.getRange(start, 1, last - start + 1, cols).getValues(), start), sheet: sh };
}

function rowsOf_(head, values, firstRow) {
  return values.map(function (v, i) {
    const o = { _row: firstRow + i };
    head.forEach(function (h, j) { o[h] = cellOut_(h, v[j]); });
    return o;
  }).filter(function (o) { return head.some(function (h) { return o[h] !== ''; }); });
}

function appendRow_(name, obj) {
  const sh = db_().getSheetByName(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.appendRow(head.map(function (h) { return asText_(obj[h]); }));
}

function updateRow_(name, rowNo, patch) {
  const sh = db_().getSheetByName(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const cur = sh.getRange(rowNo, 1, 1, head.length).getValues()[0];
  const next = head.map(function (h, i) { return asText_(patch[h] === undefined ? cellOut_(h, cur[i]) : patch[h]); });
  sh.getRange(rowNo, 1, 1, head.length).setValues([next]);
}

function setting_(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('set_' + key);
  if (hit !== null) return hit;
  const r = readTable_('설정').rows.filter(function (x) { return x['키'] === key; })[0];
  const v = r ? r['값'] : '';
  if (key !== 'FOLDER_CACHE_JSON') cache.put('set_' + key, v, 60);
  return v;
}

function setSetting_(key, value) {
  const t = readTable_('설정');
  const r = t.rows.filter(function (x) { return x['키'] === key; })[0];
  if (r) updateRow_('설정', r._row, { '값': value });
  else appendRow_('설정', { '키': key, '값': value, '설명': '' });
  try { CacheService.getScriptCache().remove('set_' + key); } catch (e) { /* 캐시 없음 */ }
}

function log_(who, what, id, text) {
  try { appendRow_('변경기록', { '일시': now_(), '누가': who, '무엇을': what, '대상ID': id, '내용': text }); } catch (e) { /* 기록 실패는 무시 */ }
}

/* ───────────────────────── 작은 도우미 ───────────────────────── */

function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); }
function ym_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM'); }

function cleanText_(s, max) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 저장 이름 규칙: 띄어쓰기·특수문자 → '-', 이어진 '-'는 하나로, '_' 금지, 30자 */
function safeName_(s) {
  return String(s || '')
    .replace(/[\s\\/:*?"<>|_#%&{}$!'@+`=.,;[\]()~^]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

function randomHex_(bytes) {
  let s = '';
  while (s.length < bytes * 2) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, bytes * 2);
}

function toHex_(bytes) {
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}
