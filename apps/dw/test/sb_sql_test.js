// 도면협의 Supabase 이관 SQL 시험 — PGlite(작은 PostgreSQL)에 Supabase 비슷한 틀을 만들고 supabase/01~04 를 그대로 돌림
// 진짜 Supabase 에는 아무것도 보내지 않음. PGlite 는 업무지원 시험 도구(apps/ws/node_modules)를 같이 씀
// 쓰는 법: node sb_sql_test.js   (끝에 「도면협의 SQL 시험 통과」)
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const NM = process.env.WS_NODE_MODULES || path.join(__dirname, '..', '..', 'ws', 'node_modules');
const wsRequire = require('module').createRequire(path.join(NM, 'x.js'));
const { PGlite } = wsRequire('@electric-sql/pglite');
const { pgcrypto } = wsRequire('@electric-sql/pglite/contrib/pgcrypto');
const { constOf, sqlOf } = require('../tools/gen_const_sql.js');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const SQL = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const H = s => crypto.createHash('sha256').update('drawing-review:' + s, 'utf8').digest('hex');   // Code.gs hash_

const BASE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated;
grant usage on schema public, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
const FILES = ['01_schema.sql', '02_const.sql', '03_api.sql', '04_service.sql'];
module.exports = { BASE, FILES, SQL, H, NM };

if (require.main === module) (async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const q = (s, p) => db.query(s, p).then(r => r.rows);
  const as = async (role, s, p) => { await db.exec('set role ' + role); try { return await q(s, p); } finally { await db.exec('reset role'); } };
  const asErr = async (role, s, p) => { try { await as(role, s, p); return ''; } catch (e) { await db.exec('reset role'); return e.message; } };
  const call = async (fn, args, role = 'authenticated') => {   // dw-api.js 처럼 이름 붙은 값으로
    const ks = Object.keys(args), r = await as(role, 'select public.' + fn + '(' + ks.map((k, i) => k + ' => $' + (i + 1)).join(', ') + ') r',
      ks.map(k => (args[k] !== null && typeof args[k] === 'object') ? JSON.stringify(args[k]) : args[k]));
    return r[0].r;
  };
  const callErr = async (fn, args, role) => { try { await call(fn, args, role); return ''; } catch (e) { await db.exec('reset role'); return e.message; } };

  await db.exec(BASE);
  for (const f of FILES) await db.exec(SQL(f));
  for (const f of FILES) await db.exec(SQL(f));
  ok(true, '01~04 SQL 두 번 실행해도 오류 없음');
  ok(SQL('02_const.sql') === sqlOf(constOf(fs.readFileSync(path.join(__dirname, '..', 'src', 'Code.gs'), 'utf8'))), '02_const.sql 이 Code.gs 값과 같음 (다르면 node tools/gen_const_sql.js)');

  const noWhere = FILES.flatMap(f => (SQL(f).match(/\b(update|delete\s+from)\s+public\.\w+[^;]*;/gi) || []).filter(s => !/\bwhere\b/i.test(s)).map(s => f + ': ' + s.slice(0, 50)));
  ok(!noWhere.length, '조건(where) 없는 update·delete 없음 — Supabase 가 막음 ' + noWhere.join(' | '));

  // ── 보안 ──
  ok(/permission denied/.test(await asErr('authenticated', 'select * from dw_stores')), '로그인 기기: 매장 표 직접 못 읽음');
  ok(/permission denied/.test(await asErr('anon', 'select * from dw_settings')), '비로그인: 설정 표 못 읽음');
  ok(/permission denied/.test(await asErr('authenticated', "select dw_role_('{}')")), '로그인 기기: 도우미 함수 못 부름');
  ok(/permission denied/.test(await asErr('authenticated', "select dw_svc_role('{}')")), '로그인 기기: 관리자 함수(dw_svc_) 못 부름');
  ok(/permission denied/.test(await asErr('anon', "select dw_login('{\"pin\":\"1\"}')")), '비로그인: 로그인 함수 못 부름 (기기 등록 먼저)');
  ok(/permission denied/.test(await asErr('authenticated', 'select dw_migrate_clear()')), '로그인 기기: 옮기기 지우기 못 부름');
  ok((await q("select public from storage.buckets where id = 'dw-files'"))[0].public === true, '버킷 dw-files 공개');

  // ── 로그인 ──
  ok(/PIN이 아직 설정되지/.test((await call('dw_login', { p_a: { pin: '1234' } })).__err), 'PIN 없으면 안내');
  await q("insert into dw_settings values ('PIN_소장', $1), ('PIN_부소장', $2)", [H('1234'), H('5678')]);
  let r = await call('dw_start', { p_a: { pin: '1234' } });
  const TOK = H('token:소장:' + H('1234'));
  ok(r.role === '소장' && r.token === TOK, 'PIN 1234 → 소장, 표가 Code.gs 와 같은 값 (기억한 기기 그대로)');
  ok(r.boot.fields.length === 68 && r.boot.rules.length === 7 && r.boot.phrases.length === 5 && Array.isArray(r.stores), '첫 화면: 항목·준수사항·문구·매장 목록');
  const A = { role: '소장', token: TOK }, B = { role: '부소장', token: H('token:부소장:' + H('5678')) };
  ok((await call('dw_login', { p_a: { role: '부소장', pin: '5678' } })).token === B.token, '부소장 PIN 로그인');
  ok(/PIN이 바뀌었습니다/.test(await callErr('dw_list_stores', { p_a: { role: '소장', token: 'x' } })), '틀린 표 → 다시 로그인 안내');
  ok(/로그인이 필요/.test(await callErr('dw_list_stores', { p_a: { pin: '1234' } })), '로그인 뒤 함수는 PIN 대신 표만 받음');
  for (let i = 0; i < 19; i++) await call('dw_login', { p_a: { pin: '0000' } });
  ok((await call('dw_login', { p_a: { pin: '1234' } })).role === '소장', '19번 틀려도 아직 됨');
  r = await call('dw_login', { p_a: { pin: '0000' } });
  ok(/PIN이 맞지/.test(r.__err), '20번째 틀림');
  ok(/10분 동안 PIN 입력을 막았습니다/.test((await call('dw_login', { p_a: { pin: '1234' } })).__err), '20번 틀리면 맞는 PIN도 10분 막음');
  ok((await call('dw_list_stores', { p_a: A })).length === 0, '잠겨도 기억한 기기(표)는 그대로 열림');
  ok((await q("select count(*)::int n from dw_log where action = 'PIN 입력 잠금'"))[0].n === 1, '잠금 변경기록');
  await q("update dw_settings set value = '{}' where key = 'PIN_FAIL'");

  // ── 검토서 저장 (새 매장) ──
  const rv = { clientId: 'c-abc12345', reviewDate: '2026-11-14', tenant: '테스트매장', storeType: '본매장', kitchen: '없음', waterproof: '시공',
    ceiling: '이상한값', contractorCompany: '가나건설', contractorEmail: 'a@b.co', docCad: '미제출', docFR: '제출', rulesAck: true,
    safetySig: 'data:image/png;base64,AAAA', notes: 'x'.repeat(30000), gasGrade: 'g'.repeat(600),
    notesPhotos: JSON.stringify([{ id: 'p1<>', f: 'abcdefghij12', a: 1.26, x: 9999, y: 0, w: 5, h: 100, r: 45 }, { f: 'bad' }]) };
  r = await call('dw_save_review', { p_a: A, p_review: rv, p_finalize: false });
  const sid = r.store.id, R1 = r.reviews[0];
  ok(sid === 'c-abc12345' && r.store.seq === 1 && r.store.docNo === '에비뉴엘컨펌_001_261114' && r.store.status === '협의중', '새 매장: 문서번호 ' + r.store.docNo);
  ok(R1.round === 1 && R1.status === '작성중' && R1.savedBy === '소장' && R1.rulesAck === true && R1.chiefOk === false, '1차 검토서 저장');
  ok(R1.waterproof === '해당없음' && R1.gasGrade === '해당없음' && R1.ceiling === '' && R1.notes.length === 20000, '주방 없음 → 해당없음, 선택지 밖 값 비움, 긴 글 자름');
  ok(r.store.docMissing === '설계도면(CAD)' && r.store.contractor === '가나건설' && r.store.currentRound === 1, '매장 요약: 미제출 서류·시공업체·차수');
  const ph = JSON.parse(R1.notesPhotos);
  ok(ph.length === 1 && ph[0].id === 'p1' && ph[0].a === 1.3 && ph[0].x === 5000 && ph[0].w === 20 && ph[0].r === 0, '사진 목록 검사 (Code.gs sanitizePhotos_)');
  ok(Object.keys(r.store).length === 25 && r.store.fireDoc === '', '매장 25칸 모두 (빈 칸은 "")');
  r = await call('dw_save_review', { p_a: A, p_review: rv, p_finalize: false });
  ok(r.store.id === sid && r.reviews.length === 1, '같은 clientId 로 다시 저장 → 같은 매장 (두 번 눌러도 하나)');
  ok(/서명 이미지가 너무 큽니다/.test(await callErr('dw_save_review', { p_a: A, p_review: Object.assign({}, rv, { safetySig: 'data:image/png;base64,' + 'A'.repeat(46000) }), p_finalize: false })), '서명 그림 너무 크면 거절');

  // 원격 서명이 들어온 뒤 화면이 빈 서명으로 저장해도 지우지 않음
  await q("update dw_reviews set data = data || '{\"salesSig\":\"data:image/png;base64,SS\",\"salesName\":\"홍\",\"salesSigDate\":\"2026-11-14\"}' where store_id = $1", [sid]);
  r = await call('dw_save_review', { p_a: A, p_review: Object.assign({}, rv, { storeId: sid, round: 1 }), p_finalize: true });
  ok(r.reviews[0].salesSig === 'data:image/png;base64,SS' && r.reviews[0].salesName === '홍' && r.reviews[0].status === '검토완료', '원격 서명은 남김 + 검토완료');
  r = await call('dw_save_review', { p_a: A, p_review: Object.assign({}, rv, { storeId: sid, round: 1, _sigCleared: ['salesSig'] }), p_finalize: false });
  ok(r.reviews[0].salesSig === '' && r.reviews[0].salesName === '홍', '「서명 삭제」한 칸만 지움');

  // 소장 확인 · 다음 차수 · 차수 삭제
  ok(/소장 PIN으로/.test(await callErr('dw_set_chief_ok', { p_a: B, p_store: sid, p_round: 1, p_on: true })), '부소장은 소장 확인 못 함');
  r = await call('dw_set_chief_ok', { p_a: A, p_store: sid, p_round: 1, p_on: true });
  ok(r.reviews[0].chiefOk === true && r.reviews[0].chiefOkBy === '소장' && r.store.chiefOk === 'Y', '소장 확인');
  r = await call('dw_save_review', { p_a: B, p_review: Object.assign({}, rv, { storeId: sid, round: 1 }), p_finalize: false });
  ok(r.reviews[0].chiefOk === true, '다시 저장해도 소장 확인은 그대로');
  r = await call('dw_next_round', { p_a: B, p_store: sid });
  const R2 = r.reviews[1];
  ok(r.reviews.length === 2 && R2.round === 2 && R2.tenant === '테스트매장' && R2.notes === '' && R2.safetySig === '' && R2.rulesAck === false && R2.chiefOk === false && R2.reviewDate.length === 10, '다음 차수: 복사하되 특이사항·서명·확인 비움');
  ok(r.store.currentRound === 2, '매장 현재 차수 2');
  r = await call('dw_delete_last_round', { p_a: A, p_store: sid });
  ok(r.reviews.length === 1 && r.store.currentRound === 1, '마지막 차수 삭제');
  ok(/1차만 남은/.test(await callErr('dw_delete_last_round', { p_a: A, p_store: sid })), '1차만 남으면 삭제 못 함');
  ok((await q('select count(*)::int n from dw_deleted'))[0].n === 1, '지운 차수 → 삭제보관');
  let L = await call('dw_set_confirmed', { p_a: A, p_store: sid, p_confirmed: true });
  ok(L[0].status === '컨펌완료' && L[0].confirmedBy === '소장', '컨펌완료');
  ok(/컨펌완료된 매장입니다/.test(await callErr('dw_save_review', { p_a: A, p_review: Object.assign({}, rv, { storeId: sid, round: 1 }), p_finalize: false })), '컨펌완료 매장은 저장 막음');
  ok(/컨펌완료된 매장은 삭제할 수 없습니다/.test(await callErr('dw_delete_store', { p_a: A, p_store: sid })), '컨펌완료 매장은 삭제 막음');
  ok((await call('dw_set_chief_ok', { p_a: A, p_store: sid, p_round: 1, p_on: false })).reviews[0].chiefOk === false, '컨펌완료여도 소장 확인은 바꿀 수 있음');
  await call('dw_set_confirmed', { p_a: A, p_store: sid, p_confirmed: false });

  // 업체 자동완성
  const co = await call('dw_companies', { p_a: A });
  ok(co.length === 1 && co[0].name === '가나건설' && co[0].kind === '시공업체' && co[0].email === 'a@b.co', '업체명 자동완성');

  // ── 파일 ──
  ok(/파일을 올리지 못했습니다/.test(await callErr('dw_photo_added', { p_a: A, p_store: sid, p_round: 1, p_file: { path: 'pdf/x.jpg', url: 'https://u/x' } })), '사진 경로가 photo/ 아니면 거절');
  const P = await call('dw_photo_added', { p_a: A, p_store: sid, p_round: 1, p_file: { path: 'photo/2026-11/a1.jpg', url: 'https://u/photo/a1.jpg', size: 1000, mime: 'image/jpeg' } });
  ok(/^1차_\d{8}_\d{6}_\d{1,3}\.jpg$/.test(P.name) && P.fileId.length === 36, '사진 이름 ' + P.name);
  r = await call('dw_file', { p_a: A, p_id: P.fileId, p_kind: 'photo' });
  ok(r.url === 'https://u/photo/a1.jpg' && r.drive_id === null, '사진 꺼내기: 버킷 주소');
  ok((await call('dw_file', { p_a: A, p_id: P.fileId, p_kind: 'pdf' })) === null, '다른 종류로는 안 꺼내짐');
  const fileA = { path: 'pdf/2026-11/p1.pdf', url: 'https://u/p1.pdf', size: 5 };
  r = await call('dw_pdf_saved', { p_a: A, p_store: sid, p_round: 1, p_name: '검토서/1차.pdf', p_file: fileA, p_auto: true });
  ok(r.name === '검토서_1차.pdf' && r.url === 'https://u/p1.pdf' && r.folder === '도면협의_출력/에비뉴엘컨펌_001_261114', 'PDF 보관: 이름 정리 ' + r.name);
  ok(JSON.parse(r.store.sendLog).slice(-1)[0].t === 'pdf' && JSON.parse(r.store.sendLog).slice(-1)[0].f === r.fileId, '발송 기록에 PDF 한 줄 (파일 번호 포함)');
  await call('dw_pdf_saved', { p_a: A, p_store: sid, p_round: 1, p_name: '검토서/1차.pdf', p_file: { path: 'pdf/2026-11/p2.pdf', url: 'https://u/p2.pdf' }, p_auto: false });
  ok((await q("select count(*)::int n from dw_files where kind = 'pdf' and trash"))[0].n === 1, '같은 이름 PDF 다시 → 옛것은 지울 표시');
  r = await call('dw_firedoc_set', { p_a: A, p_store: sid, p_file: { path: 'firedoc/2026-11/f1.jpg', url: 'https://u/f1.jpg', mime: 'image/jpeg' } });
  const fd = JSON.parse(r.store.fireDoc);
  ok(/^\d{4}-\d{2}-\d{2}_방재실협의서-테스트매장_001\.jpg$/.test(fd.name) && fd.r === 0, '협의서 이름 ' + fd.name);
  ok((await call('dw_firedoc_rotate', { p_a: A, p_store: sid, p_r: 90 })).r === 90 && (await call('dw_firedoc', { p_a: A, p_store: sid })).r === 90, '협의서 돌린 방향 기억');
  await call('dw_firedoc_set', { p_a: A, p_store: sid, p_file: { path: 'firedoc/2026-11/f2.jpg', url: 'https://u/f2.jpg' } });
  ok((await q("select count(*)::int n from dw_files where kind = 'firedoc' and trash"))[0].n === 1, '협의서 다시 올림 → 옛것 지울 표시');
  r = await call('dw_firedoc_delete', { p_a: A, p_store: sid });
  ok(r.store.fireDoc === '' && /올린 종합방재실 협의서가 없습니다/.test(await callErr('dw_firedoc', { p_a: A, p_store: sid })), '협의서 지움');

  // ── 원격 서명 (관리자 열쇠로 링크 표를 넣고, 로그인 없는 사람이 서명) ──
  const tok = 'ab'.repeat(32), h = (await q("select dw_sign_key_($1) h", [tok]))[0].h;
  ok(h === 'SIGT_' + H('sig:' + tok).slice(0, 40), '서명 링크 표 열쇠 = Code.gs sigKey_ (옛 링크 그대로)');
  await call('dw_svc_sign_put', { p_store: sid, p_round: 1, p_rows: [{ h, who: 'sales', email: 's@x.co', exp: Date.now() + 7 * 864e5, pdf_url: 'https://u/p2.pdf', by: '소장' }] }, 'service_role');
  await call('dw_svc_record', { p_store: sid, p_patch: {}, p_pending: { '1:sales': { h, to: 's@x.co' } }, p_sendlog: { t: 'sigreq', d: '영업팀' }, p_log: { who: '소장', action: '원격 서명 요청', detail: '1차' } }, 'service_role');
  let si = await call('dw_sign_info', { p_token: tok }, 'anon');
  ok(si.who === '영업팀' && si.org === '롯데쇼핑' && si.tenant === '테스트매장' && si.pdfUrl === 'https://u/p2.pdf' && /^\d{1,2}\/\d{1,2}$/.test(si.until), '서명 페이지 정보 (로그인 없이)');
  ok(/연락처를 입력/.test(await callErr('dw_sign_submit', { p_token: tok, p_data: { name: '김영업', tel: '010', sig: 'data:image/png;base64,QQ' } }, 'anon')), '연락처 짧으면 거절');
  r = await call('dw_sign_submit', { p_token: tok, p_data: { name: ' 김영업 ', tel: '010-1234-5678abc', sig: 'data:image/png;base64,QQ' } }, 'anon');
  ok(r.ok && r.who === '영업팀', '원격 서명 저장');
  const g = await call('dw_get_store', { p_a: A, p_store: sid });
  ok(g.reviews[0].salesName === '김영업' && g.reviews[0].salesTel === '010-1234-5678' && g.reviews[0].salesSig === 'data:image/png;base64,QQ' && g.store.sigPending === '{}', '검토서에 서명 · 서명 요청 칸 비움');
  ok(/이미 서명했거나/.test(await callErr('dw_sign_info', { p_token: tok }, 'anon')), '한 번 쓴 링크는 끝');
  ok(/올바르지 않습니다/.test(await callErr('dw_sign_info', { p_token: 'zz' }, 'anon')), '이상한 링크 거절');

  // ── 문구 · 비슷한 말 ──
  const pl = await call('dw_save_phrases', { p_a: A, p_list: [{ t: '첫 문구  ', c: '전기' }, { t: '   ', c: '전기' }, { t: '둘', c: '없는분류' }] });
  ok(pl.length === 2 && pl[0].t === '첫 문구' && pl[1].c === '기타', '자주 쓰는 문구 저장');
  await q("insert into dw_synonyms values (1, '스프링클러', 'SP, 헤드'), (2, '혼자', '')");
  ok(JSON.stringify((await call('dw_bootstrap', { p_a: A })).synonyms) === '[["스프링클러","SP","헤드"]]', '비슷한 말 묶음');

  // ── 지침 ──
  let st = await call('dw_guide_pdf_add', { p_a: A, p_file: { path: 'guide/pdf/g1.pdf', url: 'https://u/g1.pdf', size: 99 }, p_name: '테넌트 지침.pdf' });
  const pdfId = st.pdfs[0].fileId;
  ok(st.pdfs.length === 1 && st.pdfs[0].name === '테넌트 지침.pdf' && st.sb === true, '지침 PDF 올림');
  let bg = await call('dw_guide_begin', { p_a: A, p_info: { title: '테넌트 시설공사 지침', short: '테넌트', fileId: pdfId } });
  ok(/^g[0-9a-f]+$/.test(bg.id) && bg.resumed === false && bg.have.length === 0, '색인 시작 ' + bg.id);
  await call('dw_guide_save_pages', { p_a: A, p_id: bg.id, p_pages: [{ p: 1, path: 'guide/' + bg.id + '/a.jpg', url: 'https://u/a.jpg' }, { p: 2, path: 'photo/x.jpg', url: 'https://u/x' }] });
  ok(/1 \/ 2쪽만/.test(await callErr('dw_guide_finish', { p_a: A, p_id: bg.id, p_meta: { pages: 2 }, p_entries: [{ t: '감지기', p: 1 }] })), '쪽 그림이 모자라면 마치기 막음');
  bg = await call('dw_guide_begin', { p_a: A, p_info: { title: '테넌트 시설공사 지침', short: '테넌트', fileId: pdfId } });
  ok(bg.resumed === true && JSON.stringify(bg.have) === '[1]', '끊긴 작업 이어서 (1쪽 있음)');
  await call('dw_guide_save_pages', { p_a: A, p_id: bg.id, p_pages: [{ p: 2, path: 'guide/' + bg.id + '/b.jpg', url: 'https://u/b.jpg' }] });
  st = await call('dw_guide_finish', { p_a: A, p_id: bg.id, p_meta: { pages: 2, landscape: false }, p_entries: [{ t: '감지기', p: 1 }, { t: '분전반', p: 2 }] });
  ok(st.sources.length === 1 && st.sources[0].entries === 2 && st.sources[0].images === true && st.building === null, '색인 마침 → 검색에 추가');
  const ix = await call('dw_guide_index', { p_a: A });
  ok(ix.length === 2 && ix[0].d === bg.id, '검색 항목 (지침 번호 붙음)');
  ok((await call('dw_guide_page', { p_a: A, p_guide: bg.id, p_page: 2 })).url === 'https://u/b.jpg', '쪽 그림 꺼내기');
  // 개정판: 다른 PDF 로 같은 지침 바꾸기 → 이전 판
  st = await call('dw_guide_pdf_add', { p_a: A, p_file: { path: 'guide/pdf/g2.pdf', url: 'https://u/g2.pdf' }, p_name: '테넌트 지침 개정.pdf' });
  const pdf2 = st.pdfs.find(x => x.name === '테넌트 지침 개정.pdf').fileId;
  const b2 = await call('dw_guide_begin', { p_a: A, p_info: { title: '테넌트 지침(개정)', short: '테넌트', fileId: pdf2, replaces: bg.id } });
  await call('dw_guide_save_pages', { p_a: A, p_id: b2.id, p_pages: [{ p: 1, path: 'guide/' + b2.id + '/a.jpg', url: 'https://u/c.jpg' }] });
  st = await call('dw_guide_finish', { p_a: A, p_id: b2.id, p_meta: { pages: 1 }, p_entries: [{ t: '새 항목', p: 1 }] });
  ok(st.sources.length === 1 && st.sources[0].id === b2.id && st.archive.length === 1 && st.archive[0].id === bg.id, '개정판 → 예전 것은 이전 판으로');
  ok(st.guides.length === 2 && st.guides[1].archived === true, '화면 지침 목록: 지금 판 + 이전 판');
  st = await call('dw_guide_remove_archived', { p_a: A, p_id: bg.id });
  ok(st.archive.length === 0 && (await q("select count(*)::int n from dw_files where kind = 'guide_page' and trash"))[0].n === 2, '이전 판 지움 → 쪽 그림 지울 표시');
  st = await call('dw_guide_rename', { p_a: A, p_id: b2.id, p_info: { title: '새 이름', short: '새' } });
  ok(st.sources[0].title === '새 이름', '지침 이름 바꾸기');

  // ── 매장 삭제 ──
  L = await call('dw_delete_store', { p_a: A, p_store: sid });
  ok(L.length === 0 && (await q("select count(*)::int n from dw_files where store_id = $1 and not trash", [sid]))[0].n === 0, '매장 삭제 → 그 매장 파일 모두 지울 표시');
  ok((await q("select value from dw_settings where key = 'LAST_SEQ'"))[0].value === '1', '지운 번호 기억 (LAST_SEQ)');
  r = await call('dw_save_review', { p_a: A, p_review: { reviewDate: '2026-12-01', tenant: '둘째' }, p_finalize: false });
  ok(r.store.docNo === '에비뉴엘컨펌_002_261201', '지운 번호는 다시 안 씀 → ' + r.store.docNo);

  // ── 관리자 열쇠 함수 ──
  ok((await call('dw_svc_role', { p_a: A }, 'service_role')) === '소장', '웹앱이 로그인 정보 확인');
  const sv = await call('dw_svc_get', { p_store: r.store.id, p_round: 1 }, 'service_role');
  ok(sv.review.tenant === '둘째' && sv.store.docNo === r.store.docNo, '웹앱이 검토서 읽기');
  await call('dw_svc_setting', { p_key: 'PIN_소장', p_value: H('4321') }, 'service_role');
  ok((await call('dw_login', { p_a: { pin: '4321' } })).role === '소장' && /PIN이 바뀌었습니다/.test(await callErr('dw_list_stores', { p_a: A })), 'PIN 바꾸면 예전 기기 기억은 안 통함');
  ok(/넣을 수 없는 설정/.test(await callErr('dw_svc_setting', { p_key: 'LAST_SEQ', p_value: '0' }, 'service_role')), '정해진 설정만 넣음');
  // 서명란 연락처 (결정 139): 성명별 마지막 연락처, 안전관리팀·영업팀만, 연락처 없는 것은 뺌
  await q("insert into dw_stores values ('ct', 990, '{}')");
  await q("insert into dw_reviews (id, store_id, round, data) values ('ct1', 'ct', 1, $1), ('ct2', 'ct', 2, $2)", [
    JSON.stringify({ savedAt: '2026-11-01 10:00:00', safetyName: '김안전', safetyTel: '010-1111-1111', salesName: '이영업', salesTel: '', respName: '박책임', respTel: '010-9' }),
    JSON.stringify({ savedAt: '2026-11-10 10:00:00', safetyName: '김안전', safetyTel: '010-2222-2222', salesName: '최영업', salesTel: '010-3333-3333' })]);
  const A2 = { role: '소장', token: H('token:소장:' + H('4321')) }, ct = await call('dw_contacts', { p_a: A2 });
  ok(ct.map(c => c.who + ':' + c.name + ':' + c.tel).join(' ') === 'safety:김안전:010-2222-2222 sales:최영업:010-3333-3333', '서명란 연락처: 최근 번호 · 빈 번호 뺌 · 공사 책임자 뺌');
  ok(/permission denied/.test(await callErr('dw_contacts', { p_a: A2 }, 'anon')), '서명란 연락처: 비로그인 못 부름');
  await q("delete from dw_stores where id = 'ct'");

  const ck = await call('dw_check_setup', {}, 'service_role');
  ok(ck.bucket === true && ck.pin['소장'] === true && ck.counts['매장'] === 1, '연결 확인');
  ok((await call('dw_backup', { p_table: 'dw_stores' }, 'service_role')).length === 1, 'DB 백업 (표 통째로)');
  await call('dw_migrate_clear', {}, 'service_role');
  ok((await q('select count(*)::int n from dw_stores'))[0].n === 0, '옮기기 전 비우기');

  console.log(fail ? '\n실패 ' + fail + '개' : '\n도면협의 SQL 시험 통과');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
