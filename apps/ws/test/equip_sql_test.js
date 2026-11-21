// 소화전·공기호흡기 점검 DB 시험 (supabase/23_fire_equip.sql, 결정 224) — PGlite(작은 PostgreSQL)에서 실제 함수를 돌림
// 쓰는 법: node test/equip_sql_test.js   (끝에 「소화전·공기호흡기 SQL 시험 통과」)
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const BASE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
grant usage on schema public, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const q = (s, p) => db.query(s, p).then(r => r.rows);
  const one = async (s, p) => (await q(s, p))[0];
  const as = async (role, s, p) => { await db.exec('set role ' + role); try { return await q(s, p); } finally { await db.exec('reset role'); } };
  const asErr = async (role, s, p) => { try { await as(role, s, p); return ''; } catch (e) { await db.exec('reset role'); return e.message; } };
  const J = JSON.stringify;
  const call = async (role, fn, args) => (await as(role, 'select ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') r', args))[0].r;
  const auth = (fn, args) => call('authenticated', fn, args);
  const anon = (fn, args) => call('anon', fn, args);

  // where 없는 update·delete 금지 (진짜 Supabase 규칙)
  const bare = (SQL('23_fire_equip.sql').replace(/--[^\n]*/g, '').match(/(?<!do |for |to |on conflict[^;]*)\b(update\s+(public|only|storage)\.\w+\b|delete\s+from)\b[^;]*;/gi) || []).filter(s => !/\bwhere\b/i.test(s));
  ok(!bare.length, 'where 없는 update·delete 없음 ' + bare.join(' / '));

  await db.exec(BASE);
  for (const f of ['01_schema_rls.sql', '02_login.sql', '03_docs.sql', '05_fire.sql', '06_eh.sql']) await db.exec(SQL(f));
  await db.exec(SQL('23_fire_equip.sql')); await db.exec(SQL('23_fire_equip.sql'));
  ok(true, '23_fire_equip.sql 실행됨 (두 번)');

  await q("insert into staff (staff_id, name, part, role, pin_salt, pin_hash) values ('S001','홍길동','전방파트','소장','saltS001',$1)", [sha('saltS001' + '1234')]);
  const lg = (await as('authenticated', "select ws_login('1234','devA','https://x/sign/2026-11/a.png','sign/2026-11/a.png') r"))[0].r;
  const tk = lg.token;
  ok(/^S001\./.test(tk), '로그인 표 받음');

  // ── 보안 ──
  ok(/permission denied/.test(await asErr('anon', "select ws_eq_list('x','hyd')")), '비로그인: 목록 못 부름');
  ok(/permission denied/.test(await asErr('anon', "select ws_eq_open('x','abcdefghjkmn')")), '비로그인: 입력 열기(ws_eq_open) 못 부름');
  ok(/permission denied/.test(await asErr('anon', "select ws_eq_submit('x','abcdefghjkmn','{}','{}')")), '비로그인: 저장 못 함');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_eq_status_('2026-11')")), '로그인 기기: 도우미(ws_eq_status_) 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', 'select * from fire_equip')) && /permission denied/.test(await asErr('anon', 'select * from fire_equip_checks')), '장비·점검 표는 직접 못 읽음');
  ok(/LOGIN/.test(await asErr('authenticated', "select ws_eq_list('틀린표','hyd')")), '틀린 표 → LOGIN');

  // ── 등록 ──
  ok((await auth('ws_eq_add', [tk, J({ kind: 'x', floor: '3F', place: 'a' })])).error === '종류를 골라 주세요.', '등록: 종류 없음 → 안내');
  ok((await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '9F', place: 'a' })])).error === '층을 골라 주세요.', '등록: 없는 층 → 안내');
  ok(/위치를 적어/.test((await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '3F', place: '   ' })])).error), '등록: 위치 비면 → 안내');
  let L = await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '3F', place: ' 동측  계단 앞 ' })]);
  ok(L.ok && L.added === '3F 동측 계단 앞 소화전' && L.items.length === 1 && /^[2-9a-km-np-z]{12}$/.test(L.items[0].token) && /^WS-EQ-\d{8}-001$/.test(L.items[0].id), '소화전 등록: 이름 「층 위치 소화전」·12자리·번호 ' + L.items[0].id);
  ok((await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '3F', place: '동측 계단 앞' })])).error === '이미 등록된 위치입니다: 3F 동측 계단 앞 소화전', '같은 위치 다시 등록 → 안내');
  L = await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '2F', place: '서측 복도' })]);
  const A = await auth('ws_eq_add', [tk, J({ kind: 'air', floor: '2F', place: '방재실 1' })]);
  ok(A.ok && A.items.length === 1 && A.items[0].name === '2F 방재실 1 공기호흡기', '공기호흡기 등록은 따로 목록');
  ok(L.items.length === 2 && L.items[0].floor === '2F' && L.items[1].floor === '3F', '목록은 층 순서 · 종류별로 따로');
  ok(L.execUrl === '' && L.label.w === 50, 'QR 주소 비어 있음(화면이 채움) · 라벨 기본 50mm');
  const H3 = L.items.find(x => x.floor === '3F'), H2 = L.items.find(x => x.floor === '2F'), AIR = A.items[0];

  // ── QR 열기 ──
  let o = await auth('ws_eq_open', [tk, H3.token]);
  ok(o.ok && o.me === '홍길동' && o.eq.name === '3F 동측 계단 앞 소화전' && o.eq.kind === 'hyd' && o.eq.kindName === '소화전' && o.spec.map(s => s.k).join() === 'ext,leak,clean' && o.exists === false && o.photo.w === 640, '로그인 열기: 점검자 = 내 이름, 항목 3개 · 이번 달 없음');
  const oa = await auth('ws_eq_open', [tk, AIR.token]);
  ok(oa.spec.map(s => s.k).join() === 'charge,reg,ext' && oa.spec[0].gauge === true && oa.spec[1].gauge === true && !oa.spec[2].gauge, '공기호흡기 항목: 충전량·압력조절기(압력계 원)·외관');
  ok((await auth('ws_eq_open', [tk, 'zzzzzzzzzzzz'])).ok === false, '없는 QR → 안내');

  // ── 지난 점검 표(로그인 안 함) — 아직 기록 없음 ──
  let pub = await anon('ws_eq_pub', [H3.token]);
  ok(pub.ok && pub.rows.length === 1 && pub.rows[0].ym === o.ym && /^(wait|miss)$/.test(pub.rows[0].state) && pub.eq.name === '3F 동측 계단 앞 소화전', '로그인 안 함: 이번 달 한 줄(점검 전/미입력)');
  ok((await anon('ws_eq_pub', ['zzzzzzzzzzzz'])).ok === false, '로그인 안 함: 없는 QR → 안내');

  // ── 저장 ──
  const ymk = o.ym, PUB = 'https://x.supabase.co/storage/v1/object/public/ws-files/';
  const F = (qr, n) => { const p = 'equip/' + qr + '/' + ymk + '/' + n + '.jpg'; return { path: p, url: PUB + p }; };
  const files3 = qr => J({ ext: F(qr, 'a1'), leak: F(qr, 'a2'), clean: F(qr, 'a3') });
  ok(/사진이 비어/.test((await auth('ws_eq_submit', [tk, H3.token, J({}), '{}'])).error), '저장: 사진 없으면 거부');
  const part = J({ ext: F(H3.token, 'b1'), leak: F(H3.token, 'b2') });
  const miss = await auth('ws_eq_submit', [tk, H3.token, J({}), part]);
  ok(/청소 상태 사진이 비어/.test(miss.error), '저장: 빠진 항목 이름을 알려 줌 (' + miss.error + ')');
  ok(/사진이 비어/.test((await auth('ws_eq_submit', [tk, H3.token, J({}), J({ ext: F(H2.token, 'c1'), leak: F(H2.token, 'c2'), clean: F(H2.token, 'c3') })])).error), '저장: 다른 장비 경로의 사진은 거부');
  ok(/사진이 비어/.test((await auth('ws_eq_submit', [tk, H3.token, J({}), J({ ext: F(H3.token, 'p').path.replace('.jpg', '.png') && { path: 'equip/' + H3.token + '/' + ymk + '/p.png', url: PUB + 'equip/' + H3.token + '/' + ymk + '/p.png' }, leak: F(H3.token, 'p2'), clean: F(H3.token, 'p3') })])).error), '저장: jpg 아닌 사진 거부');
  ok((await auth('ws_eq_submit', [tk, 'zzzzzzzzzzzz', '{}', '{}'])).ok === false, '저장: 없는 QR → 안내');
  const memoLong = '배관 이음부에서 물방울이 계속 떨어짐' + '가'.repeat(80);
  let s1 = await auth('ws_eq_submit', [tk, H3.token, J({ items: { ext: { bad: false, memo: '지워져야 함' }, leak: { bad: true, memo: memoLong }, clean: { bad: false } } }), files3(H3.token)]);
  ok(s1.ok && s1.state === '이상있음' && s1.by === '홍길동' && /^WS-EC-\d{8}-001$/.test(s1.checkId), '소화전 저장: 이상 1개 → 이상있음 · 점검자 = 홍길동 · 번호 ' + s1.checkId);
  const row = await one('select items, checker, late, overwrite_count from fire_equip_checks');
  ok(row.items.length === 3 && row.items[0].bad === false && row.items[0].memo === '' && row.items[1].bad === true && row.items[1].memo.length === 60 && row.checker === '홍길동', '항목 저장: 정상 칸 이상내용 지움 · 긴 이상내용 60자로 · 점검자');
  const ff = await q("select kind, file_name, drive_folder, created_by from files where kind like 'equip_%' order by kind");
  ok(ff.length === 3 && ff[0].file_name.endsWith('_소화전점검-3F-동측-계단-앞-소화전_clean.jpg') && ff[0].drive_folder === '소화전점검/' + ymk && ff[0].created_by === '홍길동', '사진 파일 3개 이름·폴더·올린 사람 ' + ff[0].file_name);
  const again = await auth('ws_eq_submit', [tk, H3.token, J({ items: {} }), files3(H3.token)]);
  ok(again.ok === false && again.exists === true, '같은 달 다시 저장 → 「이미 있음」(덮어쓰기 확인)');
  const s2 = await auth('ws_eq_submit', [tk, H3.token, J({ overwrite: true, items: { ext: { bad: false }, leak: { bad: false }, clean: { bad: false } } }), files3(H3.token)]);
  ok(s2.ok && s2.state === '이상없음' && s2.checkId === s1.checkId && (await one('select overwrite_count n from fire_equip_checks')).n === 1, '덮어쓰기: 같은 번호 · 이상없음으로 · 덮어쓴횟수 1');
  const sa = await auth('ws_eq_submit', [tk, AIR.token, J({ items: { charge: { bad: false }, reg: { bad: true, memo: '게이지 흔들림' }, ext: { bad: false } } }), J({ charge: F(AIR.token, 'd1'), reg: F(AIR.token, 'd2'), ext: F(AIR.token, 'd3') })]);
  ok(sa.ok && sa.state === '이상있음' && /-002$/.test(sa.checkId), '공기호흡기 저장 → 번호 이어서 ' + sa.checkId);
  ok((await q("select drive_folder from files where kind = 'equip_charge'"))[0].drive_folder === '공기호흡기점검/' + ymk, '공기호흡기 사진 폴더 「공기호흡기점검/연월」');
  ok((await one("select count(*)::int n from change_log where what like '%점검 입력%' or what like '%다시 입력%'")).n === 3, '기록(change_log) 남김');
  ok((await asErr('authenticated', "insert into storage.objects (bucket_id, name) values ('ws-files', 'equip/" + H3.token + "/" + ymk + "/z.jpg')")) === '', '로그인 기기는 장비 사진 경로에 올릴 수 있음');
  ok(/row-level security/.test(await asErr('anon', "insert into storage.objects (bucket_id, name) values ('ws-files', 'equip/" + H3.token + "/" + ymk + "/z.jpg')")), '비로그인은 올리기 막힘');

  // ── 현황 · 입력 내용 ──
  const st = await auth('ws_eq_status', [tk, '']);
  const c = st.counts;
  ok(st.ok && st.items.length === 3 && c.total === 3 && c.ok === 1 && c.bad === 1 && (c.wait + c.miss) === 1, '현황: 소화전 2 + 공기호흡기 1 → 완료 1 · 이상 1 · 전/미입력 1 ' + J(c));
  ok(st.items.every((x, i, a) => !i || a[i - 1].floor <= x.floor) && st.items.find(x => x.id === AIR.id).kind === 'air' && st.items.find(x => x.id === AIR.id).by === '홍길동' && st.items[0].token, '현황: 층 순서 · 종류 · 점검자 · QR 고유번호');
  ok(st.months.length >= 1 && st.window.end === 5, '현황: 월 목록 · 입력 기간 1~5일');
  ok(st.items.find(x => x.id === H3.id).late === (st.day > 5), '기한 후 표시 = 마감일(5일) 지난 날 입력');
  const dt = await auth('ws_eq_detail', [tk, sa.checkId]);
  ok(dt.ok && dt.kindName === '공기호흡기' && dt.by === '홍길동' && dt.items.length === 3 && dt.items[1].bad === true && dt.items[1].text === '이상' && dt.items[1].memo === '게이지 흔들림' && /^https:.*d2\.jpg$/.test(dt.items[1].photo), '입력 내용: 항목·정상/이상 글·이상 내용·사진 주소');
  ok((await auth('ws_eq_detail', [tk, 'nothing'])).ok === false, '없는 점검번호 → 안내');
  const prev = await auth('ws_eq_status', [tk, '2020-01']);
  ok(prev.ok && prev.items.length === 0 && prev.counts.total === 0, '옛 달: 그때 없던 장비는 안 보임');

  // ── 로그인 안 한 표 ──
  pub = await anon('ws_eq_pub', [AIR.token]);
  const r0 = pub.rows[0], txt = J(pub);
  ok(pub.ok && r0.state === 'bad' && r0.by === '홍*동' && r0.items.length === 3 && r0.items[1].bad === true && r0.items[1].memo === '게이지 흔들림' && /^\d\d-\d\d$/.test(r0.day), '로그인 안 함 표: 상태·점검자 이름 가림(홍*동)·이상 내용');
  ok(!/https?:|photo|홍길동/.test(txt), '로그인 안 함 표: 사진 주소·점검자 실명은 안 내려감');
  ok(JSON.stringify(['홍길동', '남궁민수', '김수', '박'].map(n => n)) && (await one("select ws_mask_name('홍길동') a, ws_mask_name('남궁민수') b, ws_mask_name('김수') c, ws_mask_name('박') d, ws_mask_name('') e")).b === '남**수', '이름 가리기: 3글자 홍*동 · 4글자 남**수 · 2글자 김*');

  // ── 지운 뒤 ──
  const dl = await auth('ws_eq_delete', [tk, J([H2.id, 'nothing']), 'hyd']);
  ok(dl.count === 1 && dl.items.length === 1 && dl.items[0].id === H3.id, '삭제: 목록에서 빠짐 (소화전 목록만 돌려줌)');
  ok((await auth('ws_eq_delete', [tk, '[]', 'hyd'])).ok === false, '삭제: 고른 것 없음 → 안내');
  ok((await auth('ws_eq_open', [tk, H2.token])).ok === false && (await anon('ws_eq_pub', [H2.token])).ok === false, '삭제한 장비 QR → 「삭제된 QR」');
  ok((await auth('ws_eq_status', [tk, ''])).items.length === 2, '삭제한 장비는 이번 달 현황에서 빠짐 (기록 없던 장비)');
  const re = await auth('ws_eq_add', [tk, J({ kind: 'hyd', floor: '2F', place: '서측 복도' })]);
  ok(re.ok && re.items.some(x => x.floor === '2F' && x.token !== H2.token), '삭제한 위치는 다시 등록할 수 있음 (새 QR)');
  ok(Number((await one("select count(*)::int n from fire_equip where qr_token is not null")).n) === 4, '고유번호는 장비마다 따로 (겹침 없음)');

  console.log(fail ? '\n실패 ' + fail + '개' : '\n소화전·공기호흡기 SQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
