// Supabase 이관 SQL 시험 — PGlite(작은 PostgreSQL)에 Supabase 비슷한 틀(역할·auth·storage)을 만들고
// supabase/01_schema_rls.sql · 02_login.sql 을 그대로 돌려 로그인 규칙을 확인. 진짜 Supabase에는 아무것도 보내지 않음.
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

  await db.close();
  console.log(fail ? '\nSQL 시험 실패 ' + fail + '개' : '\nSQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message); process.exit(1); });
