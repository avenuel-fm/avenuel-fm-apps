/* ───────────────────────── 도면협의 Supabase 이관 (docs/설계/DW_Supabase이관.md) ─────────────────────────
   업무지원 이관과 같은 방식. 자료는 Supabase DB, 이 구글 스크립트에는 다음만 남음:
    1) 메일 (서명 요청·서류 요청·시방서) — 화면(fm/dw/app.html)이 POST {api:'dw'} 로 부름 → Gmail 로 보내고 DB 에 기록
    2) 드라이브로 옮긴 옛 파일(사진·협의서·PDF·지침) 꺼내 주기 — 같은 통로 fn:'file'
    3) 시트 메뉴 ⑨: 시트 → DB 한 번 옮기기 · 주 1회 드라이브 옮기기 · 백업 · 연결 확인
   필요: 스크립트 속성 SUPABASE_URL · SUPABASE_SERVICE_KEY (service_role 키 — 사용자가 직접 넣음, 화면·채팅·코드에 쓰지 않음)
         Supabase SQL Editor 에서 supabase/01_schema.sql → 02_const.sql → 03_api.sql → 04_service.sql 실행 */

var SB = { BUCKET: 'dw-files', BATCH: 500, ARC_DAYS: 8, ORPHAN_DAYS: 2, PAGE: 100, BUDGET: 270000, CHUNK: 5 * 1024 * 1024 };
// 8일: 원격 서명 링크(7일)가 끝난 뒤에 PDF 를 드라이브로 옮김 (메일 속 PDF 링크가 링크 기간 안에는 살아 있게)
var SB_TABLES = ['dw_files', 'dw_settings', 'dw_stores', 'dw_reviews', 'dw_rules', 'dw_phrases', 'dw_synonyms', 'dw_log', 'dw_deleted', 'dw_sign_tokens', 'dw_guides'];

/* ── 부르기 (관리자 열쇠: 보안 규칙을 건너뜀 — 그래서 키는 스크립트 속성에만) ── */
function sbConf_() {
  var p = props_();
  var url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, ''), key = p.getProperty('SUPABASE_SERVICE_KEY');
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !key) throw new Error('스크립트 속성 SUPABASE_URL · SUPABASE_SERVICE_KEY 를 먼저 넣어 주세요.');
  return { url: url, key: key };
}
function sbReady_() { try { sbConf_(); return true; } catch (e) { return false; } }
/** 바꿔 탄 뒤인가 (메뉴 ⑨-1 옮기기가 끝나면 SUPABASE_LIVE = Y). 되돌릴 때는 그 속성을 지움 */
function sbLive_() { return props_().getProperty('SUPABASE_LIVE') === 'Y'; }
function sbReq_(method, path, body, headers) {
  var c = sbConf_();
  var o = { method: method, muteHttpExceptions: true, headers: Object.assign({ apikey: c.key, Authorization: 'Bearer ' + c.key }, headers || {}) };
  if (body !== undefined) { o.contentType = 'application/json'; o.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(c.url + path, o), code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    var msg = String(res.getContentText() || '');
    try { msg = JSON.parse(msg).message || msg; } catch (e) { /* 글 그대로 */ }
    throw new Error(code >= 500 || code === 404 ? path.split('?')[0] + ' 실패 (' + code + '): ' + msg.slice(0, 300) : msg.slice(0, 300));
  }
  return res;
}
function sbRpc_(fn, args) {
  var t = sbReq_('post', '/rest/v1/rpc/' + fn, args || {}).getContentText();
  return t ? JSON.parse(t) : null;
}
function sbPost_(table, rows) {
  for (var i = 0; i < rows.length; i += SB.BATCH) sbReq_('post', '/rest/v1/' + table, rows.slice(i, i + SB.BATCH), { Prefer: 'return=minimal' });
}

/* ───────── 1·2) 화면 통로: doPost {api:'dw', fn, a, args} ───────── */
function dwApi_(body) {
  try {
    var role = sbRpc_('dw_svc_role', { p_a: body.a || {} });   // 화면의 로그인 정보 (PIN 확인은 DB 가 함)
    var g = body.args || [], fn = String(body.fn || '');
    var data;
    if (fn === 'apiSigRequest') data = sbSigRequest_(role, g[0], Number(g[1]), g[2], g[3] || {});
    else if (fn === 'apiSendDocReq') data = sbSendDocReq_(role, g[0], Number(g[1]), g[2], g[3]);
    else if (fn === 'apiSendSpec') data = sbSendSpec_(role, g[0], Number(g[1]), g[2], g[3]);
    else if (fn === 'apiSpecInfo') data = specInfo_();
    else if (fn === 'file') data = sbDriveChunk_(String(g[0] || ''), Number(g[1]) || 0);
    else throw new Error('모르는 요청입니다: ' + fn);
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message || err).replace(/^(Exception|Error):\s*/, '') });
  }
}

/** 매장 + 차수 (없으면 Code.gs 와 같은 안내) */
function sbStoreReview_(sid, round) {
  var g = sbRpc_('dw_svc_get', { p_store: String(sid || ''), p_round: Number(round) || 0 });
  if (!g) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
  if (!g.review) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
  return g;
}
function sbRecord_(sid, patch, pending, sendlog, log) {
  return sbRpc_('dw_svc_record', { p_store: sid, p_patch: patch || {}, p_pending: pending || {}, p_sendlog: sendlog || null, p_log: log || null });
}
/** 서명 링크 기준 주소 = DB 설정 「바로가기주소」 (…/fm/dw/). 바꿔 탄 뒤 /exec 는 옛 시트 앱이라 쓰지 않음 */
function sbPublicLink_(shortcut, query) {
  if (!okShortcut_(shortcut)) throw new Error('바로가기 주소가 없습니다. 시트 메뉴 ⑧에서 바로가기 주소(…/fm/dw/)를 넣어 주세요.');
  return shortcut + (shortcut.indexOf('?') >= 0 ? '&' : '?') + query;
}

/** 원격 서명 요청 (Code.gs apiSigRequest 와 같은 메일). PDF 는 화면이 이미 버킷에 올림 (pdf = {fileId, url, name}) */
function sbSigRequest_(role, sid, round, reqs, pdf) {
  var g = sbStoreReview_(sid, round), review = g.review;
  reqs = (reqs || []).filter(function (r, i, arr) { return r && SIG_WHO[r.who] && arr.map(function (x) { return x && x.who; }).indexOf(r.who) === i; })
    .map(function (r) { return { who: r.who, email: String(r.email || '').trim() }; });
  if (!reqs.length) throw new Error('서명받을 사람을 골라 주세요.');
  reqs.forEach(function (r) { if (!okEmail_(r.email)) throw new Error(SIG_WHO[r.who].l + ' 이메일 형식이 맞지 않습니다.'); });
  if (MailApp.getRemainingDailyQuota() < reqs.length) throw new Error('오늘 보낼 수 있는 메일 수가 모자랍니다. 내일 다시 보내 주세요.');
  if (!/^https:\/\//.test(String(pdf.url || ''))) throw new Error('검토서 PDF를 올리지 못했습니다. 다시 해 주세요.');
  var exp = Date.now() + SIG_DAYS * 86400000, expText = Utilities.formatDate(new Date(exp), 'Asia/Seoul', 'M/d');
  var list = reqs.map(function (r) { var t = newToken_(); return { r: r, token: t, h: sigKey_(t) }; });
  sbPublicLink_(g.shortcut, 'sign=x');   // 주소가 없으면 링크 표를 만들기 전에 멈춤
  sbRpc_('dw_svc_sign_put', { p_store: sid, p_round: round, p_rows: list.map(function (x) {
    return { h: x.h, who: x.r.who, email: x.r.email, exp: exp, pdf_url: pdf.url, by: role };
  }) });
  var t = review.tenant || '', fromOk = true, sent = [], pending = {};
  list.forEach(function (x) {
    var c = SIG_WHO[x.r.who];
    var mail = mailMake_('[' + APP.STORE_LABEL + '] ' + t + ' 공사 도면 검토서 서명 요청', [
      { t: '안녕하세요, ' + APP.STORE_LABEL + ' 시설팀입니다.' },
      { t: t + ' 공사 도면 검토서(' + round + '차) ' + c.l + ' 서명을 요청드립니다.' },
      { gap: true },
      { t: '1. 검토서 보기 :', url: pdf.url, link: pdf.name || '검토서 PDF' },
      { t: '2. 서명하기 :', button: '여기를 눌러 서명하기', url: sbPublicLink_(g.shortcut, 'sign=' + x.token) },
      { gap: true },
      { t: '서명은 휴대폰으로 진행 가능합니다. PC에서는 마우스로 서명할 수 있습니다.', bold: true },
      { t: '링크는 ' + expText + '까지 사용할 수 있습니다.' }
    ], '');
    fromOk = mailSend_(x.r.email, mail) && fromOk;
    pending[round + ':' + x.r.who] = { at: nowText_(), to: x.r.email, exp: exp, h: x.h, by: role };
    sent.push(c.l + ' ' + x.r.email);
  });
  var em = g.sigEmails || {};
  reqs.forEach(function (r) { if (r.who !== 'resp') em[r.who] = r.email; });   // 안전관리팀·영업팀 주소는 다음에 미리 채움
  sbRpc_('dw_svc_setting', { p_key: 'SIG_EMAILS', p_value: JSON.stringify(em) });
  sbRecord_(sid, {}, pending, { t: 'sigreq', by: role, round: round, d: sent.join(' · ') },
    { who: role, action: '원격 서명 요청', detail: round + '차 ' + sent.join(', ') });
  return { fromOk: fromOk, sigEmails: em };
}

/** 미제출 서류 요청 (Code.gs apiSendDocReq) */
function sbSendDocReq_(role, sid, round, keys, extra) {
  var review = sbStoreReview_(sid, round).review;
  var to = String(review.contractorEmail || '').trim();
  if (!okEmail_(to)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
  var names = {}; DOC_NAMES.forEach(function (d) { names[d[0]] = d[1]; });
  keys = (keys || []).filter(function (k, i, arr) { return arr.indexOf(k) === i && DOC_REQ_KEYS.indexOf(k) >= 0 && review[k] === '미제출'; });
  if (!keys.length) throw new Error('요청할 미제출 서류가 없습니다. 제출서류에서 「미제출」을 먼저 저장해 주세요.');
  extra = String(extra || '').trim().slice(0, 1000);
  var t = review.tenant || '';
  var blocks = [{ t: '안녕하세요, ' + APP.STORE_LABEL + ' 시설팀입니다.' }, { t: t + ' 공사 도면 검토(' + round + '차) 결과 아래 서류가 아직 제출되지 않았습니다.' }, { t: '미제출 시 준공이 불가하니 제출 부탁드립니다.' }, { gap: true }]
    .concat(keys.map(function (k) { return { t: '· ' + names[k] }; }));
  var fromOk = mailSend_(to, mailMake_('[' + APP.STORE_LABEL + '] ' + t + ' 미제출 서류 제출 요청', blocks, extra));
  var d = keys.map(function (k) { return names[k]; }).join(', ');
  sbRecord_(sid, {}, {}, { t: 'doc', to: to, by: role, round: round, d: d }, { who: role, action: '서류 요청', detail: d + ' → ' + to });
  return { fromOk: fromOk };
}

/** 시방서 발송 (Code.gs apiSendSpec). ZIP 은 계속 드라이브 지침 폴더 */
function sbSendSpec_(role, sid, round, keys, extra) {
  var g = sbStoreReview_(sid, round), review = g.review;
  var to = String(review.contractorEmail || '').trim();
  if (!okEmail_(to)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
  keys = (keys || []).filter(function (k, i, arr) { return arr.indexOf(k) === i && SPECS.some(function (sp) { return sp.k === k; }); });
  if (!keys.length) throw new Error('보낼 시방서를 골라 주세요.');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('오늘 보낼 수 있는 메일 수를 다 썼습니다. 내일 다시 보내 주세요.');
  var files = specFiles_(), items = [];
  keys.forEach(function (k) {
    var sp = SPECS.filter(function (x) { return x.k === k; })[0], f = files[k];
    if (!f) throw new Error('지침 폴더에 ' + sp.l + ' ZIP 파일이 없습니다.');
    try {
      if (f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (e) {
      throw new Error(sp.l + ' 파일을 "링크가 있는 모든 사용자"로 공유하지 못했습니다. 드라이브에서 직접 공유 설정을 바꿔 주세요.');
    }
    items.push({ k: k, l: sp.l, name: f.getName(), url: f.getUrl() });
  });
  extra = String(extra || '').trim().slice(0, 1000);
  var mail = specMail_(review.tenant, items, extra);
  var opts = { htmlBody: mail.html, name: APP.SPEC_FROM_NAME };
  if (fromAliasOk_()) opts.from = APP.SPEC_FROM; else opts.replyTo = APP.SPEC_FROM;
  GmailApp.sendEmail(to, mail.subject, mail.body, opts);
  var now = nowText_(), list = specSentList_(g.store);
  items.forEach(function (it) { list.push({ k: it.k, l: it.l, at: now, to: to, by: role, round: round }); });
  sbRecord_(sid, { specSent: JSON.stringify(list.slice(-40)) }, {}, null,
    { who: role, action: '시방서 발송', detail: items.map(function (x) { return x.l; }).join(', ') + ' → ' + to + (opts.from ? '' : ' (보낸 주소: 구글 계정, 회신: ' + APP.SPEC_FROM + ')') });
  return { fromOk: !!opts.from };
}

/** 드라이브로 옮긴 파일 5MB 씩 (도면협의 폴더 4개 안의 것만 — 사진·출력·지침 아래 3단까지) */
function sbDriveChunk_(id, offset) {
  if (!/^[-\w]{20,80}$/.test(id)) throw new Error('파일 번호가 올바르지 않습니다.');
  var file;
  try { file = DriveApp.getFileById(id); } catch (e) { throw new Error('파일을 찾을 수 없습니다.'); }
  var roots = {};
  ['photo', 'pdf', 'guide'].forEach(function (k) { var f = appFolder_(k, true); if (f) roots[f.getId()] = 1; });
  var inside = false, level = [file];
  for (var d = 0; d < 3 && !inside && level.length; d++) {
    var next = [];
    level.forEach(function (it) { var ps = it.getParents(); while (ps.hasNext()) { var p = ps.next(); if (roots[p.getId()]) inside = true; next.push(p); } });
    level = next;
  }
  if (!inside) throw new Error('도면협의 폴더의 파일만 볼 수 있습니다.');
  var blob = file.getBlob(), bytes = blob.getBytes(), start = Math.max(0, offset), end = Math.min(bytes.length, start + SB.CHUNK);
  return { size: bytes.length, offset: start, mime: blob.getContentType(), data: Utilities.base64Encode(bytes.slice(start, end)) };
}

/* ───────── 3) 시트 메뉴 ⑨ Supabase ───────── */
function sbMenu_() {
  return SpreadsheetApp.getUi().createMenu('⑨ Supabase')
    .addItem('1. 시트 → Supabase 옮기기 (바꿔 타는 날 한 번)', 'sbMigrateMenu_')
    .addItem('2. 주 1회 드라이브로 옮기기 켜기', 'sbArchiveMenu_')
    .addItem('3. 연결 확인 (읽기만)', 'sbCheckMenu_');
}

/** 1. 시트의 모든 자료 → DB (DB 를 비우고 다시 씀) */
function sbMigrateMenu_() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Supabase로 옮기기', '시트의 모든 자료를 Supabase DB로 옮깁니다.\n\nDB에 있던 도면협의 자료는 지우고 다시 씁니다 — 바꿔 타는 날 한 번만 돌리세요.\n(시트·드라이브 파일은 그대로 남습니다)\n\n계속할까요?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var r = sbMigrate_();
  ui.alert('Supabase로 옮기기', '끝났습니다.\n\n' + r.join('\n') + '\n\n다음: 바로가기 페이지 fm/dw/config.js 의 LIVE 를 true 로 올리고 GitHub 에 올리기.\n그 뒤로 PIN(②)·바로가기 주소(⑧)를 바꾸면 Supabase 에도 같이 씁니다.', ui.ButtonSet.OK);
}

/** 드라이브 파일 번호 → dw_files 줄 번호 (같은 번호면 늘 같은 uuid — 다시 돌려도 같음) */
function sbUuid_(id) {
  var h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dw-file:' + id).map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('').slice(0, 32);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32);
}
function sbTs_(s) {
  var m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
  return m ? m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':' + (m[4] || '00') + '+09:00' : null;
}

function sbMigrate_() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var files = {}, now = new Date().toISOString();
    var file = function (driveId, kind, folder, sid, name, at) {
      if (!driveId || files[driveId]) return driveId ? sbUuid_(driveId) : null;
      var nm = name || '', mime = null;
      if (!nm) { try { var f = DriveApp.getFileById(driveId); nm = f.getName(); mime = f.getMimeType(); } catch (e) { nm = driveId; } }
      files[driveId] = { id: sbUuid_(driveId), kind: kind, file_url: 'https://drive.google.com/file/d/' + driveId + '/view', storage_path: null, mime: mime,
        file_name: nm, drive_folder: folder, drive_id: driveId, store_id: sid || null, is_archived: true, created_at: at || now };
      return files[driveId].id;
    };
    // 매장
    var stores = readTable_(APP.SHEETS.STORES, STORE_COLS), storeRows = [], docOf = {};
    stores.forEach(function (s) {
      var d = {};
      STORE_COLS.forEach(function (c) { if (c[0] !== 'id' && c[0] !== 'seq') d[c[0]] = String(s[c[0]] == null ? '' : s[c[0]]); });
      var fd = fireDocOf_(s);
      if (fd) file(fd.f, 'firedoc', 'photo/' + s.docNo, s.id, fd.name);
      docOf[s.id] = s.docNo;
      storeRows.push({ id: s.id, seq: Number(s.seq) || 0, data: d });
    });
    // 검토서 (글자 그대로 — readReviews_ 는 true/false 로 바꾸므로 안 씀)
    var reviewRows = readTable_(APP.SHEETS.REVIEWS, reviewCols_()).filter(function (r) { return docOf[r.storeId]; }).map(function (r) {
      var d = {};
      reviewCols_().forEach(function (c) { if (['id', 'storeId', 'round'].indexOf(c[0]) < 0) d[c[0]] = String(r[c[0]] == null ? '' : r[c[0]]); });
      try { (JSON.parse(d.notesPhotos || '[]') || []).forEach(function (p) { if (p && p.f) file(p.f, 'photo', 'photo/' + docOf[r.storeId], r.storeId); }); } catch (e) { /* 사진 없음 */ }
      return { id: r.id || Utilities.getUuid(), store_id: r.storeId, round: Number(r.round) || 1, data: d, saved_at: sbTs_(d.savedAt) || now };
    });
    // 준수사항 · 문구 · 비슷한 말
    var tab = function (name, cols) {
      var sh = ss_().getSheetByName(name);
      return sh && sh.getLastRow() >= 2 ? sh.getRange(2, 1, sh.getLastRow() - 1, cols).getDisplayValues() : [];
    };
    var rules = tab(APP.SHEETS.RULES, 2).filter(function (r) { return r[1]; }).sort(function (x, y) { return Number(x[0]) - Number(y[0]); })
      .map(function (r, i) { return { seq: i + 1, text: r[1] }; });
    var phrases = readPhrases_().map(function (p, i) { return { seq: i + 1, t: p.t, c: p.c }; });
    if (!tab(APP.SHEETS.PHRASES, 2).filter(function (r) { return String(r[0]).trim(); }).length) phrases = [];   // 시트가 비면 DB 도 비움 (기본 문구가 나옴)
    var syn = tab(APP.SHEETS.SYNONYMS, 2).filter(function (r) { return String(r[0]).trim(); }).map(function (r, i) { return { seq: i + 1, word: String(r[0]).trim(), alts: String(r[1] || '') }; });
    // 변경기록 · 삭제보관
    var logs = tab(APP.SHEETS.LOG, 6).filter(function (r) { return r[0] || r[2]; }).map(function (r) {
      return { at: sbTs_(r[0]) || now, who: r[1] || null, action: r[2] || null, store_id: r[3] || null, doc_no: r[4] || null, detail: r[5] || null };
    });
    var delRows = [], dsh = ss_().getSheetByName(APP.SHEETS.DELETED);
    if (dsh && dsh.getLastRow() >= 2) {
      var hdr = dsh.getRange(1, 1, 1, dsh.getLastColumn()).getDisplayValues()[0], byHead = {};
      reviewCols_().forEach(function (c) { byHead[c[1]] = c[0]; });
      dsh.getRange(2, 1, dsh.getLastRow() - 1, hdr.length).getDisplayValues().forEach(function (row) {
        var d = {}, at = '', by = '';
        hdr.forEach(function (h, i) { if (h === '삭제일시') at = row[i]; else if (h === '삭제자') by = row[i]; else if (byHead[h]) d[byHead[h]] = row[i]; });
        if (!d.storeId && !d.id) return;
        delRows.push({ deleted_at: sbTs_(at) || now, deleted_by: by || null, store_id: d.storeId || null, round: Number(d.round) || null, data: d });
      });
    }
    // 설정 · 서명 링크
    var p = props_(), all = p.getProperties(), settings = [];
    ['PIN_소장', 'PIN_부소장', 'LAST_SEQ', 'SIG_EMAILS'].forEach(function (k) { if (all[k]) settings.push({ key: k, value: all[k] }); });
    if (okShortcut_(setting_('바로가기주소'))) settings.push({ key: '바로가기주소', value: setting_('바로가기주소') });
    var tokens = [];
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('SIGT_') !== 0) return;
      try { var t = JSON.parse(all[k]); if (t.exp > Date.now() && docOf[t.storeId]) tokens.push({ h: k, store_id: t.storeId, round: Number(t.round), who: t.who, email: t.email || null, exp: new Date(t.exp).toISOString(), pdf_url: t.pdfUrl || null, by_role: t.by || null }); } catch (e) { /* 깨진 표 */ }
    });
    // 지침: 원본 PDF · 쪽 그림 · 검색 항목
    var groot = appFolder_('guide', true);
    if (groot) { var it = groot.getFilesByType(MimeType.PDF); while (it.hasNext()) { var gf = it.next(); if (!gf.isTrashed()) file(gf.getId(), 'guide_pdf', 'guide', null, gf.getName(), Utilities.formatDate(gf.getLastUpdated(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss") + '+09:00'); } }
    var data = guideData_().index, guides = [];
    var one = function (g, i, old) {
      var pm = guidePageMap_(g.id) || {}, map = {};
      Object.keys(pm).forEach(function (k) { map[k] = file(pm[k], 'guide_page', 'guide/' + g.id, null, 'p' + ('00' + k).slice(-3) + '.jpg'); });
      var ent = data.filter(function (e) { return e.d === g.id; });
      guides.push({ id: g.id, ord: i, title: g.title, short: g.short, pages: Number(g.pages) || 0, landscape: !!g.landscape, local_pages: !!g.localPages,
        file_id: g.fileId ? sbUuid_(g.fileId) : null, file_name: g.fileName || null, file_updated: g.fileUpdated || null, entries: ent, n_entries: ent.length,
        page_map: map, built_at: g.builtAt || null, built_by: g.builtBy || null, archived: !!old, archived_at: old ? (g.archivedAt || '') : null });
    };
    guideSources_().forEach(function (g, i) { one(g, i, false); });
    guideArchive_().forEach(function (g, i) { one(g, i, true); });

    sbRpc_('dw_migrate_clear', {});
    var T = [['dw_files', Object.keys(files).map(function (k) { return files[k]; })], ['dw_settings', settings], ['dw_stores', storeRows], ['dw_reviews', reviewRows],
      ['dw_rules', rules], ['dw_phrases', phrases], ['dw_synonyms', syn], ['dw_log', logs], ['dw_deleted', delRows], ['dw_sign_tokens', tokens], ['dw_guides', guides]];
    var lines = T.map(function (t) { sbPost_(t[0], t[1]); return t[0] + ' ' + t[1].length; });
    p.setProperty('SUPABASE_LIVE', 'Y');
    log_('관리', 'Supabase로 옮기기', '', '', lines.join(', '));
    return lines;
  } finally { lock.releaseLock(); }
}

/** 2. 매주 일요일 새벽 4시: 8일 지난 버킷 파일 → 드라이브(예전과 같은 폴더) → DB 고침 → 버킷 원본 지움 */
function sbArchiveMenu_() {
  sbConf_();
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sbArchiveWeekly') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('sbArchiveWeekly').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).inTimezone('Asia/Seoul').create();
  var r = sbArchive_(false);
  SpreadsheetApp.getUi().alert('매주 일요일 새벽 4시에 Supabase 파일(8일 지난 것)을 드라이브로 옮기도록 켰습니다.\n\n지금 한 번 돌린 결과: ' + sbArchiveSay_(r));
}
function sbArchiveSay_(r) {
  return r.done ? '옮김 ' + r.n + '개, 지움 ' + r.trashed + '개, 버킷 정리 ' + r.orphans + '개, 백업 ' + r.backup + (r.fails.length ? '\n실패 ' + r.fails.length + '건 (메일 보냄)' : '')
    : '옮김 ' + r.n + '개 — 남은 것은 1분 뒤 이어서 합니다';
}
/** 예약이 부름 (fromTrigger_: 화면에서 아무나 못 부르게) */
function sbArchiveWeekly(e) { if (fromTrigger_(e)) sbArchive_(false); }
function sbArchiveContinue(e) {
  if (!fromTrigger_(e)) return;
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'sbArchiveContinue') ScriptApp.deleteTrigger(tr); });
  sbArchive_(true);
}

function sbArchive_(cont, budgetMs) {
  sbConf_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { done: false, n: 0, fails: [], busy: true };
  try {
    var p = props_();
    if (!cont || !p.getProperty('SB_ARC_CUTOFF')) p.setProperties({ SB_ARC_CUTOFF: new Date(Date.now() - SB.ARC_DAYS * 86400000).toISOString(), SB_ARC_CURSOR: '', SB_ARC_FAILS: '[]', SB_ARC_N: '0' });
    var cutoff = p.getProperty('SB_ARC_CUTOFF'), end = Date.now() + (budgetMs == null ? SB.BUDGET : budgetMs);
    var cursor = p.getProperty('SB_ARC_CURSOR') || '', n = Number(p.getProperty('SB_ARC_N')) || 0, fails = JSON.parse(p.getProperty('SB_ARC_FAILS') || '[]');
    var save = function () { p.setProperties({ SB_ARC_CURSOR: cursor, SB_ARC_N: String(n), SB_ARC_FAILS: JSON.stringify(fails.slice(-200)) }); };
    var more = true;
    page: while (Date.now() < end) {   // 번호(id) 순서로 커서를 넘김 → 실패한 파일에 막혀 같은 자리를 돌지 않음 (실패는 다음 주에 다시)
      var rows = JSON.parse(sbReq_('get', '/rest/v1/dw_files?select=id,kind,storage_path,file_name,drive_folder&is_archived=eq.false&trash=eq.false&storage_path=not.is.null' +
        '&kind=neq.guide_page&created_at=lt.' + encodeURIComponent(cutoff) + (cursor ? '&id=gt.' + cursor : '') + '&order=id&limit=' + SB.PAGE).getContentText());
      if (!rows.length) { more = false; break; }
      for (var i = 0; i < rows.length; i++) {
        if (Date.now() >= end) break page;
        try { sbArchiveOne_(rows[i]); n++; } catch (e) { fails.push((rows[i].file_name || rows[i].storage_path) + ': ' + e.message); }
        cursor = rows[i].id; save();
      }
    }
    save();
    if (more) { ScriptApp.newTrigger('sbArchiveContinue').timeBased().after(60000).create(); return { done: false, n: n, fails: fails }; }
    var trashed = 0, orphans = 0, backup = '';
    try { trashed = sbTrash_(); } catch (e) { fails.push('지울 파일: ' + e.message); }
    try { sbReq_('delete', '/rest/v1/dw_sign_tokens?exp=lt.' + encodeURIComponent(new Date().toISOString())); } catch (e) { fails.push('서명 링크 정리: ' + e.message); }
    try { orphans = sbOrphans_(); } catch (e) { fails.push('버킷 정리: ' + e.message); }
    try { backup = sbBackup_(); } catch (e) { fails.push('DB 백업: ' + e.message); }
    p.deleteProperty('SB_ARC_CUTOFF');
    log_('예약 작업', 'Supabase 파일 드라이브로', '', '', '옮김 ' + n + ', 지움 ' + trashed + ', 버킷 정리 ' + orphans + ', 백업 ' + backup + ', 실패 ' + fails.length);
    if (fails.length) MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[도면협의] Supabase 파일 드라이브 옮기기 실패 ' + fails.length + '건',
      '옮긴 파일 ' + n + '개, 실패 ' + fails.length + '건. 실패한 파일은 Supabase에 그대로 있고 다음 주에 다시 해 봅니다.\n\n' + fails.join('\n'));
    return { done: true, n: n, fails: fails, trashed: trashed, orphans: orphans, backup: backup };
  } finally { lock.releaseLock(); }
}

/** 'photo/문서번호' → 도면협의_사진/문서번호, 'pdf/…' → 도면협의_출력/…, 'guide' → 도면협의_지침 */
function sbFolder_(df) {
  var parts = String(df || '').split('/').filter(String), k = { photo: 'photo', pdf: 'pdf', guide: 'guide' }[parts[0]];
  if (!k) throw new Error('모르는 폴더: ' + df);
  var f = appFolder_(k);
  parts.slice(1).forEach(function (name) { var it = f.getFoldersByName(name); f = it.hasNext() ? it.next() : f.createFolder(name); });
  return f;
}
/** 파일 하나: 드라이브 저장 → DB 고침 → 원본 지움 (DB 고치기 전에 멈추면 원본은 그대로) */
function sbArchiveOne_(f) {
  var folder = sbFolder_(f.drive_folder), name = f.file_name || String(f.storage_path).split('/').pop(), tag = 'dw-file:' + f.id, id = '';
  for (var it = folder.getFilesByName(name); !id && it.hasNext();) { var x = it.next(); if (x.getDescription() === tag) id = x.getId(); }   // 지난번에 저장까지만 했으면 그 파일
  if (!id) { var nf = folder.createFile(sbReq_('get', '/storage/v1/object/' + SB.BUCKET + '/' + f.storage_path).getBlob().setName(name)); nf.setDescription(tag); id = nf.getId(); }
  var up = JSON.parse(sbReq_('patch', '/rest/v1/dw_files?id=eq.' + f.id + '&is_archived=eq.false',
    { file_url: 'https://drive.google.com/file/d/' + id + '/view', drive_id: id, is_archived: true, storage_path: null }, { Prefer: 'return=representation' }).getContentText());
  if (up.length !== 1) throw new Error('DB 줄을 고치지 못함');
  try { sbReq_('delete', '/storage/v1/object/' + SB.BUCKET, { prefixes: [f.storage_path] }); } catch (e) { /* 남은 원본은 버킷 정리가 지움 */ }
}
/** 지울 표시(trash)한 줄: 버킷 원본 지움 · 드라이브 파일은 휴지통(30일 안에 되살리기) · 줄 지움 */
function sbTrash_() {
  var n = 0;
  for (;;) {
    var rows = JSON.parse(sbReq_('get', '/rest/v1/dw_files?select=id,storage_path,drive_id&trash=eq.true&order=id&limit=200').getContentText());
    if (!rows.length) return n;
    var paths = rows.filter(function (r) { return r.storage_path; }).map(function (r) { return r.storage_path; });
    if (paths.length) sbReq_('delete', '/storage/v1/object/' + SB.BUCKET, { prefixes: paths });
    rows.forEach(function (r) { if (r.drive_id) { try { DriveApp.getFileById(r.drive_id).setTrashed(true); } catch (e) { /* 이미 없음 */ } } });
    sbReq_('delete', '/rest/v1/dw_files?id=in.(' + rows.map(function (r) { return r.id; }).join(',') + ')');
    n += rows.length;
  }
}
/** 버킷에만 있고 DB 가 가리키지 않는 파일 (저장이 거절된 사진 등). 막 올린 것은 남김(2일) */
function sbOrphans_() {
  var live = {};
  for (var off = 0; ; off += 1000) {
    var rows = JSON.parse(sbReq_('get', '/rest/v1/dw_files?select=storage_path&storage_path=not.is.null&order=id&limit=1000&offset=' + off).getContentText());
    rows.forEach(function (r) { live[r.storage_path] = 1; });
    if (rows.length < 1000) break;
  }
  var old = Date.now() - SB.ORPHAN_DAYS * 86400000, dead = [];
  var walk = function (prefix) {
    for (var off = 0; ; off += 1000) {
      var items = JSON.parse(sbReq_('post', '/storage/v1/object/list/' + SB.BUCKET, { prefix: prefix, limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } }).getContentText());
      items.forEach(function (it) {
        var path = prefix + it.name;
        if (it.id === null) walk(path + '/');
        else if (!live[path] && new Date(it.created_at).getTime() < old) dead.push(path);
      });
      if (items.length < 1000) break;
    }
  };
  walk('');
  for (var i = 0; i < dead.length; i += 100) sbReq_('delete', '/storage/v1/object/' + SB.BUCKET, { prefixes: dead.slice(i, i + 100) });
  return dead.length;
}
/** DB 표마다 CSV 하나 → 드라이브 도면협의_백업 (30일 지나면 백업 정리가 지움) */
function sbBackup_() {
  var day = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd'), folder = appFolder_('backup');
  var cell = function (v) {
    var s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  SB_TABLES.forEach(function (t) {
    var rows = sbRpc_('dw_backup', { p_table: t }) || [], cols = rows.length ? Object.keys(rows[0]) : [];
    var csv = [cols.map(cell).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(','); })).join('\r\n');
    folder.createFile(Utilities.newBlob('﻿' + csv, 'text/csv', 'Supabase_' + day + '_' + t + '.csv'));
  });
  var limit = new Date(Date.now() - APP.BACKUP_KEEP_DAYS * 86400000), it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/^Supabase_/.test(f.getName()) && f.getDateCreated() < limit) f.setTrashed(true); }
  return day + ' 표 ' + SB_TABLES.length + '개';
}

/** 3. 연결 확인 (읽기만) */
function sbCheckMenu_() {
  var lines = [];
  try {
    var c = sbRpc_('dw_check_setup', {});
    lines.push('· 연결: 됨');
    lines.push('· 파일 버킷 dw-files: ' + (c.bucket ? '공개 ✓' : '없음 ✗ (01_schema.sql 실행)'));
    lines.push('· PIN: 소장 ' + (c.pin['소장'] ? '✓' : '✗') + ' · 부소장 ' + (c.pin['부소장'] ? '✓' : '✗'));
    lines.push('· 바로가기 주소: ' + (c.shortcut || '(없음 — 서명 메일을 못 보냄, 메뉴 ⑧)'));
    lines.push('· 자료 수: ' + Object.keys(c.counts).map(function (k) { return k + ' ' + c.counts[k]; }).join(', '));
  } catch (e) { lines.push('· 연결 안 됨: ' + e.message); }
  lines.push('· 바꿔 탐 표시(SUPABASE_LIVE): ' + (sbLive_() ? '켜짐' : '꺼짐 — 아직 시트를 씀'));
  lines.push('· 주 1회 옮기기 예약: ' + (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sbArchiveWeekly'; }) ? '켜짐' : '꺼짐'));
  SpreadsheetApp.getUi().alert('⑨ Supabase 연결 확인', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}
