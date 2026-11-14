// Supabase 이관 SQL 시험 — PGlite(작은 PostgreSQL)에 Supabase 비슷한 틀(역할·auth·storage)을 만들고
// supabase/01_schema_rls.sql · 02_login.sql · 03_docs.sql · 04_attendance.sql 을 그대로 돌려 로그인 규칙을 확인. 진짜 Supabase에는 아무것도 보내지 않음.
// 쓰는 법: node test/sql_test.js   (끝에 「SQL 시험 통과」)
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Supabase 기본 틀 흉내: 역할 3개, auth.users, storage.buckets/objects, 새 표·함수의 기본 권한
const BASE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const q = (s, p) => db.query(s, p).then(r => r.rows);
  const one = async (s, p) => (await q(s, p))[0];
  const err = async (s, p) => { try { await q(s, p); return ''; } catch (e) { return e.message; } };
  const as = async (role, s, p) => { await db.exec('set role ' + role); try { return await q(s, p); } finally { await db.exec('reset role'); } };
  const asErr = async (role, s, p) => { try { await as(role, s, p); return ''; } catch (e) { await db.exec('reset role'); return e.message; } };

  await db.exec(BASE);
  await db.exec(SQL('01_schema_rls.sql'));
  ok(true, '01_schema_rls.sql 실행됨');
  await db.exec(SQL('01_schema_rls.sql'));
  ok(true, '01 다시 실행해도 오류 없음');
  await db.exec(SQL('02_login.sql'));
  await db.exec(SQL('02_login.sql'));
  ok(true, '02_login.sql 실행됨 (두 번)');

  // 직원: 홍길동(소장 1234) · 김철수(직원 5678) · 이영희(직원 2468)
  for (const [id, name, part, role, pin] of [['S001', '홍길동', '전방파트', '소장', '1234'], ['S002', '김철수', '기건파트', '직원', '5678'], ['S003', '이영희', '전방파트', '직원', '2468']])
    await q('insert into staff (staff_id, name, part, role, pin_salt, pin_hash) values ($1,$2,$3,$4,$5,$6)', [id, name, part, role, 'salt' + id, sha('salt' + id + pin)]);
  const today = (await one('select ws_work_day() d')).d;
  const iso = d => new Date(d).toISOString().slice(0, 10);
  const D = iso(today), ym = D.slice(0, 7), di = Number(D.slice(8, 10)) - 1;

  // ── 보안 ──
  ok(/permission denied/.test(await asErr('anon', 'select * from staff')), '비로그인: 직원 표 못 읽음');
  ok(/permission denied/.test(await asErr('anon', "select ws_login('1234','x')")), '비로그인: ws_login 못 부름');
  ok((await as('authenticated', 'select staff_id, name from staff')).length === 3, '로그인 기기: 직원 이름은 읽음');
  ok(/permission denied/.test(await asErr('authenticated', 'select pin_hash from staff')), '로그인 기기: PIN 해시는 못 읽음');
  ok(/permission denied/.test(await asErr('authenticated', 'select * from ws_sessions')), '로그인 기기: 기기 표 표는 못 읽음');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_auth('x')")), '로그인 기기: 도우미 함수(ws_auth) 못 부름');
  ok(!(await one("select to_regprocedure('public.pin_login(text)') f")).f, '1단계 pin_login 은 지워짐');
  const bk = await one("select public from storage.buckets where id = 'ws-files'");
  ok(bk && bk.public === true, '버킷 ws-files 공개');

  // ── 로그인 ──
  const login = (pin, dev, url, p) => as('authenticated', 'select ws_login($1,$2,$3,$4) r', [pin, dev, url || null, p || null]).then(r => r[0].r);
  let r = await login('1234', 'devA');
  ok(r.ok === false && r.needSign === true && r.name === '홍길동' && r.day === D, '근무일 첫 로그인 → 서명 요청 (표 안 줌)');
  const bad = await asErr('authenticated', "select ws_login('1234','devA','https://x/a.png','bad/a.png')");
  ok(/서명이 비어/.test(bad), '서명 경로가 sign/ 아니면 거부');
  r = await login('1234', 'devA', 'https://x/sign/2026-11/a.png', 'sign/2026-11/a.png');
  ok(r.ok === true && /^S001\.\d{13}\.[0-9a-f]{36}$/.test(r.token) && r.user.role === '소장', '서명과 함께 → 기기 표 ' + String(r.token).slice(0, 20) + '…');
  const tok = r.token;
  const exp = Number(tok.split('.')[1]), k = new Date(exp + 9 * 3600e3);
  ok(k.getUTCHours() === 6 && k.getUTCMinutes() === 0 && exp > Date.now() && exp - Date.now() <= 24 * 3600e3, '표 만료 = 다음 오전 6시(한국)');
  const sg = await one('select s.sign_id, s.via, f.kind, f.file_name, f.storage_path, f.is_archived from signs s join files f on f.id = s.sign_file_id');
  ok(sg && sg.sign_id === 'WS-SG-' + D.replace(/-/g, '') + '-001' && sg.via === 'PIN' && sg.kind === 'sign' && sg.file_name === D + '_서명-홍길동.png' && sg.is_archived === false, '서명 줄·파일 줄 저장 ' + (sg && sg.sign_id));
  r = await login('1234', 'devB');
  ok(r.ok === true, '같은 날 다시 로그인 → 서명 없이 바로');
  ok((await one('select count(*)::int n from signs')).n === 1, '서명은 하루 한 줄');

  // 메인
  await q("insert into fire_ext (fe_id, floor, store_name, name, qr_token, created_at) values ('F1','1F','가','1','q1', now() - interval '40 days'), ('F2','1F','나','1','q2', now() - interval '40 days'), ('F3','2F','다','1','q3', now() - interval '40 days')");
  await q("insert into fire_checks (check_id, ym, fe_id, state, entered_at) values ('C1', $1, 'F1', '이상없음', now()), ('C2', $1, 'F2', '이상있음', now())", [ym]);
  await q("insert into fire_ext (fe_id, floor, store_name, name, qr_token, created_at, active, deleted_at) values ('F4','1F','라','1','q4', now() - interval '90 days', false, now() - interval '60 days')");
  const bs = (await as('authenticated', 'select ws_bootstrap($1) r', [tok]))[0].r;
  const c = bs.fire.counts, dom = Number(bs.fire.day);
  ok(bs.ok && bs.user.name === '홍길동' && bs.needSign === false && bs.docs.signs === 1 && bs.toastSec == 2.6, '메인: 사람·서명 수·알림 2.6초');
  ok(c.total === 3 && c.ok === 1 && c.bad === 1 && c[dom <= 5 ? 'wait' : 'miss'] === 1, '메인 소화기: 3대 중 정상 1 · 이상 1 · 나머지 1 (지난달 지운 소화기 뺌)');
  ok(/LOGIN/.test(await asErr('authenticated', "select ws_bootstrap('S001.1.x')")), '틀린 표 → LOGIN');
  await as('authenticated', 'select ws_logout($1)', [tok]);
  ok(/LOGIN/.test(await asErr('authenticated', 'select ws_bootstrap($1)', [tok])), '로그아웃한 표 → LOGIN');

  // ── PIN 잠금 ──
  for (let i = 1; i <= 4; i++) r = await login('0000', 'devX');
  ok(r.error === 'PIN이 맞지 않습니다. (4/5)', '틀리면 횟수 안내 (4/5)');
  r = await login('0000', 'devX');
  ok(/5분 동안/.test(r.error), '5번째 → 이 기기 5분 잠금');
  r = await login('1234', 'devX');
  ok(/5분 동안/.test(r.error), '잠긴 기기는 맞는 PIN도 막음');
  ok((await login('1234', 'devY')).ok, '다른 기기는 됨');
  await q("delete from ws_pin_guard");
  for (let i = 0; i < 29; i++) await login('0000', 'd' + i);
  r = await login('0000', 'dz');
  ok(/모든 로그인/.test((await login('1234', 'dq')).error), '기기를 바꿔 가며 30번 틀리면 → 모두 잠금');
  const g = await one("select locks, extract(epoch from lock_until - now())::int s from ws_pin_guard where key = 'all'");
  ok(g.locks === 1 && g.s > 590 && g.s <= 600, '첫 전체 잠금 10분');
  await q("update ws_pin_guard set lock_until = now() - interval '1 second', locks = 2 where key = 'all'");
  for (let i = 0; i < 30; i++) await login('0000', 'e' + i);
  const g3 = await one("select locks, extract(epoch from lock_until - now())::int s from ws_pin_guard where key = 'all'");
  ok(g3.locks === 3 && g3.s > 3590, '6시간 안 3번째 전체 잠금은 1시간');
  ok((await one("select count(*)::int n from change_log where what = 'PIN 전체 잠금'")).n === 2, '전체 잠금은 변경기록에 남음');
  await q("delete from ws_pin_guard");
  ok(/PIN 4자리/.test((await login('12a4', 'z')).error), 'PIN 모양이 틀리면 안내');

  // ── 출근현황으로 나누기 (결정 92) ──
  const days = v => JSON.stringify(Array.from({ length: 31 }, (_, i) => i === di ? v : ''));
  await q("insert into roster (ym, seq, section, role, name, days) values ($1, 1, '기계', '기사', '김철수', $2::jsonb)", [ym, days('휴')]);
  r = await login('5678', 'k1');
  ok(r.blocked === true && /휴일 접속 불가/.test(r.error), '휴무(휴) → 막음');
  await q("update roster set days = $1::jsonb where name = '김철수'", [days('야')]);
  r = await login('5678', 'k1');
  ok(r.ok === true, '야간(야) → PIN만 (서명 없이)');
  await q("update roster set days = $1::jsonb where name = '김철수'", [days('')]);
  r = await login('5678', 'k1');
  ok(r.needSign === true, '주간 출근(빈칸) → 서명 요청');
  await q("insert into roster_changes (day, name, old_value, new_value, changed_by) values ($1, '김철수', '', '연', '홍길동')", [D]);
  ok((await login('5678', 'k1')).ok === true, '그날 고친 값(연) → PIN만');
  await q("insert into roster_changes (day, name, old_value, new_value, changed_by, changed_at) values ($1, '김철수', '연', '(되돌림)', '홍길동', now() + interval '1 second')", [D]);
  ok((await login('5678', 'k1')).needSign === true, '되돌림 → 엑셀 값(빈칸 = 주간)으로');
  const wd = ['일', '월', '화', '수', '목', '금', '토'][new Date(D + 'T00:00:00Z').getUTCDay()];
  await q("insert into default_holidays (name, weekday) values ('김철수', $1)", ['월,' + wd]);
  ok((await login('5678', 'k1')).blocked === true, '기본 휴일 요일 → 휴 → 막음');
  await q("insert into roster (ym, seq, section, role, name, days) values ($1, 2, '전기', '총무', '이영희', $2::jsonb)", [ym, days('휴')]);
  r = await login('2468', 'k2');
  ok(r.ok === true, '총무(엑셀 직책)는 쉬는 날에도 PIN만');
  ok((await login('1234', 'k3')).ok === true, '근무표에 없는 사람(홍길동) → 예전처럼 (이미 서명)');

  // 오늘 서명 (기기 표는 있는데 서명이 없을 때)
  await db.exec("delete from roster; delete from default_holidays; delete from roster_changes");
  const t3 = (await login('2468', 'k2', 'https://x/sign/b.png', 'sign/2026-11/b.png')).token;
  ok(!!t3, '이영희 서명하고 로그인');
  await q("update signs set deleted = true where staff_id = 'S003'");
  const st = (await as('authenticated', 'select ws_sign_today($1,$2,$3) r', [t3, 'https://x/sign/c.png', 'sign/2026-11/c.png']))[0].r;
  ok(st.ok === true && !st.already, 'ws_sign_today: 지워진 서명 대신 새로');
  const st2 = (await as('authenticated', 'select ws_sign_today($1,$2,$3) r', [t3, 'https://x/sign/d.png', 'sign/2026-11/d.png']))[0].r;
  ok(st2.already === true, '이미 있으면 already');
  const ids = (await q("select sign_id from signs order by sign_id")).map(x => x.sign_id.slice(-3)).join(',');
  ok(ids === '001,002,003', '서명 번호 이어 붙임 ' + ids);

  // ══ 3-2 서류작업: 명일 작업 · TBM · 종합업무일지 (03_docs.sql) ══
  await db.exec(SQL('03_docs.sql')); await db.exec(SQL('03_docs.sql'));
  ok(true, '03_docs.sql 실행됨 (두 번)');
  const call = async (fn, args) => (await as('authenticated', 'select ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') r', args))[0].r;
  const callErr = async (fn, args) => { try { await call(fn, args); return ''; } catch (e) { await db.exec('reset role'); return e.message; } };
  const tk = (await login('1234', 'docs')).token;   // 앞에서 쓴 표는 로그아웃 시험으로 끝남
  const J = o => JSON.stringify(o);
  const PUB = 'https://kjhsduhufwaihhlfdipf.supabase.co/storage/v1/object/public/ws-files/';
  const F = (kind, n, ext) => { const p = kind + '/' + ym + '/' + n + '.' + (ext || 'jpg'); return { url: PUB + p, path: p }; };
  const tomorrow = iso(Date.parse(D) + 864e5), yest = iso(Date.parse(D) - 864e5);
  ok(/permission denied/.test(await asErr('anon', "select ws_next_work_get('x','')")), '비로그인: 명일 작업 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', 'select ws_nw_data(current_date)')), '로그인 기기: 도우미(ws_nw_data) 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_add_file('x','{}','','','','')")), '로그인 기기: 도우미(ws_add_file) 못 부름');
  ok(/LOGIN/.test(await callErr('ws_tbm_get', ['bad.token', ''])), '틀린 기기 표 → LOGIN');

  // 명일 작업
  let n = await call('ws_next_work_get', [tk, '']);
  ok(n.ok && n.defaultDate === tomorrow && n.date === tomorrow && n.workDay === D && n.ver === '' && n.rows.length === 0, '명일 작업: 기본 일자 = 내일, 빈 표');
  ok((await call('ws_next_work_get', [tk, '2026-13-40'])).ok === false, '명일 작업: 틀린 날짜 → 안내');
  const rows1 = [{ dept: '전방파트', place: '  1층  복도 ', work: '<b>등 교체</b> 사다리', note: '' }, { dept: '기건파트', place: '', work: ' ', note: '' }];
  n = await call('ws_next_work_save', [tk, D, J(rows1), '']);
  ok(n.ok && n.rows.length === 1 && n.rows[0].place === '1층 복도' && n.rows[0].work === 'b등 교체/b 사다리' && n.by === '홍길동' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(n.ver), '명일 작업 저장: 빈 줄 빼고 글자 정리, ver ' + n.ver);
  const v1 = n.ver;
  n = await call('ws_next_work_save', [tk, D, J(rows1), '']);
  ok(n.ok === false && n.conflict && /홍길동님이 먼저/.test(n.error) && n.rows.length === 1, '명일 작업: 옛 ver로 저장 → 겹침 안내 + 새 내용');
  n = await call('ws_next_work_save', [tk, D, J([{ dept: '없는부서', work: 'x' }]), v1]);
  ok(n.ok === false && /부서/.test(n.error), '명일 작업: 부서 없으면 안내');
  n = await call('ws_next_work_save', [tk, D, J(Array.from({ length: 31 }, () => ({ dept: '전방파트', work: 'x' }))), v1]);
  ok(n.ok === false && /30줄/.test(n.error), '명일 작업: 31줄 → 안내');
  n = await call('ws_next_work_save', [tk, D, J([rows1[0], { dept: '기건파트', place: 'B1', work: '펌프 점검', note: '오전' }]), v1]);
  ok(n.ok && n.rows.length === 2 && n.ver > v1, '명일 작업: 새 ver로 다시 저장 (2줄)');

  // TBM
  let t = await call('ws_tbm_get', [tk, '']);
  ok(t.ok && t.day === D && !t.saved && t.works.length === 2 && t.works[0].n === '' && t.checks === null, 'TBM: 저장 전 → 그날 명일 작업 2줄을 가져옴');
  ok(t.risks.length === 18 && t.risks[0].words[0] === '사다리' && t.risks[0].fixes[0].on === true && !/✓/.test(t.risks[0].fixes[0].t) && t.risks[0].fixes[2].on === false, 'TBM: 위험성 목록 18줄, ✓ = 미리 체크');
  ok(t.signs.length >= 1 && t.signs[0].no === 1 && /^https:\/\/x\/sign\//.test(t.signs[0].img) && /^\d{2}:\d{2}$/.test(t.signs[0].at) && t.manager && t.manager.name === '홍길동', 'TBM: 서명 목록(그림 주소) · 관리감독자 소장');
  ok(/파일 정보/.test(await callErr('ws_tbm_save', [tk, J({ works: [] }), J({ meet: { url: 'https://evil/x.jpg', path: 'tbm_meet/2026-11/a.jpg' } })])), 'TBM: 버킷 밖 사진 주소 → 거부');
  ok(/파일 정보/.test(await callErr('ws_tbm_save', [tk, J({ works: [] }), J({ meet: F('sign', 'a') })])), 'TBM: 다른 종류 경로 → 거부');
  const w0 = { place: '1층', work: '등 교체', dept: '전방파트', n: 'x', risk: 'r', kind: 'k', p: 5, s: '2', fixes: ['a', 'b', '', 'c', 'd', 'e', 'f', 'g'] };
  let sv = await call('ws_tbm_save', [tk, J({ day: '', works: [w0], checks: { 사다리: true, 비계: false, 없는칸: true } }), J({ meet: F('tbm_meet', 'm1') })]);
  ok(sv.ok && /^\d{4}-/.test(sv.at), 'TBM 저장');
  t = await call('ws_tbm_get', [tk, '']);
  const tw = t.works[0];
  ok(t.saved && tw.n === '' && tw.p === '' && tw.s === 2 && tw.fixes.join('') === 'abcde' && J(t.checks) === '{"사다리":true}' && /tbm_meet\/.+m1\.jpg$/.test(t.photos.meet) && t.photos.chant === '', 'TBM: 숫자·개선조치(앞 6개 중 빈칸 빼고)·체크칸 정리, 회의 사진 주소');
  ok((await one('select tbm_id from tbm')).tbm_id === 'WS-TB-' + D.replace(/-/g, '') + '-001', 'TBM 번호 WS-TB-날짜-001');
  sv = await call('ws_tbm_save', [tk, J({ works: Array(31).fill(w0) }), '{}']);
  ok(sv.ok === false && /30줄/.test(sv.error), 'TBM: 31줄 → 안내');
  await call('ws_tbm_save', [tk, J({ works: [w0] }), J({ chant: F('tbm_chant', 'c1') })]);
  t = await call('ws_tbm_get', [tk, '']);
  ok(/m1\.jpg$/.test(t.photos.meet) && /c1\.jpg$/.test(t.photos.chant), 'TBM: 구호 사진만 바꿔도 회의 사진은 그대로');
  const sid = t.signs.map(x => x.id);
  let pd = await call('ws_tbm_save_pdf', [tk, J({ pdf: F('tbm_pdf', 'p1', 'pdf') }), J(sid), null, '']);
  ok(pd.ok && pd.pdf.signs === sid.length && /p1\.pdf$/.test(pd.pdf.url) && pd.pdf.shared === true, 'TBM PDF 저장 (서명 ' + sid.length + '명)');
  ok((await one('select count(*)::int n from signs where tbm_used')).n === sid.length, 'TBM PDF: 쓰인 서명 표시');
  ok((await one("select file_name from files where kind = 'tbm_pdf'")).file_name === D + '_TBM.pdf', 'TBM PDF 파일 이름 ' + D + '_TBM.pdf');
  t = await call('ws_tbm_get', [tk, '']);
  ok(t.pdf && t.pdf.at >= t.at, 'TBM: PDF 뒤 고친 것 없음 (pdf.at ≥ at)');
  pd = await call('ws_tbm_save_pdf', [tk, J({ pdf: F('tbm_pdf', 'p2', 'pdf') }), '[]', null, yest]);
  ok(pd.ok === false && /먼저/.test(pd.error), 'TBM: 저장 안 한 지난 날 PDF → 「먼저 저장」');
  pd = await call('ws_tbm_save_pdf', [tk, J({ pdf: F('tbm_pdf', 'p3', 'pdf') }), '[]', J({ day: yest, works: [] }), yest]);
  ok(pd.ok && (await call('ws_tbm_get', [tk, yest])).saved === true, 'TBM: 지난 날짜 저장 + PDF 한 번에');
  ok((await call('ws_tbm_get', [tk, tomorrow])).day === D, 'TBM: 앞날을 고르면 오늘');

  // 종합업무일지
  const prevY = (Number(D.slice(0, 4)) - 1) + D.slice(4);
  await q('insert into daily_log (log_date, electricity, business_hours) values ($1, 100, 10), ($2, 50, 12)', [prevY, yest]);   // 과거자료 (updated_at 없음)
  let lg = await call('ws_log_get', [tk, '']);
  ok(lg.ok && lg.day === D && lg.prevDay === prevY && lg.cur === null && lg.ver === '' && lg.vals.y['전기'] === 50 && lg.vals.p['전기'] === 100, '일지: 빈 날, 어제·전년 같은 날 값');
  ok(lg.tbm['전기방재'][0] === '1층 등 교체' && lg.tbm['기계건축'].length === 0, '일지: TBM 작업 표에서 금일작업 (부서 이름 바꿈)');
  ok((await call('ws_log_get', [tk, '2099-01-01'])).day === D, '일지: 앞날 → 오늘');
  const base = { 영업시간: '11', 전기: '1,234.5', 날씨: '맑음', 미세먼지등급: '보통', 비고: '줄1\n줄2<x>', works: { 전기방재: ['a', ' ', 'b'], 기계건축: [] } };
  lg = await call('ws_log_save', [tk, D, J(Object.assign({}, base, { 전기: '12a' })), '', '{}']);
  ok(lg.ok === false && /전기 칸에는 숫자만/.test(lg.error), '일지: 숫자 칸에 글자 → 안내');
  lg = await call('ws_log_save', [tk, D, J(Object.assign({}, base, { 미세먼지등급: '최악' })), '', '{}']);
  ok(lg.ok === false && /등급/.test(lg.error), '일지: 등급 틀림 → 안내');
  lg = await call('ws_log_save', [tk, tomorrow, J(base), '', '{}']);
  ok(lg.ok === false && /일자/.test(lg.error), '일지: 앞날 저장 → 안내');
  lg = await call('ws_log_save', [tk, D, J(base), '', J({ night: F('log_night', 'n1') })]);
  ok(lg.ok && lg.cur['전기'] === '1234.5' && lg.cur['영업시간'] === '11' && lg.cur.works['전기방재'].join() === 'a,b' && lg.cur['비고'] === '줄1\n줄2x' && lg.cur['작성자'] === '홍길동' && /n1\.jpg$/.test(lg.night) && lg.ver && lg.by === '홍길동', '일지 저장: 숫자·금일작업·비고(줄바꿈 둠)·야간 그림');
  const sameM = D.slice(0, 7) === yest.slice(0, 7), sameY = D.slice(0, 4) === yest.slice(0, 4);
  ok(lg.month.c['전기'] === (sameM ? 1284.5 : 1234.5) && lg.year.c['전기'] === (sameY ? 1284.5 : 1234.5) && lg.year.p['전기'] === 100, '일지: 월·년 누계 ' + lg.month.c['전기'] + ' · 전년 ' + lg.year.p['전기']);
  const lv = lg.ver;
  lg = await call('ws_log_save', [tk, D, J(base), '', '{}']);
  ok(lg.ok === false && lg.conflict && /홍길동님이 먼저/.test(lg.error) && lg.cur, '일지: 옛 ver → 겹침 안내 + 새 내용');
  await q("update daily_log set t_min = -3, weather_source = '네이버' where log_date = $1", [D]);   // 오후 1시 날씨 자동 (구글이 넣음, 수정시각 그대로)
  lg = await call('ws_log_save', [tk, D, J(Object.assign({}, base, { 날씨: '', 최저: '', night: '-' })), lv, '{}']);
  ok(lg.ok && lg.cur['최저'] === '-3' && lg.cur['날씨'] === '맑음' && lg.cur['날씨출처'] === '네이버' && lg.night === '', '일지: 빈칸으로 보내도 자동 날씨는 그대로, 야간 그림 빼기');
  lg = await call('ws_log_save_pdf', [tk, D, J({ pdf: F('log_pdf', 'l1', 'pdf') }), null, lv]);
  ok(lg.ok === false && lg.conflict, '일지 PDF: 옛 ver → 겹침');
  const lv2 = (await call('ws_log_get', [tk, D])).ver;
  lg = await call('ws_log_save_pdf', [tk, D, J({ pdf: F('log_pdf', 'l1', 'pdf') }), null, lv2]);
  ok(lg.ok && lg.pdf && /l1\.pdf$/.test(lg.pdf.url) && lg.warn === '', '일지 PDF 저장');
  lg = await call('ws_log_save_pdf', [tk, yest, J({ pdf: F('log_pdf', 'l2', 'pdf'), night: F('log_night', 'n2') }), J(base), '']);
  ok(lg.ok && lg.day === yest && /l2\.pdf$/.test(lg.pdf.url) && /n2\.jpg$/.test(lg.night) && lg.cur['작성자'] === '홍길동', '일지: 과거자료 날(ver 빈칸)을 고쳐 저장 + PDF 한 번에');
  ok((await one("select count(*)::int n from files where kind like 'log_%' and not is_archived")).n === 4, '일지 파일 4개가 files 표에 (드라이브 이관 대상)');
  // ══ 3-3 출근현황 (04_attendance.sql) ══
  await db.exec(SQL('04_attendance.sql')); await db.exec(SQL('04_attendance.sql'));
  ok(true, '04_attendance.sql 실행됨 (두 번)');
  await db.exec('delete from roster; delete from roster_changes; delete from default_holidays');
  ok(/permission denied/.test(await asErr('anon', "select ws_att_get('x','')")), '비로그인: 출근현황 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_at_is_day('')")), '로그인 기기: 도우미(ws_at_is_day) 못 부름');
  const kk = (await login('5678', 'at1', 'https://x/sign/k.png', 'sign/2026-11/k.png')).token;   // 김철수 (직원)
  const yy = (await login('2468', 'at2')).token;   // 이영희 (직원, 근무표에 없음)
  ok(!!kk && !!yy, '김철수·이영희 로그인');
  let at = await call('ws_att_get', [tk, '']);
  ok(at.ok && at.date === D && at.people.length === 0 && at.ju.length === 0 && at.canFix === false && at.canBoss === true && at.months.length === 0, '출근현황: 근무표 없음 → 빈 표, 소장은 canBoss');
  ok((await call('ws_att_get', [tk, '2026-02-30'])).ok === false, '출근현황: 틀린 날짜 → 안내');
  const lastDay = new Date(Date.UTC(Number(D.slice(0, 4)), Number(D.slice(5, 7)), 0)).getUTCDate();
  const dd = v => { const a = Array(lastDay + 3).fill(''); a[di] = v; return a; };   // 그날만 v (말일보다 길게 → 잘림)
  const roster = [{ sec: '전기', role: '소장', name: '홍길동', days: dd('') }, { sec: '기계', role: '기사', name: '김철수', days: dd('야') },
    { sec: '기계', role: '기사', name: '', days: [] }, { sec: 'x', role: '', name: '' }];
  let pt = await call('ws_att_put', [kk, ym, J(roster), null]);
  ok(pt.ok === false && /소장·부소장·총무만/.test(pt.error), '엑셀 올리기: 직원(대표 아님) → 막음');
  ok((await call('ws_att_put', [tk, '2026-13', J(roster), null])).ok === false, '엑셀 올리기: 틀린 달 → 안내');
  ok((await call('ws_att_put', [tk, ym, '[]', null])).ok === false, '엑셀 올리기: 줄 없음 → 안내');
  pt = await call('ws_att_put', [tk, ym, J(roster), J(F('roster_xlsx', 'r1', 'xlsx'))]);
  ok(pt.ok && pt.count === 3, '엑셀 올리기: 이름·직책 없는 줄 빼고 3줄 (공석 줄은 남김)');
  const fx = await one("select f.file_name, f.drive_folder, count(r.*)::int n from files f join roster r on r.xlsx_file_id = f.id where f.kind = 'roster_xlsx' group by 1, 2");
  ok(fx && fx.file_name === ym + '_근무스케줄.xlsx' && fx.n === 3, '엑셀 원본 파일 줄 ' + (fx && fx.file_name));
  ok((await one('select max(jsonb_array_length(days))::int n from roster')).n === lastDay, '일별 값은 말일까지만');
  at = await call('ws_att_get', [tk, '']);
  ok(at.people.length === 3 && at.people[1].v === '야' && at.people[1].raw === '야' && at.people[2].name === '' && at.people[2].v === '' && at.upBy === '홍길동' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(at.upAt), '출근현황: 사람 3줄 · 그날 값 · 올린 사람·시각');
  ok(at.ju.length === lastDay && at.ju[di] === 1 && at.months.join() === ym, '달력 주간 인원: 그날 1명 (야간·공석 뺌), 날 수 ' + at.ju.length);
  const kat = await call('ws_att_get', [kk, '']);
  ok(kat.canFix === true && kat.canBoss === false, '김철수(그날 야간): 고칠 수 있음, 대표 아님');
  ok((await call('ws_att_get', [yy, ''])).canFix === false, '이영희(근무표에 없음): 못 고침');
  pt = await call('ws_att_put', [kk, ym, J([{ sec: '기계', role: '총무', name: '김철수', days: [] }]), null]);
  ok(pt.ok === false, '이미 있는 달: 새 엑셀에 총무로 적어도 지금 달 대표가 아니면 막음');
  pt = await call('ws_att_put', [tk, ym, J(roster), null]);
  const rc = await one('select count(*) filter (where not deleted)::int live, count(*)::int total, min(seq) filter (where not deleted)::int s from roster');
  ok(pt.ok && rc.live === 3 && rc.total === 6 && rc.s === 4, '같은 달 다시 올림: 예전 줄은 지움 표시, 순서 번호 이어서');
  let fxr = await call('ws_att_fix', [kk, D, '홍길동', '연']);
  ok(fxr.ok && fxr.people[0].v === '연' && fxr.people[0].fix.by === '김철수' && fxr.ju[di] === 0, '그날 고치기: 야간 근무자가 홍길동 → 연 (주간 인원 0)');
  ok((await one("select old_value from roster_changes order by id desc limit 1")).old_value === '', '근무변경에 원래 값(출근) 남김');
  ok((await call('ws_att_fix', [kk, D, '홍길동', '외출'])).ok === false, '그날 고치기: 없는 상태 → 안내');
  ok(/근무표에 없는/.test((await call('ws_att_fix', [kk, D, '이영희', '연'])).error), '그날 고치기: 근무표에 없는 이름 → 안내');
  ok(/고칠 수 있습니다/.test((await call('ws_att_fix', [yy, D, '홍길동', '휴'])).error), '그날 고치기: 권한 없는 직원 → 막음');
  fxr = await call('ws_att_fix', [kk, D, '홍길동', '(되돌림)']);
  ok(fxr.ok && fxr.people[0].v === '' && fxr.people[0].fix === null, '되돌림 → 엑셀 값(출근)');
  ok(/소장·부소장·총무만/.test((await call('ws_att_holiday', [kk, '김철수', J(['월']), D])).error), '기본 휴일: 직원 → 막음');
  ok(/근무표에 없는/.test((await call('ws_att_holiday', [tk, '이영희', J(['월']), D])).error), '기본 휴일: 근무표에 없는 이름 → 안내');
  const hd = await call('ws_att_holiday', [tk, '홍길동', J(['토', '월', '월', '없음']), '']);
  ok(hd.ok && hd.people[0].hol === '월,토', '기본 휴일: 요일 정리 (겹침·없는 요일 빼고 순서대로) → ' + hd.people[0].hol);
  ok((await call('ws_att_holiday', [tk, '홍길동', '[]', D])).people[0].hol === '', '기본 휴일 비우기');
  await db.close();
  console.log(fail ? '\nSQL 시험 실패 ' + fail + '개' : '\nSQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
