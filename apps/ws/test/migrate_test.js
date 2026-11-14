// Supabase 이관 4단계 시험: 가짜 구글 시트(server_test.js가 모든 업무로 채움) → Migrate.gs migrateBuild_ → PGlite(01~09 SQL)에 넣고
// 앱 DB 함수(로그인·소화기·전열·공사장·TBM·일지·출근현황)가 옮긴 자료를 제대로 읽는지 봄. 진짜 Supabase·드라이브에는 아무것도 보내지 않음.
// 쓰는 법: node test/migrate_test.js   (끝에 「옮기기 시험 통과」)
const realLog = console.log;
console.log = () => {};   // server_test.js 의 ok 줄은 숨김 (실패는 console.error 로 보임)
require('./server_test.js');
console.log = realLog;
const serverFail = process.exitCode;
const fs = require('fs'), path = require('path');
(0, eval)(fs.readFileSync(path.join(__dirname, '..', 'src', 'Migrate.gs'), 'utf8').replace(/^const /gm, 'var '));
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
let fail = serverFail ? 1 : 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
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
  ok(!serverFail, '시트 쪽 서버 시험(server_test.js)이 먼저 통과 — 시트에 모든 업무 자료가 있음');
  const T = migrateBuild_(), by = Object.fromEntries(T);
  const n = k => by[k].length;
  ok(T[0][0] === 'files' && T.length === 19, '표 19개, files 먼저');
  ok(['staff', 'signs', 'next_work', 'tbm', 'risk_list', 'daily_log', 'roster', 'fire_ext', 'fire_checks', 'eh_stores', 'eh_devices', 'cs_sites', 'cs_items', 'cs_checks', 'change_log', 'settings'].every(k => n(k) > 0),
    '업무마다 옮길 줄이 있음: ' + T.map(t => t[0] + ' ' + t[1].length).join(', '));
  ok(by.files.every(f => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(f.id) && f.is_archived && f.storage_path === null), '파일: 드라이브 번호마다 uuid 하나, 이미 드라이브에 있음(is_archived)');
  ok(JSON.stringify(migrateBuild_()[0][1].map(f => f.id)) === JSON.stringify(by.files.map(f => f.id)), '다시 만들어도 같은 uuid (다시 돌려도 같음)');
  const pdf = by.files.find(f => f.kind === 'tbm_pdf'), ph = by.files.find(f => f.kind === 'fire_photo');
  ok(pdf && /^https:\/\/drive\.google\.com\/file\/d\/.+\/view$/.test(pdf.file_url) && ph && /^https:\/\/lh3\.googleusercontent\.com\/d\//.test(ph.file_url), 'PDF는 드라이브 보기 주소, 사진은 그림 주소');
  ok(migTs_('2026-11-03 10:05') === '2026-11-03T10:05:00+09:00' && migTs_('2026-11-03') === '2026-11-03T00:00:00+09:00' && migTs_('x') === null && migNum_('1,234.5') === 1234.5 && migNum_('') === null, '시각·숫자 바꾸기');

  const db = new PGlite({ extensions: { pgcrypto } });
  const q = (s, p) => db.query(s, p).then(r => r.rows);
  const as = async (role, s, p) => { await db.exec('set role ' + role); try { return await q(s, p); } finally { await db.exec('reset role'); } };
  await db.exec(BASE);
  for (const f of ['01_schema_rls.sql', '02_login.sql', '03_docs.sql', '04_attendance.sql', '05_fire.sql', '06_eh.sql', '07_cs.sql', '08_settings.sql', '09_migrate.sql', '10_archive.sql', '11_cutover.sql']) await db.exec(SQL(f));
  const denied = async role => { try { await as(role, 'select ws_migrate_clear()'); return false; } catch (e) { await db.exec('reset role'); return /permission denied/.test(e.message); } };
  ok(await denied('anon') && await denied('authenticated'), '비우기(ws_migrate_clear)는 앱 화면이 못 부름');
  await as('service_role', 'select ws_migrate_clear()');
  ok((await q('select count(*)::int n from risk_list'))[0].n === 0 && (await q('select count(*)::int n from cs_items'))[0].n === 0, 'service_role 은 비울 수 있음 (기본 위험성·점검 항목도 지움)');

  // migrateSheetToSupabase 가 보내는 것과 같은 순서로 넣음
  for (const [t, rows] of T) {
    if (!rows.length) continue;
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))].map(c => '"' + c + '"').join(',');
    try { await q('insert into public.' + t + ' (' + cols + ') select ' + cols + ' from jsonb_populate_recordset(null::public.' + t + ', $1::jsonb)', [JSON.stringify(rows)]); }
    catch (e) { ok(false, t + ' 넣기 실패: ' + e.message); }
  }
  const cnt = async t => (await q('select count(*)::int n from public.' + t))[0].n;
  let same = true; for (const [t, rows] of T) if (await cnt(t) !== rows.length) { same = false; ok(false, t + ' 줄 수 다름'); }
  ok(same, '19개 표 모두 DB 규칙(키·참조·형식)을 지키며 들어감');

  // 앱 DB 함수로 읽어 보기
  const call = async (fn, args) => (await as('authenticated', 'select ' + fn + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') r', args))[0].r;
  const hong = by.staff.find(s => s.name === '홍길동');
  ok(hong && /^[0-9a-f]{64}$/.test(hong.pin_hash), '직원: PIN 해시 그대로 옮김');
  const L = await call('ws_login', ['1234', 'mig1', 'https://x/storage/v1/object/public/ws-files/sign/2026-11/a.png', 'sign/2026-11/a.png']);
  ok(L.ok && L.user.name === '홍길동', '옮긴 PIN(1234)으로 Supabase 로그인 — 직원은 PIN을 다시 정하지 않아도 됨');
  const tk = L.token;
  const fe = await call('ws_fe_list', [tk]);
  ok(fe.ok && fe.items.length === by.fire_ext.filter(f => f.active).length && fe.items.every(i => /^[0-9a-z]{12,32}$/.test(i.token)), '소화기 목록: 쓰는 소화기 ' + fe.items.length + '대, QR 그대로 (붙은 스티커 그대로)');
  const fc = by.fire_checks.find(c => !c.deleted && c.photo_file_id);
  const fd = await call('ws_fe_detail', [tk, fc.check_id]);
  ok(fd.ok && /^https:\/\/lh3\.googleusercontent\.com\/d\//.test(fd.photo), '소화기 점검 내용: 옛 사진은 드라이브 주소로');
  const eh = await call('ws_eh_list', [tk, by.eh_stores.find(s => s.active).floor]);
  ok(eh.ok && eh.stores.length > 0 && eh.empty === false, '전열필증 목록 열림 (' + eh.stores.length + '곳)');
  const dv = by.eh_devices.find(d => d.active);
  const vw = (await as('anon', 'select ws_eh_view($1) r', [dv.qr_token]))[0].r;
  ok(vw.ok && vw.item.no === dv.mgmt_no, '전열필증 QR(비로그인): 옮긴 필증이 보임');
  const ck = by.cs_checks.find(c => !c.deleted && c.items.some(x => x.photos.length));
  const cg = await call('ws_cs_get', [tk, ck.check_day, ck.cs_id, ck.round]);
  ok(cg.ok && cg.check.id === ck.ck_id && cg.items.some(x => x.photos.some(p => /^https:\/\/lh3\./.test(p.src))), '공사장 점검: 옛 점검 열림, 사진은 드라이브 주소');
  const today = (await q("select ws_work_day()::text d"))[0].d;
  const tb = by.tbm.find(t => !t.deleted && t.works.length && t.work_day < today);
  const tg = await call('ws_tbm_get', [tk, tb.work_day]);
  ok(tg.ok && tg.works.length === tb.works.length && tg.risks.length === n('risk_list'), 'TBM: 옛 날짜 작업표·위험성 목록(시트 것)');
  const lg = by.daily_log.find(l => l.m_city_water !== null && l.log_date < today);
  const lo = await call('ws_log_get', [tk, lg.log_date]);
  ok(lo.ok && lo.cur && Number(lo.cur['시수']) === lg.m_city_water, '종합업무일지: 옛 날 숫자 그대로');
  const ro = by.roster.find(r => !r.deleted);
  const ag = await call('ws_att_get', [tk, ro.ym + '-01']);
  ok(ag.ok && ag.people.some(p => p.name === ro.name), '출근현황: 옮긴 근무표');
  ok((await call('ws_cs_home', [tk])).items.length === by.cs_items.filter(i => i.active).length, '공사장 기본 항목: 시트 것 (쓰는 것만)');

  // 보내기: 가짜 Supabase 주소로 무엇을 보내는지
  const sent = [];
  global.UrlFetchApp = { fetch: (u, o) => { sent.push({ u, o }); return { getResponseCode: () => 201, getContentText: () => '' }; } };
  let err = ''; try { migrateSheetToSupabase(); } catch (e) { err = e.message; }
  ok(/SUPABASE_URL/.test(err) && sent.length === 0 && !sbLive_(), '열쇠가 없으면 아무것도 안 보내고 안내 (바꿔 탄 표시도 안 함)');
  PropertiesService.getScriptProperties().setProperty('SUPABASE_URL', 'https://abc.supabase.co/');
  PropertiesService.getScriptProperties().setProperty('SUPABASE_SERVICE_KEY', 'svc-key');
  const r = migrateSheetToSupabase();
  ok(r.ok && sent[0].u === 'https://abc.supabase.co/rest/v1/rpc/ws_migrate_clear' && sent.every(s => s.o.headers.Authorization === 'Bearer svc-key' && s.o.headers.apikey === 'svc-key'), '먼저 DB를 비우고, 관리자 열쇠로 보냄');
  ok(sbLive_(), '옮기기가 끝나면 「바꿔 탐」 표시 (SUPABASE_LIVE = Y) → 예약 작업이 Supabase에 씀');
  const posted = {}; sent.slice(1).forEach(s => { const t = s.u.split('/rest/v1/')[1]; posted[t] = (posted[t] || 0) + JSON.parse(s.o.payload).length; });
  ok(T.every(([t, rows]) => (posted[t] || 0) === rows.length) && sent.slice(1).every(s => JSON.parse(s.o.payload).length <= 500), '표마다 모든 줄을 500줄씩 나눠 보냄');
  ok(Object.keys(posted)[0] === 'files', 'files 표를 먼저 보냄');
  global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 409, getContentText: () => 'duplicate key' }) };
  err = ''; try { migrateSheetToSupabase(); } catch (e) { err = e.message; }
  ok(/실패 \(409\): duplicate key/.test(err), 'DB가 거부하면 멈추고 이유를 보여 줌');

  // 옛 파일 링크 공유 (이어서 하기)
  const s0 = migrateShareFiles_(0);
  ok(!s0.done && s0.at === 0, '공유: 시간이 없으면 다음에 이어서');
  const s1 = migrateShareFiles_();
  const { files } = require('./mock_env.js');
  ok(s1.done && s1.total === n('files') && by.files.every(f => !files[f.drive_id] || files[f.drive_id].sharing === 'ANYONE_WITH_LINK:VIEW'), '공유: 끝까지 하면 옮긴 파일 모두 「링크가 있는 사람 보기」 (' + s1.total + '개)');

  // 바꿔 탄 뒤 예약 작업 (11_cutover.sql + Code.gs sbLive_)
  const svc = async (s, p) => (await as('service_role', s, p))[0].r;
  const wday = '2026-11-10';
  await q("insert into daily_log (log_date, t_min, m_city_water, author, editor, updated_at) values ($1, -3, 12.5, '홍길동', '홍길동', '2026-11-10 09:00+09')", [wday]);
  const before = await call('ws_log_get', [tk, wday]);
  const W = { '날씨': '맑음', '최저': '1.5', '최고': '9', '최고풍속': '3.2', '미세먼지': '41', '미세먼지등급': '보통' };
  const f1 = await svc('select ws_log_weather($1::date, $2::jsonb) r', [wday, JSON.stringify(W)]);
  const after = await call('ws_log_get', [tk, wday]);
  ok(f1.filled.join() === '날씨,최고,최고풍속,미세먼지,미세먼지등급' && after.cur['최저'] === '-3' && after.cur['날씨'] === '맑음' && after.cur['날씨출처'] === '네이버' && after.cur['시수'] === '12.5',
    '날씨 예약: 빈 칸만 채움 (직원이 쓴 최저 -3·검침 그대로)');
  ok(after.cur['수정시각'] === before.cur['수정시각'], '날씨 예약: 수정시각 그대로 → 보고 있던 화면이 저장해도 겹침 안 남');
  const sv = await call('ws_log_save', [tk, wday, JSON.stringify(Object.assign({}, after.cur, { '날씨': '' })), before.cur['수정시각'], null]);
  ok(sv.ok !== false && sv.cur['날씨'] === '맑음', '날씨가 들어오기 전에 연 화면이 저장해도 됨 (빈칸으로 보내도 날씨 남음)');
  ok((await svc('select ws_log_weather($1::date, $2::jsonb) r', [wday, JSON.stringify(W)])).filled.length === 0, '날씨 예약: 두 번 불러도 바뀌는 것 없음');
  const nd = '2026-11-11';
  await svc('select ws_log_weather($1::date, $2::jsonb) r', [nd, JSON.stringify({ '날씨': '<b>흐림</b>', '최저': 'x', '미세먼지등급': '최악' })]);
  const nlg = await call('ws_log_get', [tk, nd]);
  ok(nlg.cur && nlg.cur['날씨'] === 'b흐림/b' && nlg.cur['최저'] === '' && nlg.cur['미세먼지등급'] === '' && nlg.cur['작성자'] === '' && nlg.cur['수정시각'] === '', '날씨 예약: 줄이 없으면 날씨만 든 줄 (이상한 값은 버림, 작성자 비움 → 처음 저장한 사람이 작성자)');
  const old = '2026-07-01';
  await q("insert into files (id, kind, drive_id, is_archived, file_url) values ('11111111-1111-4111-8111-111111111111', 'sign', 'drvOldSign', true, 'x'), ('22222222-2222-4222-8222-222222222222', 'sign', null, false, 'y'), ('33333333-3333-4333-8333-333333333333', 'sign', 'drvTbm', true, 'z')");
  await q("insert into signs (sign_id, work_day, staff_id, name, sign_file_id, signed_at, tbm_used) values ('SG-old1', $1::date, $2, '홍길동', '11111111-1111-4111-8111-111111111111', now(), false), ('SG-old2', $1::date - 1, $2, '홍길동', '22222222-2222-4222-8222-222222222222', now(), false), ('SG-tbm', $1::date - 2, $2, '홍길동', '33333333-3333-4333-8333-333333333333', now(), true)", [old, hong.staff_id]);
  const liveSigns = (await q('select count(*)::int n from signs where not deleted'))[0].n;
  const cs = await svc('select ws_clean_signs(90) r');
  const left = await q("select sign_id, deleted from signs where sign_id like 'SG-%' order by sign_id");
  ok(cs.n === 2 && JSON.stringify(cs.drive) === '["drvOldSign"]' && left.map(x => x.sign_id + ':' + x.deleted).join() === 'SG-old1:true,SG-old2:true,SG-tbm:false' &&
    (await q('select count(*)::int n from signs where not deleted'))[0].n === liveSigns - 2, '서명 정리: 90일 지난 안 쓴 서명만 지운 표시, 드라이브로 옮긴 그림 번호만 돌려줌 (TBM에 쓴 서명·최근 서명 그대로)');
  const deny = async (role, s) => { try { await as(role, s); return false; } catch (e) { await db.exec('reset role'); return /permission denied/.test(e.message); } };
  ok(await deny('authenticated', "select ws_log_weather('2026-11-10', '{}')") && await deny('anon', 'select ws_clean_signs(90)') && await deny('authenticated', 'select ws_clean_signs(1)'), '날씨·서명 정리 함수는 앱 화면이 못 부름');

  // 구글 쪽: 바꿔 탄 뒤 예약이 Supabase 를 부름
  const calls = [];
  global.UrlFetchApp = { fetch: (u, o) => { calls.push({ u, body: o.payload && JSON.parse(o.payload) }); return { getResponseCode: () => 200, getContentText: () => /ws_clean_signs/.test(u) ? JSON.stringify(cs) : '{"ok":true,"filled":[]}' }; } };
  global.logWeatherFetch_ = () => W;
  files.drvOldSign = { name: 's.png', trashed: false };
  logWeatherJob_();
  ok(calls.length === 1 && /\/rest\/v1\/rpc\/ws_log_weather$/.test(calls[0].u) && calls[0].body.p_day === workDay_(Date.now()) && calls[0].body.p_w['날씨'] === '맑음', '날씨 예약(오후 1시) → Supabase ws_log_weather (시트 안 건드림)');
  calls.length = 0;
  const n2 = cleanSigns_();
  ok(n2 === 2 && calls.length === 1 && /ws_clean_signs$/.test(calls[0].u) && files.drvOldSign.trashed === true, '서명 정리 예약(새벽 3시) → Supabase ws_clean_signs, 드라이브 그림 휴지통');
  PropertiesService.getScriptProperties().setProperty('SUPABASE_LIVE', '');
  calls.length = 0; logWeatherJob_();
  ok(calls.length === 0, '「바꿔 탐」 표시를 지우면(되돌리기) 다시 시트에 씀');

  await db.close();
  console.log(fail ? '\n옮기기 시험 실패 ' + fail + '개' : '\n옮기기 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERR ' + e.message + '\n' + e.stack); process.exit(1); });
