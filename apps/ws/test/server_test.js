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
  const tb = tbmToday(hong.token);
  assert(tb.ok && tb.day === '2026-12-10' && tb.signs.map(x => x.name).join() === '이영희,김철수,홍길동', 'TBM 서명란 = 로그인 순, 파트 섞임: ' + tb.signs.map(x => x.name + x.at).join(' '));
  assert(tb.signs[0].at === '06:20' && tb.signs[0].img.indexOf('data:image/png;base64,') === 0, '서명 아래 시각 · 그림');
  const bs = bootstrap(hong.token); assert(!bs.needSign && bs.docs.signs === 3, '메인: 오늘 서명 3명');
  // 시트에서 오늘 서명 줄을 지운 경우 → needSign → signToday
  const t = readTable_('서명'); const mine = t.rows.find(r => r['근무일'] === '2026-12-10' && r['이름'] === '홍길동');
  updateRow_('서명', mine._row, { '삭제여부': 'Y' });
  assert(bootstrap(hong.token).needSign, '표는 있는데 오늘 서명 없으면 needSign');
  assert(!signToday(hong.token, 'x').ok && signToday(hong.token, SIG).ok && !bootstrap(hong.token).needSign, 'signToday 로 서명 채움');
  assert(tbmToday(hong.token).signs.slice(-1)[0].name === '홍길동', '다시 쓴 서명은 그 시각 순서로');
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
