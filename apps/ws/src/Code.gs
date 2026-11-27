/**
 * 시설팀 업무지원(WS) — 소화기 점검 테스트판
 * 기준: claude/통합_업무지원앱_설계정의서.md (RC4) + 수정요청_대기목록 WS-13·WS-14
 * 범위: 로그인(PIN + 근무일 첫 서명) → 메인 → 점검 → 소화기 점검 (QR 관리·인쇄, 월별·층별 현황, QR 점검 입력)
 *       서류작업 → TBM (서명란·작업 표·위험성·사진 2장·PDF), 명일 작업 예정 — docs/설계/WS_서류작업.md
 *       점검 → 전열필증 (층·매장·기기 관리대장, 50×50 신고필증 라벨, QR 필증 보기) — docs/설계/WS_전열필증.md
 *       점검 → 공사장 점검 (공사 현장 순찰, 사진, 날짜별·현장별 PDF) — docs/설계/WS_공사장점검.md
 * 나머지 메뉴는 화면만 두고 "준비 중"으로 표시합니다.
 *
 * 테스트판에서 단순화한 것 (정식판에서 공통 DB·cdb로 바꿈)
 *  - 직원 목록: 공통 DB 대신 이 시트의 `직원` 탭
 *  - 매장: 도면협의 매장 목록 대신 직접 입력한 매장명
 */

const APP = { id: 'WS', title: '업무지원', version: '0.26.42', specVersion: 'v1.2', commonVersion: '0.1' };
const TZ = 'Asia/Seoul';
const FLOORS = ['B1', '1F', '2F', '3F', '4F', '5F', '6F'];
const ROLES = ['소장', '부소장', '파트장', '직원', '관리자', '옵저버'];   // 옵저버: 직원 권한 + 지도 편집, 파트 「관리」 고정 (결정 138)
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
  '근무표': ['월', '순서', '구역', '직책', '이름', '일별', '올린사람', '올린시각', '삭제여부'],
  '근무변경': ['날짜', '이름', '원래값', '바꾼값', '바꾼사람', '바꾼시각', '삭제여부'],
  '기본휴일': ['이름', '요일', '바꾼사람', '바꾼시각'],
  '위험성목록': ['순서', '낱말', '위험요인', '재해형태', '가능성', '중대성', '개선조치1', '개선조치2', '개선조치3', '개선조치4', '사용여부'],
  '전열매장': ['es_id', '층', '매장번호', '매장명', '사용여부', '등록일시', '등록자', '삭제일시'],
  '전열기기': ['eh_id', 'es_id', '층', '매장명', '관리번호', '기기명', '용량W', '제조사', '책임자정', '책임자부', '승인일자', 'qr_token', '출력일시', '사용여부', '등록일시', '등록자', '수정일시', '삭제일시'],
  '공사현장': ['cs_id', '현장명', '공사내용', '업체', '사용여부', '등록일시', '등록자', '끝낸일시'],
  '공사점검항목': ['순서', '항목', '설명', '사용여부', '바꾼사람', '바꾼시각', '점검사용'],
  '공사점검': ['ck_id', '점검일', 'cs_id', '현장명', '공사내용', '업체', '점검자_id', '점검자', '점검시각', '항목', '양호', '미흡', '해당없음', '사진번호', 'pdf_id', 'PDF만든시각', '수정시각', '고친사람', '삭제여부', '회차'],
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
    .addItem('② 직원 등록', 'addStaffMenu_')
    .addItem('③ 웹앱 주소 보기', 'showUrlMenu_')
    .addItem('④ QR 고유번호 짧게 바꾸기 (32자리 → 12자리)', 'shortenTokensMenu_')
    .addItem('⑤ 데이터 점검 (날짜·숫자로 바뀐 칸, 빈 칸)', 'dataCheckMenu_')
    .addItem('⑥ 서명 정리 예약 켜기 (90일 지난 안 쓴 서명 → 휴지통, 매일 새벽 3시)', 'cleanSignsTriggerMenu_')
    .addItem('⑦ 직원 삭제', 'removeStaffMenu_')
    .addItem('⑧ 직원 PIN 바꾸기', 'changePinMenu_')
    .addItem('⑨ 종합업무일지 날씨 자동 켜기 (네이버, 매일 오후 1시)', 'logWeatherMenu_')
    .addSeparator()
    .addItem('⑩ Supabase로 옮기기 (바꿔 타는 날 한 번)', 'migrateMenu_')   // Migrate.gs (이관 4단계)
    .addItem('⑪ Supabase: 옛 파일 링크 공유 (「끝」까지 여러 번)', 'migrateShareMenu_')
    .addItem('⑫ Supabase: 주 1회 드라이브로 옮기기 켜기 (바꿔 탄 뒤)', 'archiveMenu_')   // Archive.gs (이관 5단계)
    .addItem('⑬ Supabase: 연결 확인 (읽기만, 언제든)', 'supabaseCheckMenu_')   // Migrate.gs
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
    '\n\n다음: 메뉴 ② 직원 등록 → 웹앱 배포';
}

/* 직원 등록·삭제 (결정 86): 여기 넣는 직원은 실제 직원. HUB를 만들면 공통 DB `직원`으로 그대로 옮김 → staff_id·hashPin_ 방식 유지 */
function addStaffMenu_() {
  const ui = SpreadsheetApp.getUi();
  const n = ui.prompt('직원 등록 (1/4)', '이름', ui.ButtonSet.OK_CANCEL);
  if (n.getSelectedButton() !== ui.Button.OK) return;
  const p = ui.prompt('직원 등록 (2/4)', 'PIN 4자리 (휴대폰 뒷 4자리, 겹치면 앞 4자리)', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const part = ui.prompt('직원 등록 (3/4)', '파트명 (예: 전방파트)', ui.ButtonSet.OK_CANCEL);
  if (part.getSelectedButton() !== ui.Button.OK) return;
  const r = ui.prompt('직원 등록 (4/4)', '역할: ' + ROLES.join(' / '), ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const res = addStaff_(n.getResponseText(), p.getResponseText(), part.getResponseText(), r.getResponseText());
  ui.alert(res.ok ? (res.name + ' 님을 등록했습니다 (' + res.staff_id + ')') : res.error);
}

function addStaff_(name, pin, part, role, by) {
  name = String(name || '').trim();
  pin = String(pin || '').trim();
  part = String(part || '').trim() || '전방파트';
  role = String(role || '').trim() || '직원';
  if (role === '옵저버') part = '관리';
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
    log_(by || '관리자(시트)', '직원 등록', id, name + ' · ' + role);
    return { ok: true, staff_id: id, name: name };
  } finally {
    lock.releaseLock();
  }
}

function liveStaffList_() {
  return readTable_('직원').rows.filter(function (s) { return s['사용여부'] !== 'N'; })
    .map(function (s) { return s['staff_id'] + ' ' + s['이름'] + ' · ' + s['파트명'] + ' · ' + s['역할']; });
}

function changePinMenu_() {
  const ui = SpreadsheetApp.getUi();
  const list = liveStaffList_();
  if (!list.length) { ui.alert('직원 PIN 바꾸기', '사용 중인 직원이 없습니다.', ui.ButtonSet.OK); return; }
  const q = ui.prompt('직원 PIN 바꾸기 (1/2)', 'PIN을 바꿀 직원의 이름이나 staff_id(예: S003)를 넣어 주세요.\n\n' + list.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (q.getSelectedButton() !== ui.Button.OK) return;
  const f = findStaff_(q.getResponseText());
  if (!f.ok) { ui.alert('직원 PIN 바꾸기', f.error, ui.ButtonSet.OK); return; }
  const p = ui.prompt('직원 PIN 바꾸기 (2/2)', f.staff['이름'] + ' (' + f.staff['staff_id'] + ') 님의 새 PIN 4자리\n\n바꾸면 그 직원이 쓰던 기기는 로그아웃되고, 새 PIN으로 다시 로그인해야 합니다.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return;
  const res = changePin_(f.staff['staff_id'], p.getResponseText());
  ui.alert('직원 PIN 바꾸기', res.ok ? res.name + ' 님의 PIN을 바꿨습니다.' : res.error, ui.ButtonSet.OK);
}

/* PIN 바꾸기: 새 salt로 다시 암호화. 기기 표 서명에 pin_hash가 들어가므로 쓰던 기기는 저절로 로그아웃 */
function changePin_(staffId, pin, by) {
  pin = String(pin || '').trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: 'PIN은 숫자 4자리입니다.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const rows = readTable_('직원').rows.filter(function (r) { return r['사용여부'] !== 'N'; });
    const s = rows.filter(function (r) { return r['staff_id'] === staffId; })[0];
    if (!s) return { ok: false, error: '사용 중인 직원 ' + staffId + '을(를) 찾지 못했습니다.' };
    const dup = rows.some(function (r) { return r['staff_id'] !== staffId && hashPin_(pin, r['pin_salt']) === r['pin_hash']; });
    if (dup) return { ok: false, error: '이 PIN은 다른 직원이 쓰고 있습니다. 휴대폰 번호 앞 4자리(010 다음)를 넣어 주세요.' };
    const salt = randomHex_(8);
    updateRow_('직원', s._row, { 'pin_hash': hashPin_(pin, salt), 'pin_salt': salt, '수정일시': now_() });
    CacheService.getScriptCache().remove('staff');
    log_(by || '관리자(시트)', '직원 PIN 바꿈', staffId, s['이름']);
    return { ok: true, staff_id: staffId, name: s['이름'] };
  } finally {
    lock.releaseLock();
  }
}

function removeStaffMenu_() {
  const ui = SpreadsheetApp.getUi();
  const list = liveStaffList_();
  if (!list.length) { ui.alert('직원 삭제', '사용 중인 직원이 없습니다.', ui.ButtonSet.OK); return; }
  const q = ui.prompt('직원 삭제', '지울 직원의 이름이나 staff_id(예: S003)를 넣어 주세요.\n\n' + list.join('\n'), ui.ButtonSet.OK_CANCEL);
  if (q.getSelectedButton() !== ui.Button.OK) return;
  const f = findStaff_(q.getResponseText());
  if (!f.ok) { ui.alert('직원 삭제', f.error, ui.ButtonSet.OK); return; }
  const yes = ui.alert('직원 삭제', f.staff['이름'] + ' (' + f.staff['staff_id'] + ' · ' + f.staff['파트명'] + ' · ' + f.staff['역할'] + ') 님을 삭제할까요?\n\n바로 로그인할 수 없게 됩니다. 시트 줄은 남기고 「사용여부」만 N으로 바꾸므로 서명·점검 기록의 이름은 그대로입니다.', ui.ButtonSet.YES_NO);
  if (yes !== ui.Button.YES) return;
  const res = removeStaff_(f.staff['staff_id']);
  ui.alert('직원 삭제', res.ok ? res.name + ' 님을 삭제했습니다.' : res.error, ui.ButtonSet.OK);
}

/* 이름이나 staff_id로 사용 중인 직원 찾기. 같은 이름이 둘 이상이면 staff_id로 다시 고르게 함 */
function findStaff_(key) {
  key = String(key || '').trim();
  if (!key) return { ok: false, error: '이름이나 staff_id를 넣어 주세요.' };
  const live = readTable_('직원').rows.filter(function (s) { return s['사용여부'] !== 'N'; });
  const byId = live.filter(function (s) { return s['staff_id'].toUpperCase() === key.toUpperCase(); });
  if (byId.length) return { ok: true, staff: byId[0] };
  const byName = live.filter(function (s) { return s['이름'] === key; });
  if (byName.length === 1) return { ok: true, staff: byName[0] };
  if (byName.length > 1) return { ok: false, error: '이름이 「' + key + '」인 직원이 ' + byName.length + '명입니다. staff_id로 넣어 주세요: ' + byName.map(function (s) { return s['staff_id']; }).join(', ') };
  return { ok: false, error: '「' + key + '」 직원을 찾지 못했습니다. 이미 삭제했거나 이름이 다릅니다.' };
}

/* 삭제 = 사용여부 N (줄은 남김, 결정 10·86). 직원 기억을 지워 그 직원의 기기 표도 바로 막힘 */
function removeStaff_(staffId, by) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = readTable_('직원').rows.filter(function (r) { return r['staff_id'] === staffId && r['사용여부'] !== 'N'; })[0];
    if (!s) return { ok: false, error: '사용 중인 직원 ' + staffId + '을(를) 찾지 못했습니다.' };
    updateRow_('직원', s._row, { '사용여부': 'N', '수정일시': now_() });
    CacheService.getScriptCache().remove('staff');
    log_(by || '관리자(시트)', '직원 삭제', staffId, s['이름'] + ' · ' + s['역할']);
    return { ok: true, staff_id: staffId, name: s['이름'] };
  } finally {
    lock.releaseLock();
  }
}

/* ── 환경설정 (앱, 결정 102): 소장만. 직원 추가·편집·삭제·PIN, 알림 표시 시간 ── */
function bossOnly_(token) {
  const me = auth_(token);
  if (me['역할'] !== '소장') throw new Error('환경설정은 소장만 쓸 수 있습니다.');
  return me;
}
function staffOut_() {
  return readTable_('직원').rows.filter(function (s) { return s['사용여부'] !== 'N'; }).map(userOut_);
}
function toastSec_() { const v = Number(setting_('알림표시초')); return v >= 0.5 && v <= 10 ? v : 2.6; }
function adminStaff(token) {
  bossOnly_(token);
  return { ok: true, staff: staffOut_(), toastSec: toastSec_() };
}
const MENU_KEYS_ = ['docs', 'inspect', 'spec', 'map', 'cad', 'docs.tbm', 'docs.nw', 'docs.att', 'docs.ahu', 'docs.log', 'docs.risk', 'docs.work', 'inspect.fire', 'inspect.eh', 'inspect.thermal', 'inspect.cs', 'inspect.defect'];   // 메인 메뉴 켜기·끄기 (결정 148) — 설정 시트 「메인메뉴끄기」
function menuOff_() { return String(setting_('메인메뉴끄기') || '').split(',').filter(function (k) { return MENU_KEYS_.indexOf(k) !== -1; }); }
function adminSetMenu(token, off) {
  const me = bossOnly_(token);
  const v = MENU_KEYS_.filter(function (k) { return (off || []).indexOf(k) !== -1; });
  setSetting_('메인메뉴끄기', v.join(','));
  log_(me['이름'], '메인 메뉴 끄기', '', v.join(',') || '모두 켬');
  return { ok: true, off: menuOff_() };
}
function adminSetToast(token, sec) {
  const me = bossOnly_(token);
  sec = Number(sec);
  if (!(sec >= 0.5 && sec <= 10)) return { ok: false, error: '0.5~10초 사이로 골라 주세요.' };
  setSetting_('알림표시초', String(sec));
  log_(me['이름'], '알림 표시 시간', '', sec + '초');
  return { ok: true, toastSec: sec };
}
function adminStaffSave(token, d) {
  const me = bossOnly_(token);
  d = d || {};
  if (!d.staff_id) {
    const r = addStaff_(d.name, d.pin, d.part, d.role, me['이름']);
    return r.ok ? { ok: true, staff: staffOut_() } : r;
  }
  const name = String(d.name || '').trim();
  let role = String(d.role || '').trim(), part = role === '옵저버' ? '관리' : String(d.part || '').trim();
  if (!name) return { ok: false, error: '이름을 넣어 주세요.' };
  if (!part) return { ok: false, error: '파트를 넣어 주세요.' };
  if (d.staff_id === me['staff_id']) role = me['역할'];   // 내 역할은 못 바꿈 (환경설정을 잃지 않게)
  if (ROLES.indexOf(role) === -1) return { ok: false, error: '역할은 ' + ROLES.join(' / ') + ' 중 하나입니다.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = readTable_('직원').rows.filter(function (r) { return r['staff_id'] === d.staff_id && r['사용여부'] !== 'N'; })[0];
    if (!s) return { ok: false, error: '사용 중인 직원 ' + d.staff_id + '을(를) 찾지 못했습니다.' };
    updateRow_('직원', s._row, { '이름': name, '파트명': part, '역할': role, '수정일시': now_() });
    CacheService.getScriptCache().remove('staff');
    log_(me['이름'], '직원 편집', d.staff_id, name + ' · ' + part + ' · ' + role);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, staff: staffOut_() };
}
function adminStaffPin(token, staffId, pin) {
  const me = bossOnly_(token);
  return changePin_(String(staffId || ''), pin, me['이름']);
}
function adminStaffRemove(token, staffId) {
  const me = bossOnly_(token);
  if (staffId === me['staff_id']) return { ok: false, error: '내 계정은 지울 수 없습니다.' };
  const r = removeStaff_(String(staffId || ''), me['이름']);
  return r.ok ? { ok: true, staff: staffOut_() } : r;
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
    else if (/^cad(Login|Cats|Prepare|Finish)$/.test(body.action)) out = cadPc_(body);   // PC 변환기 업로드 (WS_CAD.md 10장): PIN 대조
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
  if (p.eh !== undefined) {   // 전열필증 QR — 로그인 없이 필증 정보 (결정 96)
    return HtmlService.createHtmlOutput(ehViewPage_(p.eh))
      .setTitle('전열기기 신고필증')
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
    } else if (p.api === 'logac') {
      // Supabase 판 종합업무일지가 열릴 때 부름: 날씨가 빠진 날 채우기 (가동시간은 결정 194 로 Supabase 직접) — 키 없이
      const day = logDay_(p.day);
      if (sbLive_()) logWeatherMaybe_(day, p.wx === '1');   // 예약이 빠진 날: Supabase 화면이 일지를 열 때 날씨 채움 (구글 판 logGet 과 같음). wx=1 = 공조기 화면: 오후 1시 전에도, 날씨만
      out = { ok: true, day: day };   // 가동시간은 Supabase ws_log_ac 로 옮김 (결정 192) — 이 통로는 날씨 채우기만
    } else if (p.api === 'caddrive') {
      // CAD 변환 도면(DXF) 드라이브 사본: ws-files 의 cad/YYYY-MM/<32자>.dxf 만 → 시설팀 통합업무/20_업무지원/CAD변환파일/YYYY-MM
      out = cadDrive_(p.path, p.name);
    } else if (p.api === 'pdf') {
      // Supabase 판 앱 안 PDF 보기: 드라이브로 옮긴 PDF를 대신 받아 줌 (브라우저는 드라이브에서 직접 못 받음). 키 없이 — 이미 「링크가 있는 사람 보기」인 PDF만
      out = pdfApi_(p.id);
    } else {
      throw new Error('알 수 없는 요청');
    }
  } catch (err) {
    out = { ok: false, error: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** PC 변환기(CAD변환기.exe)의 업로드 — 업무지원 직원 PIN과 대조 (docs/설계/WS_CAD.md 10장, supabase/18_cad.sql)
 *  cadLogin {pin} → {ok,name,role} · cadCats {pin} → {ok,cats[{id,name}]} · cadPrepare {pin} → {ok,path,uploadUrl} (PC가 파일을 이 주소에 PUT) · cadFinish {pin,path,name,floor,memo,cat_id,size} → 드라이브 사본 + 목록 기록(그 직원 이름으로) */
function cadPc_(b) {
  const who = sbReq_('post', '/rest/v1/rpc/ws_cad_pc_check', { p_pin: String(b.pin || '') }).getContentText();
  const me = JSON.parse(who);
  if (!me.ok || b.action === 'cadLogin') return me;
  if (b.action === 'cadCats') return { ok: true, cats: JSON.parse(sbReq_('get', '/rest/v1/cad_cat?select=id,name&order=id').getContentText()) };   // 올릴 때 고를 분류
  const base = migrateConf_().url;
  if (b.action === 'cadPrepare') {
    const ym = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    const path = 'cad/' + ym + '/' + Utilities.getUuid().replace(/-/g, '') + '.dxf';
    const r = JSON.parse(sbReq_('post', '/storage/v1/object/upload/sign/ws-files/' + path, {}).getContentText());
    const rel = String(r.url || '');
    if (!rel) throw new Error('올릴 주소를 받지 못했습니다');
    return { ok: true, path: path, uploadUrl: /^https:/.test(rel) ? rel : base + '/storage/v1' + (rel.charAt(0) === '/' ? '' : '/') + rel };
  }
  const path = String(b.path || '');
  if (!/^cad\/\d{4}-\d{2}\/[0-9a-f]{32}\.dxf$/.test(path)) throw new Error('도면 파일 경로가 맞지 않습니다');
  const name = String(b.name || '').trim();
  if (!name) throw new Error('도면 이름이 없습니다');
  let drive = '';
  try { drive = cadDrive_(path, name).url; } catch (e) { if (/없|404|not found/i.test(String(e.message))) throw new Error('올린 파일을 서버에서 찾지 못했습니다. 다시 올려 주세요'); }
  const r = JSON.parse(sbReq_('post', '/rest/v1/rpc/ws_cad_pc_save', { p_pin: String(b.pin), p_r: { name: name, floor: b.floor || '', memo: b.memo || '', cat_id: b.cat_id || '', path: path, url: base + '/storage/v1/object/public/ws-files/' + path, size: Number(b.size) || 0, drive_url: drive } }).getContentText());
  if (r.ok) r.name = me.name;
  r.drive = !!drive;
  return r;
}

/** CAD 변환 도면 드라이브 사본 (docs/설계/WS_CAD.md 7장). 같은 파일은 두 번 만들지 않음. 크기 50MB 이하 */
function cadDrive_(path, name) {
  const m = /^cad\/(\d{4}-\d{2})\/[0-9a-f]{32}\.dxf$/.exec(String(path || ''));
  if (!m) throw new Error('도면 파일 경로가 맞지 않습니다');
  const nm = (String(name || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'CAD도면').replace(/(\.dxf)?$/i, '.dxf');
  const folder = folderPath_(['시설팀 통합업무', '20_업무지원', 'CAD변환파일', m[1]]);
  const tag = 'cad:' + path;
  let id = '';
  for (const it = folder.getFilesByName(nm); !id && it.hasNext();) { const x = it.next(); if (x.getDescription() === tag) id = x.getId(); }
  if (!id) {
    const blob = sbReq_('get', '/storage/v1/object/ws-files/' + path).getBlob();
    if (blob.getBytes().length > 50 * 1024 * 1024) throw new Error('도면이 너무 큽니다 (50MB 넘음)');
    id = saveBlob_(folder, blob, nm, tag);
  }
  DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: id, name: nm, url: driveUrl_(id) };
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
  const mode = loginMode_(me, Date.now());   // 출근현황으로 서명·PIN만·막힘 (결정 92)
  if (mode === 'block') { log_(me['이름'], '휴일 접속 막음', me['staff_id'], day); return { ok: false, blocked: true, error: BLOCK_MSG }; }
  let sign = todaySign_(me['staff_id'], day);
  if (!sign && mode === 'sign') {
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
  const mode = loginMode_(me, Date.now());
  if (mode === 'block') throw new Error('LOGIN');   // 그날 휴무로 바뀌었으면 기기 표도 막음 → 다시 PIN 넣으면 안내
  const signs = daySigns_(day);
  return {
    ok: true, user: userOut_(me), app: APP, toastSec: toastSec_(), menuOff: menuOff_(),
    needSign: mode === 'sign' && !signs.some(function (r) { return r['staff_id'] === me['staff_id']; }),
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
  return (day === workDay_(Date.now()) ? readTail_('서명', SIGN_TAIL) : readTable_('서명')).rows   // 지난 날(TBM 날짜 고르기)은 전체에서
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

/** TBM 날짜: 화면이 고른 지난 날짜, 없거나 틀리거나 앞날이면 오늘 근무일 (11-13) */
function tbmDay_(v) {
  const today = workDay_(Date.now());
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && v < today ? v : today;
}

function jsonOr_(s, dflt) { try { const v = JSON.parse(s); return v == null ? dflt : v; } catch (e) { return dflt; } }

/**
 * TBM 화면 불러오기: 오늘 서명(로그인 순) · 관리감독자(역할 소장, 없으면 부소장) · 위험성 목록 · 저장한 작업 표·사진.
 * 아직 저장 안 했으면 작업 표는 오늘 근무일 날짜의 명일 작업 예정에서 가져옴 (위험성은 화면에서 낱말로 미리 고름)
 */
function tbmGet(token, want) {
  auth_(token);
  ensureTbmTabs_();
  const day = tbmDay_(want);
  const roles = {};
  staffRows_().forEach(function (s) { roles[s['staff_id']] = s['역할']; });
  const signs = daySigns_(day).map(function (r, i) {
    return { no: i + 1, id: r['sign_id'], name: r['이름'], part: r['파트명'], role: roles[r['staff_id']] || '', at: String(r['서명시각']).slice(11, 16), img: fileB64_(r['서명_id']) };
  });
  const mgr = signs.filter(function (s) { return s.role === '소장'; })[0] || signs.filter(function (s) { return s.role === '부소장'; })[0] || null;
  const row = tbmRow_(day);
  const works = row ? jsonOr_(row['작업표'], []) : nwSheet_(day).rows.map(function (r) { return { place: r.place, work: r.work, note: r.note, dept: r.dept, n: '' }; });   // note(비고)는 위험성 미리 고르기에만 씀
  return {
    ok: true, day: day, today: workDay_(Date.now()), signs: signs, manager: mgr ? { name: mgr.name, img: mgr.img } : null, risks: riskList_(),
    works: works, checks: row ? jsonOr_(row['체크칸'], {}) : null, saved: !!row, by: row ? row['작성자명'] : '', at: row ? row['수정시각'] : '',
    photos: { meet: row ? fileB64_(row['회의사진_id']) : '', chant: row ? fileB64_(row['구호사진_id']) : '' },
    pdf: row && row['pdf_id'] ? { id: row['pdf_id'], at: row['PDF만든시각'], signs: Number(row['서명수']) || 0, url: driveUrl_(row['pdf_id']), shared: sharedOnce_(row['pdf_id']) } : null
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
    const day = tbmDay_(d.day);
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
function tbmSavePdf(token, dataUri, signIds, d, want) {
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
    const day = tbmDay_(want);
    const row = tbmRow_(day);
    if (!row) return { ok: false, error: '먼저 [저장]을 눌러 주세요' };
    const oldPdf = row['pdf_id'];
    const id = saveBlob_(tbmFolder_(day), Utilities.newBlob(bytes, 'application/pdf'), day + '_TBM.pdf', 'TBM ' + day + ' · 서명 ' + ids.length + '명 · ' + me['이름']);
    const shared = shareLink_(id);
    if (shared) CacheService.getScriptCache().put('sh_' + id, '1', 21600);
    const at = now_();
    updateRow_('TBM', row._row, { 'pdf_id': id, 'PDF만든시각': at, '서명수': String(ids.length) });
    trashFile_(oldPdf);   // 새 PDF를 저장한 뒤에 옛 PDF를 버림
    readTable_('서명').rows.forEach(function (r) {
      if (ids.indexOf(r['sign_id']) !== -1 && r['TBM사용'] !== 'Y') updateRow_('서명', r._row, { 'TBM사용': 'Y' });
    });
    log_(me['이름'], 'TBM PDF 저장', day, '서명 ' + ids.length + '명');
    return { ok: true, pdf: { id: id, at: at, signs: ids.length, url: driveUrl_(id), shared: shared }, warn: shared ? '' : 'PDF는 저장했지만 공유를 못 했습니다. 구글 로그인 안 한 휴대폰에서는 열리지 않을 수 있습니다.' };
  } finally {
    lock.releaseLock();
  }
}

/* [PDF 열기]가 구글 로그인 안 한 브라우저에서도 되게 「링크가 있는 사람 누구나 보기」로 (11-07, 도면협의 검토서 PDF와 같음).
   링크(파일 주소)를 아는 사람만 볼 수 있고 고칠 수는 없음 */
function shareLink_(id) {
  try {
    const f = DriveApp.getFileById(id);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    if (f.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK) return true;   // 정말 바뀌었는지 확인 (계정 정책으로 조용히 안 바뀌는 경우)
    log_('시스템', 'TBM PDF 공유 안 됨', id, '공유 설정이 「링크가 있는 사람」으로 바뀌지 않음 — 드라이브 공유 정책 확인');
    return false;
  } catch (e) { log_('시스템', 'TBM PDF 공유 실패', id, String(e && e.message || e)); return false; }
}
/** TBM을 열 때 오늘 PDF도 공유 확인 — v0.6.9 전에 만든 PDF도 열리게. 한 번 되면 6시간 기억해 다시 드라이브를 부르지 않음 */
function sharedOnce_(id) {
  const cache = CacheService.getScriptCache(), key = 'sh_' + id;
  if (cache.get(key)) return true;
  const ok = shareLink_(id);
  if (ok) cache.put(key, '1', 21600);
  return ok;
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

/* ───────────────────────── 종합업무일지 (WS_종합업무일지 15.3.22, 결정 116) ─────────────────────────
   하루 한 줄. 새로 쓰는 날 = 구글 시트 「종합업무일지」, 25·26년 엑셀에서 옮긴 날 = 「종합업무일지_과거자료」(4단계).
   전년·누계·증감은 저장하지 않고 읽을 때 계산 → 옛 날을 고쳐도 뒤 누계가 저절로 맞음 */

const LOG_METERS = ['시수', '중수', '식당시수', '식당온수', '식당가스', '식당분전반', '식기세척분전반', '매점분전반', '급탕', '환탕', '급탕탱크'];   // 실온수 = 급탕 − 환탕 (계산)
const LOG_NUMS = ['영업시간', '최저', '최고', '최고풍속', '미세먼지', '전기'].concat(LOG_METERS);
const LOG_GRADES = ['', '좋음', '보통', '나쁨', '매우나쁨'];
const LOG_DEPTS = ['전기방재', '기계건축'];
const LOG_MAX_LINES = 15;   // 부서마다 기본 10줄, 줄 추가로 15줄까지 (사용자 11-13 · 11-25). 비고 칸은 화면에서 뺌(결정 120), 시트 열·옛 값은 그대로
const LOG_WX = ['날씨', '최저', '최고', '최고풍속', '미세먼지', '미세먼지등급'];   // 네이버 오후 1시 값이 들어가는 칸
const LOG_WX_REGION = '09710101';   // 네이버 날씨 지역 번호: 서울 송파구 잠실동
const LOG_TBM_DEPT = { '전방파트': '전기방재', '기건파트': '기계건축' };
const LOG_COLS = ['일자', '영업시간', '날씨', '최저', '최고', '최고풍속', '미세먼지', '미세먼지등급', '날씨출처'].concat(LOG_METERS,
  ['전기', '작업_전기방재', '작업_기계건축', '야간그림_id', 'pdf_id', 'PDF만든시각', '작성자', '수정자', '수정시각', '삭제여부', '비고']);   // 새 열은 맨 끝에만

/** 일지 시트 열기 — 없으면 만들어 드라이브 「서류작업/종합업무일지」에 두고 번호를 설정 탭에 적음 (사용자 요청: WS DB와 따로) */
function logBook_(key, title) {
  const id = setting_(key);
  if (id) {
    let ss = null;
    try { ss = SpreadsheetApp.openById(id); } catch (e) { /* 지워졌으면 새로 */ }
    if (ss) {
      const sh = ss.getSheetByName('일지'), n = sh.getLastColumn();
      if (n < LOG_COLS.length) sh.getRange(1, n + 1, 1, LOG_COLS.length - n).setValues([LOG_COLS.slice(n)]);   // 판이 올라 생긴 새 열(비고 …)을 맨 끝에
      return ss;
    }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    CacheService.getScriptCache().remove('set_' + key);
    const again = setting_(key);
    if (again && again !== id) return SpreadsheetApp.openById(again);
    const ss = SpreadsheetApp.create(title);
    const sh = ss.getSheets()[0];
    sh.setName('일지');
    sh.getRange(1, 1, 1, LOG_COLS.length).setValues([LOG_COLS]);
    sh.setFrozenRows(1);
    try { DriveApp.getFileById(ss.getId()).moveTo(logFolder_()); } catch (e) { /* 폴더 옮기기 실패해도 시트는 씀 */ }
    setSetting_(key, ss.getId());
    log_('시스템', '종합업무일지 시트 만듦', ss.getId(), title);
    return ss;
  } finally {
    lock.releaseLock();
  }
}
function logFolder_(day) {
  return folderPath_(['시설팀 통합업무', '20_업무지원', '서류작업', '종합업무일지'].concat(day ? [day.slice(0, 4), day.slice(0, 7)] : []));
}
/** 다른 시트에서 표 도우미(readTable_·appendRow_·updateRow_)를 쓰게 잠깐 db_를 바꿈 */
let DB_SWAP = null;
function withBook_(ss, fn) {
  const keep = DB_SWAP;
  DB_SWAP = ss;
  try { return fn(); } finally { DB_SWAP = keep; }
}
function logRows_(ss) {
  return withBook_(ss, function () { return readTable_('일지').rows; }).filter(function (r) { return r['일자'] && r['삭제여부'] !== 'Y'; });
}
/** 날짜 → 줄. 새 시트가 과거자료보다 먼저 */
function logMap_() {
  const m = {};
  logRows_(logBook_('일지과거시트ID', '종합업무일지_과거자료')).forEach(function (r) { m[r['일자']] = r; });
  logRows_(logBook_('일지시트ID', '종합업무일지')).forEach(function (r) { m[r['일자']] = Object.assign({ _new: true }, r); });
  return m;
}
/** 일지 날짜: 고른 날(앞날은 안 됨), 없거나 틀리면 오늘 근무일 */
function logDay_(v) {
  const today = workDay_(Date.now());
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && v <= today ? String(v) : today;
}
/** 전년 같은 달 같은 날. 2월 29일 → 전년 2월 28일 */
function logPrevYear_(day) {
  const y = Number(day.slice(0, 4)) - 1, md = day.slice(5);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return y + '-' + (md === '02-29' && !leap ? '02-28' : md);
}
function logAddDay_(day, n) { return new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
function logNum_(v) { const n = Number(String(v == null ? '' : v).replace(/,/g, '')); return String(v == null ? '' : v).trim() !== '' && isFinite(n) ? n : null; }
/** 한 줄의 숫자들 — 실온수 = 급탕 − 환탕 (둘 다 있을 때) */
function logVals_(r) {
  const o = {};
  if (!r) return o;
  LOG_NUMS.forEach(function (k) { o[k] = logNum_(r[k]); });
  o['실온수'] = o['급탕'] != null && o['환탕'] != null ? Math.round((o['급탕'] - o['환탕']) * 1000) / 1000 : null;
  return o;
}
/** from ~ to (둘 다 포함) 합. 빈 날은 0 */
function logSum_(map, from, to) {
  const keys = ['영업시간', '전기', '실온수'].concat(LOG_METERS), s = {};
  keys.forEach(function (k) { s[k] = 0; });
  for (let d = from; d <= to; d = logAddDay_(d, 1)) {
    const v = logVals_(map[d]);
    keys.forEach(function (k) { if (v[k] != null) s[k] += v[k]; });
  }
  keys.forEach(function (k) { s[k] = Math.round(s[k] * 1000) / 1000; });
  return s;
}
/** 그 근무일 TBM 작업 표의 작업위치 + 작업내용 (위험요인·재해형태·위험성·개선조치는 뺌). TBM을 아직 저장 안 했으면 TBM 화면처럼 명일 작업 예정에서 */
function logTbm_(day) {
  const out = {};
  LOG_DEPTS.forEach(function (d) { out[d] = []; });
  return out;   // 명일 작업 일정·TBM 표는 금일작업에 안 가져옴 (사용자 11-25, 결정 268). 주간작업 연동은 Supabase 판 (26_workhist.sql)
}
function logOut_(r) {
  if (!r) return null;
  const o = { works: {} };
  LOG_COLS.forEach(function (k) { if (k.indexOf('작업_') !== 0) o[k] = r[k]; });
  LOG_DEPTS.forEach(function (d) { o.works[d] = jsonOr_(r['작업_' + d], []); });
  return o;
}
function logData_(day) {
  const map = logMap_(), prev = logPrevYear_(day), cur = map[day] || null;
  return {
    ok: true, day: day, prevDay: prev, workDay: workDay_(Date.now()),
    cur: logOut_(cur), prev: logOut_(map[prev] || null),
    vals: { c: logVals_(cur), p: logVals_(map[prev]), y: logVals_(map[logAddDay_(day, -1)]) },
    month: { c: logSum_(map, day.slice(0, 8) + '01', day), p: logSum_(map, prev.slice(0, 8) + '01', prev) },
    year: { c: logSum_(map, day.slice(0, 5) + '01-01', day), p: logSum_(map, prev.slice(0, 5) + '01-01', prev) },
    ver: cur && cur._new ? cur['수정시각'] : '', by: cur && cur._new ? cur['수정자'] : '',
    pdf: cur && cur._new && cur['pdf_id'] ? { id: cur['pdf_id'], at: cur['PDF만든시각'], url: driveUrl_(cur['pdf_id']) } : null,
    night: cur ? fileB64_(cur['야간그림_id']) : '', tbm: logTbm_(day), ac: logAc_(day)
  };
}

/** 불러오기 — 로그인한 직원 모두 (사용자 11-13) */
function logGet(token, day) {
  auth_(token);
  day = logDay_(day);
  logWeatherMaybe_(day);
  return logData_(day);
}

/** 저장 — 그날 줄을 새로 쓰거나 고침. ver(불러올 때 수정시각)가 다르면 덮어쓰지 않고 새 내용을 돌려줌 (명일 작업과 같음) */
function logSave(token, day, d, ver) {
  const me = auth_(token);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) || day > workDay_(Date.now())) return { ok: false, error: '일자가 맞지 않습니다' };
  d = d || {};
  const patch = {};
  for (let i = 0; i < LOG_NUMS.length; i++) {
    const k = LOG_NUMS[i], raw = String(d[k] == null ? '' : d[k]).replace(/,/g, '').trim();
    if (raw !== '' && !/^-?\d+(\.\d+)?$/.test(raw)) return { ok: false, error: k + ' 칸에는 숫자만 넣어 주세요' };
    patch[k] = raw;
  }
  const grade = String(d['미세먼지등급'] || '');
  if (LOG_GRADES.indexOf(grade) === -1) return { ok: false, error: '미세먼지 등급을 골라 주세요' };
  patch['미세먼지등급'] = grade;
  patch['날씨'] = cleanText_(d['날씨'], 10);
  patch['비고'] = String(d['비고'] || '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim().slice(0, 500);   // 줄바꿈은 둠
  if (d['날씨출처'] !== undefined) patch['날씨출처'] = cleanText_(d['날씨출처'], 10);
  const works = d.works || {};
  for (let i = 0; i < LOG_DEPTS.length; i++) {
    const list = (Array.isArray(works[LOG_DEPTS[i]]) ? works[LOG_DEPTS[i]] : []).map(function (t) { return cleanText_(t, 100); }).filter(String);
    if (list.length > LOG_MAX_LINES) return { ok: false, error: LOG_DEPTS[i] + ' 작업은 ' + LOG_MAX_LINES + '줄까지 넣을 수 있습니다' };
    patch['작업_' + LOG_DEPTS[i]] = JSON.stringify(list);
  }
  let night = null;   // 야간 일일 작업 현황 그림: 바꾼 때만 보냄 (2400px JPEG), '-' = 빼기
  if (d.night && d.night !== '-') {
    night = parseDataUrl_(d.night, 'image/jpeg', 1000, 6000000);
    if (!night) return { ok: false, error: '야간 작업 그림을 읽지 못했습니다. 다시 골라 주세요.' };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = logBook_('일지시트ID', '종합업무일지');
    const row = logRows_(ss).filter(function (r) { return r['일자'] === day; })[0] || null;
    const curVer = row ? row['수정시각'] : '';
    if (String(ver || '') !== curVer) return Object.assign(logData_(day), { ok: false, conflict: true, error: (row && row['수정자'] || '다른 사람') + '님이 먼저 고쳤어요. 새 내용을 불러왔습니다.' });
    let at = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    if (at <= curVer) at = curVer + '+';   // 같은 초에 두 번 저장해도 ver가 바뀌게
    Object.assign(patch, { '수정자': me['이름'], '수정시각': at });
    if (row) LOG_WX.forEach(function (k) { if (patch[k] === '' && row[k]) delete patch[k]; });   // 빈칸으로 보내도 자동으로 들어온 날씨는 지우지 않음 (오후 1시 전에 연 화면)
    const oldNight = row ? row['야간그림_id'] : '';
    if (night) patch['야간그림_id'] = saveBlob_(logFolder_(day), night, day + '_야간작업_001.jpg', '종합업무일지 야간 작업 ' + day + ' · ' + me['이름']);
    else if (d.night === '-') patch['야간그림_id'] = '';
    withBook_(ss, function () {
      if (row) updateRow_('일지', row._row, patch);
      else appendRow_('일지', Object.assign({ '일자': day, '작성자': me['이름'] }, patch));
    });
    if (oldNight && (night || d.night === '-')) trashFile_(oldNight);   // 새 그림·시트를 다 쓴 뒤에 옛 그림을 버림
    log_(me['이름'], '종합업무일지 저장', day, night ? '야간 그림 바꿈' : '');
    return logData_(day);
  } finally {
    lock.releaseLock();
  }
}

/** PDF 저장 (B4 가로, 화면에서 만듦) — d가 있으면 먼저 저장 */
function logSavePdf(token, day, dataUri, d, ver) {
  const me = auth_(token);
  let v = ver;
  if (d) { const s = logSave(token, day, d, ver); if (!s.ok) return s; v = s.ver; }
  const m = /^data:application\/pdf[^,]*;base64,(.+)$/.exec(String(dataUri || ''));
  if (!m || m[1].length < 100) return { ok: false, error: 'PDF 내용이 올바르지 않습니다' };
  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 30 * 1024 * 1024) return { ok: false, error: 'PDF가 너무 큽니다' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = logBook_('일지시트ID', '종합업무일지');
    const row = logRows_(ss).filter(function (r) { return r['일자'] === day; })[0];
    if (!row) return { ok: false, error: '먼저 [저장]을 눌러 주세요' };
    if (String(v || '') !== row['수정시각']) return Object.assign(logData_(day), { ok: false, conflict: true, error: (row['수정자'] || '다른 사람') + '님이 먼저 고쳤어요. 새 내용을 불러왔습니다. 다시 PDF로 저장해 주세요.' });
    const id = saveBlob_(logFolder_(day), Utilities.newBlob(bytes, 'application/pdf'), day + '_종합업무일지.pdf', '종합업무일지 ' + day + ' · ' + me['이름']);
    const shared = shareLink_(id);
    const at = now_();
    withBook_(ss, function () { updateRow_('일지', row._row, { 'pdf_id': id, 'PDF만든시각': at }); });
    trashFile_(row['pdf_id']);   // 새 PDF를 저장한 뒤에 옛 PDF를 버림
    log_(me['이름'], '종합업무일지 PDF 저장', day, '');
    return Object.assign(logData_(day), { warn: shared ? '' : 'PDF는 저장했지만 공유를 못 했습니다. 구글 로그인 안 한 기기에서는 열리지 않을 수 있습니다.' });
  } finally {
    lock.releaseLock();
  }
}

/* 네이버 날씨 (6단계): 오후 1시 예약 작업이 그날 줄의 빈 날씨 칸만 채움. 화면 글을 읽는 방식이라 네이버가 바꾸면 끊길 수 있음 → 실패하면 빈칸, 직원이 직접 입력
   shortcut: 네이버 화면 안 JSON(nowFcastInfo·weeklyFcastList·stationPm10)을 글자로 찾음 — 끊기면 이 세 곳 이름을 다시 확인 */
function logWeatherFetch_(day) {
  const get = function (path) {
    const r = UrlFetchApp.fetch('https://weather.naver.com/' + path + '/' + LOG_WX_REGION, { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    return r.getResponseCode() === 200 ? r.getContentText() : '';
  };
  const n1 = function (v) { const x = Number(v); return v != null && isFinite(x) ? String(Math.round(x * 10) / 10) : ''; };
  const today = get('today'), air = get('air'), ymd = day.replace(/-/g, '');
  const now = /"nowFcastInfo":\{([^}]*)\}/.exec(today), pick = function (o, k) { const m = o && new RegExp('"' + k + '":"?([^",]*)').exec(o[1]); return m ? m[1] : null; };
  const wk = new RegExp('"aplYmd":"' + ymd + '","aplYmdt":"[^"]*",[^}]*?"minTmpr":(-?[\\d.]+),"maxTmpr":(-?[\\d.]+)').exec(today);
  const pm = /"stationPm10":(\d+(?:\.\d+)?),"stationPm10Legend":"([^"]*)"/.exec(air);
  const hm = /"domesticWetrList":\[\{[^}]*?"humd":(\d+(?:\.\d+)?)/.exec(today);   // 지금 습도 (공조기 환기온도 머리, 결정 128)
  const o = { '날씨': cleanText_(pick(now, 'wetrTxt') || '', 10), '최저': wk ? n1(wk[1]) : '', '최고': wk ? n1(wk[2]) : '', '최고풍속': n1(pick(now, 'windSpd')),
    '미세먼지': pm ? n1(pm[1]) : '', '미세먼지등급': pm && LOG_GRADES.indexOf(pm[2]) !== -1 ? pm[2] : '', '습도': hm ? n1(hm[1]) : '' };   // 습도는 Supabase 일지에만 (시트 일지에는 칸 없음)
  return LOG_WX.some(function (k) { return o[k]; }) ? o : null;
}
/** 그날 줄의 빈 날씨 칸만 채움 (직원이 쓴 값은 그대로). 줄이 없으면 날씨만 든 줄을 만듦 */
function logWeatherFill_(day) {
  const w = logWeatherFetch_(day);
  if (!w) { log_('예약 작업', '종합업무일지 날씨 실패', day, '네이버 날씨를 읽지 못함'); return null; }
  if (sbLive_()) { sbReq_('post', '/rest/v1/rpc/ws_log_weather', { p_day: day, p_w: w }); return w; }   // 바꿔 탄 뒤: Supabase 일지의 빈 칸만 (11_cutover.sql)
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = logBook_('일지시트ID', '종합업무일지');
    const row = logRows_(ss).filter(function (r) { return r['일자'] === day; })[0] || null;
    const patch = {};
    LOG_WX.forEach(function (k) { if (w[k] && !(row && row[k])) patch[k] = w[k]; });
    if (!Object.keys(patch).length) return w;
    patch['날씨출처'] = '네이버';
    withBook_(ss, function () {
      if (row) updateRow_('일지', row._row, patch);   // 수정시각은 그대로 → 보고 있던 화면이 저장해도 겹침 안 남
      else appendRow_('일지', Object.assign({ '일자': day, '작성자': '네이버 날씨' }, patch));
    });
    log_('예약 작업', '종합업무일지 날씨', day, JSON.stringify(patch));
    return w;
  } finally {
    lock.releaseLock();
  }
}
/** 예약 작업 (매일 오후 1시) */
function logWeatherJob_() { logWeatherFill_(workDay_(Date.now())); }
/** 예약이 빠졌을 때: 오늘 일지를 오후 1시 뒤에 열었는데 날씨가 비었으면 한 번 읽음 (실패하면 30분 동안 다시 안 함) */
function logWeatherMaybe_(day, early) {
  const now = new Date();
  if (day !== workDay_(now.getTime()) || (!early && Number(Utilities.formatDate(now, TZ, 'HH')) < 13)) return;
  const cache = CacheService.getScriptCache(), key = 'lgwx_' + day;
  if (cache.get(key)) return;
  try {
    const row = sbLive_() ? null : logRows_(logBook_('일지시트ID', '종합업무일지')).filter(function (r) { return r['일자'] === day; })[0];   // Supabase는 빈 칸만 채우니 그냥 부름
    if (row && row['날씨']) { cache.put(key, '1', 21600); return; }
    cache.put(key, logWeatherFill_(day) ? '1' : '0', 1800);
  } catch (e) { cache.put(key, '0', 1800); }
}
/** 시트 메뉴 ⑨: 예약 켜기 + 지금 한 번 읽어 보기 (처음 한 번은 구글이 「외부 서비스 연결」 권한을 물음) */
function logWeatherMenu_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'logWeatherJob_') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('logWeatherJob_').timeBased().everyDays(1).atHour(13).nearMinute(0).inTimezone(TZ).create();
  let w = null;
  try { w = logWeatherFetch_(workDay_(Date.now())); } catch (e) { w = null; }
  SpreadsheetApp.getUi().alert('날씨 자동을 켰습니다. 매일 오후 1시쯤 네이버 날씨(잠실동)를 그날 일지에 넣습니다.\n\n' +
    (w ? '지금 읽어 본 값: ' + LOG_WX.map(function (k) { return k + ' ' + (w[k] || '-'); }).join(' · ') : '지금은 네이버 날씨를 읽지 못했습니다. 화면에서 직접 입력해 주세요.'));
}

/* 공조기·에어커튼 가동 (결정 120 → 194): 기록이 Supabase(19_climate.sql)로 옮겨 감 → Supabase 화면이 ws_log_ac 로 직접 읽음.
   구글 판 일지(logGet)는 더 이상 가동시간을 못 보여 줌 (Supabase 로 바꿔 탄 뒤라 구글 판은 안 씀). */
function logAc_(day) { return { err: '가동시간은 Supabase 판에서 봅니다' }; }

/* ───────────────────────── 출근현황 (WS_출근현황 15.3.19, 결정 88) ───────────────────────── */

const AT_CODES = ['', '9-7', '휴', '연', '법', '야', '비', '병가', 'A반', 'P반', 'A검진', 'P검진'];   // '' = 출근
const AT_BOSS = ['소장', '부소장', '총무'];
const AT_UNDO = '(되돌림)';
const WEEK_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 새 탭 3개는 배포 뒤 「① 초기 설정」을 안 해도 처음 열 때 만듦 (TBM과 같은 방식) */
function atTabs_() { ensureTabs_(['근무표', '근무변경', '기본휴일']); }
/* 배포 뒤 「① 초기 설정」을 다시 하지 않아도 새 탭을 처음 쓸 때 만듦 */
function ensureTabs_(names) {
  const ss = db_(), need = names.filter(function (n) { return !ss.getSheetByName(n); });
  if (!need.length) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    need.forEach(function (name) {
      if (ss.getSheetByName(name)) return;
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
      sh.setFrozenRows(1);
    });
  } finally {
    lock.releaseLock();
  }
}

function atMonthRows_(ym) {
  return readTable_('근무표').rows.filter(function (r) { return r['월'] === ym && r['삭제여부'] !== 'Y'; })
    .sort(function (a, b) { return Number(a['순서']) - Number(b['순서']); })
    .map(function (r) { return { sec: r['구역'], role: r['직책'], name: r['이름'], days: jsonOr_(r['일별'], []), by: r['올린사람'], at: r['올린시각'] }; });
}
/** 그날 고친 값: 날짜|이름 → 마지막 줄 (되돌림이면 지움) */
function atFixes_(prefix) {
  const o = {};
  readTable_('근무변경').rows.forEach(function (r) {
    if (r['삭제여부'] === 'Y' || String(r['날짜']).indexOf(prefix) !== 0) return;
    const k = r['날짜'] + '|' + r['이름'];
    if (r['바꾼값'] === AT_UNDO) delete o[k]; else o[k] = { v: r['바꾼값'], by: r['바꾼사람'], at: r['바꾼시각'] };
  });
  return o;
}
function atHolidays_() {
  const o = {};
  readTable_('기본휴일').rows.forEach(function (r) { o[r['이름']] = r['요일']; });
  return o;
}
/** 순서: 그날 고친 값 > 엑셀 값(빈 칸 아님) > 기본 휴일 > 출근 (6장) */
function atValue_(p, date, fixes, hol) {
  const f = fixes[date + '|' + p.name];
  if (f) return f.v;
  const raw = String(p.days[Number(date.slice(8, 10)) - 1] || '');
  if (raw) return raw;
  const wd = WEEK_KO[new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay()];
  return String(hol[p.name] || '').split(',').indexOf(wd) !== -1 ? '휴' : '';
}
function atIsDay_(v) { return v === '' || v === '9-7' || /^[AP](반|검진)$|^[전후]반$/.test(v); }   // 엑셀 「근무인원합계」와 같은 셈 (반차·검진 = 주)

/** 소장·부소장·총무: 직원 탭 역할 또는 그 달 엑셀 직책(이름으로 찾음) — 관리자 역할은 넣지 않음 (사용자 11-07) */
function atBoss_(me, rows) {
  if (['소장', '부소장'].indexOf(me['역할']) !== -1) return true;
  return rows.some(function (p) { return p.name === me['이름'] && AT_BOSS.indexOf(p.role) !== -1; });
}
/** 파트 바꾸기·직원 삭제: 대표 3명 + 그 달 엑셀 관리파트 인원 (사용자 11-26) */
function atStaffBoss_(me, rows) {
  return atBoss_(me, rows) || rows.some(function (p) { return p.name === me['이름'] && String(p.sec || '').indexOf('관') === 0; });
}
/** 그날 고치기: 대표 3명 + 그날이나 전날 야간 근무자 (야간은 아침 8시 30분에 끝나 다음 날 아침 게시판도 그 사람이 맞춤) */
function atCanFix_(me, date, rows, fixes, hol) {
  if (atBoss_(me, rows)) return true;
  const prev = new Date(Date.parse(date + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
  const mine = rows.filter(function (p) { return p.name === me['이름']; })[0];
  if (!mine) return false;
  if (atValue_(mine, date, fixes, hol) === '야') return true;
  if (prev.slice(0, 7) !== date.slice(0, 7)) {
    const pr = atMonthRows_(prev.slice(0, 7)).filter(function (p) { return p.name === me['이름']; })[0];
    return !!pr && atValue_(pr, prev, atFixes_(prev.slice(0, 7)), hol) === '야';
  }
  return atValue_(mine, prev, fixes, hol) === '야';
}

/* ── 출근현황으로 로그인 나누기 (결정 92) ──
   주간 출근(빈칸·9-7·P반·P검진·후반) = PIN + 서명(TBM 서명란) / 야·A반·A검진·연·법·병가·전반 = PIN만 / 휴·비 = 「휴일 접속 불가」
   전날 야간 근무자는 다음 날 오전 9시까지 PIN만(퇴근 8시 30분). 소장·부소장·총무는 막지 않음(쉬는 날은 PIN만).
   근무표가 없거나 이름이 없으면 예전처럼 PIN + 서명 */
const AT_PIN_ONLY = ['야', 'A반', 'A검진', '연', '법', '병가', '전반'];
const AT_BLOCK = ['휴', '비'];
function loginMode_(me, nowMs) {
  const day = workDay_(nowMs), early = new Date(nowMs + KST_MS).getUTCHours() < 9;
  const cache = CacheService.getScriptCache();
  const key = 'lm_' + (cache.get('at_gen') || '0') + '_' + me['staff_id'] + '_' + day + (early ? 'e' : '');
  const hit = cache.get(key);
  if (hit) return hit;
  let mode = 'sign';
  try {
    const ym = day.slice(0, 7), rows = atMonthRows_(ym);
    const mine = rows.filter(function (p) { return p.name && p.name === me['이름']; })[0];
    if (mine) {
      const fixes = atFixes_(ym), hol = atHolidays_();
      const v = atValue_(mine, day, fixes, hol);
      const prev = new Date(Date.parse(day + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10);
      const prevNight = function () {
        if (prev.slice(0, 7) === ym) return atValue_(mine, prev, fixes, hol) === '야';
        const pr = atMonthRows_(prev.slice(0, 7)).filter(function (p) { return p.name === me['이름']; })[0];
        return !!pr && atValue_(pr, prev, atFixes_(prev.slice(0, 7)), hol) === '야';
      };
      if (AT_PIN_ONLY.indexOf(v) !== -1) mode = 'pin';
      else if (AT_BLOCK.indexOf(v) === -1) mode = 'sign';
      else if (early && prevNight()) mode = 'pin';
      else mode = atBoss_(me, rows) ? 'pin' : 'block';
    }
  } catch (e) { mode = 'sign'; }   // 근무표 탭이 아직 없음 등 → 예전 방식
  cache.put(key, mode, 60);
  return mode;
}
/** 출근현황을 고치면 로그인 판단 기억을 모두 버림 */
function atChanged_() { CacheService.getScriptCache().put('at_gen', String(Date.now()), 21600); }
const BLOCK_MSG = '휴일 접속 불가 — 오늘은 출근현황에 휴무(휴·비)로 되어 있습니다. 출근하셨으면 소장·부소장·총무에게 출근현황을 고쳐 달라고 해 주세요.';

/** 그날 출근현황 + 그 달 날짜별 주간 인원(달력) + 권한. date 비우면 오늘 근무일 */
function attGet(token, date) {
  const me = auth_(token);
  atTabs_();
  const d = date || workDay_(Date.now());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: '날짜 형식이 맞지 않습니다' };
  const ym = d.slice(0, 7), rows = atMonthRows_(ym), fixes = atFixes_(ym), hol = atHolidays_(), parts = {};
  staffRows_().forEach(function (st) { if (st['사용여부'] !== 'N' && parts[st['이름']] == null) parts[st['이름']] = String(st['파트명'] || ''); });
  const months = readTable_('근무표').rows.filter(function (r) { return r['삭제여부'] !== 'Y'; }).map(function (r) { return r['월']; })
    .filter(function (m, i, a) { return a.indexOf(m) === i; }).sort();
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const ju = [];
  for (let i = 1; i <= last; i++) {
    const di = ym + '-' + (i < 10 ? '0' : '') + i;
    ju.push(rows.filter(function (p) { return p.name && atIsDay_(atValue_(p, di, fixes, hol)); }).length);
  }
  return {
    ok: true, date: d, today: workDay_(Date.now()), months: months, ju: rows.length ? ju : [],
    upBy: rows.length ? rows[0].by : '', upAt: rows.length ? rows[0].at : '',
    canFix: rows.length ? atCanFix_(me, d, rows, fixes, hol) : false, canBoss: atBoss_(me, rows), canStaff: atStaffBoss_(me, rows),
    people: rows.map(function (p) {
      const f = p.name ? fixes[d + '|' + p.name] : null;
      return { sec: p.sec, role: p.role, name: p.name, v: p.name ? atValue_(p, d, fixes, hol) : '', raw: String(p.days[Number(d.slice(8, 10)) - 1] || ''),
        fix: f ? { by: f.by, at: f.at } : null, hol: p.name ? String(hol[p.name] || '') : '', part: p.name && parts[p.name] != null ? parts[p.name] : null };
    })
  };
}

/** 엑셀 한 달 저장 (화면에서 읽은 줄). 같은 달은 예전 줄 삭제여부=Y. 고친 값·기본 휴일은 그대로 */
function attPut(token, ym, rows, fileB64) {
  const me = auth_(token);
  atTabs_();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym || ''))) return { ok: false, error: '몇 년 몇 월인지 읽지 못했습니다' };
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const clean = (Array.isArray(rows) ? rows : []).map(function (r) {
    return { sec: cleanText_(r && r.sec, 20), role: cleanText_(r && r.role, 20), name: cleanText_(r && r.name, 20),
      days: (Array.isArray(r && r.days) ? r.days : []).slice(0, last).map(function (v) { return cleanText_(v, 10); }) };
  }).filter(function (r) { return r.role || r.name; });
  if (!clean.length || clean.length > 80) return { ok: false, error: '직원 줄을 읽지 못했습니다 (엑셀 모양 확인)' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('근무표');
    const cur = t.rows.filter(function (r) { return r['월'] === ym && r['삭제여부'] !== 'Y'; });
    // 처음 올릴 때는 그 엑셀의 소장·부소장·총무만, 이미 있으면 지금 달의 대표만 바꿀 수 있음
    if (!atBoss_(me, cur.length ? atMonthRows_(ym) : clean)) return { ok: false, error: '엑셀은 소장·부소장·총무만 올릴 수 있습니다' };
    const at = now_();
    clean.forEach(function (r, i) {
      appendRow_('근무표', { '월': ym, '순서': String(i + 1), '구역': r.sec, '직책': r.role, '이름': r.name, '일별': JSON.stringify(r.days), '올린사람': me['이름'], '올린시각': at, '삭제여부': '' });
    });
    cur.forEach(function (r) { updateRow_('근무표', r._row, { '삭제여부': 'Y' }); });
    let fileId = '';
    if (fileB64) {
      const blob = parseDataUrl_(fileB64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 100, 4000000);
      if (blob) fileId = saveBlob_(folderPath_(['시설팀 통합업무', '20_업무지원', '서류작업', '출근현황']), blob, ym + '_근무스케줄.xlsx', me['이름'] + ' ' + at);
    }
    atChanged_();
    log_(me['이름'], '근무표 올림', ym, clean.length + '줄' + (fileId ? ' · 원본 ' + fileId : ''));
    return { ok: true, count: clean.length };
  } finally {
    lock.releaseLock();
  }
}

/** 그날 상태 고치기 — value가 AT_UNDO면 엑셀 값으로 되돌림 */
function attFix(token, date, name, value) {
  const me = auth_(token);
  atTabs_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { ok: false, error: '날짜 형식이 맞지 않습니다' };
  if (AT_CODES.indexOf(value) === -1 && value !== AT_UNDO) return { ok: false, error: '고를 수 없는 상태입니다' };
  const ym = date.slice(0, 7), rows = atMonthRows_(ym), fixes = atFixes_(ym), hol = atHolidays_();
  const p = rows.filter(function (x) { return x.name && x.name === name; })[0];
  if (!p) return { ok: false, error: '그 달 근무표에 없는 이름입니다' };
  if (!atCanFix_(me, date, rows, fixes, hol)) return { ok: false, error: '소장·부소장·총무·그날 야간 근무자만 고칠 수 있습니다' };
  appendRow_('근무변경', { '날짜': date, '이름': name, '원래값': atValue_(p, date, fixes, hol), '바꾼값': value, '바꾼사람': me['이름'], '바꾼시각': now_(), '삭제여부': '' });
  atChanged_();
  log_(me['이름'], '출근현황 고침', date, name + ' → ' + (value || '출근'));
  return attGet(token, date);
}

/** 기본 휴일 (요일 여러 개) — 소장·부소장·총무 */
function attHoliday(token, name, days, date) {
  const me = auth_(token);
  atTabs_();
  const ym = String(date || workDay_(Date.now())).slice(0, 7), rows = atMonthRows_(ym);
  if (!atBoss_(me, rows)) return { ok: false, error: '기본 휴일은 소장·부소장·총무만 정할 수 있습니다' };
  if (!rows.some(function (p) { return p.name && p.name === name; })) return { ok: false, error: '그 달 근무표에 없는 이름입니다' };
  const list = (Array.isArray(days) ? days : []).filter(function (w, i, a) { return WEEK_KO.indexOf(w) !== -1 && a.indexOf(w) === i; })
    .sort(function (a, b) { return WEEK_KO.indexOf(a) - WEEK_KO.indexOf(b); }).join(',');
  const cur = readTable_('기본휴일').rows.filter(function (r) { return r['이름'] === name; })[0];
  const patch = { '이름': name, '요일': list, '바꾼사람': me['이름'], '바꾼시각': now_() };
  if (cur) updateRow_('기본휴일', cur._row, patch); else appendRow_('기본휴일', patch);
  atChanged_();
  log_(me['이름'], '기본 휴일', name, list || '없음');
  return attGet(token, date || '');
}

/** 파트 (전방파트 → 전기·방재, 기건파트 → 기계·건축 쪽에 보임) — 직원 탭 파트명을 바꿈 (사용자 11-26) */
function attPart(token, name, part, date) {
  const me = auth_(token);
  atTabs_();
  const ym = String(date || workDay_(Date.now())).slice(0, 7);
  if (!atStaffBoss_(me, atMonthRows_(ym))) return { ok: false, error: '파트는 소장·관리파트만 바꿀 수 있습니다' };
  if (['전방파트', '기건파트'].indexOf(part) === -1) return { ok: false, error: '전방파트나 기건파트를 골라 주세요' };
  const live = readTable_('직원').rows.filter(function (s) { return s['사용여부'] !== 'N' && s['이름'] === name; });
  if (!live.length) return { ok: false, error: '로그인 직원 목록에 없는 이름입니다' };
  live.forEach(function (s) { updateRow_('직원', s._row, { '파트명': part, '수정일시': now_() }); });
  CacheService.getScriptCache().remove('staff');
  log_(me['이름'], '파트 바꿈', name, part);
  return attGet(token, date || '');
}

/** 직원 삭제: 이 달부터 근무표에서 빼고, 직원 사용 중지 + PIN 지움(기기 표도 바로 막힘) (사용자 11-26). 서명·점검 기록은 남김 */
function attRemove(token, name, date) {
  const me = auth_(token);
  atTabs_();
  const ym = String(date || workDay_(Date.now())).slice(0, 7), rows = atMonthRows_(ym);
  if (!atStaffBoss_(me, rows)) return { ok: false, error: '직원 삭제는 소장·관리파트만 할 수 있습니다' };
  if (name === me['이름']) return { ok: false, error: '내 계정은 지울 수 없습니다' };
  if (!rows.some(function (p) { return p.name && p.name === name; })) return { ok: false, error: '그 달 근무표에 없는 이름입니다' };
  readTable_('근무표').rows.forEach(function (r) { if (r['이름'] === name && r['월'] >= ym && r['삭제여부'] !== 'Y') updateRow_('근무표', r._row, { '삭제여부': 'Y' }); });
  const ids = [];
  readTable_('직원').rows.forEach(function (s) {
    if (s['사용여부'] === 'N' || s['이름'] !== name) return;
    updateRow_('직원', s._row, { '사용여부': 'N', 'pin_hash': '', 'pin_salt': '', '수정일시': now_() }); ids.push(s['staff_id']);
  });
  CacheService.getScriptCache().remove('staff');
  atChanged_();
  log_(me['이름'], '직원 삭제', ids.join(','), name + ' (출근현황)');
  return attGet(token, date || '');
}

/** 개선 C: TBM PDF에 쓰이지 않은 서명은 90일 뒤 휴지통 (매일 예약 작업) */
/** ?api=pdf&id=드라이브번호 → { ok, name, b64 }. 공유(링크가 있는 사람·누구나) PDF만 — 주소만 알면 원래도 볼 수 있는 파일이라 더 열리는 것 없음 */
function pdfApi_(id) {
  if (!/^[\w-]{20,80}$/.test(String(id || ''))) throw new Error('파일 번호가 맞지 않습니다');
  let f;
  try { f = DriveApp.getFileById(id); } catch (e) { throw new Error('파일을 찾지 못했습니다'); }
  if (f.isTrashed()) throw new Error('지워진 파일입니다 (드라이브 휴지통)');
  if (f.getMimeType() !== 'application/pdf') throw new Error('PDF 파일이 아닙니다');
  const a = String(f.getSharingAccess());
  if (a !== String(DriveApp.Access.ANYONE_WITH_LINK) && a !== String(DriveApp.Access.ANYONE)) {
    // 앱이 만든 PDF(업무지원 폴더 안)는 「링크가 있는 사람 보기」여야 함 → 빠진 것은 여기서 공유 (11-14 TBM 11-12 PDF). 폴더 밖 파일은 거절
    if (!inAppFolder_(f)) throw new Error('볼 수 없는 파일입니다');
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    log_('시스템', 'PDF 공유 다시 걸기', id,f.getName() + ' (공유 안 되어 있던 것: ' + a + ')');
  }
  if (f.getSize() > 25 * 1024 * 1024) throw new Error('파일이 너무 큽니다');
  return { ok: true, name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) };
}

/** 파일이 「시설팀 통합업무/20_업무지원」 폴더 아래(몇 층이든)에 있는가 */
function inAppFolder_(f) {
  const root = folderPath_(['시설팀 통합업무', '20_업무지원']).getId();
  let ps = f.getParents();
  for (let n = 0; n < 12 && ps.hasNext(); n++) {
    const p = ps.next();
    if (p.getId() === root) return true;
    ps = p.getParents();
  }
  return false;
}

/** 바꿔 탄 뒤인가 (메뉴 ⑩ 옮기기가 끝나면 스크립트 속성 SUPABASE_LIVE = Y). 되돌릴 때는 그 속성을 지움 */
function sbLive_() { return PropertiesService.getScriptProperties().getProperty('SUPABASE_LIVE') === 'Y'; }

function cleanSigns_() {
  if (sbLive_()) {   // 바꿔 탄 뒤: Supabase 서명 표에서 지운 표시 → 드라이브로 옮긴 그림만 휴지통 (11_cutover.sql)
    const r = JSON.parse(sbReq_('post', '/rest/v1/rpc/ws_clean_signs', { p_days: 90 }).getContentText());
    r.drive.forEach(trashFile_);
    return r.n;
  }
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

/* ───────────────────────── 전열필증 (WS_전열필증 15.3.20, 결정 96) ───────────────────────── */

const EH_FLOORS = ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '팝업'];
const EH_NO = /^(B[1-3]|[1-6]F|팝업)-(\d+)-(\d+)$/;
const EH_TABS = ['전열매장', '전열기기'];

function ehTables_() {
  ensureTabs_(EH_TABS);
  return { st: readTable_('전열매장'), dv: readTable_('전열기기') };
}
function ehLive_(r) { return r['사용여부'] !== 'N'; }
function ehSeq_(no) { const m = EH_NO.exec(no); return m ? Number(m[3]) : 0; }

/** 층 하나(매장·기기) + 모든 층 개수 + 검색용 매장 이름 */
function ehList(token, floor) {
  auth_(token);
  return ehOut_(ehTables_(), floor);
}
function ehOut_(T, floor) {
  if (EH_FLOORS.indexOf(floor) === -1) floor = '1F';
  const stores = T.st.rows.filter(ehLive_), items = T.dv.rows.filter(ehLive_);
  const by = {};
  items.forEach(function (r) { (by[r['es_id']] = by[r['es_id']] || []).push(r); });
  const floors = EH_FLOORS.map(function (f) {
    const s = stores.filter(function (x) { return x['층'] === f; });
    return { code: f, stores: s.length, items: s.reduce(function (n, x) { return n + (by[x['es_id']] || []).length; }, 0) };
  });
  const list = stores.filter(function (x) { return x['층'] === floor; })
    .sort(function (a, b) { return Number(a['매장번호']) - Number(b['매장번호']); })
    .map(function (x) {
      return { id: x['es_id'], no: Number(x['매장번호']) || 0, name: x['매장명'],
        items: (by[x['es_id']] || []).sort(function (a, b) { const pa = a['관리번호'].replace(/-\d+$/, ''), pb = b['관리번호'].replace(/-\d+$/, ''); return pa < pb ? -1 : pa > pb ? 1 : ehSeq_(a['관리번호']) - ehSeq_(b['관리번호']); }).map(ehItem_) };
    });
  return { ok: true, floor: floor, floors: floors, stores: list,
    names: stores.map(function (x) { return [x['층'], x['매장명'], x['es_id']]; }),
    empty: !T.dv.rows.length, execUrl: publicUrl_(), dpi: labelSize_().dpi };
}
function ehItem_(r) {
  return { id: r['eh_id'], no: r['관리번호'], name: r['기기명'], w: r['용량W'], maker: r['제조사'], m1: r['책임자정'], m2: r['책임자부'], date: r['승인일자'], printed: r['출력일시'], token: r['qr_token'] };
}

/* 매장 추가·이름 바꾸기. 매장번호 = 그 층에서 쓴 가장 큰 번호 + 1 (지운 매장·기기 번호도 셈 — 다시 쓰지 않음) */
function ehStoreSave(token, d) {
  const me = auth_(token);
  d = d || {};
  const name = cleanText_(d.name, 30);
  if (!name) return { ok: false, error: '매장명을 넣어 주세요.' };
  ensureTabs_(EH_TABS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const T = ehTables_();
    const cur = d.id ? T.st.rows.filter(function (r) { return r['es_id'] === d.id && ehLive_(r); })[0] : null;
    if (d.id && !cur) return { ok: false, error: '매장을 찾지 못했습니다. 새로고침해 주세요.' };
    const floor = cur ? cur['층'] : String(d.floor || '');
    if (EH_FLOORS.indexOf(floor) === -1) return { ok: false, error: '층을 골라 주세요.' };
    if (T.st.rows.some(function (r) { return ehLive_(r) && r['층'] === floor && r['매장명'] === name && r !== cur; })) return { ok: false, error: floor + '에 「' + name + '」 매장이 이미 있습니다.' };
    if (cur) {
      if (cur['매장명'] === name) return ehOut_(T, floor);
      updateRow_('전열매장', cur._row, { '매장명': name });
      cur['매장명'] = name;
      const mine = T.dv.rows.filter(function (r) { return r['es_id'] === cur['es_id']; });
      mine.forEach(function (r) { r['매장명'] = name; });
      if (mine.length) writeBack_(T.dv);
      log_(me['이름'], '전열 매장 이름', cur['es_id'], floor + ' · ' + name);
    } else {
      const row = { 'es_id': nextId_('ES', T.st.rows, 'es_id'), '층': floor, '매장번호': String(ehNextStoreNo_(T, floor)), '매장명': name, '사용여부': 'Y', '등록일시': now_(), '등록자': me['이름'], '삭제일시': '' };
      appendRow_('전열매장', row);
      T.st.rows.push(row);
      log_(me['이름'], '전열 매장 추가', row['es_id'], floor + ' · ' + name + ' (' + row['매장번호'] + ')');
    }
    return ehOut_(T, floor);
  } finally {
    lock.releaseLock();
  }
}
function ehNextStoreNo_(T, floor) {
  let max = 0;
  T.st.rows.forEach(function (r) { if (r['층'] === floor) max = Math.max(max, Number(r['매장번호']) || 0); });
  T.dv.rows.forEach(function (r) { const m = EH_NO.exec(r['관리번호']); if (m && r['층'] === floor) max = Math.max(max, Number(m[2])); });
  return max + 1;
}

function ehStoreDelete(token, id) {
  const me = auth_(token);
  ensureTabs_(EH_TABS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const T = ehTables_();
    const s = T.st.rows.filter(function (r) { return r['es_id'] === id && ehLive_(r); })[0];
    if (!s) return { ok: false, error: '매장을 찾지 못했습니다. 새로고침해 주세요.' };
    const t = now_();
    updateRow_('전열매장', s._row, { '사용여부': 'N', '삭제일시': t });
    s['사용여부'] = 'N';
    const n = ehMark_(T.dv, function (r) { return r['es_id'] === id && ehLive_(r); }, { '사용여부': 'N', '삭제일시': t });
    log_(me['이름'], '전열 매장 삭제', id, s['층'] + ' · ' + s['매장명'] + ' · 기기 ' + n + '대');
    return Object.assign(ehOut_(T, s['층']), { count: n });
  } finally {
    lock.releaseLock();
  }
}

/** 기기 추가(관리번호·QR 자동)·편집 */
function ehSave(token, d) {
  const me = auth_(token);
  d = d || {};
  const v = {
    '기기명': cleanText_(d.name, 40), '제조사': cleanText_(d.maker, 40),
    '책임자정': cleanText_(d.m1, 30), '책임자부': cleanText_(d.m2, 30),
    '용량W': String(d.w == null ? '' : d.w).replace(/[,\sWw]/g, ''), '승인일자': String(d.date || '')
  };
  if (!v['기기명']) return { ok: false, error: '기기명을 넣어 주세요.' };
  if (!/^\d{1,5}(\.\d)?$/.test(v['용량W']) || !(Number(v['용량W']) > 0)) return { ok: false, error: '용량은 W 숫자로 넣어 주세요 (예: 1500).' };
  if (!v['책임자정']) return { ok: false, error: '책임자(정)를 넣어 주세요.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v['승인일자'])) return { ok: false, error: '승인일자를 골라 주세요.' };
  ensureTabs_(EH_TABS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const T = ehTables_();
    if (d.id) {
      const r = T.dv.rows.filter(function (x) { return x['eh_id'] === d.id && ehLive_(x); })[0];
      if (!r) return { ok: false, error: '기기를 찾지 못했습니다. 새로고침해 주세요.' };
      const changed = Object.keys(v).some(function (k) { return r[k] !== v[k]; });
      if (!changed) return ehOut_(T, r['층']);
      // 필증에 찍힌 값이 바뀌면 다시 인쇄해야 하므로 「미출력」으로
      v['출력일시'] = ['책임자정', '승인일자', '용량W'].some(function (k) { return r[k] !== v[k]; }) ? '' : r['출력일시'];
      v['수정일시'] = now_();
      updateRow_('전열기기', r._row, v);
      Object.assign(r, v);
      log_(me['이름'], '전열기기 편집', r['eh_id'], r['관리번호'] + ' · ' + v['기기명']);
      return Object.assign(ehOut_(T, r['층']), { saved: r['관리번호'] });
    }
    const s = T.st.rows.filter(function (x) { return x['es_id'] === d.esId && ehLive_(x); })[0];
    if (!s) return { ok: false, error: '매장을 찾지 못했습니다. 새로고침해 주세요.' };
    const head = s['층'] + '-' + s['매장번호'] + '-';
    let seq = 0;
    T.dv.rows.forEach(function (x) { if (x['관리번호'].indexOf(head) === 0) seq = Math.max(seq, ehSeq_(x['관리번호'])); });
    const used = {};
    T.dv.rows.forEach(function (x) { used[x['qr_token']] = 1; });
    const row = Object.assign({ 'eh_id': nextId_('EH', T.dv.rows, 'eh_id'), 'es_id': s['es_id'], '층': s['층'], '매장명': s['매장명'], '관리번호': head + (seq + 1),
      'qr_token': shortToken_(used), '출력일시': '', '사용여부': 'Y', '등록일시': now_(), '등록자': me['이름'], '수정일시': '', '삭제일시': '' }, v);
    appendRow_('전열기기', row);
    T.dv.rows.push(row);
    log_(me['이름'], '전열기기 추가', row['eh_id'], row['관리번호'] + ' · ' + v['기기명']);
    return Object.assign(ehOut_(T, s['층']), { saved: row['관리번호'] });
  } finally {
    lock.releaseLock();
  }
}

/** 고른 기기 필증 삭제 (사용여부 N — 붙은 QR은 「삭제된 필증」) */
function ehDelete(token, ids, floor) { return ehBulk_(token, ids, floor, { '사용여부': 'N', '삭제일시': now_() }, '전열필증 삭제'); }
/** 인쇄한 기기에 출력일시 */
function ehPrinted(token, ids, floor) { return ehBulk_(token, ids, floor, { '출력일시': now_() }, '전열필증 출력'); }
function ehBulk_(token, ids, floor, patch, what) {
  const me = auth_(token);
  ids = (ids || []).map(String);
  if (!ids.length) return { ok: false, error: '기기를 골라 주세요.' };
  ensureTabs_(EH_TABS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const T = ehTables_();
    const nos = [];
    const n = ehMark_(T.dv, function (r) { if (ids.indexOf(r['eh_id']) !== -1 && ehLive_(r)) { nos.push(r['관리번호']); return true; } return false; }, patch);
    log_(me['이름'], what, '', n + '대 · ' + nos.slice(0, 30).join(', ') + (nos.length > 30 ? ' …' : ''));
    return Object.assign(ehOut_(T, floor), { count: n });
  } finally {
    lock.releaseLock();
  }
}
/* 여러 줄 고치기: 몇 줄이면 줄마다, 많으면 표를 한 번에 다시 씀 (줄마다 쓰면 수백 번 시트 호출) */
function ehMark_(t, pick, patch) {
  const hit = t.rows.filter(pick);
  hit.forEach(function (r) { Object.assign(r, patch); });
  if (hit.length > 5) writeBack_(t);
  else hit.forEach(function (r) { updateRow_('전열기기', r._row, patch); });
  return hit.length;
}

/** QR 필증 정보 (로그인 없음) */
function ehView_(qr) {
  qr = String(qr || '');
  if (!isQrToken_(qr)) return { ok: false, error: '필증 QR 주소가 올바르지 않습니다.' };
  ensureTabs_(EH_TABS);
  const r = readTable_('전열기기').rows.filter(function (x) { return x['qr_token'] === qr; })[0];
  if (!r) return { ok: false, error: '등록되지 않은 필증입니다. 시설팀에 알려 주세요.' };
  if (!ehLive_(r)) return { ok: false, error: '삭제된 필증입니다. 시설팀에 알려 주세요.', no: r['관리번호'] };
  return { ok: true, item: Object.assign(ehItem_(r), { floor: r['층'], store: r['매장명'], token: undefined, printed: undefined }) };
}
function ehViewPage_(qr) {
  const v = ehView_(qr), i = v.item || {};
  const esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const row = function (k, x) { return '<tr><th>' + k + '</th><td>' + esc(x) + '</td></tr>'; };
  const body = v.ok
    ? '<table class="eht">' + row('관리번호', i.no) + row('사용장소', i.floor + ' · ' + i.store) + row('기기명', i.name) + row('용량', i.w ? Number(i.w).toLocaleString() + ' W' : '') +
      row('제조사', i.maker) + row('책임자', i.m1 + (i.m2 ? ' / ' + i.m2 : '')) + row('승인일자', String(i.date).replace(/-/g, '.')) + row('승인', '시설소장') + '</table>'
    : '<div class="banner">' + esc(v.error) + (v.no ? '<br><small>' + esc(v.no) + '</small>' : '') + '</div>';
  return include('Styles') + '<style>.w{max-width:520px;margin:0 auto;padding:20px 16px}.eht{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line2);border-radius:12px;overflow:hidden;font-size:16px}' +
    '.eht th{width:96px;text-align:left;background:var(--blue-bg);color:var(--blue-d);padding:12px;font-size:14px;border-top:1px solid var(--line3)}.eht td{padding:12px;border-top:1px solid var(--line3);font-weight:700}' +
    '.banner{background:var(--red-bg);color:var(--red);border-radius:12px;padding:16px;line-height:1.6}h1{font-size:20px;margin:0 0 4px}.s{color:var(--muted);font-size:13px;margin-bottom:14px}</style>' +
    '<div class="w"><h1>전열기기 신고필증</h1><div class="s">롯데백화점 에비뉴엘 월드타워점 · 시설팀</div>' + body + '</div>';
}

/* ───── 엑셀 「전열기 관리대장」 가져오기 (처음 한 번, 8장) ───── */
/** sheets = { 시트이름: [[칸…]…] } (브라우저가 읽은 글자 표). save가 아니면 미리 셈만 */
function ehImport(token, sheets, save) {
  const me = auth_(token);
  ensureTabs_(EH_TABS);
  const P = ehParse_(sheets || {});
  if (!P.items.length) return { ok: false, error: '전열기기를 찾지 못했습니다. 「2026년 전열기 관리대장」 엑셀이 맞는지 확인해 주세요.' };
  if (!save) return { ok: true, check: P.check };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const T = ehTables_();
    if (T.dv.rows.length || T.st.rows.length) return { ok: false, error: '이미 전열기기가 들어 있어 가져오지 않습니다 (처음 한 번만).' };
    const day = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'), t = now_(), used = {};
    const st = P.stores.map(function (s, i) { return { 'es_id': 'WS-ES-' + day + '-' + pad3_(i + 1), '층': s.floor, '매장번호': String(s.no), '매장명': s.name, '사용여부': 'Y', '등록일시': t, '등록자': me['이름'], '삭제일시': '' }; });
    const dv = P.items.map(function (x, i) {
      const k = shortToken_(used); used[k] = 1;
      return { 'eh_id': 'WS-EH-' + day + '-' + pad3_(i + 1), 'es_id': st[x.store]['es_id'], '층': x.floor, '매장명': st[x.store]['매장명'], '관리번호': x.no, '기기명': x.name, '용량W': x.w, '제조사': x.maker,
        '책임자정': x.m1, '책임자부': x.m2, '승인일자': x.date, 'qr_token': k, '출력일시': '', '사용여부': x.gone ? 'N' : 'Y', '등록일시': t, '등록자': '엑셀 가져오기', '수정일시': '', '삭제일시': x.gone ? t : '' };
    });
    appendRows_('전열매장', st);
    appendRows_('전열기기', dv);
    log_(me['이름'], '전열 관리대장 가져오기', '', '매장 ' + st.length + '곳 · 기기 ' + dv.length + '대 (새 번호 ' + P.check.renumbered + ', 폐기 ' + P.check.gone + ')');
    return Object.assign(ehOut_(ehTables_(), '1F'), { check: P.check });
  } finally {
    lock.releaseLock();
  }
}
function pad3_(n) { const s = String(n); return s.length < 3 ? ('00' + s).slice(-3) : s; }

/** 관리대장 시트 → 매장·기기. 시트마다 「층 : n」 다음 줄 = 매장명, `No` 머리줄, 그 아래 기기 줄. 쪽이 나뉘어 같은 매장이 또 나오면 합침 */
function ehParse_(sheets) {
  const stores = [], key = {}, items = [];
  Object.keys(sheets).forEach(function (sn) {
    const fm = /^(B[1-3])F?$|^([1-6]F)$|^(팝업)$/.exec(String(sn).trim());
    if (!fm) return;
    const floor = fm[1] || fm[2] || fm[3];
    const rows = sheets[sn] || [];
    let cur = null, col = null;
    rows.forEach(function (r, i) {
      const c = (r || []).map(function (x) { return String(x == null ? '' : x).trim(); });
      if (c.some(function (x) { return /^층\s*:/.test(x); })) {
        const nx = (rows[i + 1] || []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(String);
        const name = cleanText_(String((/^매장명\s*:?$/.test(nx[0]) ? nx[1] : nx[0]) || '').replace(/^매장명\s*:\s*/, ''), 30);   // 새 양식(11월): 「매장명 :」 옆 칸 · 옛 양식: 칸 서식이 「매장명 : 」을 붙여 읽힘
        if (!name || name === '0') { cur = null; return; }
        const k = floor + '|' + name;
        if (key[k] === undefined) { key[k] = stores.length; stores.push({ floor: floor, name: name, nos: {} }); }
        cur = key[k];
        return;
      }
      if (c[0] === 'No') {
        col = {};
        c.forEach(function (x, j) { x = x.replace(/\s/g, ''); if (x && col[x] === undefined) col[x] = j; });
        return;
      }
      if (cur === null || !col || !/^\d+$/.test(c[0])) return;
      const g = function (h) { return col[h] === undefined ? '' : (c[col[h]] || ''); };
      const no = g('관리번호'), name = g('기기명');
      if (!no && !name) return;
      const all = c.join(' ');
      items.push({ floor: floor, store: cur, raw: no, name: cleanText_(name.replace(/\n/g, ' '), 40) || '(이름 없음)',
        w: ehW_(g('용량(W)')), maker: cleanText_(g('제조사').replace(/\(?폐기\)?/g, ''), 40),
        m1: cleanText_(g('관리책임자'), 30), m2: col['관리책임자'] === undefined ? '' : cleanText_(c[col['관리책임자'] + 1], 30),
        date: ehDate_(g('승인일자')), gone: /폐기|매장철수/.test(all) });
    });
  });
  // 1) 쓸 수 있는 번호(모양 맞고 처음 나온 것)는 그대로, 지하는 B1F- → B1-
  const seen = {};
  let fixed = 0;
  items.forEach(function (x) {
    let no = String(x.raw).split('\n')[0].replace(/\(.*$/, '').trim();
    const b = no.replace(/^(B[1-3])F-/, '$1-');
    if (b !== no) { no = b; fixed++; }
    const m = EH_NO.exec(no);
    x.no = m && m[1] === x.floor && !seen[no] ? no : '';   // 다른 층 번호(B1 매장에 2F-1-1 등)는 새 번호
    if (x.no) { seen[no] = 1; const s = stores[x.store].nos; s[m[2]] = (s[m[2]] || 0) + 1; }
  });
  // 2) 매장번호 = 그 매장 기기 번호에 가장 많이 쓰인 가운데 숫자 (층 안에서 겹치면 새 번호)
  const taken = {}, maxNo = {};
  stores.forEach(function (s) {
    const best = Object.keys(s.nos).sort(function (a, b) { return s.nos[b] - s.nos[a] || a - b; })[0];
    Object.keys(s.nos).forEach(function (n) { maxNo[s.floor] = Math.max(maxNo[s.floor] || 0, Number(n)); });
    if (best && !taken[s.floor + '-' + best]) { s.no = Number(best); taken[s.floor + '-' + best] = 1; }
  });
  stores.forEach(function (s) { if (!s.no) s.no = maxNo[s.floor] = (maxNo[s.floor] || 0) + 1; });
  // 3) 번호 없음·모양 다름·겹침 → 그 매장 다음 순번
  let renumbered = 0;
  items.forEach(function (x) {
    if (x.no) return;
    const s = stores[x.store], head = s.floor + '-' + s.no + '-';
    let n = 0;
    Object.keys(seen).forEach(function (k) { if (k.indexOf(head) === 0) n = Math.max(n, ehSeq_(k)); });
    x.no = head + (n + 1); seen[x.no] = 1; renumbered++;
  });
  const check = { stores: stores.length, items: items.length, renumbered: renumbered, bfix: fixed, gone: items.filter(function (x) { return x.gone; }).length,
    noDate: items.filter(function (x) { return !x.date; }).length,
    floors: EH_FLOORS.map(function (f) { return [f, stores.filter(function (s) { return s.floor === f; }).length, items.filter(function (x) { return x.floor === f; }).length]; }) };
  return { stores: stores, items: items, check: check };
}
function ehW_(s) { const m = /\d+(\.\d+)?/.exec(String(s).replace(/,/g, '')); return m ? m[0] : ''; }
/* 2014.12.26 · 23.02.01 · 24.08,29 · 2019-11-30 → YYYY-MM-DD */
function ehDate_(s) {
  const m = /(\d{2,4})\s*[.,\-\/]\s*(\d{1,2})\s*[.,\-\/]\s*(\d{1,2})/.exec(String(s));
  if (!m) return '';
  const y = m[1].length === 2 ? '20' + m[1] : m[1], mo = Number(m[2]), d = Number(m[3]);
  if (y.length !== 4 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
}

/* ID {앱}-{종류}-{YYYYMMDD}-{###} — 오늘 가장 큰 번호 + 1 */
/* ───────────────────────── 공사장 점검 (WS_공사장점검, 결정 100) ───────────────────────── */

const CS_TABS = ['공사현장', '공사점검항목', '공사점검'];
const CS_ST = ['양호', '미흡', '해당없음'];
const CS_MAX_PHOTOS = 6, CS_MAX_ITEMS = 30;
// 사진은 항목당 6장 (한 줄 3장 × 2줄, 11-11)
// 하루 2번: 1회차 오후점검 · 2회차 퇴실점검 (사용자 11-13, 결정 112). 3회차는 11-11~12에 하루 3번 하던 기록만 (「추가 점검」으로 보임)
const CS_ROUNDS = ['오후점검', '퇴실점검', '추가 점검'];
const CS_USE_SEED = ['정리정돈·통로', '안전수칙 위반'];   // 처음 「점검에 넣기」 항목 (사용자 11-13: 8·9번만)
/* 기본 점검 항목 9개 (사용자 첨부 「현장 일일 안전점검 보고서」 5개 + 4개, 11-11 확정) — 앱에서 관리자가 더하고 지움 */
const CS_SEED = [
  ['비치서류', '공정표, 위험성평가표, 작업허가서, MSDS(물질안전보건자료), 작업자 명단 비치'],
  ['화기작업 관리', '화기작업 허가, 불티 방지포, 소화기 2대·화재감시자 배치, 작업 후 30분 잔불 확인'],
  ['위험물 보관', '인화성 물질(도료·시너·가스) 격리 보관, 보관함 잠금, 반입량 최소'],
  ['소방시설 보호', '감지기 덮개 작업 후 해제, 스프링클러·소화전·방화셔터 앞 막힘 없음'],
  ['전기 안전', '임시 분전반 누전차단기, 전선 피복 손상·문어발 없음, 퇴근 시 전원 차단'],
  ['개인 보호구', '안전모·안전화 착용, 고소작업 시 안전대 체결'],
  ['고소·사다리 작업', '말비계·사다리 고정, 2인 1조, 작업 구간 통제'],
  ['정리정돈·통로', '자재 적치 정돈, 피난통로·비상구 확보, 가림막·출입 통제'],
  ['안전수칙 위반', '흡연, 음주, 무단 화기 사용, 개구부 덮개 미설치 등']
];

/** 탭이 없으면 만들고 기본 항목 9개를 넣음 (두 사람이 처음 동시에 열어도 한 번만) */
function csTabs_() {
  const ss = db_(), it = ss.getSheetByName('공사점검항목'), ck = ss.getSheetByName('공사점검');
  if (ck) {   // v0.9.4까지 만든 탭엔 「회차」 열이 없음 → 맨 끝에 붙임 (빈 칸 = 1회차 오전)
    const head = ck.getRange(1, 1, 1, ck.getLastColumn()).getValues()[0].map(String);
    if (head.indexOf('회차') === -1) ck.getRange(1, head.length + 1, 1, 1).setValues([['회차']]);
  }
  if (it && it.getLastRow() > 1) {   // v0.9.7까지 만든 탭엔 「점검사용」 열이 없음 → 붙이고 처음 값 (정리정돈·통로 · 안전수칙 위반만 Y)
    const ih = it.getRange(1, 1, 1, it.getLastColumn()).getValues()[0].map(String);
    if (ih.indexOf('점검사용') === -1) {
      it.getRange(1, ih.length + 1, 1, 1).setValues([['점검사용']]);
      const t = readTable_('공사점검항목');
      t.rows.forEach(function (r) { r['점검사용'] = CS_USE_SEED.indexOf(r['항목']) !== -1 ? 'Y' : 'N'; });
      writeBack_(t);
    }
  }
  if (it && it.getLastRow() > 1 && ss.getSheetByName('공사현장') && ck) return;
  ensureTabs_(CS_TABS);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (db_().getSheetByName('공사점검항목').getLastRow() > 1) return;
    appendRows_('공사점검항목', CS_SEED.map(function (s, i) { return { '순서': String(i + 1), '항목': s[0], '설명': s[1], '사용여부': 'Y', '바꾼사람': '처음 목록', '바꾼시각': now_(), '점검사용': CS_USE_SEED.indexOf(s[0]) !== -1 ? 'Y' : 'N' }; }));
  } finally {
    lock.releaseLock();
  }
}
function csAdmin_(me) { return me['역할'] === '관리자' || me['역할'] === '소장'; }   // 기본 항목은 관리자·소장만 고침 (사용자 11-11)
function csItems_() {
  return readTable_('공사점검항목').rows.filter(function (r) { return r['사용여부'] !== 'N' && r['항목']; })
    .sort(function (a, b) { return Number(a['순서']) - Number(b['순서']); })
    .map(function (r) { return { t: r['항목'], d: r['설명'], use: r['점검사용'] === 'Y' }; });
}
function csSites_() { return readTable_('공사현장').rows.filter(function (r) { return r['사용여부'] !== 'N'; }); }
function csSiteOut_(r) { return { id: r['cs_id'], name: r['현장명'], work: r['공사내용'], co: r['업체'] }; }
function csRound_(r) { return Number(r['회차']) || 1; }
function csRoundArg_(n) { n = Number(n); return n >= 1 && n <= 3 && Math.floor(n) === n ? n : 0; }
function csCheckOut_(r) {
  return { id: r['ck_id'], date: r['점검일'], site: r['cs_id'], round: csRound_(r), name: r['현장명'], work: r['공사내용'], co: r['업체'], by: r['점검자'], at: r['점검시각'], ok: Number(r['양호']) || 0, bad: Number(r['미흡']) || 0, na: Number(r['해당없음']) || 0,
    saved: r['수정시각'], pdf: r['pdf_id'] ? { url: driveUrl_(r['pdf_id']), at: r['PDF만든시각'] } : null, stale: !!(r['pdf_id'] && r['수정시각'] > r['PDF만든시각']) };
}
function csFolder_(date) { return folderPath_(['시설팀 통합업무', '20_업무지원', '점검', '공사장점검', date.slice(0, 4), date.slice(0, 7)]); }
function csDate_(date) { return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : workDay_(Date.now()); }

/** 첫 화면: 오늘(근무일) · 진행 중 현장 · 오늘 점검 결과 · 지난 점검(전부 — 검색용, 항목 JSON은 안 보냄) · 기본 항목 */
function csHome(token) {
  const me = auth_(token);
  csTabs_();
  const day = workDay_(Date.now());
  const checks = readTable_('공사점검').rows.filter(function (r) { return r['삭제여부'] !== 'Y'; }).map(csCheckOut_);
  return {
    ok: true, day: day, admin: csAdmin_(me), items: csItems_(),
    sites: csSites_().map(csSiteOut_),
    today: checks.filter(function (c) { return c.date === day; }),
    past: checks.filter(function (c) { return c.date < day; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; })
  };
}

/** 현장 추가·고치기 (누구나). id 있으면 고침 */
function csSiteSave(token, d) {
  const me = auth_(token);
  d = d || {};
  const name = cleanText_(d.name, 30), work = cleanText_(d.work, 30), co = cleanText_(d.co, 30);
  if (!name) return { ok: false, error: '현장 이름을 넣어 주세요. (예: 5F 리모와)' };
  csTabs_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('공사현장');
    const live = t.rows.filter(function (r) { return r['사용여부'] !== 'N'; });
    const cur = d.id ? live.filter(function (r) { return r['cs_id'] === d.id; })[0] : null;
    if (d.id && !cur) return { ok: false, error: '현장을 찾지 못했습니다. 새로고침해 주세요.' };
    if (live.some(function (r) { return r !== cur && r['현장명'] === name; })) return { ok: false, error: '「' + name + '」 현장이 이미 있습니다.' };
    if (cur) {
      updateRow_('공사현장', cur._row, { '현장명': name, '공사내용': work, '업체': co });
      log_(me['이름'], '공사 현장 고침', cur['cs_id'], name);
    } else {
      const id = nextId_('CS', t.rows, 'cs_id');
      appendRow_('공사현장', { 'cs_id': id, '현장명': name, '공사내용': work, '업체': co, '사용여부': 'Y', '등록일시': now_(), '등록자': me['이름'] });
      log_(me['이름'], '공사 현장 추가', id, name);
    }
    return { ok: true, sites: csSites_().map(csSiteOut_) };
  } finally {
    lock.releaseLock();
  }
}

/** 공사 끝: 목록에서 뺌 (지난 점검·PDF는 그대로) */
function csSiteEnd(token, id) {
  const me = auth_(token);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = csSites_().filter(function (x) { return x['cs_id'] === id; })[0];
    if (!r) return { ok: false, error: '현장을 찾지 못했습니다.' };
    updateRow_('공사현장', r._row, { '사용여부': 'N', '끝낸일시': now_() });
    log_(me['이름'], '공사 끝', id, r['현장명']);
    return { ok: true, sites: csSites_().map(csSiteOut_) };
  } finally {
    lock.releaseLock();
  }
}

/** 기본 항목 바꾸기 (관리자·소장만): 화면의 목록 전체 [{t, d}]를 받아 순서대로 씀. 빠진 항목은 사용여부 N (줄은 남김) */
function csItemsSave(token, list) {
  const me = auth_(token);
  if (!csAdmin_(me)) return { ok: false, error: '기본 항목은 관리자·소장만 고칠 수 있습니다.' };
  if (!Array.isArray(list) || !list.length || list.length > CS_MAX_ITEMS) return { ok: false, error: '항목은 1~' + CS_MAX_ITEMS + '개로 해 주세요.' };
  const items = list.map(function (x) { return { t: cleanText_(x && x.t, 30), d: cleanText_(x && x.d, 100), use: !!(x && x.use) }; });
  if (items.some(function (x) { return !x.t; })) return { ok: false, error: '항목 이름이 빈 줄이 있습니다.' };
  if (!items.some(function (x) { return x.use; })) return { ok: false, error: '「점검에 넣기」 항목을 1개 이상 골라 주세요.' };
  csTabs_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const t = readTable_('공사점검항목'), at = now_(), used = {};
    const out = items.map(function (x, i) {
      const r = t.rows.filter(function (r) { return !used[r._row] && r['항목'] === x.t; })[0];
      if (r) { used[r._row] = true; Object.assign(r, { '순서': String(i + 1), '설명': x.d, '사용여부': 'Y', '바꾼사람': me['이름'], '바꾼시각': at, '점검사용': x.use ? 'Y' : 'N' }); return null; }
      return { '순서': String(i + 1), '항목': x.t, '설명': x.d, '사용여부': 'Y', '바꾼사람': me['이름'], '바꾼시각': at, '점검사용': x.use ? 'Y' : 'N' };
    }).filter(Boolean);
    t.rows.forEach(function (r) { if (!used[r._row] && r['사용여부'] !== 'N') Object.assign(r, { '사용여부': 'N', '바꾼사람': me['이름'], '바꾼시각': at }); });
    writeBack_(t);
    appendRows_('공사점검항목', out);
    log_(me['이름'], '공사 점검 기본 항목', '', items.map(function (x) { return (x.use ? '[점검] ' : '') + x.t; }).join(', '));
    return { ok: true, items: csItems_() };
  } finally {
    lock.releaseLock();
  }
}

/** 그날 그 현장의 점검 줄들 (회차 순) */
function csDayRows_(date, siteId) {
  return readTable_('공사점검').rows.filter(function (r) { return r['점검일'] === date && r['cs_id'] === siteId && r['삭제여부'] !== 'Y'; })
    .sort(function (a, b) { return csRound_(a) - csRound_(b); });
}
function csRow_(date, siteId, round) {
  return csDayRows_(date, siteId).filter(function (r) { return csRound_(r) === (round || 1); })[0] || null;
}

/** 현장 하나의 그날 한 회차: 저장한 것이 있으면 그 항목(사진은 data URL), 없으면 기본 항목으로 빈 점검.
 *  회차를 안 주면 아직 안 한 첫 회차 (3회차까지 다 했으면 3회차) */
function csGet(token, date, siteId, round) {
  auth_(token);
  csTabs_();
  date = csDate_(date);
  const day = csDayRows_(date, siteId), done = day.map(csRound_);
  round = csRoundArg_(round) || [1, 2].filter(function (n) { return done.indexOf(n) === -1; })[0] || 2;   // 회차 안 주면 아직 안 한 회차 (둘 다 했으면 퇴실점검)
  const row = day.filter(function (r) { return csRound_(r) === round; })[0] || null;
  const site = row ? { id: row['cs_id'], name: row['현장명'], work: row['공사내용'], co: row['업체'] } : (csSites_().filter(function (r) { return r['cs_id'] === siteId; }).map(csSiteOut_)[0] || null);
  if (!site) return { ok: false, error: '현장을 찾지 못했습니다. 새로고침해 주세요.' };
  const items = row ? jsonOr_(row['항목'], []) : csItems_().filter(function (x) { return x.use; }).map(function (x) { return { t: x.t, d: x.d, st: '', memo: '', photos: [] }; });
  items.forEach(function (x) { x.photos = (x.photos || []).map(function (p) { return { id: p.id, at: p.at, src: fileB64_(p.id) }; }); });
  return { ok: true, date: date, round: round, site: site, items: items, check: row ? csCheckOut_(row) : null, rounds: day.map(csCheckOut_) };
}

function csCleanItems_(list) {
  if (!Array.isArray(list) || !list.length || list.length > CS_MAX_ITEMS) return null;
  return list.map(function (x) {
    x = x || {};
    const photos = (Array.isArray(x.photos) ? x.photos : []).slice(0, CS_MAX_PHOTOS).map(function (p) {
      return { id: /^[\w-]{1,80}$/.test(String(p && p.id || '')) ? String(p.id) : '', at: /^\d{1,2}:\d{2}$/.test(String(p && p.at || '')) ? String(p.at) : '', data: p && p.data ? String(p.data) : '' };
    }).filter(function (p) { return p.id || p.data; });
    return { t: cleanText_(x.t, 30) || '(이름 없음)', d: cleanText_(x.d, 100), st: CS_ST.indexOf(x.st) !== -1 ? x.st : '', memo: String(x.memo || '').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, '').trim().slice(0, 300), extra: !!x.extra, photos: photos };
  });
}

/**
 * 저장 (자동 저장도 이것): 항목 전체 + 새 사진(data). 새 사진은 드라이브에 저장하고 id를 돌려줌.
 * 점검자·점검시각 = 처음 저장한 사람·시각 (결정 100). 뺀 사진은 시트를 다 쓴 뒤 휴지통 (결정 80과 같은 순서)
 */
function csSave(token, date, siteId, list, round) {
  const me = auth_(token);
  date = csDate_(date);
  round = csRoundArg_(round) || 1;
  const items = csCleanItems_(list);
  if (!items) return { ok: false, error: '항목은 1~' + CS_MAX_ITEMS + '개로 해 주세요.' };
  for (const x of items) for (const p of x.photos) {
    if (p.data && !parseDataUrl_(p.data, 'image/jpeg', 1000, 4000000)) return { ok: false, error: '「' + x.t + '」 사진을 읽지 못했습니다. 다시 찍어 주세요.' };
  }
  csTabs_();
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const row = csRow_(date, siteId, round);
    const site = row ? { name: row['현장명'], work: row['공사내용'], co: row['업체'] } : csSites_().filter(function (r) { return r['cs_id'] === siteId; }).map(function (r) { return { name: r['현장명'], work: r['공사내용'], co: r['업체'] }; })[0];
    if (!site) return { ok: false, error: '현장을 찾지 못했습니다. 새로고침해 주세요.' };
    const oldN = {};   // 예전 사진 id → 파일 번호. 화면이 보낸 id는 이 점검의 사진일 때만 받음
    if (row) jsonOr_(row['항목'], []).forEach(function (x) { (x.photos || []).forEach(function (p) { oldN[p.id] = Number(p.n) || 0; }); });
    let seq = Math.max.apply(null, [Number(row && row['사진번호']) || 0].concat(Object.keys(oldN).map(function (k) { return oldN[k]; })));   // 지운 사진 번호도 다시 안 씀
    const base = date + '_공사장점검-' + safeName_(site.name) + '_' + CS_ROUNDS[round - 1], used = {};
    items.forEach(function (x) {
      x.photos = x.photos.filter(function (p) { return p.data || oldN[p.id] !== undefined; });
      x.photos.forEach(function (p) { if (p.id && !p.data) { used[p.id] = true; p.n = oldN[p.id]; } });
    });
    const folder = items.some(function (x) { return x.photos.some(function (p) { return p.data; }); }) ? csFolder_(date) : null;
    items.forEach(function (x) {
      x.photos.forEach(function (p) {
        if (!p.data) return;
        p.n = ++seq;
        p.id = saveBlob_(folder, parseDataUrl_(p.data, 'image/jpeg', 1000, 4000000), base + '_' + pad3_(p.n) + '.jpg', '공사장 점검 ' + date + ' ' + CS_ROUNDS[round - 1] + ' · ' + site.name + ' · ' + x.t + ' · ' + me['이름']);
        delete p.data;
      });
    });
    const cnt = { '양호': 0, '미흡': 0, '해당없음': 0 };
    items.forEach(function (x) { if (cnt[x.st] !== undefined) cnt[x.st]++; });
    const at = now_();
    const patch = { '항목': JSON.stringify(items), '사진번호': String(seq), '양호': String(cnt['양호']), '미흡': String(cnt['미흡']), '해당없음': String(cnt['해당없음']), '수정시각': at, '고친사람': me['이름'] };
    let id;
    if (row) { id = row['ck_id']; updateRow_('공사점검', row._row, patch); }
    else {
      id = nextId_('CK', readTable_('공사점검').rows, 'ck_id');
      appendRow_('공사점검', Object.assign(patch, { 'ck_id': id, '점검일': date, 'cs_id': siteId, '현장명': site.name, '공사내용': site.work, '업체': site.co, '점검자_id': me['staff_id'], '점검자': me['이름'], '점검시각': at, '삭제여부': 'N', '회차': String(round) }));
    }
    Object.keys(oldN).forEach(function (o) { if (!used[o]) trashFile_(o); });
    const day = csDayRows_(date, siteId);
    return { ok: true, items: items.map(function (x) { return x.photos.map(function (p) { return p.id; }); }), check: csCheckOut_(day.filter(function (r) { return csRound_(r) === round; })[0]), rounds: day.map(csCheckOut_) };
  } finally {
    lock.releaseLock();
  }
}

/** 화면이 만든 A4 PDF (현장마다 하루 1개 — 오전·오후·작업종료를 한 파일에, 사용자 11-11)를 저장.
 *  그날 그 현장의 모든 회차 줄에 같은 pdf_id를 적음. 다시 만들면 예전 PDF는 휴지통 */
function csSavePdf(token, ckId, dataUri) {
  const me = auth_(token);
  const m = /^data:application\/pdf[^,]*;base64,(.+)$/.exec(String(dataUri || ''));
  if (!m || m[1].length < 100) return { ok: false, error: 'PDF 내용이 올바르지 않습니다' };
  const bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 30 * 1024 * 1024) return { ok: false, error: 'PDF가 너무 큽니다' };
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const row = readTable_('공사점검').rows.filter(function (r) { return r['ck_id'] === ckId && r['삭제여부'] !== 'Y'; })[0];
    if (!row) return { ok: false, error: '먼저 저장해 주세요' };
    const id = saveBlob_(csFolder_(row['점검일']), Utilities.newBlob(bytes, 'application/pdf'), row['점검일'] + '_공사장점검-' + safeName_(row['현장명']) + '.pdf', '공사장 점검 ' + row['점검일'] + ' · ' + row['현장명'] + ' · ' + me['이름']);
    const shared = shareLink_(id), at = now_(), old = {};
    csDayRows_(row['점검일'], row['cs_id']).forEach(function (r) { if (r['pdf_id']) old[r['pdf_id']] = true; updateRow_('공사점검', r._row, { 'pdf_id': id, 'PDF만든시각': at }); });
    Object.keys(old).forEach(trashFile_);
    log_(me['이름'], '공사장 점검 PDF', ckId, row['점검일'] + ' · ' + row['현장명']);
    const day = csDayRows_(row['점검일'], row['cs_id']);
    return { ok: true, check: csCheckOut_(day.filter(function (r) { return r['ck_id'] === ckId; })[0]), rounds: day.map(csCheckOut_), warn: shared ? '' : 'PDF는 저장했지만 공유를 못 했습니다. 구글 로그인 안 한 휴대폰에서는 열리지 않을 수 있습니다.' };
  } finally {
    lock.releaseLock();
  }
}

function nextId_(kind, rows, col) {
  const day = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'), re = new RegExp('^WS-' + kind + '-' + day + '-(\\d+)$');
  let n = 0;
  rows.forEach(function (r) { const m = re.exec(r[col]); if (m) n = Math.max(n, Number(m[1])); });
  return 'WS-' + kind + '-' + day + '-' + pad3_(n + 1);
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
  if (DB_SWAP) return DB_SWAP;   // 종합업무일지 시트 (withBook_)
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
    if (h === '연월' || h === '월') return Utilities.formatDate(v, TZ, 'yyyy-MM');
    if (h === '일자' || h === '날짜') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
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

/* 여러 줄 한 번에 덧붙이기 (엑셀 가져오기 수천 줄) */
function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = db_().getSheetByName(name);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  sh.getRange(sh.getLastRow() + 1, 1, objs.length, head.length).setValues(objs.map(function (o) { return head.map(function (h) { return asText_(o[h]); }); }));
}
/* readTable_로 읽어 고친 표 전체를 한 번에 다시 씀 (잠금 안에서만 — 읽은 뒤 다른 사람이 쓴 줄을 덮지 않게) */
function writeBack_(t) {
  const n = t.sheet.getLastRow() - 1;
  if (n < 1) return;
  const out = [];
  for (let i = 0; i < n; i++) out.push(t.head.map(function () { return ''; }));
  t.rows.forEach(function (r) { if (r._row >= 2 && r._row - 2 < n) out[r._row - 2] = t.head.map(function (h) { return asText_(r[h]); }); });
  t.sheet.getRange(2, 1, n, t.head.length).setValues(out);
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
