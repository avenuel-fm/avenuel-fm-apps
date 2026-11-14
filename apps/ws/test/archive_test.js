// Supabase 이관 5단계 시험: Archive.gs (주 1회 파일 → 구글 드라이브, 버킷 정리, DB 백업)
// 가짜 Supabase(REST·버킷)와 가짜 드라이브로 돌림 + PGlite 로 10_archive.sql(ws_backup) 확인. 진짜 Supabase·드라이브에는 아무것도 보내지 않음.
// 쓰는 법: node test/archive_test.js   (끝에 「드라이브 옮기기 시험 통과」)
const { NOW } = require('./mock_env.js');
const fs = require('fs'), path = require('path');
for (const f of ['Migrate.gs', 'Archive.gs']) (0, eval)(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/^const /gm, 'var '));
setup_();
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const DAY = 86400000, ago = d => new Date(NOW.d.getTime() - d * DAY).toISOString();

/* ── 가짜 드라이브 (폴더 경로·파일·설명·공유를 기억) ── */
const D = { files: {}, n: 0 };
const folder = p => ({
  getId: () => 'F:' + p, isTrashed: () => false,
  getFoldersByName: n => { let done = false; return { hasNext: () => !done, next: () => { done = true; return folder(p ? p + '/' + n : n); } }; },
  createFolder: n => folder(p ? p + '/' + n : n),
  createFile: b => { const id = 'drv' + (++D.n); D.files[id] = { path: p, name: b.name, type: b.getContentType(), data: b.data !== undefined ? b.data : b.bytes, desc: '' }; return { getId: () => id, setDescription: d => D.files[id].desc = d }; },
  getFilesByName: n => { const l = Object.keys(D.files).filter(id => D.files[id].path === p && D.files[id].name === n); let i = 0; return { hasNext: () => i < l.length, next: () => { const id = l[i++]; return { getId: () => id, getDescription: () => D.files[id].desc }; } }; }
});
global.DriveApp = { getRootFolder: () => folder(''), getFolderById: id => folder(id.slice(2)), getFileById: id => ({ setSharing: (a, b) => D.files[id].sharing = a + ':' + b }),
  Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK' }, Permission: { VIEW: 'VIEW' } };
const T = { list: [] };
global.ScriptApp = { getProjectTriggers: () => T.list.slice(), deleteTrigger: t => { T.list = T.list.filter(x => x !== t); }, WeekDay: { SUNDAY: 'SUN' },
  newTrigger: h => { const t = { h, getHandlerFunction: () => h }; const b = { timeBased: () => b, everyWeeks: w => (t.week = w, b), onWeekDay: d => (t.day = d, b), atHour: x => (t.hour = x, b), inTimezone: () => b, after: ms => (t.after = ms, b), create: () => (T.list.push(t), t) }; return b; } };
const mails = [];
global.MailApp = { sendEmail: (to, s, b) => mails.push({ to, s, b }) };
global.Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@test' }) };
let lockBusy = false;
global.LockService = { getScriptLock: () => ({ tryLock: () => !lockBusy, waitLock() {}, releaseLock() {} }) };

/* ── 가짜 Supabase ── */
const S = { rows: [], obj: {}, calls: [], patchMiss: {}, tick: 0 };
const res = (code, body, blob) => ({ getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getBlob: () => blob });
global.UrlFetchApp = { fetch: (u, o) => {
  S.calls.push({ u, o });
  if (o.headers.Authorization !== 'Bearer svc' || o.headers.apikey !== 'svc') return res(401, 'no key');
  const url = new URL(u), q = url.searchParams, pth = url.pathname, body = o.payload ? JSON.parse(o.payload) : null, m = o.method;
  if (pth === '/rest/v1/files' && m === 'get' && q.get('select') === 'storage_path') {
    const live = S.rows.filter(r => r.storage_path).sort((a, b) => a.id < b.id ? -1 : 1).map(r => ({ storage_path: r.storage_path }));
    return res(200, live.slice(+q.get('offset'), +q.get('offset') + +q.get('limit')));
  }
  if (pth === '/rest/v1/files' && m === 'get') {
    const cut = q.get('created_at').slice(3), cur = (q.get('id') || 'gt.').slice(3);
    return res(200, S.rows.filter(r => !r.is_archived && r.storage_path && r.created_at < cut && r.id > cur).sort((a, b) => a.id < b.id ? -1 : 1).slice(0, +q.get('limit')));
  }
  if (pth === '/rest/v1/files' && m === 'patch') {
    const r = S.rows.find(x => x.id === q.get('id').slice(3) && !x.is_archived);
    if (!r || S.patchMiss[r.id]) return res(200, []);
    Object.assign(r, body); return res(200, [r]);
  }
  if (pth.startsWith('/storage/v1/object/ws-files/') && m === 'get') {
    NOW.d = new Date(NOW.d.getTime() + S.tick);   // 받는 데 시간이 걸림
    const k = pth.slice('/storage/v1/object/ws-files/'.length), x = S.obj[k];
    return x ? res(200, '', Object.assign(Utilities.newBlob(x.data, x.type), { data: x.data })) : res(404, '{"error":"not_found"}');
  }
  if (pth === '/storage/v1/object/ws-files' && m === 'delete') { body.prefixes.forEach(k => delete S.obj[k]); return res(200, []); }
  if (pth === '/storage/v1/object/list/ws-files') {
    const kids = {};
    Object.keys(S.obj).filter(k => k.startsWith(body.prefix)).forEach(k => {
      const rest = k.slice(body.prefix.length), i = rest.indexOf('/');
      kids[i < 0 ? rest : rest.slice(0, i)] = i < 0 ? { name: rest, id: 'o-' + k, created_at: S.obj[k].at } : { name: rest.slice(0, i), id: null };
    });
    return res(200, Object.values(kids).sort((a, b) => a.name < b.name ? -1 : 1).slice(body.offset, body.offset + body.limit));
  }
  if (pth === '/rest/v1/rpc/ws_backup') return res(200, body.p_table === 'files' ? S.rows : body.p_table === 'staff' ? [{ staff_id: 'S001', name: '홍,"길동"', meta: { a: 1 } }] : []);
  return res(404, 'unknown ' + m + ' ' + pth);
} };
const props = PropertiesService.getScriptProperties();
const uid = i => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
const put = (i, kind, days, folder, name, objDays) => {
  const p = kind + '/2026-10/f' + i + (/pdf/.test(kind) ? '.pdf' : '.jpg');
  S.rows.push({ id: uid(i), kind, file_url: 'https://kjh.supabase.co/storage/v1/object/public/ws-files/' + p, storage_path: p, file_name: name, drive_folder: folder, is_archived: false, created_at: ago(days) });
  if (objDays !== null) S.obj[p] = { data: 'DATA' + i, type: /pdf/.test(kind) ? 'application/pdf' : 'image/jpeg', at: ago(objDays === undefined ? days : objDays) };
  return S.rows[S.rows.length - 1];
};

(async () => {
  // 열쇠 없음
  let err = ''; try { archiveFilesToDrive(); } catch (e) { err = e.message; }
  ok(/SUPABASE_URL/.test(err) && S.calls.length === 0, '열쇠가 없으면 아무것도 안 하고 안내');
  props.setProperty('SUPABASE_URL', 'https://kjh.supabase.co'); props.setProperty('SUPABASE_SERVICE_KEY', 'svc');

  const a = put(1, 'cs_photo', 10, '점검/공사장점검/2026/2026-10', '2026-10-20_공사장점검-A동_1_001.jpg');
  const b = put(2, 'tbm_pdf', 8, '서류작업/TBM/2026/2026-10', '2026-10-22_TBM.pdf');
  const c = put(3, 'sign', 2, '서류작업/서명/2026-11', '2026-11-01_서명-홍길동.png');            // 7일 안 됨 → 그대로
  const d = put(4, 'fire_photo', 9, '소화기점검/2026-10', '없는파일.jpg', null);                  // 버킷에 원본 없음 → 실패
  const e = put(5, 'log_pdf', 12, '서류작업/종합업무일지/2026/2026-10', '2026-10-18_종합업무일지.pdf');
  S.patchMiss[e.id] = true;                                                                     // DB가 이미 바뀜 → 원본 지우면 안 됨
  S.rows.push({ id: uid(6), kind: 'cs_photo', file_url: 'https://lh3.googleusercontent.com/d/old', storage_path: null, is_archived: true, created_at: ago(30) });
  S.obj['cs_photo/2026-10/stray.jpg'] = { data: 'x', type: 'image/jpeg', at: ago(3) };          // 저장 거절된 사진 (DB에 없음) → 지움
  S.obj['cs_photo/2026-11/justnow.jpg'] = { data: 'y', type: 'image/jpeg', at: ago(0.1) };      // 막 올림 → 남김

  const r = archiveFilesToDrive();
  const drv = id => D.files[S.rows.find(x => x.id === id).drive_id] || {};
  ok(r.done && r.n === 2, '7일 지난 파일 옮김: ' + r.n + '개 (끝까지)');
  ok(a.is_archived && a.storage_path === null && /^drv\d+$/.test(a.drive_id) && a.file_url === 'https://lh3.googleusercontent.com/d/' + a.drive_id, '사진: DB에 드라이브 그림 주소 · 다 옮김 표시 · 버킷 경로 비움');
  ok(b.file_url === 'https://drive.google.com/file/d/' + b.drive_id + '/view', 'PDF: 드라이브 보기 주소');
  ok(drv(a.id).path === '시설팀 통합업무/20_업무지원/점검/공사장점검/2026/2026-10' && drv(a.id).name === '2026-10-20_공사장점검-A동_1_001.jpg' && drv(a.id).data === 'DATA1',
    '드라이브: 예전과 같은 폴더 · 같은 이름 · 같은 내용');
  ok(drv(a.id).sharing === 'ANYONE_WITH_LINK:VIEW' && drv(b.id).sharing === 'ANYONE_WITH_LINK:VIEW', '드라이브: 「링크가 있는 사람 보기」');
  ok(!S.obj[a.storage_path === null ? 'cs_photo/2026-10/f1.jpg' : ''] && !S.obj['tbm_pdf/2026-10/f2.pdf'], '옮긴 파일만 버킷 원본 지움');
  ok(!c.is_archived && S.obj[c.storage_path], '7일 안 된 파일은 그대로 (그 주 PDF 다시 만들기용)');
  ok(!d.is_archived && d.storage_path && !e.is_archived && S.obj[e.storage_path], '실패한 파일은 DB·원본 그대로 (다음 주에 다시)');
  const ordered = S.calls.map(x => x.o.method + ' ' + new URL(x.u).pathname);
  const iPatch = ordered.findIndex(x => x === 'patch /rest/v1/files'), iDel = ordered.findIndex(x => x === 'delete /storage/v1/object/ws-files');
  ok(iPatch >= 0 && iPatch < iDel, '순서: DB를 고친 다음에만 원본 지움');
  ok(r.orphans === 1 && !S.obj['cs_photo/2026-10/stray.jpg'] && S.obj['cs_photo/2026-11/justnow.jpg'], '버킷 정리: DB에 없는 2일 지난 파일만 지움 (막 올린 것은 남김)');
  const bk = Object.values(D.files).filter(f => f.path === '시설팀 통합업무/20_업무지원/Supabase백업/2026-11-03');
  const st = bk.find(f => f.name === 'staff.csv');
  ok(bk.length === 19 && bk.every(f => f.type === 'text/csv') && st && st.data === '﻿staff_id,name,meta\r\nS001,"홍,""길동""","{""a"":1}"', 'DB 백업: 표 19개 CSV (Supabase백업/날짜, 쉼표·따옴표 처리)');
  ok(mails.length === 1 && mails[0].to === 'owner@test' && /실패 2건/.test(mails[0].s) && /없는파일\.jpg: .*404/.test(mails[0].b) && /DB 줄을 고치지 못함/.test(mails[0].b), '실패는 스크립트 주인에게 메일 (실패 2건, 이유)');
  ok(!props.getProperty('ARC_CUTOFF') && T.list.length === 0, '끝나면 이어하기 표시·예약 없음');

  // 위 판에서 일지 PDF는 드라이브 저장까지 하고 DB에서 막힘 → 다음 판은 그 드라이브 파일을 씀
  const pre = Object.keys(D.files).filter(id => D.files[id].desc === 'ws-file:' + e.id);
  delete S.patchMiss[e.id];
  const n0 = D.n; mails.length = 0;
  const r2 = archiveFilesToDrive();
  ok(pre.length === 1 && r2.n === 1 && e.drive_id === pre[0] && D.n === n0 + 19, '지난번에 저장만 하고 멈춘 파일은 그 드라이브 파일을 씀 (두 번 저장 안 함)');

  // 많을 때: 4분 반에 못 끝내면 1분 뒤 이어서, 실패에 막히지 않음
  for (let i = 10; i < 20; i++) put(i, 'fire_photo', 20, '소화기점검/2026-10', 'p' + i + '.jpg', i === 10 ? null : undefined);
  S.tick = 60000; mails.length = 0;
  const r3 = archiveFilesToDrive();
  ok(!r3.done && r3.n > 0 && r3.n < 10 && T.list.length === 1 && T.list[0].h === 'archiveContinue_' && T.list[0].after === 60000, '시간이 모자라면 ' + r3.n + '개 하고 1분 뒤 이어서 예약');
  S.tick = 0;
  const r4 = archiveContinue_();
  ok(r4.done && r4.n === 9 && T.list.length === 0 && S.rows.filter(x => x.id >= uid(11) && x.id <= uid(19)).every(x => x.is_archived), '이어서: 남은 것 마저 (실패 1개 넘어감), 예약 지움');
  ok(mails.length === 1 && /실패 2건/.test(mails[0].s), '이어 한 판까지 실패를 모아 메일 한 번 (원본 없는 파일 2개)');

  // 다른 판이 돌고 있으면 그냥 끝
  lockBusy = true; const r5 = archiveFilesToDrive(); lockBusy = false;
  ok(r5.busy && !r5.done, '이미 돌고 있으면 겹쳐 돌지 않음');

  // 메뉴 ⑫: 주 1회 예약 (두 번 눌러도 하나)
  global.SpreadsheetApp = Object.assign({}, global.SpreadsheetApp, { getUi: () => ({ alert: m => (S.alert = m) }) });
  archiveMenu_(); archiveMenu_();
  const wk = T.list.filter(t => t.h === 'archiveFilesToDrive');
  ok(wk.length === 1 && wk[0].week === 1 && wk[0].day === 'SUN' && wk[0].hour === 4 && /일요일 새벽 4시/.test(S.alert), '메뉴 ⑫: 매주 일요일 새벽 4시 예약 하나');

  // 옮기기(4단계)가 같은 보내기 도우미를 씀 — 실패 문구
  S.calls.length = 0;
  err = ''; try { sbReq_('post', '/rest/v1/nothing?x=1', {}); } catch (e2) { err = e2.message; }
  ok(err === '/rest/v1/nothing 실패 (404): unknown post /rest/v1/nothing', '실패 안내에 주소 뒤쪽(조건)은 안 보임');

  // DB: ws_backup (10_archive.sql)
  const { PGlite } = require('@electric-sql/pglite');
  const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
  for (const f of ['01_schema_rls.sql', '02_login.sql', '03_docs.sql', '04_attendance.sql', '05_fire.sql', '06_eh.sql', '07_cs.sql', '08_settings.sql', '09_migrate.sql', '10_archive.sql'])
    await db.exec(fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8'));
  const as = async (role, s) => { await db.exec('set role ' + role); try { return (await db.query(s)).rows; } catch (x) { return x; } finally { await db.exec('reset role'); } };
  const rk = await as('service_role', "select ws_backup('risk_list') r");
  ok(Array.isArray(rk[0].r) && rk[0].r.length === 18 && rk[0].r[0].risk, 'ws_backup: 표 전체를 한 번에 (위험성 목록 18줄)');
  ok(Array.isArray((await as('service_role', "select ws_backup('cs_checks') r"))[0].r), 'ws_backup: 빈 표는 []');
  ok(/백업할 수 없는 표/.test((await as('service_role', "select ws_backup('ws_sessions')")).message) && /백업할 수 없는 표/.test((await as('service_role', "select ws_backup('staff; drop table files')")).message), 'ws_backup: 정해 둔 표만 (기기 표·이상한 이름 막음)');
  ok(/permission denied/.test((await as('authenticated', "select ws_backup('staff')")).message) && /permission denied/.test((await as('anon', "select ws_backup('staff')")).message), 'ws_backup: 앱 화면은 못 부름');
  await db.close();

  console.log(fail ? '\n드라이브 옮기기 시험 실패 ' + fail + '개' : '\n드라이브 옮기기 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(x => { console.log('ERR ' + x.message + '\n' + x.stack); process.exit(1); });
