// 가짜 구글 환경(mock_env.js)을 쓰고 Code.js를 불러옴 — 시트는 진짜처럼 날짜 모양 글자를 날짜로 바꿈
const fs = require('fs');
const { NOW, files, sheets } = require('./mock_env.js');

const SIG = 'data:image/png;base64,' + 'S'.repeat(2000);
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
console.log(setup_().split('\n')[0]);
assert(addStaff_('홍길동', '1234', '전방파트', '소장').ok, '직원 등록');
assert(!addStaff_('김철수', '1234', '기건파트', '직원').ok, '같은 PIN 거부');
assert(!login('9999', 'dev1').ok, '틀린 PIN 거부');
const L = login('1234', 'dev1', SIG); assert(L.ok && L.user.name === '홍길동', '로그인');
let T = L.token;  // 기기 표는 다음 오전 8시까지라, 날짜를 넘기면 다시 로그인 (결정 48)
let threw = false; try { auth_(T + 'x'); } catch (e) { threw = true; } assert(threw, '위조 토큰 거부');
assert(feAdd(T, { floor: '3F', store: '샤넬 뷰티', count: 2 }).ok, '소화기 2대 등록');
assert(feAdd(T, { floor: '3F', store: '샤넬 뷰티', count: 1 }).added[0] === '샤넬 뷰티-소화기3', '이어지는 번호');
assert(feAdd(T, { floor: 'B1', store: '공용부', count: 1 }).ok, 'B1 등록');
assert(!feAdd(T, { floor: '9F', store: 'x' }).ok, '없는 층 거부');
const list = feList(T).items; assert(list.length === 4 && list[0].floor === 'B1', '목록 정렬 (층 순)');
let st = feStatus(T, '2026-11'); assert(st.counts.wait === 4 && st.counts.total === 4, '11/3: 모두 점검 전');
const qr = list.find(i => i.name === '샤넬 뷰티-소화기1').token;
const init = checkInit(qr); assert(init.ok && !init.late && !init.exists, 'QR 열기');
assert(!checkInit('zz').ok, '잘못된 QR 거부');
const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000), png = 'data:image/png;base64,' + 'B'.repeat(800);
assert(!checkSubmit(qr, { photo: jpg, signA: png, state: '이상없음' }).ok, '이름 칸 빠지면 거부');
let r = checkSubmit(qr, { photo: jpg, signA: png, signB: png, state: '이상없음' }); assert(r.ok && !r.late, '점검 전송');
assert(checkSubmit(qr, { photo: jpg, signA: png, signB: png }).exists, '같은 달 두 번째는 확인 요구');
r = checkSubmit(qr, { photo: jpg, signA: png, signB: png, state: '이상있음', overwrite: true }); assert(r.ok, '덮어쓰기');
assert(Object.values(files).filter(f => f.trashed).length === 3, '예전 파일 3개 휴지통');
assert(Object.values(files).some(f => /^2026-11-03_소화기점검-샤넬-뷰티-소화기1_001\.jpg$/.test(f.name)), '파일 이름 규칙: ' + Object.values(files).map(f => f.name).slice(-3).join(', '));
st = feStatus(T, '2026-11'); const c1 = st.items.find(i => i.name === '샤넬 뷰티-소화기1');
assert(c1.state === 'bad' && st.counts.bad === 1 && st.counts.wait === 3, '현황: 이상 있음 1, 점검 전 3');
const det = feDetail(T, c1.checkId); assert(det.ok && det.photo.indexOf('data:image/jpeg;base64,') === 0, '입력 내용 보기');
NOW.d = new Date('2026-11-07T09:00:00+09:00'); T = login('1234', 'dev1', SIG).token;
st = feStatus(T, '2026-11'); assert(st.counts.miss === 3, '11/7: 나머지는 미입력');
const qr2 = list.find(i => i.name === '샤넬 뷰티-소화기2').token;
r = checkSubmit(qr2, { photo: jpg, signA: png, signB: png, state: '이상없음' }); assert(r.ok && r.late, '기한 후 입력 받음');
st = feStatus(T, '2026-11'); assert(st.items.find(i => i.name === '샤넬 뷰티-소화기2').late, '기한 후 표시');
const sm = summary_(); assert(sm.todos.some(t => t.key === 'fe_miss'), '요약: 미입력 할 일');
NOW.d = new Date('2026-12-02T09:00:00+09:00'); T = login('1234', 'dev1', SIG).token;
st = feStatus(T, '2026-12'); assert(st.counts.wait === 4 && st.months.join() === '2026-11,2026-12', '12월: 새로 점검 전, 월 목록');
assert(feDelete(T, [list[0].id]).count === 1, '삭제');
assert(!checkInit(list[0].token).ok, '삭제된 QR은 열리지 않음');
assert(feStatus(T, '2026-11').counts.total === 4, '지난달 현황엔 삭제 전 소화기 유지');
assert(feStatus(T, '2026-12').counts.total === 3, '이번 달에선 빠짐');
assert(safeName_('a b/c_d(2)') === 'a-b-c-d-2', '이름 정리 규칙');
// v0.2.1: 12자리 고유번호 · 예전 32자리 바꾸기 · 라벨 크기 저장
{
  const all = feList(T).items;
  assert(all.every(i => /^[2-9a-km-np-z]{12}$/.test(i.token)), '새 QR 고유번호 12자리');
  assert(new Set(all.map(i => i.token)).size === all.length, '고유번호 겹치지 않음');
  assert(checkInit(all[0].token).ok, '12자리 QR 열림');
  const t = readTable_('소화기'); const r = t.rows.filter(x => x['사용여부'] !== 'N')[0];
  const old = 'a'.repeat(32); updateRow_('소화기', r._row, { 'qr_token': old });
  assert(checkInit(old).ok, '예전 32자리 QR도 열림');
  assert(shortenTokens_() >= 1, '32자리 → 12자리 바꾸기');
  assert(!checkInit(old).ok, '바꾼 뒤 예전 QR은 안 열림');
  assert(!labelSave(T, 5, 40).ok, '너무 작은 라벨 거부');
  assert(labelSave(T, 40, 40).ok && feList(T).label.w === 40, '라벨 크기 저장 바로 반영');
  labelSave(T, 30, 34);
}
// v0.2.4: QR 주소로 들어올 때(doGet ?fe=) 12자리·32자리 모두 받는지
{
  let last = null;
  const chain = { setTitle() { return chain; }, addMetaTag() { return chain; }, setXFrameOptionsMode() { return chain; } };
  global.HtmlService = { XFrameOptionsMode: { ALLOWALL: 'ALLOWALL' }, createTemplateFromFile(n) { last = { name: n }; last.evaluate = () => chain; return last; } };
  const tk = feList(T).items[0].token;
  doGet({ parameter: { fe: tk } });
  assert(last.name === 'Check' && last.qr === tk, 'QR 주소(12자리)로 점검 입력 페이지가 열림');
  doGet({ parameter: { fe: 'a'.repeat(32) } });
  assert(last.qr === 'a'.repeat(32), '예전 32자리 QR 주소도 받음');
  doGet({ parameter: { fe: 'bad!' } });
  assert(last.qr === '', '이상한 값은 거절');
}
// v0.3: GitHub check.html 통로 — GET ?api=check, POST checkSubmit (JSON)
{
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput(t) { return { t, setMimeType() { return this; } }; } };
  const tk = feList(T).items[0].token;
  const g = JSON.parse(doGet({ parameter: { api: 'check', fe: tk } }).t);
  assert(g.ok && g.fe && g.window, 'GET ?api=check 로 소화기 정보');
  const bad = JSON.parse(doGet({ parameter: { api: 'check', fe: 'zzzz' } }).t);
  assert(!bad.ok, '틀린 번호는 거절');
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000), png = 'data:image/png;base64,' + 'A'.repeat(400);
  const r = JSON.parse(doPost({ postData: { contents: JSON.stringify({ action: 'checkSubmit', qr: tk, d: { photo: jpg, signA: png, signB: png, state: '이상없음', overwrite: true } }) } }).t);
  assert(r.ok, 'POST checkSubmit 저장');
  const r2 = JSON.parse(doPost({ postData: { contents: '{"action":"x"}' } }).t);
  assert(!r2.ok, '모르는 요청은 거절');
}
// v0.4.0: 기기 표 만료 = 다음 오전 6시 = 근무일 시작 (결정 60)
{
  const KST = 9 * 3600e3, at = (s) => Date.parse(s + '+09:00');
  const hh = (ms) => new Date(ms + KST).toISOString().slice(0, 16).replace('T', ' ');
  assert(hh(nextWorkStart_(at('2026-11-04T22:38:00'))) === '2026-11-05 06:00', '밤 10시 로그인 → 다음 날 6시');
  assert(hh(nextWorkStart_(at('2026-11-05T05:30:00'))) === '2026-11-05 06:00', '5시 30분 로그인 → 그날 6시');
  assert(hh(nextWorkStart_(at('2026-11-05T06:00:00'))) === '2026-11-06 06:00', '6시 정각 로그인 → 다음 날 6시');
  assert(hh(nextWorkStart_(at('2026-12-31T23:59:00'))) === '2027-01-01 06:00', '연말 → 새해 6시');
  assert(workDay_(at('2026-11-05T06:10:00')) === '2026-11-05', '06:10 → 그날 근무일');
  assert(workDay_(at('2026-11-05T05:59:00')) === '2026-11-04', '05:59 → 전날 근무일');
  assert(workDay_(at('2026-11-05T23:50:00')) === '2026-11-05', '23:50 → 그날 근무일');
  const tk = login('1234', 'dev9', SIG).token;
  assert(Number(tk.split('.')[1]) === nextWorkStart_(Date.now()), '로그인 표에 다음 6시가 들어감');
}
{
  NOW.d = new Date('2026-12-02T09:00:00+09:00'); const t1 = login('1234', 'dev1', SIG).token;
  NOW.d = new Date('2026-12-03T05:59:00+09:00'); let okBefore = true; try { auth_(t1); } catch (e) { okBefore = false; }
  NOW.d = new Date('2026-12-03T06:00:01+09:00'); let okAfter = true; try { auth_(t1); } catch (e) { okAfter = false; }
  assert(okBefore && !okAfter, '다음 날 5:59엔 들어가고 6:00 지나면 다시 PIN');
}
{
  const s = readTable_('직원').rows[0];
  const mk = exp => { const pl = s['staff_id'] + '.' + exp; return pl + '.' + sign_(pl + '|' + String(s['pin_hash']).slice(0, 8)); };
  let rejected = false; try { auth_(mk(Date.now() + 30 * 24 * 3600e3)); } catch (e) { rejected = true; }
  assert(rejected, '예전 30일 표는 받지 않음 (한 번 다시 로그인)');
  rejected = false; try { auth_(mk(nextWorkStart_(Date.now()) + 2 * 3600e3)); } catch (e) { rejected = true; }
  assert(rejected, '예전 8시 표도 받지 않음 (한 번 다시 로그인)');
}
// v0.3.2: 시트가 날짜·숫자로 바꿔 저장해도 현황이 맞게 셈 (현황 0대 문제)
{
  NOW.d = new Date('2026-11-04T23:05:00+09:00'); T = login('1234', 'dev1', SIG).token;
  const tabFe = sheets['소화기'].rows, head = tabFe[0];
  const add = feAdd(T, { floor: '3F', store: '샤넬', count: 1 }); assert(add.ok, '샤넬 소화기 등록');
  const last = tabFe[tabFe.length - 1];
  assert(typeof last[head.indexOf('등록일시')] === 'string', '새로 쓴 등록일시는 글자로 남음');
  // 예전 판처럼 날짜 값으로 바뀐 줄을 하나 직접 넣음
  const old = head.map(h => ({ 'fe_id': 'WS-FE-20261104-099', '층': '3F', '매장명': '샤넬', '번호': 9, '이름': '샤넬-소화기9', 'qr_token': 'abcdefghjkmn', '사용여부': 'Y', '등록일시': new Date('2026-11-04T10:00:00+09:00'), '등록자': 'x' })[h] ?? '');
  tabFe.push(old);
  const ch = sheets['소화기점검'].rows, chHead = ch[0];
  ch.push(chHead.map(h => ({ 'check_id': 'WS-FC-20261104-099', '연월': new Date('2026-11-01T00:00:00+09:00'), 'fe_id': 'WS-FE-20261104-099', '층': '3F', '매장명': '샤넬', '소화기이름': '샤넬-소화기9', '상태': '이상없음', '입력일시': new Date('2026-11-04T23:06:00+09:00'), '기한후입력': 'N', '덮어쓴횟수': 0, '삭제여부': 'N' })[h] ?? ''));
  const st = feStatus(T, '2026-11');
  const s9 = st.items.find(i => i.name === '샤넬-소화기9');
  assert(s9 && s9.state === 'ok' && s9.at === '2026-11-04 23:06', '날짜로 바뀐 예전 줄도 점검완료로 셈 (입력일시 ' + (s9 && s9.at) + ')');
  assert(st.items.some(i => i.name === '샤넬-소화기1'), '새 소화기도 현황에 보임 (0대 아님): ' + st.counts.total + '대');
  // QR로 보낸 점검이 바로 집계되는지
  const tk = feList(T).items.find(i => i.name === '샤넬-소화기1').token;
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000), png = 'data:image/png;base64,' + 'A'.repeat(400);
  assert(checkSubmit(tk, { photo: jpg, signA: png, signB: png, state: '이상없음' }).ok, 'QR 점검 보냄');
  const st2 = feStatus(T, '2026-11');
  assert(st2.items.find(i => i.name === '샤넬-소화기1').state === 'ok', '보낸 점검이 현황에 점검완료로 잡힘');
  const lastCh = ch[ch.length - 1];
  assert(typeof lastCh[chHead.indexOf('연월')] === 'string' && lastCh[chHead.indexOf('연월')] === '2026-11', '연월은 글자 2026-11 로 저장');
  // = 로 시작하는 매장명이 수식이 되지 않음
  assert(asText_('=IMPORTXML(1)') === "'=IMPORTXML(1)", '= 로 시작하는 글자는 수식이 되지 않게 저장');
}
{
  const before = dataCheck_(false);
  assert(before.bad > 0, '⑤ 데이터 점검: 날짜로 바뀐 칸을 찾음 (' + before.bad + '칸)');
  const fixed = dataCheck_(true);
  assert(fixed.changed > 0 && dataCheck_(false).bad === 0, '⑤ 고치기 후 바뀐 칸 0');
  const st = feStatus(T, '2026-11');
  assert(st.items.find(i => i.name === '샤넬-소화기9').state === 'ok', '고친 뒤에도 집계 그대로');
  const jpg = 'data:image/jpeg;base64,' + 'A'.repeat(4000), png = 'data:image/png;base64,' + 'A'.repeat(400);
  const tk = feList(T).items.find(i => i.name === '샤넬-소화기1').token;
  const r = checkSubmit(tk, { photo: jpg, signA: png, signB: png, state: '이상없음', overwrite: true });
  assert(r.ok && /^WS-FC-\d{8}-\d{3}$/.test(r.checkId), '완료 화면용 저장 번호: ' + r.checkId);
}

// v0.4.0: PIN + 근무일 첫 서명 로그인, TBM 서명 목록 (결정 56·60)
{
  NOW.d = new Date('2026-12-10T05:40:00+09:00');
  assert(addStaff_('김철수', '5678', '기건파트', '직원').ok && addStaff_('이영희', '2468', '전방파트', '파트장').ok, '직원 2명 더 등록');
  const a = login('5678', 'dA');
  assert(!a.ok && a.needSign && a.name === '김철수' && !a.token, '오늘 서명 없으면 표 안 주고 서명 요구 (이름 같이)');
  assert(!login('5678', 'dA', 'data:image/png;base64,AAAA').ok, '너무 짧은 서명은 거절');
  assert(!login('5678', 'dA', 'data:image/jpeg;base64,' + 'S'.repeat(2000)).ok, 'PNG가 아니면 거절');
  const a2 = login('5678', 'dA', SIG); assert(a2.ok && a2.token, '서명과 함께 → 로그인 (05:40 → 12-09 근무일)');
  const sg = readTable_('서명').rows.filter(r => r['staff_id'] === a2.user.staff_id);
  assert(sg.length === 1 && sg[0]['근무일'] === '2026-12-09' && /^WS-SG-20261209-\d{3}$/.test(sg[0]['sign_id']), '서명 줄: 근무일 12-09, ' + (sg[0] && sg[0]['sign_id']));
  assert(Object.values(files).some(f => f.name === '2026-12-09_서명-김철수.png'), '서명 파일 이름 규칙');
  assert(typeof sheets['서명'].rows[sheets['서명'].rows.length - 1][6] === 'string', '서명시각은 글자로 저장');
  assert(login('5678', 'dB').ok, '같은 근무일 다른 기기 → 서명 다시 안 묻고 로그인');
  NOW.d = new Date('2026-12-10T06:05:00+09:00');
  const b = login('5678', 'dA'); assert(b.needSign, '6시 지나면 새 근무일 → 다시 서명');
  NOW.d = new Date('2026-12-10T06:20:00+09:00'); const y = login('2468', 'dC', SIG);
  NOW.d = new Date('2026-12-10T07:10:00+09:00'); const k = login('5678', 'dA', SIG);
  NOW.d = new Date('2026-12-10T07:12:00+09:00'); const k2 = login('5678', 'dD', SIG);
  assert(y.ok && k.ok && k2.ok, '이영희 06:20, 김철수 07:10 서명');
  assert(readTable_('서명').rows.filter(r => r['근무일'] === '2026-12-10' && r['staff_id'] === k.user.staff_id).length === 1, '하루 한 줄만');
  NOW.d = new Date('2026-12-10T08:30:00+09:00'); const hong = login('1234', 'dE', SIG);
  const tb = tbmGet(hong.token);
  assert(tb.ok && tb.day === '2026-12-10' && tb.signs.map(x => x.name).join() === '이영희,김철수,홍길동', 'TBM 서명란 = 로그인 순, 파트 섞임: ' + tb.signs.map(x => x.name + x.at).join(' '));
  assert(tb.signs[0].at === '06:20' && tb.signs[0].img.indexOf('data:image/png;base64,') === 0, '서명 아래 시각 · 그림');
  const bs = bootstrap(hong.token); assert(!bs.needSign && bs.docs.signs === 3, '메인: 오늘 서명 3명');
  // 시트에서 오늘 서명 줄을 지운 경우 → needSign → signToday
  const t = readTable_('서명'); const mine = t.rows.find(r => r['근무일'] === '2026-12-10' && r['이름'] === '홍길동');
  updateRow_('서명', mine._row, { '삭제여부': 'Y' });
  assert(bootstrap(hong.token).needSign, '표는 있는데 오늘 서명 없으면 needSign');
  assert(!signToday(hong.token, 'x').ok && signToday(hong.token, SIG).ok && !bootstrap(hong.token).needSign, 'signToday 로 서명 채움');
  assert(tbmGet(hong.token).signs.slice(-1)[0].name === '홍길동', '다시 쓴 서명은 그 시각 순서로');
  // 개선 C: 90일 지난 안 쓴 서명 휴지통, TBM에 쓴 서명은 보관
  const t2 = readTable_('서명'); const used = t2.rows.find(r => r['근무일'] === '2026-12-09');
  updateRow_('서명', used._row, { 'TBM사용': 'Y' });
  NOW.d = new Date('2027-03-15T03:00:00+09:00');
  const n = cleanSigns_();
  const after = readTable_('서명').rows;
  assert(n >= 3, '정리 실행 ' + n + '개');
  assert(after.find(r => r['근무일'] === '2026-12-09')['삭제여부'] === 'N', 'TBM에 쓴 서명은 90일 지나도 보관');
  assert(after.filter(r => r['근무일'] < '2026-12-15' && r['TBM사용'] !== 'Y').every(r => r['삭제여부'] === 'Y'), '안 쓴 서명은 모두 휴지통 표시');
}
// 명일 작업 예정 (WS_서류작업 9장, 결정 62·68)
{
  NOW.d = new Date('2026-12-18T15:00:00+09:00'); const lee = login('2468', 'nw1', SIG); const kim = login('5678', 'nw2', SIG);
  let g = nextWorkGet(lee.token, '');
  assert(g.ok && g.date === '2026-12-19' && g.workDay === '2026-12-18' && g.rows.length === 0 && g.ver === '', '명일: 12-18 15시 → 일자 12-19, 빈 장');
  NOW.d = new Date('2026-12-19T01:00:00+09:00');
  assert(nextWorkGet(lee.token, '').date === '2026-12-19', '명일: 새벽 1시는 아직 12-18 근무일 → 일자 12-19');
  NOW.d = new Date('2026-12-18T15:10:00+09:00');
  const rows = [{ dept: '전방파트', place: '전층', work: 'EPS실 순찰 및 공사장 안전점검', note: '' }, { dept: '기건파트', place: '', work: '', note: '' },
    { dept: '기건파트', place: '2층,3층,4층', work: '층별 전 공조기 구리스 주입', note: '사다리' }];
  assert(!nextWorkSave(lee.token, '2026-12-19', [{ dept: '전기방재', place: '전층', work: 'x' }], '').ok, '명일: 부서는 전방파트·기건파트만');
  assert(!nextWorkSave(lee.token, '12/19', rows, '').ok, '명일: 일자 형식 거부');
  let s1 = nextWorkSave(lee.token, '2026-12-19', rows, '');
  assert(s1.ok && s1.rows.length === 2 && s1.rows[1].place === '2층,3층,4층' && s1.by === '이영희', '명일: 빈 줄 빼고 2줄 저장');
  assert(sheets['명일작업'].rows.slice(1).every(r => typeof r[0] === 'string' && r[0] === '2026-12-19'), '명일: 일자는 글자로 저장');
  const stale = s1.ver;
  NOW.d = new Date('2026-12-18T15:20:00+09:00');
  const s2 = nextWorkSave(kim.token, '2026-12-19', s1.rows.concat([{ dept: '기건파트', place: '전층', work: '미세먼지 측정', note: '' }]), s1.ver);
  assert(s2.ok && s2.rows.length === 3 && s2.by === '김철수', '명일: 다른 직원이 이어서 고침');
  const c = nextWorkSave(lee.token, '2026-12-19', [{ dept: '전방파트', place: '1층', work: '덮어쓰기', note: '' }], stale);
  assert(!c.ok && c.conflict && c.rows.length === 3 && /김철수/.test(c.error), '명일: 먼저 고친 사람 있으면 덮어쓰지 않고 새 내용 돌려줌');
  assert(nextWorkSave(lee.token, '2026-12-20', rows, '').ok && nextWorkGet(lee.token, '2026-12-19').rows.length === 3, '명일: 날짜마다 한 장 (다른 날짜는 따로)');
  const s3 = nextWorkSave(kim.token, '2026-12-19', s2.rows.slice(1), s2.ver);
  assert(s3.ok && s3.rows.length === 2 && s3.rows[0].work === '층별 전 공조기 구리스 주입' && readTable_('명일작업').rows.filter(r => r['일자'] === '2026-12-19').map(r => r['순번']).join() === '1,2', '명일: 줄 지우면 순번 1부터 다시');
  const s4 = nextWorkSave(kim.token, '2026-12-19', s3.rows, s3.ver);
  assert(s4.ok && s4.ver !== s3.ver, '명일: 같은 초에 다시 저장해도 ver 바뀜');
  let threw2 = false; try { nextWorkGet('bad', ''); } catch (e) { threw2 = true; } assert(threw2, '명일: 로그인 필요');
}
// TBM 작성 · PDF (WS_서류작업 4-1~5장, 결정 66·70)
{
  assert(sheets['위험성목록'].rows.length === 19 && readTable_('위험성목록').rows[0]['낱말'] === '사다리', 'TBM: 초기 설정이 위험성 목록 18줄을 넣음');
  assert(addStaff_('박부소', '1357', '전방파트', '부소장').ok, 'TBM: 부소장 등록');
  NOW.d = new Date('2026-12-19T07:00:00+09:00'); const bu = login('1357', 't1', SIG);
  let g = tbmGet(bu.token);
  assert(g.ok && g.day === '2026-12-19' && !g.saved && g.manager.name === '박부소', 'TBM: 소장 없으면 부소장이 관리감독자');
  assert(g.works.length === 2 && g.works[0].work === '층별 전 공조기 구리스 주입' && g.works[0].dept === '기건파트', 'TBM: 작업 표 = 오늘 날짜의 명일 작업 예정');
  assert(g.risks.length === 18 && g.risks[0].fixes[0].on && !g.risks[0].fixes[2].on && g.risks[0].p === 2 && g.risks[0].s === 3, 'TBM: 위험성 목록 (✓ = 미리 체크)');
  NOW.d = new Date('2026-12-19T07:30:00+09:00'); const hong = login('1234', 't2', SIG);
  g = tbmGet(hong.token);
  assert(g.manager.name === '홍길동' && g.signs.slice(-2).map(s => s.name).join() === '박부소,홍길동' && g.signs.slice(-1)[0].role === '소장', 'TBM: 소장이 오면 소장 (부소장은 서명란에만)');
  const works = g.works.map(w => Object.assign({}, w, { risk: 'A형 사다리 미끄러짐·상부 균형 상실', kind: '떨어짐', p: 2, s: 3, fixes: ['2인 1조, 1명은 아래에서 사다리 지지', '직접 쓴 조치<script>'] }));
  assert(!tbmSavePdf(hong.token, 'data:application/pdf;base64,' + 'J'.repeat(200), []).ok, 'TBM: 저장 전 PDF 거부');
  assert(!tbmSave(hong.token, { works, meet: 'data:image/jpeg;base64,xx' }).ok, 'TBM: 망가진 사진 거부');
  let s = tbmSave(hong.token, { works, checks: { '사다리': true, '엉뚱': true }, meet: 'data:image/jpeg;base64,' + 'M'.repeat(3000) });
  assert(s.ok, 'TBM: 저장 (회의 사진 1장)');
  g = tbmGet(hong.token);
  assert(g.saved && g.works[0].fixes[1] === '직접 쓴 조치script' && g.works[0].p === 2 && JSON.stringify(g.checks) === '{"사다리":true}' && g.photos.meet && !g.photos.chant, 'TBM: 다시 열면 저장한 내용 · 체크 칸은 정해진 8개만');
  const meetId = readTable_('TBM').rows[0]['회의사진_id'];
  assert(files[meetId].name === '2026-12-19_TBM-회의사진_001.jpg', 'TBM: 사진 이름 ' + files[meetId].name);
  s = tbmSave(hong.token, { works, checks: {}, meet: 'data:image/jpeg;base64,' + 'N'.repeat(3000), chant: 'data:image/jpeg;base64,' + 'C'.repeat(3000) });
  assert(s.ok && files[meetId].trashed && readTable_('TBM').rows.length === 1, 'TBM: 사진 바꾸면 예전 사진 휴지통, 하루 한 줄');
  const ids = g.signs.map(x => x.id);
  let p = tbmSavePdf(hong.token, 'data:application/pdf;filename=generated.pdf;base64,' + 'J'.repeat(400), ids);
  assert(p.ok && files[p.pdf.id].name === '2026-12-19_TBM.pdf' && p.pdf.signs === ids.length, 'TBM: PDF 저장 ' + files[p.pdf.id].name);
  assert(files[p.pdf.id].sharing === 'ANYONE_WITH_LINK:VIEW' && !p.warn, 'TBM: PDF는 링크가 있는 사람 누구나 보기 (구글 로그인 없이 열림)');
  files[p.pdf.id].sharing = ''; CacheService.getScriptCache().remove('sh_' + p.pdf.id);   // 예전 판에서 만든(공유 안 된) PDF 흉내
  assert(tbmGet(hong.token).pdf.shared === true && files[p.pdf.id].sharing === 'ANYONE_WITH_LINK:VIEW', 'TBM: 공유 안 된 예전 PDF도 TBM을 열면 공유됨');
  global.NO_SHARE = true; files[p.pdf.id].sharing = ''; CacheService.getScriptCache().remove('sh_' + p.pdf.id);
  assert(tbmGet(hong.token).pdf.shared === false, 'TBM: 공유가 실제로 안 바뀌면 shared=false (화면에 빨간 안내)');
  global.NO_SHARE = false;
  assert(readTable_('서명').rows.filter(r => ids.indexOf(r['sign_id']) !== -1).every(r => r['TBM사용'] === 'Y'), 'TBM: PDF에 쓰인 서명은 TBM사용=Y');
  const first = p.pdf.id;
  p = tbmSavePdf(hong.token, 'data:application/pdf;base64,' + 'K'.repeat(400), ids);
  assert(p.ok && files[first].trashed && tbmGet(hong.token).pdf.id === p.pdf.id, 'TBM: 다시 누르면 새 PDF, 예전 PDF 휴지통');
  assert(!tbmSave(hong.token, { works: new Array(31).fill({}) }).ok, 'TBM: 작업 표 30줄까지');
}
// 점검 1·3·4·5·8 (결정 74)
{
  const { files: F } = require('./mock_env.js');
  // 1) 기기 번호를 바꿔 가며 틀려도 전체 30번이면 모두 10분 막음
  NOW.d = new Date('2026-12-20T09:00:00+09:00'); CacheService.getScriptCache().remove('pinfail_all');   // 앞 시험에서 틀린 횟수 지움 (가짜 캐시는 10분이 지나도 안 사라짐)
  for (let i = 0; i < 29; i++) login('0000', 'atk' + i);
  assert(login('1234', 'ok1', SIG).ok, '점검1: 29번 틀려도 아직 로그인됨');
  login('0000', 'atk-last');
  const blocked = login('1234', 'ok2', SIG);
  assert(!blocked.ok && /모든 로그인/.test(blocked.error), '점검1: 기기를 바꿔 가며 30번 틀리면 맞는 PIN도 10분 막음');
  CacheService.getScriptCache().remove('pinlock_all');
  const hong = login('1234', 'ok3', SIG); assert(hong.ok, '점검1: 잠금 풀리면 다시 로그인');
  // 3) 서명 그림은 한 번 읽으면 기억
  let reads = 0; const orig = DriveApp.getFileById; DriveApp.getFileById = id => { reads++; return orig(id); };
  tbmGet(hong.token); const r1 = reads; tbmGet(hong.token);
  assert(r1 > 0 && reads === r1, '점검3: 두 번째 열 때는 서명 그림을 드라이브에서 다시 읽지 않음 (' + r1 + '번 → +' + (reads - r1) + ')');
  DriveApp.getFileById = orig;
  // 4) 위험성목록이 이미 있으면 다시 넣지 않음
  tbmGet(hong.token); assert(readTable_('위험성목록').rows.length === 18, '점검4: 위험성 목록 18줄 그대로');
  // 5) 새 줄 쓰는 중 오류 → 예전 줄은 남음
  const nw = nextWorkGet(hong.token, '2026-12-19');
  const realAppend = sheets['명일작업'].appendRow; let k = 0;
  sheets['명일작업'].appendRow = v => { if (++k === 2) throw new Error('Service timed out'); realAppend(v); };
  let threw5 = false; try { nextWorkSave(hong.token, '2026-12-19', nw.rows.concat(nw.rows), nw.ver); } catch (e) { threw5 = true; }
  sheets['명일작업'].appendRow = realAppend;
  assert(threw5 && nextWorkGet(hong.token, '2026-12-19').rows.length >= nw.rows.length, '점검5: 저장 중 시트 오류여도 예전 작업 줄이 남음');
  // 8) 서명 탭이 길어도 맨 아래만 읽어 오늘 서명을 찾음
  const sg = sheets['서명'].rows; const filler = sg[1].slice(); filler[1] = "'2026-01-01";
  const before = sg.length; for (let i = 0; i < 500; i++) sg.splice(1, 0, filler.slice());
  const today = tbmGet(hong.token).signs;
  assert(today.length >= 1 && today.every(s => s.name) && bootstrap(hong.token).docs.signs === today.length, '점검8: 서명 ' + (before + 500) + '줄이어도 오늘 서명을 찾음');
}
// 로딩 개선 (결정 76): 메인 소화기 숫자 1분 기억, 등록·삭제·점검하면 바로 새로
{
  NOW.d = new Date('2026-12-21T09:00:00+09:00'); CacheService.getScriptCache().remove('pinlock_all');
  const h = login('1234', 'fc1', SIG); const n0 = bootstrap(h.token).fire.counts.total;
  feAdd(h.token, { floor: '1F', store: '기억시험', count: 1 });
  assert(bootstrap(h.token).fire.counts.total === n0 + 1, '결정76: 소화기 등록하면 메인 숫자 바로 바뀜');
  const fe = feList(h.token).items.find(i => i.store === '기억시험');
  checkSubmit(fe.token, { photo: 'data:image/jpeg;base64,' + 'A'.repeat(4000), signA: 'data:image/png;base64,' + 'B'.repeat(800), signB: 'data:image/png;base64,' + 'B'.repeat(800), state: '이상없음' });
  const c = bootstrap(h.token).fire.counts; assert(c.ok + c.bad >= 1 && c.total === n0 + 1, '결정76: 점검 입력하면 메인 숫자 바로 바뀜');
  feAdd(h.token, { floor: '1F', store: '기억시험2', count: 1 }); const fe2 = feList(h.token).items.find(i => i.store === '기억시험2');
  assert(bootstrap(h.token).fire.counts.total === n0 + 2, '결정76: 하나 더 등록');
  feDelete(h.token, [fe2.id]); assert(bootstrap(h.token).fire.counts.total === n0 + 1, '결정76: 점검 안 한 소화기 삭제하면 바로 빠짐');
}
// 앱 속도 (결정 78): 직원 목록 1분 기억, 등록하면 바로 새로 · 소화기 등록이 목록도 돌려줌 · 저장 + PDF 한 번에
{
  NOW.d = new Date('2026-12-22T09:00:00+09:00'); CacheService.getScriptCache().remove('pinlock_all');
  const h = login('1234', 'sp1', SIG); auth_(h.token);
  assert(CacheService.getScriptCache().get('staff'), '결정78: 직원 목록을 기억함');
  assert(addStaff_('새직원', '8642', '기건파트', '직원').ok && login('8642', 'sp2', SIG).ok, '결정78: 직원 등록하면 기억을 지워 바로 로그인됨');
  const a = feAdd(h.token, { floor: '2F', store: '목록시험', count: 1 });
  assert(a.ok && a.added.length === 1 && a.items.some(i => i.store === '목록시험') && a.label, '결정78: 소화기 등록이 새 목록도 돌려줌');
  const g = tbmGet(h.token);
  const p = tbmSavePdf(h.token, 'data:application/pdf;base64,' + 'P'.repeat(400), g.signs.map(x => x.id), { works: [{ place: '1층', work: '한번에 저장', dept: '전방파트' }], checks: {}, meet: 'data:image/jpeg;base64,' + 'Q'.repeat(3000) });
  const g2 = tbmGet(h.token);
  assert(p.ok && g2.works[0].work === '한번에 저장' && g2.photos.meet && g2.pdf.id === p.pdf.id, '결정78: [PDF로 저장]이 저장까지 한 번에');
}

// 점검 결과 고침 (결정 80)
{
  const { files: F } = require('./mock_env.js');
  const cache = CacheService.getScriptCache();
  // PIN 전체 잠금: 6시간 안에 3번째 잠금부터 1시간
  NOW.d = new Date('2026-12-23T09:00:00+09:00'); cache.remove('pinfail_all'); cache.remove('pinlock_all'); cache.remove('pinlock_cnt');
  const lockOnce = () => { for (let i = 0; i < 30; i++) login('0000', 'b' + i); };
  lockOnce(); const m1 = login('1234', 'x1', SIG).error; cache.remove('pinlock_all');
  lockOnce(); cache.remove('pinlock_all');
  lockOnce(); const m3 = login('1234', 'x3', SIG).error;
  assert(/10분 동안 모든 로그인/.test(m1) && /60분 동안 모든 로그인/.test(m3), '결정80: 첫 잠금 10분, 6시간 안 3번째 잠금은 1시간 (' + m3 + ')');
  cache.remove('pinlock_all'); cache.remove('pinlock_cnt');
  const h = login('1234', 'x4', SIG); assert(h.ok, '결정80: 잠금이 풀리면 다시 로그인');
  // 앱 연결 키는 로그인 비밀키와 따로
  const P = PropertiesService.getScriptProperties();
  const lk = P.getProperty('LINK_KEY');
  assert(lk && lk !== P.getProperty('HUB_KEY'), '결정80: 앱 연결 키(LINK_KEY)가 로그인 비밀키와 다름');
  global.ContentService = { MimeType: { JSON: 1 }, createTextOutput: t => ({ getContent: () => t, setMimeType() { return this; } }) };
  assert(!JSON.parse(api_({ api: 'summary', key: P.getProperty('HUB_KEY') }).getContent()).ok, '결정80: 로그인 비밀키로는 요약을 못 받음');
  assert(JSON.parse(api_({ api: 'summary', key: lk }).getContent()).ok, '결정80: 연결 키로 요약 받음');
  P.setProperty('LINK_KEY', 'new-key'); assert(auth_(h.token), '결정80: 연결 키를 바꿔도 로그인 표는 그대로');
  // 다시 입력할 때 새 파일 저장이 실패하면 옛 파일은 휴지통에 가지 않음
  const fe = feList(h.token).items[0];
  const pic = 'data:image/jpeg;base64,' + 'A'.repeat(4000), sg = 'data:image/png;base64,' + 'B'.repeat(800);
  checkSubmit(fe.token, { photo: pic, signA: sg, signB: sg, state: '이상없음', overwrite: true });
  const trashed0 = Object.values(F).filter(f => f.trashed).length;
  const realSave = saveBlob_; let n = 0;
  globalThis.saveBlob_ = function () { if (++n === 2) throw new Error('Drive 오류'); return realSave.apply(null, arguments); };
  let threw = false; try { checkSubmit(fe.token, { photo: pic, signA: sg, signB: sg, state: '이상없음', overwrite: true }); } catch (e) { threw = true; }
  globalThis.saveBlob_ = realSave;
  assert(threw && Object.values(F).filter(f => f.trashed).length === trashed0, '결정80: 새 파일 저장 중 오류면 옛 점검 사진은 그대로');
  assert(checkSubmit(fe.token, { photo: pic, signA: sg, signB: sg, state: '이상없음', overwrite: true }).ok && Object.values(F).filter(f => f.trashed).length === trashed0 + 3, '결정80: 성공하면 그때 옛 파일 3개 휴지통');
  // 밖에서 부를 수 있는 함수(이름이 _로 안 끝남)는 정한 것만 — 시트 메뉴·예약 함수는 모두 _
  const pub = [...fs.readFileSync(require('path').join(__dirname, '..', 'src', 'Code.gs'), 'utf8').matchAll(/^function\s+([A-Za-z0-9$]+)\s*\(/gm)].map(m => m[1]).filter(x => !/_$/.test(x));
  const ALLOWED = ['onOpen', 'doPost', 'doGet', 'include', 'login', 'signToday', 'bootstrap', 'tbmGet', 'tbmSave', 'tbmSavePdf', 'nextWorkGet', 'nextWorkSave', 'attGet', 'attPut', 'attFix', 'attHoliday', 'feList', 'feAdd', 'feDelete', 'labelSave', 'feStatus', 'feDetail', 'checkInit', 'checkSubmit'];
  const extra = pub.filter(x => ALLOWED.indexOf(x) === -1);
  assert(!extra.length, '결정80: 밖에서 부를 수 있는 함수는 화면용으로 정한 것만 ' + extra.join(', '));
}

// 직원 삭제 (결정 86): 사용여부 N, 줄은 남김, 바로 로그인·기기 표 막힘, PIN 다시 쓸 수 있음, 같은 이름은 staff_id로
{
  NOW.d = new Date('2026-12-23T09:00:00+09:00'); CacheService.getScriptCache().remove('pinlock_all');
  assert(addStaff_('삭제시험', '9753', '기건파트', '직원').ok, '결정86: 지울 직원 등록');
  const lg = login('9753', 'del1', SIG); assert(lg.ok && auth_(lg.token), '결정86: 지우기 전 로그인됨');
  const f = findStaff_('삭제시험'); assert(f.ok, '결정86: 이름으로 찾음');
  const n0 = readTable_('직원').rows.length;
  assert(removeStaff_(f.staff['staff_id']).ok, '결정86: 삭제');
  const row = readTable_('직원').rows.filter(r => r['staff_id'] === f.staff['staff_id'])[0];
  assert(readTable_('직원').rows.length === n0 && row['사용여부'] === 'N', '결정86: 줄은 남기고 사용여부만 N');
  assert(!login('9753', 'del2', SIG).ok, '결정86: 삭제한 직원은 PIN 로그인 안 됨');
  let blocked = false; try { blocked = !auth_(lg.token); } catch (e) { blocked = true; }
  assert(blocked, '결정86: 쓰던 기기 표도 바로 막힘');
  assert(!removeStaff_(f.staff['staff_id']).ok && !findStaff_('삭제시험').ok, '결정86: 이미 지운 직원은 다시 못 찾음');
  assert(addStaff_('새삭제시험', '9753', '전방파트', '직원').ok, '결정86: 지운 직원의 PIN은 다시 쓸 수 있음');
  assert(addStaff_('같은이름', '1470', '전방파트', '직원').ok && addStaff_('같은이름', '2580', '기건파트', '직원').ok, '결정86: 같은 이름 둘 등록');
  const twin = findStaff_('같은이름'); assert(!twin.ok && /staff_id/.test(twin.error), '결정86: 같은 이름이면 staff_id로 고르라고 함');
  const sid = readTable_('직원').rows.filter(r => r['이름'] === '같은이름')[1]['staff_id'];
  assert(findStaff_(sid.toLowerCase()).ok && findStaff_(sid).staff['파트명'] === '기건파트', '결정86: staff_id(소문자도)로 찾음');
}

// 출근현황 (WS_출근현황 15.3.19, 결정 88) — 가짜 이름만 씀 (실제 직원 이름은 저장소에 올리지 않음)
{
  NOW.d = new Date('2026-11-07T09:00:00+09:00'); CacheService.getScriptCache().remove('pinlock_all');
  const tk = (n, pin) => { addStaff_(n, pin, '시험파트', '직원'); return login(pin, 'at-' + n, SIG).token; };
  const boss = login('1234', 'at-boss', SIG).token;   // 홍길동 = 직원 탭 역할 소장
  const chong = tk('총무가짜', '3101'), night = tk('야간가짜', '3102'), day = tk('주간가짜', '3103');
  const D = (fill, set) => { const a = Array(30).fill(fill); Object.keys(set || {}).forEach(k => a[k - 1] = set[k]); return a; };
  const ROWS = [
    { sec: '관리', role: '소장', name: '홍길동', days: D('', { 1: '휴' }) },
    { sec: '관리', role: '총무', name: '총무가짜', days: D('') },
    { sec: '전기방재', role: '교대', name: '야간가짜', days: D('', { 7: '야', 8: '비' }) },
    { sec: '전기방재', role: '기사', name: '주간가짜', days: D('', { 8: 'A반' }) },
    { sec: '기계건축', role: '기사', name: '', days: D('') },
    { sec: '기계건축', role: '주임', name: '병가가짜', days: D('병가') }
  ];
  let g = attGet(boss, '2026-11-07');
  assert(g.ok && g.people.length === 0 && g.canBoss && !g.canFix, '결정88: 올리기 전엔 빈 화면, 소장은 올릴 수 있음');
  assert(!attPut(day, '2026-11', ROWS).ok, '결정88: 대표가 아닌 직원은 엑셀 못 올림');
  assert(!attPut(chong, '2026-13', ROWS).ok, '결정88: 잘못된 달 거부');
  const XL = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + 'A'.repeat(400);
  assert(attPut(chong, '2026-11', ROWS, XL).count === 6, '결정88: 총무(엑셀 직책)는 처음 올리기 가능 · 6줄');
  assert(Object.values(files).some(f => f.name === '2026-11_근무스케줄.xlsx'), '결정88: 원본 엑셀 드라이브 보관');
  g = attGet(day, '2026-11-07');
  const v = n => g.people.find(x => x.name === n).v;
  assert(g.people.length === 6 && g.people[4].name === '' && v('야간가짜') === '야' && v('병가가짜') === '병가', '결정88: 7일 상태 · 공석 줄');
  assert(g.ju[6] === 3 && g.ju[7] === 3 && g.ju[0] === 3, '결정88: 주간 인원 = 출근·A반 (병가·야·휴 빼고) ' + g.ju.slice(0, 8));
  assert(g.months.join() === '2026-11' && g.upBy === '총무가짜', '결정88: 달 목록 · 올린 사람');
  assert(!g.canFix && !g.canBoss, '결정88: 주간 직원은 못 고침');
  assert(attGet(night, '2026-11-07').canFix && attGet(night, '2026-11-08').canFix && !attGet(night, '2026-11-10').canFix, '결정88: 야간 근무자는 그날·다음 날 아침만 고침');
  assert(!attFix(day, '2026-11-07', '주간가짜', '휴').ok, '결정88: 권한 없으면 고치기 거부');
  assert(!attFix(night, '2026-11-07', '주간가짜', 'X').ok && !attFix(night, '2026-11-07', '없는사람', '휴').ok, '결정88: 없는 상태·이름 거부');
  g = attFix(night, '2026-11-07', '주간가짜', '휴');
  const p = g.people.find(x => x.name === '주간가짜');
  assert(g.ok && p.v === '휴' && p.raw === '' && p.fix.by === '야간가짜', '결정88: 야간 근무자가 그날 상태 고침');
  assert(readTable_('근무변경').rows.length === 1 && readTable_('근무변경').rows[0]['날짜'] === '2026-11-07', '결정88: 근무변경 줄 (날짜 글자 그대로)');
  assert(attPut(boss, '2026-11', ROWS).ok && readTable_('근무표').rows.filter(r => r['삭제여부'] === 'Y').length === 6, '결정88: 같은 달 다시 올리면 예전 줄 삭제여부 Y');
  assert(attGet(day, '2026-11-07').people.find(x => x.name === '주간가짜').v === '휴', '결정88: 다시 올려도 고친 값 유지');
  assert(attFix(chong, '2026-11-07', '주간가짜', '(되돌림)').people.find(x => x.name === '주간가짜').v === '', '결정88: 엑셀 값으로 되돌리기');
  assert(!attHoliday(day, '주간가짜', ['토']).ok, '결정88: 기본 휴일은 대표만');
  g = attHoliday(chong, '주간가짜', ['일', '토', '토', 'X'], '2026-11-07');
  const q = g.people.find(x => x.name === '주간가짜');
  assert(g.ok && q.hol === '일,토' && q.v === '휴', '결정88: 기본 휴일 토·일 → 빈 칸인 토요일(7일)은 휴');
  assert(attGet(day, '2026-11-08').people.find(x => x.name === '주간가짜').v === 'A반', '결정88: 엑셀에 값이 있으면(8일 A반) 엑셀 값이 먼저');
  assert(attHoliday(boss, '주간가짜', [], '2026-11-07').people.find(x => x.name === '주간가짜').v === '', '결정88: 기본 휴일 비우면 다시 출근');
  assert(attGet(day, '').date === '2026-11-07', '결정88: 날짜 비우면 오늘 근무일');
}
