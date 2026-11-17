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
  ok((await call('ws_fe_add', [tk, J({ floor: '7F', store: 'x' })])).error === '층을 골라 주세요.', '소화기 등록: 없는 층 → 안내');
  ok((await call('ws_fe_add', [tk, J({ floor: '1F', store: '  ' })])).error === '매장명을 넣어 주세요.', '소화기 등록: 매장명 없음 → 안내');
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
  ok(/습도 12:00/.test((await call('ws_ahu_save', [tk, D, J({ out_h12: 'abc' })])).error), '공조기: 외기 칸 글자 → 안내');
  ok(/목록에 없/.test((await call('ws_ahu_save', [tk, D, J({ temps: { 'X-1': { 12: '20' } } })])).error) && /12:00·16:00/.test((await call('ws_ahu_save', [tk, D, J({ temps: { '6F-36': { 19: '20' } } })])).error), '공조기: 없는 번호·19시 → 안내');
  ok((await call('ws_ahu_save_pdf', [tk, yest, J(F('ahu_pdf', 'a0', 'pdf'))])).error === '먼저 [저장]을 눌러 주세요', '공조기 PDF: 저장 안 한 날 → 안내');
  ah = await call('ws_ahu_save_pdf', [tk, D, J(F('ahu_pdf', 'a1', 'pdf'))]);
  ok(ah.ok && /a1\.pdf$/.test(ah.rec.pdf.url) && (await one("select file_name, drive_folder from files where kind = 'ahu_pdf'")).file_name === D + '_공조기환기온도.pdf', '공조기 PDF 저장 · 파일 이름');
  await q("update daily_log set humidity = 45 where log_date = $1", [D]);
  ok((await call('ws_ahu_get', [tk, D])).wx.humidity === 45, '공조기: 종합업무일지 습도 칸을 읽음');

  // ══ 지도 (13_map.sql, 결정 130) ══
  await db.exec(SQL('13_map.sql')); await db.exec(SQL('13_map.sql'));
  ok((await one('select count(*)::int n from map_floor')).n === 0 && !SQL('13_map.sql').includes('amazonaws'), '13_map.sql 실행됨 (두 번) · 층 주소는 저장소에 없음');
  await q("insert into map_floor values ('avenuel','1F','https://x/1F.svg'),('avenuel','B1','https://x/B1.svg'),('dept','01','https://x/d01.svg')");
  ok(/permission denied/.test(await asErr('authenticated', 'select * from map_kv')) && /permission denied/.test(await asErr('authenticated', 'select * from map_floor')), '지도: 표는 로그인 기기도 바로 못 읽음');
  ok(/permission denied/.test(await asErr('anon', "select ws_map_load('x')")) && /LOGIN/.test(await callErr('ws_map_load', ['bad'])) && /LOGIN/.test(await callErr('ws_map_save', ['bad', 'lotte_symbols_1F', '[]'])), '지도: 비로그인·PIN 표 없음 → 막음');
  let mp = await call('ws_map_load', [tk]);
  ok(mp.ok && Object.keys(mp.kv).length === 0 && /^https:/.test(mp.urls.avenuel['1F']) && Object.keys(mp.urls.dept).length === 1, '지도: 처음 = 빈 칸 · 건물별 층 주소');
  ok((await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[{"id":"a"}]'])).ok && (await call('ws_map_save', [tk, 'lotte_util_lines_1F', '[]'])).ok, '지도: 저장 · 덮어쓰기');
  await call('ws_map_save', [tk, 'lotte_scale_settings_dept', '{"ratio":200}']);
  mp = await call('ws_map_load', [tk]);
  ok(mp.kv.lotte_util_lines_1F === '[]' && mp.kv.lotte_scale_settings_dept === '{"ratio":200}' && (await one("select editor from map_kv where k = 'lotte_util_lines_1F'")).editor === '홍길동', '지도: 다시 받으면 마지막 값 · 고친 사람');
  ok((await call('ws_map_save', [tk, 'lotte_util_lines_1F', null])).ok && !('lotte_util_lines_1F' in (await call('ws_map_load', [tk])).kv), '지도: null = 지움');
  ok((await call('ws_map_save', [tk, 'ws_token', 'x'])).ok === false && (await call('ws_map_save', [tk, 'lotte_a b', 'x'])).ok === false, '지도: lotte_ 로 시작하지 않는 칸 이름 → 막음');
  await db.close();
  console.log(fail ? '\nSQL 시험 실패 ' + fail + '개' : '\nSQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
