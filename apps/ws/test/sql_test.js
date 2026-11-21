// Supabase 이관 SQL 시험 — PGlite(작은 PostgreSQL)에 Supabase 비슷한 틀(역할·auth·storage)을 만들고
// supabase/01_schema_rls.sql · 02_login.sql · 03_docs.sql · 04_attendance.sql · 05_fire.sql · 06_eh.sql · 07_cs.sql · 08_settings.sql 을 그대로 돌려 로그인 규칙을 확인. 진짜 Supabase에는 아무것도 보내지 않음.
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
grant all on storage.objects to anon, authenticated;   -- Supabase처럼 표 권한은 있고 RLS 정책으로 막음
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

  // 진짜 Supabase는 where 없는 update·delete를 막음(「UPDATE requires a WHERE clause」, 11-14 공사장 기본 항목). PGlite는 안 막으니 글로 찾음
  // (on conflict … do update · 보안 정책의 for update 는 빼고)
  const bare = require('fs').readdirSync(path.join(__dirname, '..', 'supabase')).filter(f => /\.sql$/.test(f)).flatMap(f =>
    (SQL(f).replace(/--[^\n]*/g, '').match(/(?<!do |for |to |on conflict[^;]*)\b(update\s+(public|only|storage)\.\w+\b|delete\s+from)\b[^;]*;/gi) || [])
      .filter(s => !/\bwhere\b/i.test(s)).map(s => f + ': ' + s.replace(/\s+/g, ' ').slice(0, 60)));
  ok(!bare.length, 'where 없는 update·delete 없음 ' + bare.join(' / '));
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
  // ══ 3-4 소화기 (05_fire.sql) ══
  await db.exec(SQL('05_fire.sql')); await db.exec(SQL('05_fire.sql'));
  ok(true, '05_fire.sql 실행됨 (두 번)');
  ok(/permission denied/.test(await asErr('anon', "select ws_fe_list('x')")), '비로그인: 소화기 목록 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_fe_status_('2026-11')")), '로그인 기기: 도우미(ws_fe_status_) 못 부름');
  ok(/permission denied/.test(await asErr('anon', 'select * from fire_ext')), '비로그인: 소화기 표는 여전히 못 읽음');
  ok((await call('ws_fe_add', [tk, J({ floor: '11F', store: 'x' })])).error === '층을 골라 주세요.', '소화기 등록: 없는 층 → 안내');
  ok((await call('ws_fe_add', [tk, J({ floor: '1F', store: '  ' })])).error === '위치를 적어 주세요.', '소화기 등록: 매장명 없음 → 안내');
  let fl = await call('ws_fe_add', [tk, J({ floor: '1F', store: '1층 카페(A)', count: '3' })]);
  const mine = fl.items.filter(x => x.store === '1층 카페(A)');
  ok(fl.ok && fl.added.join() === '1층 카페(A)-소화기1,1층 카페(A)-소화기2,1층 카페(A)-소화기3' && mine.length === 3 && mine.every(x => /^[2-9a-km-np-z]{12}$/.test(x.token)), '소화기 3대 등록: 이름·12자리 QR');
  ok(/^WS-FE-\d{8}-001$/.test(mine[0].id), '소화기 번호 WS-FE-날짜-001 ' + mine[0].id);
  fl = await call('ws_fe_add', [tk, J({ floor: '1F', store: '1층 카페(A)', count: 0 })]);
  ok(fl.added.join() === '1층 카페(A)-소화기4' && /-004$/.test(fl.items.find(x => x.no === 4 && x.store === '1층 카페(A)').id), '개수 0 → 1대, 번호 이어서 (4)');
  const FL = ['B1', '1F', '2F', '3F', '4F', '5F', '6F'];
  ok(fl.items.every((x, i, a) => !i || FL.indexOf(a[i - 1].floor) <= FL.indexOf(x.floor)), '목록은 층 순서');
  ok((await call('ws_fe_delete', [tk, '[]'])).ok === false, '지울 것 없음 → 안내');
  const del = fl.items.find(x => x.no === 4 && x.store === '1층 카페(A)');
  fl = await call('ws_fe_delete', [tk, J([del.id, 'nothing'])]);
  ok(fl.count === 1 && !fl.items.some(x => x.id === del.id), '소화기 지우기 (목록에서 빠짐)');
  ok(fl.execUrl === '' && fl.label.w === 50 && fl.label.dpi === 203, 'QR 주소 설정 없음 → 빈칸(화면이 채움), 라벨 기본 50mm');
  await q("insert into settings (key, value) values ('바로가기주소', 'https://a.github.io/fm/ws/?x=1') on conflict (key) do update set value = excluded.value");
  ok((await call('ws_fe_list', [tk])).execUrl === 'https://a.github.io/fm/ws/', 'QR 주소 = 설정 바로가기주소 (? 뒤는 뺌)');
  ok(/15~100/.test((await call('ws_label_save', [tk, 10, 50])).error), '라벨 크기 범위 밖 → 안내');
  const lb = await call('ws_label_save', [tk, 60.04, 40]);
  ok(lb.ok && lb.label.w === 60 && lb.label.h === 40 && (await one("select value from settings where key = '라벨가로mm'")).value === '60', '라벨 크기 저장 60×40');

  // QR 점검 입력 (비로그인)
  const qr = mine[0].token, anonCall = async (fn, args) => (await as('anon', 'select ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') r', args))[0].r;
  ok((await anonCall('ws_check_init', ['zzzzzzzzzzzz'])).ok === false, 'QR 점검: 없는 QR → 안내');
  let ci = await anonCall('ws_check_init', [qr]);
  ok(ci.ok && ci.fe.name === '1층 카페(A)-소화기1' && ci.exists === false && ci.photo.w === 640 && ci.ym === ym && ci.window.end === 5, 'QR 점검: 비로그인도 열림 (소화기 이름·이번 달)');
  ok((await asErr('anon', "insert into storage.objects (bucket_id, name) values ('ws-files', $1)", ['fire/' + qr + '/' + ym + '/a1.jpg'])) === '', 'QR 점검: 비로그인이 진짜 QR 경로에 사진 올림');
  ok(/row-level security/.test(await asErr('anon', "insert into storage.objects (bucket_id, name) values ('ws-files', $1)", ['fire/zzzzzzzzzzzz/' + ym + '/a2.jpg'])), 'QR 점검: 없는 QR 경로 → 올리기 막음');
  ok(/row-level security/.test(await asErr('anon', "insert into storage.objects (bucket_id, name) values ('ws-files', $1)", ['tbm_meet/' + ym + '/a3.jpg'])), 'QR 점검: 다른 경로 → 올리기 막음');
  const FQ = (n, ext) => { const p = 'fire/' + qr + '/' + ym + '/' + n + '.' + ext; return { url: PUB + p, path: p }; };
  let cs = await anonCall('ws_check_submit', [qr, J({ state: '이상없음' }), '{}']);
  ok(cs.ok === false && cs.error === '압력계 사진, 외관·압력 이상무 칸, 이름 칸이(가) 비어 있습니다.', 'QR 점검: 파일 없음 → 빈 칸 안내');
  ok((await anonCall('ws_check_submit', [qr, J({}), J({ photo: FQ('p', 'png'), memo: FQ('m', 'png'), name: FQ('n', 'png') })])).ok === false, 'QR 점검: 사진이 jpg 아니면 거부');
  const files3 = J({ photo: FQ('p1', 'jpg'), memo: FQ('m1', 'png'), name: FQ('n1', 'png') });
  cs = await anonCall('ws_check_submit', [qr, J({ state: '이상있음' }), files3]);
  ok(cs.ok && cs.state === '이상있음' && /^WS-FC-\d{8}-001$/.test(cs.checkId) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cs.at), 'QR 점검 입력 ' + cs.checkId);
  const ff = await q("select kind, file_name, drive_folder, created_by from files where kind like 'fire_%' order by kind");
  ok(ff.length === 3 && ff.find(x => x.kind === 'fire_photo').file_name === iso(Date.now() + 9 * 3600e3) + '_소화기점검-1층-카페-A-소화기1_001.jpg' && ff[0].drive_folder === '소화기점검/' + iso(Date.now() + 9 * 3600e3).slice(0, 7) && ff[0].created_by === '매장 직원(QR)', '점검 파일 3개 이름·폴더 ' + ff.find(x => x.kind === 'fire_photo').file_name);
  cs = await anonCall('ws_check_submit', [qr, J({ state: '이상없음' }), files3]);
  ok(cs.ok === false && cs.exists === true, 'QR 점검: 이번 달 이미 있음 → 덮어쓸지 물음');
  cs = await anonCall('ws_check_submit', [qr, J({ state: '이상없음', overwrite: true }), J({ photo: FQ('p2', 'jpg'), memo: FQ('m2', 'png'), name: FQ('n2', 'png') })]);
  const oc = await one('select overwrite_count n, state from fire_checks where check_id = $1', [cs.checkId]);
  ok(cs.ok && /-001$/.test(cs.checkId) && oc.n === 1 && oc.state === '이상없음', 'QR 점검 덮어쓰기: 같은 번호, 덮어쓴 횟수 1');
  ok((await anonCall('ws_check_init', [qr])).exists === true, 'QR 점검: 다시 열면 「이미 있음」');
  ok((await anonCall('ws_check_init', [del.token])).ok === false, 'QR 점검: 지운 소화기 QR → 안내');

  // 점검 현황
  let fs = await call('ws_fe_status', [tk, 'bad']);
  const it = fs.items.find(x => x.id === mine[0].id);
  ok(fs.ok && fs.ym === fs.curYm && it.state === 'ok' && it.checkId === cs.checkId && fs.counts.total === fs.items.length && fs.counts.ok >= 1, '점검 현황: 이번 달, 입력한 소화기 점검완료');
  ok(!fs.items.some(x => x.id === del.id) && fs.months[fs.months.length - 1] === fs.curYm, '점검 현황: 이번 달 지운 소화기(기록 없음)는 안 보임, 달 목록 끝 = 이번 달');
  const dt = await call('ws_fe_detail', [tk, cs.checkId]);
  ok(dt.ok && /p2\.jpg$/.test(dt.photo) && /m2\.png$/.test(dt.signA) && /n2\.png$/.test(dt.signB) && dt.state === '이상없음', '점검 내용 보기: 새 사진·손글씨 주소');
  ok((await call('ws_fe_detail', [tk, 'nope'])).ok === false, '점검 내용: 없는 번호 → 안내');
  // ══ 3-5 전열필증 (06_eh.sql) ══
  await db.exec(SQL('06_eh.sql')); await db.exec(SQL('06_eh.sql'));
  ok(true, '06_eh.sql 실행됨 (두 번)');
  ok(/permission denied/.test(await asErr('anon', "select ws_eh_list('x', '1F')")), '비로그인: 전열 목록 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', "select ws_eh_out('1F')")), '로그인 기기: 도우미(ws_eh_out) 못 부름');
  let eh = await call('ws_eh_list', [tk, 'zz']);
  ok(eh.ok && eh.floor === '1F' && eh.floors.length === 10 && eh.empty === true && eh.dpi === 203, '전열 목록: 없는 층 → 1F, 층 10개, 비어 있음');
  ok((await call('ws_eh_store_save', [tk, J({ floor: '7F', name: 'a' })])).error === '층을 골라 주세요.', '매장 추가: 없는 층 → 안내');
  eh = await call('ws_eh_store_save', [tk, J({ floor: '2F', name: '샤넬' })]);
  const s1 = eh.stores[0];
  ok(eh.ok && eh.floor === '2F' && s1.name === '샤넬' && s1.no === 1 && /^WS-ES-\d{8}-001$/.test(s1.id), '매장 추가 2F 샤넬 (매장번호 1)');
  ok((await call('ws_eh_store_save', [tk, J({ floor: '2F', name: '샤넬' })])).error === '2F에 「샤넬」 매장이 이미 있습니다.', '같은 층 같은 이름 → 안내');
  eh = await call('ws_eh_store_save', [tk, J({ floor: '2F', name: '디올' })]);
  const s2 = eh.stores.find(x => x.name === '디올');
  ok(s2.no === 2 && eh.stores.map(x => x.name).join() === '샤넬,디올', '두 번째 매장 번호 2, 번호 순');
  ok((await call('ws_eh_save', [tk, J({ esId: s1.id, name: '커피머신', w: 'abc', m1: '김', date: '2026-01-02' })])).error === '용량은 W 숫자로 넣어 주세요 (예: 1500).', '기기: 용량 글자 → 안내');
  ok((await call('ws_eh_save', [tk, J({ esId: s1.id, name: '커피머신', w: '1500', m1: '김', date: '2026-13-02' })])).error === '승인일자를 골라 주세요.', '기기: 틀린 날짜 → 안내');
  eh = await call('ws_eh_save', [tk, J({ esId: s1.id, name: '커피머신', w: '1,500W', maker: 'LG', m1: '김정', m2: '박부', date: '2026-01-02' })]);
  let d1 = eh.stores[0].items[0];
  ok(eh.saved === '2F-1-1' && d1.no === '2F-1-1' && d1.w === '1500' && d1.date === '2026-01-02' && /^[2-9a-km-np-z]{12}$/.test(d1.token) && d1.printed === '', '기기 추가: 관리번호 2F-1-1, 용량 1500, 12자리 QR');
  eh = await call('ws_eh_save', [tk, J({ esId: s1.id, name: '전기포트', w: '800', m1: '김정', date: '2026-01-03' })]);
  ok(eh.saved === '2F-1-2' && eh.stores[0].items.map(x => x.no).join() === '2F-1-1,2F-1-2', '두 번째 기기 2F-1-2');
  eh = await call('ws_eh_printed', [tk, J([d1.id]), '2F']);
  d1 = eh.stores[0].items[0];
  ok(eh.count === 1 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(d1.printed), '인쇄함 표시');
  eh = await call('ws_eh_save', [tk, J({ id: d1.id, name: '커피머신2', w: '1500', maker: 'LG', m1: '김정', m2: '박부', date: '2026-01-02' })]);
  ok(eh.saved === '2F-1-1' && eh.stores[0].items[0].printed !== '' && eh.stores[0].items[0].name === '커피머신2', '이름만 바꿈 → 인쇄 표시 그대로');
  eh = await call('ws_eh_save', [tk, J({ id: d1.id, name: '커피머신2', w: '2000', maker: 'LG', m1: '김정', m2: '박부', date: '2026-01-02' })]);
  ok(eh.stores[0].items[0].printed === '' && eh.stores[0].items[0].w === '2000', '용량 바꿈 → 「미출력」으로');
  const anonOne = async (fn, args) => (await as('anon', 'select ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') r', args))[0].r;
  const vw = await anonOne('ws_eh_view', [d1.token]);
  ok(vw.ok && vw.item.no === '2F-1-1' && vw.item.floor === '2F' && vw.item.store === '샤넬' && vw.item.w === '2000' && vw.item.token === undefined && vw.item.printed === undefined, '필증 QR 보기: 비로그인도 읽음 (QR·인쇄 정보는 안 보냄)');
  ok((await anonOne('ws_eh_view', ['bad'])).error === '필증 QR 주소가 올바르지 않습니다.', '필증 QR: 틀린 모양 → 안내');
  ok(/permission denied/.test(await asErr('anon', 'select * from eh_devices')), '비로그인: 전열 표는 못 읽음');
  eh = await call('ws_eh_store_save', [tk, J({ id: s1.id, name: '샤넬뷰티' })]);
  ok(eh.stores[0].name === '샤넬뷰티' && (await anonOne('ws_eh_view', [d1.token])).item.store === '샤넬뷰티', '매장 이름 바꿈 → 기기 매장명도');
  eh = await call('ws_eh_delete', [tk, J([eh.stores[0].items[1].id]), '2F']);
  ok(eh.count === 1 && eh.stores[0].items.length === 1, '기기 필증 삭제');
  eh = await call('ws_eh_save', [tk, J({ esId: s1.id, name: '토스터', w: '900', m1: '김정', date: '2026-01-04' })]);
  ok(eh.saved === '2F-1-3', '지운 번호는 다시 안 씀 (2F-1-3)');
  eh = await call('ws_eh_store_delete', [tk, s1.id]);
  ok(eh.count === 2 && eh.stores.length === 1 && eh.floors.find(x => x.code === '2F').stores === 1, '매장 삭제 → 기기 2대도');
  ok((await anonOne('ws_eh_view', [d1.token])).error === '삭제된 필증입니다. 시설팀에 알려 주세요.', '필증 QR: 삭제된 기기 → 안내');
  eh = await call('ws_eh_store_save', [tk, J({ floor: '2F', name: '새매장' })]);
  ok(eh.stores.find(x => x.name === '새매장').no === 3, '새 매장 번호는 지운 매장 번호 뒤 (3)');
  ok((await call('ws_eh_import', [tk, J({ stores: [{ floor: '1F', no: 1, name: 'a' }], items: [{ floor: '1F', store: 0, no: '1F-1-1', name: 'x' }] })])).error === '이미 전열기기가 들어 있어 가져오지 않습니다 (처음 한 번만).', '엑셀 가져오기: 이미 있으면 안 함');
  await q('delete from eh_devices'); await q('delete from eh_stores');
  ok((await call('ws_eh_import', [tk, J({ stores: [{ floor: '9F', no: 1, name: 'a' }], items: [{ floor: '1F', store: 0, no: '1F-1-1' }] })])).error === '엑셀 내용이 올바르지 않습니다. 다시 골라 주세요.', '엑셀 가져오기: 틀린 내용 → 안내');
  eh = await call('ws_eh_import', [tk, J({ stores: [{ floor: '1F', no: 4, name: '카페' }, { floor: '2F', no: 1, name: '샵' }],
    items: [{ floor: '1F', store: 0, no: '1F-4-1', name: '오븐', w: '3000', maker: 'S', m1: '갑', m2: '을', date: '2024-08-29', gone: false },
            { floor: '1F', store: 0, no: '1F-4-2', name: '히터', w: '', m1: '갑', date: '', gone: true },
            { floor: '2F', store: 1, no: '2F-1-1', name: '', w: '10.5', m1: '병', date: '2020-01-01', gone: false }] })]);
  ok(eh.ok && eh.floor === '1F' && eh.stores[0].no === 4 && eh.stores[0].items.length === 1 && eh.stores[0].items[0].w === '3000' && eh.floors.find(x => x.code === '2F').items === 1, '엑셀 가져오기: 매장 2·기기 3 (폐기 1대는 삭제로)');
  ok((await one("select count(*)::int n from eh_devices where device_name = '(이름 없음)' and watts = 10.5")).n === 1, '엑셀 가져오기: 이름 없음 · 소수 용량');
  // 다시 가져오기(바꿔 넣기): 같은 관리번호는 QR 그대로, 필증 칸이 같으면 「출력함」도 그대로
  const qOld = await one("select (select qr_token from eh_devices where mgmt_no = '1F-4-1') a, (select qr_token from eh_devices where mgmt_no = '2F-1-1') b");
  await q("update eh_devices set printed_at = now() where mgmt_no in ('1F-4-1', '2F-1-1')");
  eh = await call('ws_eh_import', [tk, J({ replace: true, stores: [{ floor: '1F', no: 4, name: '카페2' }, { floor: '3F', no: 1, name: '새' }],
    items: [{ floor: '1F', store: 0, no: '1F-4-1', name: '오븐', w: '3000', maker: 'S', m1: '갑', m2: '을', date: '2024-08-29', gone: false },
            { floor: '1F', store: 0, no: '1F-4-3', name: '포트', w: '1500', m1: '갑', date: '', gone: false },
            { floor: '3F', store: 1, no: '2F-1-1', name: 'x', w: '20', m1: '병', date: '2020-01-01', gone: false }] })]);
  const qNew = await one("select (select qr_token from eh_devices where mgmt_no = '1F-4-1') a, (select qr_token from eh_devices where mgmt_no = '2F-1-1') b, (select printed_at is not null from eh_devices where mgmt_no = '1F-4-1') pa, (select printed_at is null from eh_devices where mgmt_no = '2F-1-1') pb, (select count(*)::int from eh_devices) n, (select count(*)::int from eh_stores) s");
  ok(eh.ok && eh.kept === 2 && qNew.a === qOld.a && qNew.b === qOld.b && qNew.n === 3 && qNew.s === 2, '다시 가져오기: 전부 바꿈 · 같은 관리번호 QR 그대로 (2대)');
  ok(qNew.pa && qNew.pb, '다시 가져오기: 필증 칸 같으면 출력함 유지, 용량 바뀌면 미출력');
  ok(eh.stores[0].name === '카페2', '다시 가져오기: 매장 이름도 새 엑셀대로');
  // 기기 1,000대 넘게 (11-17 실제 엑셀 3,028대: 일련번호가 '100' 으로 잘려 겹치던 오류)
  eh = await call('ws_eh_import', [tk, J({ replace: true, stores: [{ floor: '1F', no: 4, name: '카페2' }],
    items: Array.from({ length: 1005 }, (_, k) => ({ floor: '1F', store: 0, no: '1F-4-' + (k + 1), name: '기기' + k, w: '10', m1: '갑', date: '', gone: false })) })]);
  const big = await one("select count(*)::int n, count(distinct eh_id)::int d, max(eh_id) filter (where mgmt_no = '1F-4-1000') k from eh_devices");
  ok(eh.ok && big.n === 1005 && big.d === 1005 && /-1000$/.test(big.k) && eh.kept === 2, '다시 가져오기: 기기 1,005대 (일련번호 1000 이상도 겹치지 않음) ' + big.k);
  ok((await one("select ws_pad3(7) a, ws_pad3(999) b, ws_pad3(1000) c")).c === '1000', '번호 자리: 007 · 999 · 1000');

  // ══ 3-5 공사장 점검 (07_cs.sql) ══
  await db.exec(SQL('07_cs.sql')); await db.exec(SQL('07_cs.sql'));
  ok((await one('select count(*)::int n from cs_items')).n === 9, '07_cs.sql 실행됨 (두 번) — 기본 항목 9개 한 번만');
  ok(/permission denied/.test(await asErr('anon', "select ws_cs_home('x')")), '비로그인: 공사장 첫 화면 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', 'select ws_cs_items_()')), '로그인 기기: 도우미(ws_cs_items_) 못 부름');
  let ch = await call('ws_cs_home', [tk]);
  ok(ch.ok && ch.admin === true && ch.items.length === 9 && ch.items.filter(x => x.use).map(x => x.t).join() === '정리정돈·통로,안전수칙 위반' && ch.sites.length === 0, '공사장 첫 화면: 기본 9개, 점검에 넣기 2개');
  ok((await call('ws_cs_site_save', [tk, J({ name: ' ' })])).ok === false, '현장: 이름 없음 → 안내');
  let cst = await call('ws_cs_site_save', [tk, J({ name: '5F 리모와', work: '인테리어', co: 'A사' })]);
  const site = cst.sites[0];
  ok(cst.ok && site.name === '5F 리모와' && site.co === 'A사' && /^WS-CS-\d{8}-001$/.test(site.id), '현장 추가');
  ok((await call('ws_cs_site_save', [tk, J({ name: '5F 리모와' })])).error === '「5F 리모와」 현장이 이미 있습니다.', '같은 현장 이름 → 안내');
  let cg = await call('ws_cs_get', [tk, '', site.id, 0]);
  ok(cg.ok && cg.round === 1 && cg.items.length === 2 && cg.check === null && cg.rounds.length === 0 && cg.date === ch.day, '점검 열기: 1회차, 점검에 넣은 항목 2개');
  const CP = n => { const p = 'cs_photo/' + ym + '/' + n + '.jpg'; return { url: PUB + p, path: p }; };
  let csv = await call('ws_cs_save', [tk, '', site.id, J([{ t: '정리정돈·통로', d: 'x', st: '양호', memo: '줄1\n줄2<b>', photos: [{ id: '', at: '14:05', file: CP('c1') }, { id: '', at: '14:06', file: CP('c2') }] },
                                                        { t: '안전수칙 위반', st: '미흡', photos: [] }]), 1]);
  ok(csv.ok && csv.items[0].length === 2 && csv.items[1].length === 0 && csv.check.ok === 1 && csv.check.bad === 1 && csv.check.by === '홍길동' && /^WS-CK-\d{8}-001$/.test(csv.check.id), '점검 저장: 새 사진 2장, 양호1·미흡1 ' + (csv.check && csv.check.id));
  ok((await call('ws_cs_get', [tk, '', site.id, 1])).items[0].memo === '줄1\n줄2b', '특이사항: 줄바꿈은 남기고 <> 뺌');
  const cf = await q("select file_name, drive_folder from files where kind = 'cs_photo' order by file_name");
  ok(cf.length === 2 && cf[0].file_name === ch.day + '_공사장점검-5F-리모와_오후점검_001.jpg' && cf[0].drive_folder === '점검/공사장점검/' + ch.day.slice(0, 4) + '/' + ch.day.slice(0, 7), '사진 파일 이름·폴더 ' + cf[0].file_name);
  ok(/파일 정보가 올바르지/.test(await asErr('authenticated', 'select ws_cs_save($1,$2,$3,$4,$5)', [tk, '', site.id, J([{ t: 'a', photos: [{ id: '', file: { url: 'https://evil/x.jpg', path: 'cs_photo/' + ym + '/x.jpg' } }] }]), 1])), '남의 주소 사진 → 거부');
  csv = await call('ws_cs_save', [tk, '', site.id, J([{ t: '정리정돈·통로', st: '양호', photos: [{ id: csv.items[0][1], at: '14:06' }, { id: '11111111-1111-1111-1111-111111111111' }, { id: '', at: '15:00', file: CP('c3') }] }]), 1]);
  cg = await call('ws_cs_get', [tk, '', site.id, 1]);
  ok(csv.items[0].length === 2 && cg.items[0].photos.length === 2 && /c2\.jpg$/.test(cg.items[0].photos[0].src) && /c3\.jpg$/.test(cg.items[0].photos[1].src) && cg.items[0].photos[0].at === '14:06', '다시 저장: 남긴 사진 + 새 사진, 남의 id는 버림');
  ok((await one("select file_name from files where kind = 'cs_photo' order by created_at desc limit 1")).file_name.endsWith('_003.jpg'), '새 사진 번호 이어서 (지운 번호 안 씀) _003');
  cg = await call('ws_cs_get', [tk, '', site.id, 0]);
  ok(cg.round === 2 && cg.check === null && cg.rounds.length === 1, '회차 안 주면 아직 안 한 2회차 (퇴실점검)');
  csv = await call('ws_cs_save', [tk, '', site.id, J([{ t: '정리정돈·통로', st: '해당없음', photos: [] }]), 2]);
  ok(csv.rounds.length === 2 && csv.check.round === 2 && csv.check.na === 1, '2회차 저장 → 그날 회차 2개');
  const pdfP = 'cs_pdf/' + ym + '/p1.pdf';
  const cpd = await call('ws_cs_save_pdf', [tk, csv.check.id, J({ url: PUB + pdfP, path: pdfP })]);
  ok(cpd.ok && /p1\.pdf$/.test(cpd.check.pdf.url) && cpd.rounds.every(x => x.pdf && /p1\.pdf$/.test(x.pdf.url)) && cpd.check.stale === false, 'PDF 저장: 그날 회차 모두에 같은 PDF');
  ok((await one("select file_name from files where kind = 'cs_pdf'")).file_name === ch.day + '_공사장점검-5F-리모와.pdf', 'PDF 이름');
  ok((await call('ws_cs_save_pdf', [tk, 'nope', J({ url: PUB + pdfP, path: pdfP })])).error === '먼저 저장해 주세요', 'PDF: 없는 점검 → 안내');
  await call('ws_cs_save', [tk, '', site.id, J([{ t: '정리정돈·통로', st: '양호', photos: [] }]), 2]);
  ch = await call('ws_cs_home', [tk]);
  ok(ch.today.length === 2 && ch.today.find(x => x.round === 2).stale === true && ch.today.every(x => x.items === undefined), '첫 화면: 오늘 점검 2개, PDF 뒤에 고친 회차는 「다시 만들기」');
  ok((await call('ws_cs_items_save', [tk, J([{ t: '정리정돈·통로', use: false }])])).error === '「점검에 넣기」 항목을 1개 이상 골라 주세요.', '기본 항목: 점검에 넣기 없음 → 안내');
  const is = await call('ws_cs_items_save', [tk, J([{ t: '안전수칙 위반', d: '새 설명', use: true }, { t: '새 항목', d: 'n', use: true }, { t: '비치서류', use: false }])]);
  const rows = await q('select seq, item, active from cs_items order by seq');
  ok(is.ok && is.items.map(x => x.t).join() === '안전수칙 위반,새 항목,비치서류' && is.items[0].d === '새 설명' && rows.length === 10 && rows.filter(x => x.active).length === 3 && rows[2].item === '비치서류', '기본 항목 바꾸기: 순서대로, 빠진 7개는 사용 안 함(줄은 남김)');
  await q("update staff set role = '직원' where staff_id = 'S001'");
  ok((await call('ws_cs_items_save', [tk, J([{ t: 'a', use: true }])])).error === '기본 항목은 관리자·소장만 고칠 수 있습니다.', '기본 항목: 직원은 못 고침');
  await q("update staff set role = '소장' where staff_id = 'S001'");
  cst = await call('ws_cs_site_end', [tk, site.id]);
  ok(cst.ok && cst.sites.length === 0, '공사 끝 → 목록에서 빠짐');
  ok((await call('ws_cs_get', [tk, '', site.id, 1])).ok === true, '끝난 현장도 저장한 점검은 열림');
  // ══ 3-6 환경설정 (08_settings.sql) ══
  await db.exec(SQL('08_settings.sql')); await db.exec(SQL('08_settings.sql'));
  ok(true, '08_settings.sql 실행됨 (두 번)');
  ok(/permission denied/.test(await asErr('anon', "select ws_admin_staff('x')")), '비로그인: 환경설정 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', 'select ws_staff_out()')), '로그인 기기: 도우미(ws_staff_out) 못 부름');
  ok(/소장만/.test(await asErr('authenticated', 'select ws_admin_staff($1)', [kk])), '직원 기기 → 「소장만」');
  ok(/소장만/.test(await asErr('authenticated', "select ws_risk_save($1, '[]')", [kk])), '위험성 목록: 직원은 못 고침');
  let ad = await call('ws_admin_staff', [tk]);
  ok(ad.ok && ad.staff.length === 3 && ad.staff[0].staff_id === 'S001' && ad.toastSec === 2.6 && ad.staff[0].pin_hash === undefined, '직원 목록 3명 (PIN 정보는 안 보냄), 알림 기본 2.6초');
  ok((await call('ws_admin_set_toast', [tk, 20])).error === '0.5~10초 사이로 골라 주세요.', '알림 시간 범위 밖 → 안내');
  ok((await call('ws_admin_set_toast', [tk, 1.5])).toastSec === 1.5 && (await call('ws_admin_staff', [tk])).toastSec === 1.5, '알림 시간 1.5초 저장');
  ok((await call('ws_admin_staff_save', [tk, J({ name: '박', pin: '12a4' })])).error === 'PIN은 숫자 4자리입니다.', '직원 추가: PIN 모양 → 안내');
  ok(/다른 직원이 쓰고/.test((await call('ws_admin_staff_save', [tk, J({ name: '박', pin: '5678' })])).error), '직원 추가: 남의 PIN → 안내');
  ad = await call('ws_admin_staff_save', [tk, J({ name: '박민수', pin: '1357' })]);
  const nw = ad.staff.find(x => x.name === '박민수');
  ok(ad.ok && nw.staff_id === 'S004' && nw.part === '전방파트' && nw.role === '직원', '직원 추가 S004 (파트·역할 기본값)');
  const nt = await login('1357', 'n1', 'https://x/sign/n.png', 'sign/2026-11/n.png');
  ok(nt.ok === true || nt.needSign === true || nt.blocked === true, '새 직원 PIN 으로 로그인됨 (' + JSON.stringify(Object.keys(nt)) + ')');
  ad = await call('ws_admin_staff_save', [tk, J({ staff_id: 'S004', name: '박민수', part: '기건파트', role: '파트장' })]);
  ok(ad.staff.find(x => x.staff_id === 'S004').role === '파트장', '직원 편집: 파트·역할');
  ad = await call('ws_admin_staff_save', [tk, J({ staff_id: 'S001', name: '홍길동', part: '전방파트', role: '직원' })]);
  ok(ad.staff.find(x => x.staff_id === 'S001').role === '소장', '내 역할은 못 바꿈 (소장 그대로)');
  ok((await call('ws_admin_staff_save', [tk, J({ staff_id: 'S004', name: '박', part: '', role: '직원' })])).error === '파트를 넣어 주세요.', '직원 편집: 파트 빔 → 안내');
  ad = await call('ws_admin_staff_save', [tk, J({ staff_id: 'S004', name: '박민수', part: '기건파트', role: '옵저버' })]);
  ok(ad.ok && ad.staff.find(x => x.staff_id === 'S004').role === '옵저버' && ad.staff.find(x => x.staff_id === 'S004').part === '관리', '옵저버: 역할로 고를 수 있고 파트는 「관리」로 고정 (결정 138)');
  ad = await call('ws_admin_staff_save', [tk, J({ staff_id: 'S004', name: '박민수', part: '기건파트', role: '파트장' })]);
  ok(/다른 직원이 쓰고/.test((await call('ws_admin_staff_pin', [tk, 'S004', '1234'])).error), 'PIN 바꾸기: 남의 PIN → 안내');
  const before = (await one("select count(*)::int n from ws_sessions where staff_id = 'S002'")).n;
  const pc = await call('ws_admin_staff_pin', [tk, 'S002', '9753']);
  ok(pc.ok && pc.name === '김철수' && before > 0 && (await one("select count(*)::int n from ws_sessions where staff_id = 'S002'")).n === 0, 'PIN 바꿈 → 그 직원 기기 표 지움 (다시 로그인)');
  ok((await login('5678', 'pc1')).ok === false, '옛 PIN 은 이제 안 됨');
  ok((await call('ws_admin_staff_remove', [tk, 'S001'])).error === '내 계정은 지울 수 없습니다.', '내 계정 삭제 → 막음');
  ad = await call('ws_admin_staff_remove', [tk, 'S004']);
  ok(ad.ok && !ad.staff.some(x => x.staff_id === 'S004') && (await one("select active from staff where staff_id = 'S004'")).active === false, '직원 삭제 (줄은 남기고 사용 안 함)');
  ok((await login('1357', 'n2')).ok === false, '지운 직원 PIN → 로그인 안 됨');

  // 위험성 목록
  let rk = await call('ws_risk_get', [tk]);
  ok(rk.ok && rk.rows.length === 18 && typeof rk.rows[0].words === 'string' && Array.isArray(rk.rows[0].fixes), '위험성 목록 18줄 (낱말은 글자 그대로)');
  ok((await call('ws_risk_save', [tk, J([{ words: '', risk: '감전' }])])).error === '낱말이 빈 줄이 있습니다. TBM 작업에서 찾을 낱말을 넣어 주세요.', '낱말 빈 줄 → 안내');
  rk = await call('ws_risk_save', [tk, J([{ words: '분전반, 배선', risk: '감전', kind: '감전', p: '2', s: 3, fixes: [{ t: '', on: true }, { t: '절연장갑', on: true }, { t: '전원 차단 확인', on: false }] },
    { words: '', risk: '' }, { words: '사다리', risk: '떨어짐', p: 9, s: '1', fixes: [] }])]);
  ok(rk.ok && rk.rows.length === 2 && rk.rows[0].p === 2 && rk.rows[0].s === 3 && rk.rows[0].fixes.length === 2 && rk.rows[0].fixes[0].t === '절연장갑' && rk.rows[0].fixes[0].on === true && rk.rows[0].fixes[1].on === false && rk.rows[1].p === 1,
    '위험성 목록 저장: 빈 줄 버림, 빈 개선조치 당김, ✓ 미리 체크');
  const tb = await call('ws_tbm_get', [tk, '']);
  ok(tb.risks.length === 2 && tb.risks[0].words.join() === '분전반,배선', 'TBM 이 고친 목록을 씀');

  // ══ 공조기 환기온도 (12_ahu.sql, 결정 128) ══
  await db.exec(SQL('12_ahu.sql')); await db.exec(SQL('12_ahu.sql'));
  ok((await one('select count(*)::int n from ahu_unit')).n === 38, '12_ahu.sql 실행됨 (두 번) · 공조기 38대');
  ok(/permission denied/.test(await asErr('authenticated', 'select * from ahu_temp')) && /permission denied/.test(await asErr('authenticated', 'select ws_ahu_data(current_date)')), '공조기: 표·도우미는 로그인 기기도 바로 못 읽음');
  ok(/permission denied/.test(await asErr('anon', "select ws_ahu_get('x','')")) && /LOGIN/.test(await callErr('ws_ahu_get', ['bad', ''])), '공조기: 비로그인·틀린 기기 표 막음');
  let ah = await call('ws_ahu_get', [tk, '']);
  ok(ah.ok && ah.day === D && ah.units.length === 38 && ah.units[0].no === '7F-39' && ah.units[37].no === 'B3F-HVU1' && ah.rec === null && ah.wx.tmin === -3, '공조기: 빈 날, 목록 순서, 종합업무일지 날씨 ' + J(ah.wx));
  ok((await call('ws_ahu_get', [tk, tomorrow])).ok === false, '공조기: 앞날 → 안내');
  ah = await call('ws_ahu_save', [tk, D, J({ out_t12: '9.84', out_h12: '52', temps: { '7F-39': { 12: '22.3' }, 'B3F-HVU1': { 12: ' 24 ' } } })]);
  ok(ah.ok && ah.rec.out_t12 === 9.8 && ah.rec.out_h12 === 52 && ah.rec.temps['7F-39']['12'] === 22.3 && ah.rec.temps['B3F-HVU1']['12'] === 24 && ah.rec.authors.join() === '홍길동' && ah.rec.ver, '공조기 저장: 소수 한 자리, 외조기 포함');
  ah = await call('ws_ahu_save', [tk, D, J({ out_t16: '11.2', temps: { '7F-39': { 16: '22.7' } } })]);
  ok(ah.rec.out_t12 === 9.8 && ah.rec.out_t16 === 11.2 && ah.rec.temps['7F-39']['12'] === 22.3 && ah.rec.temps['7F-39']['16'] === 22.7, '공조기: 16:00 따로 저장해도 12:00 값 그대로 (고친 칸만 합침)');
  ah = await call('ws_ahu_save', [tk, D, J({ out_h12: '', temps: { 'B3F-HVU1': { 12: '' } } })]);
  ok(ah.rec.out_h12 === null && !('B3F-HVU1' in ah.rec.temps) && ah.rec.authors.length === 1, '공조기: 빈칸으로 지움, 다 비면 그 공조기 뺌, 점검자 한 번만');
  ok(/-10 ~ 50/.test((await call('ws_ahu_save', [tk, D, J({ temps: { '6F-36': { 12: '60' } } })])).error), '공조기: 환기온도 범위 밖 → 안내');
  ok(/습도 11:00/.test((await call('ws_ahu_save', [tk, D, J({ out_h12: 'abc' })])).error), '공조기: 외기 칸 글자 → 안내');
  ok(/목록에 없/.test((await call('ws_ahu_save', [tk, D, J({ temps: { 'X-1': { 12: '20' } } })])).error) && /11:00·16:00/.test((await call('ws_ahu_save', [tk, D, J({ temps: { '6F-36': { 19: '20' } } })])).error), '공조기: 없는 번호·19시 → 안내');
  ok((await call('ws_ahu_save_pdf', [tk, yest, J(F('ahu_pdf', 'a0', 'pdf'))])).error === '먼저 [저장]을 눌러 주세요', '공조기 PDF: 저장 안 한 날 → 안내');
  ah = await call('ws_ahu_save_pdf', [tk, D, J(F('ahu_pdf', 'a1', 'pdf'))]);
  ok(ah.ok && /a1\.pdf$/.test(ah.rec.pdf.url) && (await one("select file_name, drive_folder from files where kind = 'ahu_pdf'")).file_name === D + '_공조기환기온도.pdf', '공조기 PDF 저장 · 파일 이름');
  await q("update daily_log set humidity = 45 where log_date = $1", [D]);
  ok((await call('ws_ahu_get', [tk, D])).wx.humidity === 45, '공조기: 종합업무일지 습도 칸을 읽음');
  {   // 서명란: 소장 > 부소장, 기계·건축 파트장 > 냉동장, 그날 서명한 사람만 (사용자 11-19)
    const X = '2026-10-05', sf = (await one('select sign_file_id::text f from signs where sign_file_id is not null limit 1')).f;
    const sg = async () => (await call('ws_ahu_get', [tk, X])).signs;
    const sign = (id, name, staff, at) => q("insert into signs (sign_id, work_day, staff_id, name, sign_file_id, signed_at) values ($1, $2, $3, $4, $5, $6)", [id, X, staff, name, sf, X + 'T' + at + '+09']);
    await q("insert into roster (ym, seq, section, role, name) values ('2026-10',1,'관리파트','부소장','부가람'),('2026-10',2,'기계·건축','파트장','파나래'),('2026-10',3,'기계·건축','냉동장','냉다솜'),('2026-10',4,'전기·방재','파트장','전라온')");
    let x = await sg();
    ok(x.boss === null && x.part === null, '공조기 서명란: 아무도 서명 안 한 날 → 빈 칸 ' + J(x));
    await sign('AS1', '전라온', null, '08:00'); await sign('AS2', '냉다솜', null, '08:10'); await sign('AS3', '부가람', null, '08:20');
    x = await sg();
    ok(x.boss.name === '부가람' && x.part.name === '냉다솜' && /^https:\/\/x\/sign\//.test(x.part.img), '공조기 서명란: 소장·파트장 없으면 부소장·냉동장 (전기 파트장은 안 씀) ' + J(x));
    const boss = (await one("select staff_id from staff where role = '소장' and name = '홍길동'")).staff_id;
    await sign('AS4', '파나래', null, '09:00'); await sign('AS5', '홍길동', boss, '09:30');
    x = await sg();
    ok(x.boss.name === '홍길동' && x.part.name === '파나래', '공조기 서명란: 둘 다 나오면 소장·기계·건축 파트장 ' + J(x));
    // 종합업무일지 서명란 4칸 (결정 162)
    const ls = async d => (await call('ws_log_get', [tk, d])).signs, nm = v => ['front', 'mech', 'vice', 'boss'].map(k => v[k] ? v[k].name : '-').join(',');
    let v = await ls(X);
    ok(nm(v) === '전라온,파나래,부가람,홍길동' && /^https:\/\/x\/sign\//.test(v.front.img), '일지 서명란: 파트장 둘·부소장·소장이 다 나오면 각자 ' + nm(v));
    const X2 = '2026-10-06', sign2 = (id, name, staff, at) => q("insert into signs (sign_id, work_day, staff_id, name, sign_file_id, signed_at) values ($1, $2, $3, $4, $5, $6)", [id, X2, staff, name, sf, X2 + 'T' + at + '+09']);
    await q("insert into roster (ym, seq, section, role, name) values ('2026-10',5,'전기·방재','주임','주하나'),('2026-10',6,'전기·방재','주임','주세찬'),('2026-10',7,'기계·건축','주임','주두리')");
    ok(nm(await ls(X2)) === '-,-,-,-', '일지 서명란: 아무도 서명 안 한 날 → 빈 칸');
    await sign2('LS1', '주두리', null, '07:50'); await sign2('LS2', '주하나', null, '08:00'); await sign2('LS3', '주세찬', null, '08:05'); await sign2('LS4', '홍길동', boss, '08:30');
    v = await ls(X2);
    ok(nm(v) === '주하나,주두리,홍길동,홍길동', '일지 서명란: 파트장·냉동장 없으면 주임(먼저 서명한 사람) · 부소장 없으면 소장이 두 칸 ' + nm(v));
    await sign2('LS5', '냉다솜', null, '09:00'); await sign2('LS6', '부가람', null, '09:10');
    v = await ls(X2);
    ok(nm(v) === '주하나,냉다솜,부가람,홍길동', '일지 서명란: 냉동장이 주임보다 앞 · 부소장 칸은 부소장 ' + nm(v));
    await q("delete from signs where sign_id = 'LS4'");
    ok(nm(await ls(X2)) === '주하나,냉다솜,부가람,부가람', '일지 서명란: 소장 없으면 소장 칸에 부소장');
  }

  await db.exec(SQL('15_menu.sql')); await db.exec(SQL('15_menu.sql'));   // 메인 메뉴 켜기·끄기 (결정 148) — 지도·시방서가 부름
  // ══ 지도 (13_map.sql, 결정 130 · 기록 132 · 동시 편집·권한 134) ══
  await db.exec(SQL('13_map.sql'));
  await q("insert into map_kv (k, v, editor) values ('lotte_symbols_B1', '[\"old\"]', '옛사람')");   // 기록 시작 전부터 있던 칸 (11-17 배포 때처럼)
  await db.exec(SQL('13_map.sql')); await db.exec(SQL('13_map.sql'));
  ok((await one('select count(*)::int n from map_floor')).n === 0 && !SQL('13_map.sql').includes('amazonaws'), '13_map.sql 실행됨 (두 번) · 층 주소는 저장소에 없음');
  const yd = (await one("select ((now() at time zone 'Asia/Seoul')::date - 1)::text d")).d, td = (await one("select ((now() at time zone 'Asia/Seoul')::date)::text d")).d;
  ok((await one("select count(*)::int n, min(day)::text d from map_hist")).d === yd && (await one('select count(*)::int n from map_hist')).n === 1, '기록 시작: 있던 칸을 어제 기록으로 한 번만 (두 번 실행해도 1줄)');
  await q("insert into map_floor values ('avenuel','1F','https://x/1F.svg'),('avenuel','B1','https://x/B1.svg'),('dept','01','https://x/d01.svg')");
  ok(/permission denied/.test(await asErr('authenticated', 'select * from map_kv')) && /permission denied/.test(await asErr('authenticated', 'select * from map_hist')) && /permission denied/.test(await asErr('authenticated', "select ws_map_state(now())")), '지도: 표·도우미는 로그인 기기도 바로 못 읽음');
  ok(/permission denied/.test(await asErr('anon', "select ws_map_load('x')")) && /LOGIN/.test(await callErr('ws_map_load', ['bad'])) && /LOGIN/.test(await callErr('ws_map_save', ['bad', 'lotte_symbols_1F', '[]', ''])) && /LOGIN/.test(await callErr('ws_map_days', ['bad'])), '지도: 비로그인·PIN 표 없음 → 막음');
  let mp = await call('ws_map_load', [tk]);
  ok(mp.ok && mp.canEdit && mp.isBoss && mp.kv.lotte_symbols_B1 === '["old"]' && /^https:/.test(mp.urls.avenuel['1F']) && Object.keys(mp.urls.dept).length === 1, '지도: 받기 (칸·판·층 주소·소장)');
  let ms = await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[{"id":"a"}]', '']);
  ok(ms.ok && ms.ver, '지도: 새 칸 저장 → 새 판');
  ok((await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[]', ''])).conflict === true, '동시 편집: 옛 판(빈 판)으로 저장 → 「그사이 고침」');
  const ms2 = await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[]', ms.ver]);
  ok(ms2.ok && ms2.ver !== ms.ver && (await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[1]', ms.ver])).conflict === true, '동시 편집: 맞는 판이면 저장, 다른 사람이 먼저 고친 판이면 막음');
  ok((await call('ws_map_save', [tk, 'lotte_symbols_B1', null, mp.vers.lotte_symbols_B1])).ok && !('lotte_symbols_B1' in (await call('ws_map_load', [tk])).kv), '지도: null = 지움');
  ok((await call('ws_map_save', [tk, 'ws_token', 'x', ''])).ok === false && (await call('ws_map_save', [tk, 'lotte_base_svg_1F', 'x', ''])).ok === false, '지도: 이상한 칸 이름 · 바탕 도면 칸은 저장 함수로 못 씀');
  await q("insert into ws_sessions (token, staff_id, expires_at) values ('emp', 'S003', now() + interval '1 hour')");
  await q("update staff set role = '관리자' where staff_id = 'S003'");
  ok((await call('ws_map_load', ['emp'])).canEdit === false && /소장·부소장·파트장·옵저버만/.test((await call('ws_map_save', ['emp', 'lotte_symbols_1F', '[]', ''])).error), '권한: 관리자도 지도는 보기만 (결정 136)');
  await q("update staff set role = '옵저버' where staff_id = 'S003'");
  ok((await call('ws_map_load', ['emp'])).canEdit === true && (await call('ws_map_save', ['emp', 'lotte_symbols_9F', '[]', ''])).ok === true, '권한: 옵저버는 지도 고칠 수 있음 (결정 138)');
  await call('ws_map_save', ['emp', 'lotte_symbols_9F', null, (await call('ws_map_load', ['emp'])).vers.lotte_symbols_9F]);
  await q("update staff set role = '직원' where staff_id = 'S003'");
  const em = await call('ws_map_load', ['emp']);
  ok(em.ok && em.canEdit === false && em.isBoss === false && /소장·부소장·파트장·옵저버만/.test((await call('ws_map_save', ['emp', 'lotte_symbols_1F', '[]', ''])).error), '권한: 직원은 보기만 (저장 → 안내)');
  // ══ 지도 되돌리기 권한 (22_map_restore.sql, 결정 214): 소장·부소장·파트장 ══
  await db.exec(SQL('22_map_restore.sql')); await db.exec(SQL('22_map_restore.sql'));
  ok(/permission denied/.test(await asErr('authenticated', "select ws_map_can_restore('소장')")), '22_map_restore.sql 실행됨 (두 번) · 안쪽 도우미는 직접 못 부름');
  for (const [role, can] of [['소장', true], ['부소장', true], ['파트장', true], ['옵저버', false], ['관리자', false], ['직원', false]]) {
    await q(`update staff set role = '${role}' where staff_id = 'S003'`);
    const ld = await call('ws_map_load', ['emp']);
    const rs = await call('ws_map_restore', ['emp', td]);
    ok(ld.canRestore === can && (can ? /지난 날짜/.test(rs.error || '') : /소장·부소장·파트장만/.test(rs.error)), '되돌리기 권한: ' + role + (can ? ' 가능' : ' 막음') + ' (load.canRestore · restore)');
  }
  await q("update staff set role = '직원' where staff_id = 'S003'");
  // ══ 메인 메뉴 켜기·끄기 (15_menu.sql, 결정 148) ══
  ok(/소장만/.test(await callErr('ws_admin_set_menu', ['emp', ['map']])) && (await call('ws_menu', ['emp'])).off.length === 0, '메뉴: 끄기는 소장만 · 처음엔 모두 켜짐');
  ok(JSON.stringify((await call('ws_admin_set_menu', [tk, ['inspect.thermal', 'inspect.x', 'cad']])).off) === '["cad","inspect.thermal"]', '메뉴: 하위·CAD 이름 저장');
  ok(JSON.stringify((await call('ws_admin_set_menu', [tk, ['map', 'x', 'map', 'docs']])).off) === '["docs","map"]' && JSON.stringify((await call('ws_menu', ['emp'])).off) === '["docs","map"]', '메뉴: 소장이 끄면 모두에게 (모르는 이름·겹침은 버림)');
  ok(/사용 중지/.test(await callErr('ws_map_load', ['emp'])) && (await call('ws_map_load', [tk])).ok, '메뉴: 꺼진 지도는 직원에게 서버에서도 막힘 · 소장은 엶');
  await q("update staff set role = '옵저버' where staff_id = 'S003'"); const mo = await call('ws_map_load', ['emp']);
  await q("update staff set role = '관리자' where staff_id = 'S003'"); const ma = await call('ws_map_load', ['emp']);
  await q("update staff set role = '직원' where staff_id = 'S003'");
  ok(mo.ok && ma.ok, '메뉴: 옵저버·관리자는 꺼진 지도도 엶');
  ok((await call('ws_admin_set_menu', [tk, []])).off.length === 0 && (await call('ws_map_load', ['emp'])).ok && (await one("select value from settings where key = '메인메뉴끄기'")).value === '', '메뉴: 다시 켜면 직원도 엶 (설정 표 「메인메뉴끄기」)');
  ok((await one("select count(*)::int n from map_hist where k = 'lotte_util_lines_1F'")).n === 1 && (await one("select v from map_hist where k = 'lotte_util_lines_1F'")).v === '[]', '기록: 같은 날 같은 칸은 마지막 것만');
  // 업체 바탕 도면
  let mb = await call('ws_map_base', ['emp', 'lotte_base_svg_1F', '<svg>v1</svg>']);
  ok(mb.ok && !mb.same && (await call('ws_map_base', ['emp', 'lotte_base_svg_1F', '<svg>v1</svg>'])).same === true && (await call('ws_map_load', [tk])).bases.lotte_base_svg_1F === mb.sha, '바탕 도면: 처음 보관, 같은 그림은 다시 안 넣음, 받기에 sha');
  ok((await call('ws_map_base', [tk, 'lotte_symbols_1F', 'x'])).ok === false, '바탕 도면: 다른 칸 이름 → 막음');
  // 날짜별 보기: 어제(기록 시작) · 오늘
  let mdy = await call('ws_map_days', [tk]);
  ok(mdy.days.length === 2 && mdy.days[0].day === yd && mdy.days[1].day === td && mdy.days[1].keys.includes('lotte_util_lines_1F') && mdy.days[1].by.includes('홍길동'), '기록 날짜: 어제 · 오늘, 바뀐 칸 · 고친 사람');
  let mat = await call('ws_map_at', [tk, yd]);
  ok(mat.ok && mat.kv.lotte_symbols_B1 === '["old"]' && !('lotte_util_lines_1F' in mat.kv) && !('lotte_base_svg_1F' in mat.kv), '어제 모습: 그때 칸만 (오늘 지운 칸은 있고, 오늘 만든 칸·바탕은 없음)');
  mat = await call('ws_map_at', [tk, td]);
  ok(mat.kv.lotte_util_lines_1F === '[]' && !('lotte_symbols_B1' in mat.kv) && mat.kv.lotte_base_svg_1F === '<svg>v1</svg>', '오늘 모습: 바탕 도면 포함, 지운 칸 없음');
  ok((await call('ws_map_at', [tk, 'x'])).ok === false, '날짜 모양이 틀리면 안내');
  // 되돌리기 (소장만)
  ok(/소장·부소장·파트장만/.test((await call('ws_map_restore', ['emp', yd])).error) && /지난 날짜/.test((await call('ws_map_restore', [tk, td])).error), '되돌리기: 직원 막음 · 오늘은 안 됨');
  const mrs = await call('ws_map_restore', [tk, yd]);
  mp = await call('ws_map_load', [tk]);
  ok(mrs.ok && mrs.n === 2 && mp.kv.lotte_symbols_B1 === '["old"]' && !('lotte_util_lines_1F' in mp.kv), '되돌리기: 어제 모습으로 (칸 2개 바뀜)');
  mdy = await call('ws_map_days', [tk]);
  ok(mdy.restores.length === 1 && mdy.restores[0].to === yd && mdy.restores[0].by === '홍길동', '되돌리기 기록');
  mat = await call('ws_map_at', [tk, mdy.restores[0].before]);
  ok(mat.kv.lotte_util_lines_1F === '[]' && !('lotte_symbols_B1' in mat.kv), '되돌리기 전 모습을 그대로 불러옴 (기록에 남음)');
  ok((await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[9]', ''])).ok && (await call('ws_map_at', [tk, mdy.restores[0].before])).kv.lotte_util_lines_1F === '[]', '되돌린 뒤 또 고쳐도 되돌리기 전 기록은 지워지지 않음');
  // ══ 시방서 검색 (14_spec.sql, 결정 140) — 도면협의 표·함수는 DW SQL 에서 그대로 떼어 옴 ══
  const DW = f => require('fs').readFileSync(path.join(__dirname, '..', '..', 'dw', 'supabase', f), 'utf8');
  await db.exec(DW('01_schema.sql').match(/create table if not exists public\.(dw_files|dw_guides|dw_synonyms) \([\s\S]*?\);/g).join('\n'));
  await db.exec(DW('03_api.sql').match(/create or replace function public\.(dw_guides_client_|dw_synonyms_)\(\)[\s\S]*?\$\$;/g).join('\n'));
  await db.exec(SQL('14_spec.sql')); await db.exec(SQL('14_spec.sql'));
  ok(/check/.test(await err("update staff set role = '손님' where staff_id = 'S003'")) && !(await err("update staff set role = '옵저버' where staff_id = 'S003'")), '14_spec.sql 두 번 실행 · 역할 검사에 옵저버 (다른 이름은 막음)');
  await q("update staff set role = '직원' where staff_id = 'S003'");
  const gpg = await one("insert into dw_files (kind, file_url, storage_path) values ('guide_page', 'https://b/g1/12.jpg', 'guide/G1/12.jpg') returning id::text");
  const gpd = await one("insert into dw_files (kind, file_url, storage_path) values ('guide_pdf', 'https://b/g1.pdf', 'guide/pdf/g1.pdf') returning id::text");
  const mv = await one("insert into dw_files (kind, file_url, drive_id) values ('guide_page', 'https://drive/x', 'DRV1') returning id::text");
  await q("insert into dw_guides (id, ord, title, short, pages, file_id, entries, page_map) values ('G1', 1, '시설공사 지침', '시설공사', 86, $1, $2, $3)",
    [gpd.id, JSON.stringify([{ d: 'G1', p: 12, t: '방화구획 관통부' }, { d: 'G1', p: 13, t: '감지기' }]), JSON.stringify({ 12: gpg.id, 13: mv.id })]);
  await q("insert into dw_guides (id, title, short, entries, archived, archived_at) values ('G0', '옛 지침', '옛', $1, true, '2026-01-01')", [JSON.stringify([{ d: 'G0', p: 1, t: '방화구획 옛' }])]);
  await q("insert into dw_synonyms values (1, '방화구획', '방화 구획, 방화벽')");
  ok(/permission denied/.test(await asErr('anon', "select ws_spec_index('x')")) && /LOGIN/.test(await callErr('ws_spec_boot', ['bad'])) && /LOGIN/.test(await callErr('ws_spec_page', ['bad', 'G1', 12])), '시방서: 손님 막음 · 로그인 표 없으면 막음');
  await call('ws_admin_set_menu', [tk, ['spec']]);
  ok(/사용 중지/.test(await callErr('ws_spec_boot', ['emp'])) && (await call('ws_admin_set_menu', [tk, []])).ok, '메뉴: 꺼진 시방서 검색도 직원에게 서버에서 막힘 (결정 148)');
  const sb = await call('ws_spec_boot', ['emp']);
  ok(sb.ok && sb.guides.length === 2 && sb.guides[0].id === 'G1' && sb.guides[1].archived === true && sb.synonyms.length === 1 && sb.synonyms[0].includes('방화벽'), '시방서: 지침 목록(이전 판 뒤) · 비슷한 말 — 직원도 읽음');
  const si = await call('ws_spec_index', ['emp']);
  ok(si.ok && si.entries.length === 3 && si.entries[0].p === 12 && si.entries[2].d === 'G0', '시방서: 검색 항목 (지금 판 먼저, 쪽 순서)');
  const sp = await call('ws_spec_page', ['emp', 'G1', 12]), sp2 = await call('ws_spec_page', ['emp', 'G1', 13]);
  ok(sp.img === 'https://b/g1/12.jpg' && sp.pdf === 'https://b/g1.pdf' && sp2.ok && sp2.img === '' && (await call('ws_spec_page', ['emp', 'GX', 1])).ok === false, '시방서: 쪽 그림·원본 PDF 주소 (드라이브로 옮긴 것은 빈 값, 없는 지침은 안내)');
  // 외부용 단독 페이지 (결정 142): 로그인 없이(anon) 읽기만 · 지금 판만 · 원본 PDF 주소 없음
  const pr = r => r[0][Object.keys(r[0])[0]];
  const pb = pr(await as('anon', 'select ws_spec_pub_boot()')), ps = q2 => as('anon', 'select ws_spec_pub_search($1, $2)', q2).then(pr);
  const pp = pr(await as('anon', "select ws_spec_pub_page('G1', 12)")), po = pr(await as('anon', "select ws_spec_pub_page('G0', 1)"));
  ok(pb.ok && pb.guides.length === 1 && pb.guides[0].id === 'G1' && pb.synonyms.length === 1, '외부용: 손님(anon)도 열림 · 이전 판 지침은 목록에서 뺌');
  const ss1 = await ps(['방화 구획', ['G1', 'G0']]), ss2 = await ps(['방화벽', ['G1']]), ss3 = await ps(['감지기', []]), ss4 = await ps(['  ', ['G1']]);
  ok(ss1.entries.length === 1 && ss1.entries[0].p === 12 && ss1.counts.G1 === 1 && !('G0' in ss1.counts), '외부용 검색(결정 146): 서버에서 찾음 · 띄어쓰기 무시 · 이전 판은 고르더라도 안 줌');
  ok(ss2.entries.length === 1 && ss2.entries[0].p === 12, '외부용 검색: 비슷한 말 묶음(방화벽 → 방화구획)도 찾음');
  ok(ss3.entries.length === 0 && ss3.counts.G1 === 1 && ss4.entries.length === 0, '외부용 검색: 고른 지침이 없으면 결과 없이 건수만 · 빈 검색어는 빈 답');
  ok(/does not exist/.test(await asErr('anon', 'select ws_spec_pub_index()')), '외부용: 색인 통째로 주던 함수는 없앰');
  ok(pp.img === 'https://b/g1/12.jpg' && pp.pdf === '' && po.ok === false, '외부용: 쪽 그림만 (원본 PDF 주소 없음 · 이전 판 쪽은 안 줌)');
  // ══ 열화상점검 (16_thermal.sql, 결정 166·168) — 작성기(fm/thermal)는 업무지원 통로로만 ══
  await db.exec(SQL('16_thermal.sql')); await db.exec(SQL('16_thermal.sql'));
  ok(/permission denied/.test(await asErr('authenticated', 'select * from thermal_kv')) || !(await as('authenticated', 'select * from thermal_kv')).length, '16_thermal.sql 두 번 실행 · 표는 직접 못 읽음');
  ok(/permission denied/.test(await asErr('anon', "select ws_thermal_boot('x')")), '열화상: 비로그인(anon)은 못 부름');
  await q("update staff set role = '직원' where staff_id = 'S003'");
  const tpl = JSON.stringify({ path: 'thermal/2026-11/s.atr', url: 'https://b/s.atr', name: 's.atr' });
  for (const role of ['직원', '파트장', '부소장', '관리자', '옵저버']) {
    await q("update staff set role = $1 where staff_id = 'S003'", [role]);
    const bo = await call('ws_thermal_boot', ['emp']), boss = role !== '직원' && role !== '파트장';
    ok(bo.ok === true && bo.me.role === role && (await call('ws_thermal_set', ['emp', 'model', '{"a":1}'])).ok === true, '열화상(결정 212): ' + role + '도 열고 학습 값을 저장함');
    const ts = await call('ws_thermal_set', ['emp', 'template', tpl]);
    ok(ts.ok === boss && (boss || /양식 파일은 소장·부소장·관리자·옵저버만/.test(ts.error)), '열화상(결정 212): 양식 바꾸기는 ' + role + (boss ? '은 됨' : '은 막힘'));
    if (boss) await call('ws_thermal_set', [tk, 'template', JSON.stringify({ path: 'thermal/2026-11/zz.atr', url: 'https://b/z', name: 'z' })]);
  }
  await call('ws_thermal_set', [tk, 'model', 'null']);
  await q("update staff set role = '직원' where staff_id = 'S003'");
  await q("delete from thermal_kv where k in ('model', 'template')");
  const tb0 = await call('ws_thermal_boot', [tk]);
  ok(tb0.ok && tb0.me.role === '소장' && tb0.model === null && tb0.template === null && tb0.reports.length === 0, '열화상: 처음엔 학습 값·양식·보고서 없음 · 나(이름·역할)');
  ok((await call('ws_thermal_set', [tk, 'model', JSON.stringify({ avg_y: 125, samples: [] })])).ok && (await call('ws_thermal_boot', [tk])).model.avg_y === 125, '열화상: 학습 값 저장·읽기');
  ok((await call('ws_thermal_set', [tk, 'x', '{}'])).ok === false && (await call('ws_thermal_set', [tk, 'template', JSON.stringify({ path: 'sign/a.atr' })])).ok === false, '열화상: 모르는 칸·thermal/ 밖 양식 경로는 막음');
  ok((await call('ws_thermal_set', [tk, 'template', JSON.stringify({ path: 'thermal/2026-11/a.atr', url: 'https://b/a.atr', name: '양식.atr' })])).ok && (await call('ws_thermal_boot', [tk])).template.name === '양식.atr', '열화상: 양식 파일 저장');
  ok((await call('ws_thermal_report', [tk, JSON.stringify({ title: '', path: 'thermal/x.atr', url: 'https://b/x' })])).ok === false && (await call('ws_thermal_report', [tk, JSON.stringify({ title: 'EPS', path: 'tbm_pdf/x', url: 'https://b/x' })])).ok === false, '열화상: 제목 없음·thermal/ 밖 경로는 막음');
  const tr = await call('ws_thermal_report', [tk, JSON.stringify({ title: '2026년 4분기 EPS 1층', inspector: '홍길동', date: '2026-11-20', path: 'thermal/2026-11/r.atr', url: 'https://b/r.atr', pages: 3, max_dt: '4.2' })]);
  const tb1 = await call('ws_thermal_boot', [tk]);
  ok(tr.ok && tr.id > 0 && tb1.reports.length === 1 && tb1.reports[0].pages === 3 && Number(tb1.reports[0].max_dt) === 4.2 && !('editor' in tb1.reports[0]), '열화상: 보고서 기록 → 목록에 (만든 사람 이름은 안 내보냄)');
  const tp = await call('ws_thermal_report', [tk, JSON.stringify({ title: 'PDF만', date: '2026-11-20', pdf_path: 'thermal/2026-11/a.pdf', pdf_url: 'https://b/a.pdf', drive_url: 'https://drive.google.com/file/d/x/view', pages: 2 })]);
  const tb2 = await call('ws_thermal_boot', [tk]);
  ok(tp.ok && tb2.reports[0].pdf_url === 'https://b/a.pdf' && tb2.reports[0].drive_url.startsWith('https://drive.google.com') && tb2.reports[0].path === '', '열화상: PDF만 있는 기록(.atr 없이) · PDF·드라이브 주소가 목록에');
  ok((await call('ws_thermal_report', [tk, JSON.stringify({ title: 'x', pdf_path: 'tbm_pdf/a.pdf', pdf_url: 'https://b/a.pdf' })])).ok === false && (await call('ws_thermal_report', [tk, JSON.stringify({ title: 'x', pdf_path: 'thermal/a.pdf', pdf_url: 'https://b/a.pdf', drive_url: 'http://x' })])).ok === false, '열화상: PDF 경로가 thermal/ 밖 · 드라이브 주소가 https 아님 → 막음');
  await db.exec(SQL('16_thermal.sql'));   // 이미 쓰던 표에 다시 실행해도 기록이 남음 (칸 더하기)
  ok((await call('ws_thermal_boot', [tk])).reports.length === 2, '열화상: 16_thermal.sql 다시 실행해도 기록 유지');
  // ══ CAD 변환 도면 (18_cad.sql) — 전 직원이 보고 올림, 지우기는 소장만 ══
  await db.exec(SQL('18_cad.sql')); await db.exec(SQL('18_cad.sql'));
  ok(/permission denied/.test(await asErr('anon', "select ws_cad_list('x')")), 'CAD: 비로그인(anon)은 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', 'select * from cad_file')) || !(await as('authenticated', 'select * from cad_file')).length, 'CAD: 표는 직접 못 읽음');
  const cp = 'cad/2026-11/' + 'a'.repeat(32) + '.dxf', cu = 'https://b/' + cp;
  await q("update staff set role = '직원' where staff_id = 'S003'");
  ok((await call('ws_cad_list', ['emp'])).items.length === 0, 'CAD: 직원도 목록을 엶 (처음엔 비어 있음)');
  const c1 = await call('ws_cad_save', ['emp', JSON.stringify({ name: '1층 평면도', floor: '1F', memo: '시험', path: cp, url: cu, size: 1000, drive_url: 'https://drive.google.com/file/d/x/view' })]);
  ok(c1.ok && c1.id, 'CAD: 직원도 올림');
  ok((await call('ws_cad_save', ['emp', JSON.stringify({ name: 'x', path: 'sign/a.dxf', url: cu })])).ok === false && (await call('ws_cad_save', ['emp', JSON.stringify({ name: '', path: cp, url: cu })])).ok === false, 'CAD: cad/ 밖 경로·빈 이름은 막음');
  ok((await call('ws_cad_save', ['emp', JSON.stringify({ name: 'big', path: cp, url: cu, size: 60 * 1048576 })])).ok === false && (await call('ws_cad_save', ['emp', JSON.stringify({ name: 'd', path: cp, url: cu, drive_url: 'http://x' })])).ok === false, 'CAD: 50MB 넘음·http 드라이브 주소는 막음');
  const c2 = await call('ws_cad_save', ['emp', JSON.stringify({ name: '1층 평면도', floor: '1F', path: cp.replace('aaaa', 'bbbb'), url: cu, size: 2000 })]);
  const cl = await call('ws_cad_list', [tk]);
  ok(c2.ok && c2.id === c1.id && cl.items.length === 1 && cl.items[0].size === 2000 && cl.items[0].by && cl.items[0].date, 'CAD: 같은 이름은 새 파일로 바꿈(한 줄) · 목록에 이름·층·올린 사람·날짜·크기');
  ok(/소장만/.test(await err("select ws_cad_delete('emp', " + Number(c1.id) + ')')), 'CAD: 직원은 못 지움');
  ok((await call('ws_cad_delete', [tk, Number(c1.id)])).ok && (await call('ws_cad_list', [tk])).items.length === 0, 'CAD: 소장은 지움');
  const cl0 = await call('ws_cad_list', ['emp']);
  ok(cl0.cats.map(c => c.name).join() === '공조,소방,전기,건축' && cl0.can_del_cat === false && (await call('ws_cad_list', [tk])).can_del_cat === true, 'CAD 분류: 처음 공조·소방·전기·건축 · 지우기 권한은 소장급만');
  const ca = await call('ws_cad_cat_add', ['emp', ' 통신 ']);
  ok(ca.ok && (await call('ws_cad_cat_add', ['emp', '통신'])).ok === false && (await call('ws_cad_cat_add', ['emp', ''])).ok === false, 'CAD 분류: 직원도 만듦 · 같은 이름·빈 이름은 막음');
  const cx = await call('ws_cad_save', ['emp', JSON.stringify({ name: '분류 시험', path: cp, url: cu, size: 10, cat_id: String(ca.id) })]);
  const cl1 = await call('ws_cad_list', [tk]);
  ok(cx.ok && cl1.items.find(i => i.name === '분류 시험').cat === '통신' && cl1.cats.find(c => c.name === '통신').n === 1, 'CAD 분류: 올릴 때 분류 · 목록에 분류 이름 · 분류별 개수');
  ok((await call('ws_cad_set_cat', ['emp', Number(cx.id), null])).ok && (await call('ws_cad_list', [tk])).items.find(i => i.name === '분류 시험').cat === '', 'CAD 분류: 바꾸기 → 분류 없음(미분류)');
  await call('ws_cad_set_cat', ['emp', Number(cx.id), Number(ca.id)]);
  ok((await call('ws_cad_cat_del', ['emp', Number(ca.id)])).ok === false, 'CAD 분류: 직원은 못 지움');
  const cd = await call('ws_cad_cat_del', [tk, Number(ca.id)]);
  const cl2 = await call('ws_cad_list', [tk]);
  ok(cd.ok && cd.moved === 1 && cl2.items.find(i => i.name === '분류 시험').cat === '' && !cl2.cats.find(c => c.name === '통신'), 'CAD 분류: 소장이 지우면 도면은 남고 미분류로');
  await db.exec(SQL('18_cad.sql'));
  ok((await call('ws_cad_list', [tk])).cats.length === 4, 'CAD: 18_cad.sql 다시 실행해도 분류 유지');
  // PC 변환기 업로드: PIN 대조 → 그 직원 이름으로 기록 (구글 서버만 부름)
  ok(/permission denied/.test(await asErr('anon', "select ws_cad_pc_check('1234')")) && /permission denied/.test(await asErr('authenticated', "select ws_cad_pc_check('1234')")), 'CAD PC: 일반 로그인(anon·authenticated)은 PIN 대조 함수를 못 부름');
  const pc1 = await as('service_role', "select ws_cad_pc_check('1234') r").then(r => r[0].r);
  ok(pc1.ok && pc1.name === '홍길동' && pc1.role === '소장', 'CAD PC: 소장 PIN → 홍길동(소장)');
  await q("update staff set active = true, role = '직원', pin_salt = 'sx', pin_hash = $1 where staff_id = 'S002'", [sha('sx5678')]);
  const pcp = 'cad/2026-11/' + 'c'.repeat(32) + '.dxf';
  const pc2 = await as('service_role', 'select ws_cad_pc_save($1, $2) r', ['5678', JSON.stringify({ name: 'PC 도면', floor: '2F', path: pcp, url: 'https://b/' + pcp, size: 5 })]).then(r => r[0].r);
  ok(pc2.ok && (await call('ws_cad_list', [tk])).items.find(i => i.name === 'PC 도면').by === '김철수', 'CAD PC: 직원 PIN(5678) → 김철수가 올린 것으로 기록');
  await q("delete from ws_pin_guard where key = 'cadpc'");
  const pcw = []; for (let i = 0; i < 5; i++) pcw.push((await as('service_role', "select ws_cad_pc_check('9999') r").then(r => r[0].r)).error);
  ok(/\(1\/5\)/.test(pcw[0]) && /5분 동안 막았/.test(pcw[4]), 'CAD PC: PIN 5번 틀리면 5분 잠금 (횟수 안내)');
  ok(/5분 동안 막았/.test((await as('service_role', "select ws_cad_pc_check('1234') r").then(r => r[0].r)).error), 'CAD PC: 잠긴 동안은 맞는 PIN도 안 받음');
  await q("delete from ws_pin_guard where key = 'cadpc'");
  ok((await as('service_role', "select ws_cad_pc_save('0000', '{}') r").then(r => r[0].r)).ok === false, 'CAD PC: 없는 PIN은 기록 안 함');
  await q("delete from ws_pin_guard where key = 'cadpc'");
  let lim = 0; for (let i = 0; i < 31; i++) { if ((await call('ws_cad_save', ['emp', JSON.stringify({ name: 'L' + i, path: cp, url: cu })])).ok) lim++; }
  ok(lim === 29, 'CAD: 한 사람 하루 30개까지 (앞서 1개 올림 + ' + lim + ')');
  // ══ 온습도/공조기/에어커튼 입력 (19_climate.sql, 결정 212·194·196) ══
  await db.exec(SQL('19_climate.sql')); await db.exec(SQL('19_climate.sql'));
  const cnt = async t => (await one('select count(*)::int n from ' + t)).n;
  ok(await cnt('curtain_unit') === 36 && await cnt('climate_zone') === 19 && await cnt('ahu_unit where active') === 38 && await cnt('ahu_unit where not active') === 3, '19_climate.sql 두 번 실행 · 에어커튼 36 · 구역 19 · 공조기 38 + 옛 3·37·38 (화면 밖)');
  ok((await one('select count(*)::int n from ahu_unit where active and (use_floor is null or old_no is null)')).n === 0 && (await one("select old_no from ahu_unit where no = 'B3F-HVU1'")).old_no === 41 && (await one("select old_no from ahu_unit where no = '7F-39'")).old_no === 39, '공조기 번호 맞춤: 38대 모두 쓰는 층·옛 번호 · 41 → B3F-HVU1 · 39 → 7F-39');
  ok((await call('ws_ahu_get', [tk, D])).units.length === 38, '환기온도 목록은 그대로 38대 (옛 번호 줄은 안 보임)');
  ok(/permission denied/.test(await asErr('authenticated', 'select * from equip_usage')) && /permission denied/.test(await asErr('anon', "select ws_usage_get('x','hvac','')")) && /LOGIN/.test(await callErr('ws_usage_get', ['bad', 'hvac', ''])), '가동시간: 표는 못 읽음 · 비로그인·틀린 표 막음');
  let ug = await call('ws_usage_get', [tk, 'hvac', '']);
  ok(ug.ok && ug.units.length === 38 && ug.units[0].grp === '6층' && ug.units[0].tone === 'f6' && ug.units.find(u => u.u === '7F-39').e === 1310 && ug.units.find(u => u.u === 'B3F-1').s === 510 && ug.units.find(u => u.u === '5F-27').ew === 1220, '공조기 가동: 6층부터 · 층 색 · 6층 21:50 · B3층 08:30 · 금토일 20:20');
  const ucu = await call('ws_usage_get', [tk, 'curtain', '']);
  ok(ucu.units.length === 36 && ucu.units[2].name === '1번' && ucu.units[2].tone === 'f1out' && ucu.units.find(u => u.u === '4BR-1').name === '4층 브릿지' && ucu.units[0].e === 1200 && ucu.units[0].ew === 1170, '에어커튼: 36대 · OUT 주황 · 브릿지는 번호 없이 · 기본 20:00 / 금토일 19:30');
  const td0 = await call('ws_usage_todo', [tk]);
  ok(td0.ok && td0.hvac === 38 && td0.curtain === 36 && /오늘|어제/.test(td0.when), '미입력: 처음엔 공조기 38 · 에어커튼 36 (' + td0.when + ')');
  ug = await call('ws_usage_save', [tk, 'hvac', td0.day, J([{ u: '7F-39', s: 600, e: 1310 }, { u: '6F-36', off: true }, { u: '6F-34', s: 600, e: 1160 }])]);
  ok(ug.ok && ug.recs['7F-39'].e === 1310 && ug.recs['6F-36'].off === true && ug.recs['7F-39'].by === '홍길동', '가동 저장 · 미가동');
  ok((await call('ws_usage_todo', [tk])).hvac === 35, '미입력: 미가동도 입력으로 셈 (35대)');
  ok(/둘 다/.test((await call('ws_usage_save', [tk, 'hvac', D, J([{ u: '6F-32', s: 600 }])])).error) && /늦어야/.test((await call('ws_usage_save', [tk, 'hvac', D, J([{ u: '6F-32', s: 700, e: 600 }])])).error) && /10분/.test((await call('ws_usage_save', [tk, 'hvac', D, J([{ u: '6F-32', s: 605, e: 700 }])])).error) && /목록에 없/.test((await call('ws_usage_save', [tk, 'hvac', D, J([{ u: 'OLD-3', s: 600, e: 700 }])])).error), '가동 검사: 한쪽만·거꾸로·10분 아님·옛 번호 → 안내');
  ok(/31일/.test((await call('ws_usage_save', [tk, 'hvac', '2020-01-01', J([{ u: '6F-32', s: 600, e: 700 }])])).error), '가동: 31일 넘은 날은 못 고침');
  await call('ws_usage_save', [tk, 'hvac', td0.day, J([{ u: '6F-34', s: '', e: '' }])]);
  ok((await one("select count(*)::int n from equip_usage where unit = '6F-34'")).n === 1 && (await call('ws_usage_todo', [tk])).hvac === 36, '가동: 칸을 비우면 미입력으로 (줄은 지우지 않음)');
  await call('ws_usage_save', [tk, 'curtain', td0.day, J([{ u: '1G1OUT-1', s: 600, e: 1170 }, { u: '4BR-1', off: true }])]);
  const rp = await call('ws_usage_report', [tk, 'hvac', '', D]);
  ok(rp.ok && rp.rows.length === 2 && rp.rows.find(r => r[1] === '7F-39')[2] === 710 && rp.rows.find(r => r[1] === '6F-36')[2] === 0 && rp.price === null, '리포트 자료: 입력한 장비만 분(미가동 0, 빈 칸 뺌) · 단가 없음');
  ok(/소장만/.test(await callErr('ws_equip_kw_get', ['emp'])) && /소장만/.test(await callErr('ws_equip_kw_save', ['emp', J({ price: '100' })])), 'kW·단가: 소장만');
  let kw = await call('ws_equip_kw_save', [tk, J({ price: '130.5', hvac: { '7F-39': '7.5' }, curtain: { '1G1OUT-1': '1.2' } })]);
  ok(kw.ok && Number(kw.price) === 130.5 && Number(kw.hvac.find(u => u.u === '7F-39').kw) === 7.5 && Number(kw.curtain.find(u => u.u === '1G1OUT-1').kw) === 1.2 && kw.hvac.filter(u => u.kw == null).length === 37, 'kW·단가 저장 (나머지는 빈 칸)');
  ok(/0 ~ 1000/.test((await call('ws_equip_kw_save', [tk, J({ hvac: { '7F-39': 'abc' } })])).error) && /단가/.test((await call('ws_equip_kw_save', [tk, J({ price: '-1' })])).error), 'kW·단가: 글자·음수 → 안내');
  await db.exec(SQL('19_climate.sql'));
  ok(Number((await call('ws_equip_kw_get', [tk])).hvac.find(u => u.u === '7F-39').kw) === 7.5, '18 다시 실행해도 kW는 그대로');
  kw = await call('ws_equip_kw_save', [tk, J({ hvac: { '7F-39': '' } })]);
  ok(kw.hvac.find(u => u.u === '7F-39').kw == null && Number(kw.price) === 130.5, 'kW 지우면 빈 칸 · 단가는 그대로');
  // 온습도
  ok(/permission denied/.test(await asErr('anon', "select ws_climate_get('x')")) && /LOGIN/.test(await callErr('ws_climate_add', ['bad', '[]', '{}'])), '온습도: 비로그인·틀린 표 막음');
  const clg = await call('ws_climate_add', [tk, J([{ floor: '6F', zone: '1구역', t: '24.1', h: '52' }, { floor: '6F', zone: '2구역', t: '26.4', h: '62' }]), J({ t: '11.2', h: '48' })]);
  ok(clg.ok && clg.recs.length === 2 && Number(clg.recs[0].di) === 70.8 && Number(clg.recs[1].di) === 75 && clg.zones.length === 19, '온습도 저장 · 불쾌지수 서버 계산 (70.8 · 75.0) ' + JSON.stringify(clg.recs && clg.recs.map(r => r.di)));
  ok(/온도는 -10/.test((await call('ws_climate_add', [tk, J([{ floor: '6F', zone: '1구역', t: '60', h: '50' }]), J({})])).error) && /위치/.test((await call('ws_climate_add', [tk, J([{ floor: 'B1F', zone: '2구역', t: '20', h: '50' }]), J({})])).error) && /실외습도/.test((await call('ws_climate_add', [tk, J([{ floor: '6F', zone: '1구역', t: '20', h: '50' }]), J({ h: '120' })])).error) && /없습니다/.test((await call('ws_climate_add', [tk, J([]), J({})])).error), '온습도 검사: 범위·B1F 2구역·실외습도·빈 저장 → 안내');
  const cr = await call('ws_climate_report', [tk, '', D]);
  ok(cr.ok && cr.rows.length === 2 && Number(cr.rows[0][6]) === 11.2 && cr.rows[0][1] === '6F', '온습도 리포트 자료 (실외 같이)');
  // 종합업무일지 (구글 통로 대신, 결정 194)
  await call('ws_usage_save', [tk, 'hvac', D, J([{ u: '7F-39', s: 600, e: 1310 }, { u: '6F-36', off: true }])]);
  const la = await call('ws_log_ac', [tk, D, '']), hv = la.ac.hvac;
  ok(la.ok && hv.name === '공조기' && hv.total === 38 && hv.groups.length === 8 && hv.groups[0][0] === '6층' && hv.groups[6][0] === 'B1' && hv.groups[0][1].length === 5 && la.ac.curtain.groups.length === 9 && la.ac.curtain.groups[8][0] === '4·6 브릿지', '일지 가동: 옛 구글 통로와 같은 묶음 (공조기 8 · 에어커튼 9)');
  ok(hv.entered === 2 && hv.off === 1 && Number(hv.c.d) === 11.8 && Number(hv.c.m) >= 11.8 && hv.p.d === null && hv.groups[0][1].includes(11.8), '일지 가동: 그날 입력 2 · 미가동 1 · 합 11.8시간 · 전년 없음 ' + JSON.stringify(hv.c));
  // ══ 가동시간 설정 (21_equip_hours.sql, 결정 200) ══
  await db.exec(SQL('21_equip_hours.sql')); await db.exec(SQL('21_equip_hours.sql'));
  ok((await call('ws_equip_hours_get', ['emp', 'hvac'])).ok === true && /저장할 내용이 없습니다/.test((await call('ws_equip_hours_save', ['emp', 'hvac', '[]'])).error) && (await callErr('ws_equip_hours_get', ['nope', 'hvac'])) !== '' && /permission denied/.test(await asErr('authenticated', 'select * from equip_hours')), '가동시간 설정: 전 직원 보기·고치기 (결정 218) · 로그인 안 하면 안 됨 · 표 직접 못 봄');
  let hr = await call('ws_equip_hours_get', [tk, 'hvac']);
  ok(hr.ok && hr.groups.length === 8 && hr.groups[0].g === '6층' && hr.groups[0].days.length === 7 && hr.groups[0].days[0][1] === 1310 && hr.groups[1].days[0][1] === 1160 && hr.groups[1].days[4][1] === 1220 && hr.groups[7].days[6][0] === 510 && hr.groups[0].days[0][2] === false, '설정: 처음엔 예전 기본값 (5층 월~목 19:20 · 금토일 20:20 · B3 08:30)');
  ok((await call('ws_equip_hours_get', [tk, 'curtain'])).groups.length === 10, '설정: 에어커튼 10묶음');
  const dw = (await one("select extract(isodow from '" + D + "'::date)::int w")).w;
  hr = await call('ws_equip_hours_save', [tk, 'hvac', J([{ g: '5층', w: dw, s: 540, e: 1440 }])]);
  ok(hr.ok && hr.groups[1].days[dw - 1][0] === 540 && hr.groups[1].days[dw - 1][2] === true, '설정 저장 (자정 종료 1440)');
  ug = await call('ws_usage_get', [tk, 'hvac', D]);
  ok(ug.units.find(u => u.u === '5F-27').s === 540 && ug.units.find(u => u.u === '5F-27').e === 1440 && ug.units.find(u => u.u === '5F-27').ew === 1440 && ug.units.find(u => u.u === '7F-39').s === 600, '가동 입력 기본 시각이 그 요일 설정을 따름 (다른 층은 그대로)');
  ok(/목록에 없/.test((await call('ws_equip_hours_save', [tk, 'hvac', J([{ g: '9층', w: 1, s: 600, e: 700 }])])).error) && /늦어야/.test((await call('ws_equip_hours_save', [tk, 'hvac', J([{ g: '5층', w: 1, s: 700, e: 600 }])])).error) && /10분/.test((await call('ws_equip_hours_save', [tk, 'hvac', J([{ g: '5층', w: 1, s: 605, e: 700 }])])).error) && /모두/.test((await call('ws_equip_hours_save', [tk, 'hvac', J([{ g: '5층', w: 8, s: 600, e: 700 }])])).error), '설정: 없는 층 · 거꾸로 · 10분 아닌 값 · 틀린 요일 막음');
  await db.exec(SQL('21_equip_hours.sql'));
  ok((await call('ws_equip_hours_get', [tk, 'hvac'])).groups[1].days[dw - 1][0] === 540, '21 다시 실행해도 설정 그대로');
  // ══ 옛 시트 옮기기 (tools/climate_csv.js → 20_climate_data.sql) ══
  {
    const M = require('../tools/climate_csv.js');
    const CLC = 'id,매장ID,측정시각,층,구역,실내온도,실내습도,불쾌지수,실외온도,실외습도,ts\n' +
      'r1,mall-001,2025-05-01 14:05,6F,1구역,24.1,52,70.8,11.2,48,1746075900000\n' +
      'r1,mall-001,2025-05-01 14:05,6F,1구역,24.1,52,70.8,11.2,48,1746075900000\n' +   // 같은 id 두 번
      'r2,mall-001,"2025. 5. 2 오전 3:10:00",B1F,1구역,22.5,40,,,,\n' +              // ts 없음 · 불쾌지수 빈 칸
      'r3,mall-001,,6F,2구역,24,50,70,,,\n';                                           // 시각 없음 → 못 읽음
    const HVC = 'id,매장ID,날짜,공조기번호,가동시작,가동종료,가동시간(시간),급기온도,배기온도,수정시각,startMin,endMin,미가동,구분\n' +
      'a,mall-001,2025-05-01,39,오전 10:00,오후 9:50,11.83,,,100,600,1310,,\n' +
      'b,mall-001,2025-05-01,39,오전 10:00,오후 8:50,10.83,,,200,600,1250,,\n' +         // 같은 날·장비 → 늦은 수정시각
      'c,mall-001,2025-05-01,41,오전 8:30,오후 6:40,,,,50,,,,\n' +                        // startMin 없는 옛 줄 → 글로 읽음
      'd,mall-001,2025-05-01,3,오전 10:00,오후 8:00,,,,50,600,1200,,\n' +                  // 옛 3번 → OLD-3
      'e,mall-001,2025-05-01,12,,,0,,,50,,,Y,\n' +
      'f,mall-001,2025-05-01,99,오전 10:00,오후 8:00,,,,50,600,1200,,\n';                  // 없는 번호
    const CTC = 'id,매장ID,날짜,에어커튼번호,가동시작,가동종료,가동시간(시간),급기온도,배기온도,수정시각,startMin,endMin,미가동,구분\n' +
      'x,mall-001,2025-05-01,1G1OUT-1,오전 10:00,오전 12:00 (24시),14,,,10,600,1440,,\n';
    ok(M.minOf('오후 9:50') === 1310 && M.minOf('오전 12:00 (24시)') === 1440 && M.minOf('오전 12:10') === 10 && M.dateOf('2025. 5. 2 오후 3:10:00').hm === '15:10', '옮기기 도구: 옛 시각 글 읽기');
    const cl = M.climateRows(CLC), hv = M.usageRows(HVC, 'hvac'), ct = M.usageRows(CTC, 'curtain');
    ok(cl.rows.length === 2 && cl.bad.length === 1 && cl.rows[1].t === 22.5 && cl.rows[1].di > 60 && hv.rows.length === 5 && hv.rows.find(r => r.unit === '39').e === 1250 && hv.rows.find(r => r.unit === '41').s === 510, '옮기기 도구: 같은 id 한 번 · 늦은 수정시각 · startMin 없으면 글로');
    const sql = M.buildSql(cl, hv, ct);
    const chk = async () => (await db.query(sql.slice(sql.indexOf('-- 맞춰 보기')).replace(/\ncommit;\s*$/, '').replace(/^--.*\n/, ''))).rows;
    await db.exec(sql.replace(/\ncommit;\s*$/, '\n').replace(' on commit drop', '').replace(/^begin;$/m, ''));
    const n = async w => (await one('select count(*)::int n from ' + w)).n;
    ok(await n("climate_record where src = 'sheet'") === 2 && Number((await one("select log_date::text d from climate_record where id = 'r2'")).d === '2025-05-01'), '옮기기: 온습도 2건 · 새벽 3시 기록은 전날 근무일');
    ok(await n("equip_usage where src = 'sheet' and kind = 'hvac'") === 4 && (await one("select end_min from equip_usage where unit = '7F-39' and log_date = '2025-05-01'")).end_min === 1250 &&
      await n("equip_usage where unit = 'B3F-HVU1' and start_min = 510") === 1 && await n("equip_usage where unit = 'OLD-3'") === 1 && await n("equip_usage where unit = '3F-12' and off and log_date = '2025-05-01'") === 1, '옮기기: 공조기 4건 (39 → 7F-39 · 41 → B3F-HVU1 · 3 → OLD-3 · 12 → 3F-12 미가동) · 없는 99번은 뺌');
    const v = await chk();
    ok(Number(v[1].시트_시간) === Number(v[1].db_시간) + Number(v[3].시트_시간) && Number(v[3].시트_시간) === 10 && Number(v[2].db_시간) === 14 && /99/.test(v[3].종류) && Number(v[3].시트_건수) === 1, '옮기기: 맞춰 보기 표 (공조기 시트 = DB + 못 찾은 99번 10시간) ' + JSON.stringify(v));
    await db.exec("update equip_usage set end_min = 1300, updated_at = now(), src = 'app' where unit = '7F-39' and log_date = '2025-05-01';");
    await db.exec(sql.replace(/\ncommit;\s*$/, '\n').replace(' on commit drop', '').replace(/^begin;$/m, ''));
    ok((await one("select end_min from equip_usage where unit = '7F-39' and log_date = '2025-05-01'")).end_min === 1300 && await n("climate_record where src = 'sheet'") === 2, '옮기기: 다시 실행해도 그대로 · 앱에서 더 늦게 고친 것은 안 덮음');
    ok(!/cl_old|begin;|commit;|temp table/.test(sql), '옮기기 SQL: 임시 표·묶음 없이 문장마다 자료 (Supabase 편집기에서 연결이 바뀌어도 됨)');
  }
  await db.close();
  console.log(fail ? '\nSQL 시험 실패 ' + fail + '개' : '\nSQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
