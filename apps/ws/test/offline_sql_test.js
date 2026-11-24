// 오프라인 임시 저장 DB 시험 (supabase/24_offline.sql, 결정 222) — PGlite(작은 PostgreSQL)에서 실제 함수를 돌림
// 쓰는 법: node test/equip_sql_test.js   (끝에 「오프라인 저장 SQL 시험 통과」)
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

  await db.exec(BASE);
  for (const f of ['01_schema_rls.sql', '02_login.sql', '03_docs.sql', '05_fire.sql', '12_ahu.sql', '19_climate.sql']) await db.exec(SQL(f));
  await db.exec(SQL('24_offline.sql')); await db.exec(SQL('24_offline.sql'));
  ok(true, '24_offline.sql 실행됨 (두 번)');
  await q("insert into staff (staff_id, name, part, role, pin_salt, pin_hash) values ('S001','홍길동','전방파트','소장','saltS001',$1)", [sha('saltS001' + '1234')]);
  const tk = (await as('authenticated', "select ws_login('1234','devA','https://x/sign/2026-11/a.png','sign/2026-11/a.png') r"))[0].r.token;
  const kst = ms => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const PUB = 'https://x.supabase.co/storage/v1/object/public/ws-files/';

  // ── 소화기 QR 점검: client_id 중복 방지 · 입력 시각으로 달 판정 ──
  await auth('ws_fe_add', [tk, J({ floor: '1F', store: '카페', count: '1' })]);
  const qr = (await one('select qr_token t from fire_ext limit 1')).t;
  const F = (n, ext) => { const p = 'fire/' + qr + '/2026-11/' + n + '.' + ext; return { url: PUB + p, path: p }; };
  const files = n => J({ photo: F('p' + n, 'jpg'), memo: F('m' + n, 'png'), name: F('n' + n, 'png') });
  const at = new Date(Date.now() - 3600e3).toISOString();
  let r1 = await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'cid1', entered_at: at }), files(1)]);
  ok(r1.ok && !r1.again, '첫 전송 저장됨');
  const r2 = await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'cid1', entered_at: at }), files(1)]);
  ok(r2.ok && r2.again && r2.checkId === r1.checkId, '같은 client_id 다시 보냄 → 새로 만들지 않고 같은 결과 (응답 유실 대비)');
  ok((await one('select count(*)::int n from fire_checks')).n === 1 && (await one("select count(*)::int n from files where kind like 'fire_%'")).n === 3, '점검 1건 · 파일 3개 그대로');
  const r3 = await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'cid2', entered_at: at }), files(2)]);
  ok(r3.ok === false && r3.exists === true, '다른 client_id 인데 이번 달 이미 있음 → 물음 (자동 덮어쓰기 없음)');
  const r4 = await anon('ws_check_submit', [qr, J({ state: '이상있음', client_id: 'cid2', entered_at: at, overwrite: true }), files(2)]);
  ok(r4.ok && r4.checkId === r1.checkId && (await one('select overwrite_count n, client_id c from fire_checks')).c === 'cid2', '덮어쓰기 허락 → 같은 점검을 고침 · client_id 갱신');
  // 입력한 달: 40일보다 오래전 · 미래 시각은 서버 시각으로
  await q('delete from fire_checks where true');
  const old = new Date(Date.now() - 60 * 864e5).toISOString(), fut = new Date(Date.now() + 5 * 864e5).toISOString();
  await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'old', entered_at: old }), files(5)]);
  await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'fut', entered_at: fut, overwrite: true }), files(6)]);
  const ym = kst(Date.now()).slice(0, 7);
  ok((await q('select ym from fire_checks')).every(x => x.ym === ym), '40일 넘은 · 미래 입력 시각은 믿지 않고 서버 시각의 달로');
  await q('delete from fire_checks where true');
  const prev = new Date(Date.now() - 20 * 864e5);
  await anon('ws_check_submit', [qr, J({ state: '이상없음', client_id: 'prev', entered_at: prev.toISOString() }), files(7)]);
  ok((await one('select ym from fire_checks')).ym === kst(prev.getTime()).slice(0, 7), '20일 전에 입력한 것을 늦게 보내도 입력한 달로 기록');
  const oldscreen = await anon('ws_check_submit', [qr, J({ state: '이상없음', overwrite: true }), files(9)]);
  ok(oldscreen.ok, '옛 화면(client_id·entered_at 없음)도 저장됨');

  // ── 온습도: 같은 입력 다시 보내도 한 번만 ──
  const rows = [{ floor: '6F', zone: '1구역', t: '24.1', h: '52' }, { floor: '6F', zone: '2구역', t: '23.5', h: '50' }];
  const c1 = await auth('ws_climate_add', [tk, J(rows), J({ t: '11', h: '40' }), 'job1', new Date(Date.now() - 600e3).toISOString()]);
  ok(c1.ok && (await one('select count(*)::int n from climate_record')).n === 2, '온습도 2곳 저장');
  await auth('ws_climate_add', [tk, J(rows), J({ t: '11', h: '40' }), 'job1', new Date(Date.now() - 600e3).toISOString()]);
  ok((await one('select count(*)::int n from climate_record')).n === 2, '같은 입력 번호로 다시 → 늘지 않음');
  await auth('ws_climate_add', [tk, J(rows), J({}), 'job2', null]);
  ok((await one('select count(*)::int n from climate_record')).n === 4, '다른 입력 번호는 새로 저장');
  const c3 = await auth('ws_climate_add', [tk, J(rows), J({})]);   // 옛 화면 (3개 값)
  ok(c3.ok && (await one('select count(*)::int n from climate_record')).n === 6, '옛 화면(번호·시각 없음)도 저장');

  // ── 가동시간: 더 늦게 입력된 값을 먼저 입력한 값이 덮지 못함 ──
  const D = (await one('select ws_work_day()::text d')).d;
  const u = (await one('select no from ahu_unit where active order by seq limit 1')).no;
  const t1 = new Date(Date.now() - 1800e3).toISOString(), t0 = new Date(Date.now() - 3600e3).toISOString();
  await auth('ws_usage_save', [tk, 'hvac', D, J([{ u, s: 600, e: 1200, off: false }]), t1]);
  await auth('ws_usage_save', [tk, 'hvac', D, J([{ u, s: 540, e: 1100, off: false }]), t0]);   // 더 일찍 입력했지만 늦게 도착
  let e = await one("select start_min s, end_min e from equip_usage where kind = 'hvac' and unit = $1 and log_date = $2::date", [u, D]);
  ok(e.s === 600 && e.e === 1200, '늦게 도착한 옛 입력(입력 시각이 더 이름)은 새 값을 덮지 않음');
  await auth('ws_usage_save', [tk, 'hvac', D, J([{ u, s: 660, e: 1250, off: false }]), new Date().toISOString()]);
  e = await one("select start_min s, end_min e from equip_usage where kind = 'hvac' and unit = $1 and log_date = $2::date", [u, D]);
  ok(e.s === 660 && e.e === 1250, '더 늦게 입력한 값은 덮음');
  const old2 = await auth('ws_usage_save', [tk, 'hvac', D, J([{ u, s: 600, e: 1200, off: false }])]);   // 옛 화면 (시각 없음 = 지금)
  ok(old2.ok, '옛 화면(입력 시각 없음)도 저장됨');

  ok(/permission denied/.test(await asErr('authenticated', "select ws_entered_at('2026-01-01T00:00:00Z')")), '도우미(ws_entered_at)는 못 부름');
  console.log(fail ? '실패 ' + fail + '건' : '오프라인 저장 SQL 시험 통과');
  process.exit(fail ? 1 : 0);
})();
