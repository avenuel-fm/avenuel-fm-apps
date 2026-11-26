/* 개발·점검용 모의 백엔드: google.script.run 을 흉내 내고 데이터는 localStorage 에 저장합니다.
   Code.gs 를 먼저 불러와 FIELDS 등 상수를 그대로 사용합니다. 테스트 PIN: 1234 */
(function () {
  var KEY = 'dr_mockdb';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || { stores: [], reviews: [] }; } catch (e) { return { stores: [], reviews: [] }; } }
  function persist(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function uuid() { return 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function now() { var d = new Date(); return today() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  // 시험 PIN: 소장 1234, 부소장 5678 (PIN만 넣으면 사람을 찾음)
  var MOCK_PINS = { '1234': '소장', '5678': '부소장' };
  function auth(a) {
    if (a && !a.role && !a.token && a.pin != null) { var r = MOCK_PINS[String(a.pin)]; if (!r) throw new Error('PIN이 맞지 않습니다.'); a.role = r; return r; }
    if (!a || APP.ROLES.indexOf(a.role) < 0) throw new Error('로그인이 필요합니다.');
    if (a.token) { if (a.token !== 'mock-token-' + a.role + (window.__mockPinVer || '')) throw new Error('PIN이 바뀌었습니다. 새 PIN으로 다시 로그인해 주세요.'); return a.role; }
    if (MOCK_PINS[String(a.pin)] !== a.role) throw new Error('PIN이 맞지 않습니다.');
    return a.role;
  }
  function bundle(db, id) {
    var store = db.stores.filter(function (s) { return s.id === id; })[0];
    if (!store) throw new Error('매장을 찾을 수 없습니다.');
    return { store: JSON.parse(JSON.stringify(store)), reviews: db.reviews.filter(function (r) { return r.storeId === id; }).sort(function (a, b) { return a.round - b.round; }).map(function (r) { return JSON.parse(JSON.stringify(r)); }) };
  }
  function sync(db, id) {
    var store = db.stores.filter(function (s) { return s.id === id; })[0];
    var rs = db.reviews.filter(function (r) { return r.storeId === id; }).sort(function (a, b) { return a.round - b.round; });
    var last = rs[rs.length - 1]; if (!last) return;
    Object.assign(store, { tenant: last.tenant, location: last.location, storeType: last.storeType, contractor: last.contractorCompany, openDate: last.openDate, exitDate: last.exitDate || '', periodStart: last.periodStart, periodEnd: last.periodEnd, fireCheckDate: last.fireCheckDate, chiefOk: last.chiefOk ? 'Y' : '', docMissing: docMissing_(last).join(', '), currentRound: last.round, lastReviewDate: last.reviewDate, updatedAt: now() });
  }
  function addLog(db, id, entry) {
    var st = db.stores.filter(function (x) { return x.id === id; })[0]; if (!st) return;
    var list = []; try { list = JSON.parse(st.sendLog || '[]'); } catch (e) { list = []; }
    entry.at = entry.at || now(); list.push(entry); st.sendLog = JSON.stringify(list);
    if (entry.t === 'defect') st.defectSent = entry.at;
  }
  window.__mockAddLog = function (id, entry) { var db = load(); addLog(db, id, entry); persist(db); };
  var SIGS = window.__mockSigTokens = {};
  function clean(review) {
    var o = {};
    var na = naKeys_(review);
    FIELDS.forEach(function (f) { var v = review[f[0]]; o[f[0]] = na.indexOf(f[0]) >= 0 ? NOT_APPLICABLE : f[2] === 'bool' ? !!v : (v == null ? '' : String(v)); });
    if (o.notesPhotos) o.notesPhotos = sanitizePhotos_(o.notesPhotos);
    return o;
  }
  function companies(db) {
    var map = {};
    db.reviews.forEach(function (r) {
      [['owner', '발주처'], ['contractor', '시공업체']].forEach(function (p) {
        var n = String(r[p[0] + 'Company'] || '').trim(); if (!n) return;
        map[n] = { name: n, kind: p[1], person: r[p[0] + 'Name'] || '', tel: r[p[0] + 'Tel'] || '', email: r[p[0] + 'Email'] || '' };
      });
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }
  var API = {
    apiCompanies: function (a) { auth(a); return companies(load()); },
    apiDeleteStore: function (a, id) {
      auth(a); var db = load();
      var s = db.stores.filter(function (x) { return x.id === id; })[0];
      if (!s) throw new Error('이미 삭제된 검토서입니다.');
      if (s.status === '컨펌완료') throw new Error('컨펌완료된 매장은 삭제할 수 없습니다. 대시보드에서 컨펌완료를 먼저 취소해 주세요.');
      db.lastSeq = Math.max(db.lastSeq || 0, db.stores.reduce(function (m, x) { return Math.max(m, x.seq); }, 0));
      db.deleted = (db.deleted || []).concat(db.reviews.filter(function (r) { return r.storeId === id; }));
      db.reviews = db.reviews.filter(function (r) { return r.storeId !== id; });
      db.stores = db.stores.filter(function (x) { return x.id !== id; });
      persist(db);
      return db.stores;
    },
    apiDeleteLastRound: function (a, id) {
      auth(a); var db = load();
      var s = db.stores.filter(function (x) { return x.id === id; })[0];
      if (s.status === '컨펌완료') throw new Error('컨펌완료된 매장은 차수를 삭제할 수 없습니다.');
      var rs = db.reviews.filter(function (r) { return r.storeId === id; }).sort(function (x, y) { return x.round - y.round; });
      if (rs.length <= 1) throw new Error('1차만 남은 매장은 차수를 삭제할 수 없습니다.');
      var last = rs[rs.length - 1];
      db.reviews = db.reviews.filter(function (r) { return r !== last && r.id !== last.id; });
      sync(db, id); persist(db);
      return bundle(db, id);
    },
    apiLogin: function (a) { var role = auth(a); return { role: role, token: 'mock-token-' + role + (window.__mockPinVer || '') }; },
    apiStart: function (a) { var role = auth(a); return { role: role, token: 'mock-token-' + role + (window.__mockPinVer || ''), boot: API.apiBootstrap(a), stores: load().stores }; },
    apiBootstrap: function (a) { auth(a); return { version: APP.VERSION, storeLabel: APP.STORE_LABEL, docPrefix: APP.DOC_PREFIX, fields: FIELDS, rules: DEFAULT_RULES, phrases: phrasesNow(), phraseCats: PHRASE_CATS, synonyms: DEFAULT_SYNONYMS.map(function (r) { return [r[0]].concat(r[1].split(',').map(function (w) { return w.trim(); })); }), appUrl: '', publicUrl: window.__mockPublicUrl || '', guides: G.client(), signature: APP.SPEC_SIGNATURE, specFrom: APP.SPEC_FROM, specFromName: APP.SPEC_FROM_NAME, sigEmails: JSON.parse(localStorage.getItem('dr_mock_sigemails') || '{}') }; },
    apiSavePdf: function (a, id, round, name, uri) {
      auth(a);
      var st = load().stores.filter(function (x) { return x.id === id; })[0];
      if (!st) throw new Error('매장을 찾을 수 없습니다.');
      if (!/^data:application\/pdf[^,]*;base64,/.test(uri)) throw new Error('PDF 내용이 올바르지 않습니다.');
      window.__mockPdf = { name: name, bytes: Math.round(uri.split(',')[1].length * 3 / 4), auto: !!arguments[5] };
      var db = load(); addLog(db, id, { t: 'pdf', by: a.role, round: Number(round), d: Number(round) + '차 ' + (arguments[5] ? '검토 완료 → 드라이브 자동 보관' : '드라이브 저장'), url: 'https://drive.google.com/mock-pdf' }); persist(db);
      return { url: 'https://drive.google.com/', name: name, folder: '도면협의_출력/' + st.docNo, store: db.stores.filter(function (x) { return x.id === id; })[0] };
    },
    apiUploadPhoto: function (a, id, round, url) {
      auth(a);
      if (!load().stores.some(function (x) { return x.id === id; })) throw new Error('먼저 검토서를 저장해 주세요.');
      if (!/^data:image\/(jpeg|png);base64,/.test(url)) throw new Error('사진 형식이 올바르지 않습니다.');
      if (window.__mockFailUpload) throw new Error('NetworkError: Connection failure due to HTTP 0');
      var fid = 'ph' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      PHOTOS[fid] = url;
      return { fileId: fid, name: round + '차.jpg' };
    },
    apiPhoto: function (a, fid) { auth(a); return PHOTOS[fid] || null; },
    apiFireDocUpload: function (a, id, url) {
      var role = auth(a), db = load(), st = db.stores.filter(function (x) { return x.id === id; })[0];
      if (!st) throw new Error('먼저 검토서를 저장해 주세요.');
      if (!/^data:image\/(jpeg|png);base64,/.test(url)) throw new Error('사진 형식이 올바르지 않습니다.');
      if (window.__mockFailUpload) throw new Error('NetworkError: Connection failure due to HTTP 0');
      var fid = 'fd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      PHOTOS[fid] = url; window.__mockFdLen = url.length;
      st.fireDoc = JSON.stringify({ f: fid, at: now(), by: role, r: 0, name: now().slice(0, 10) + '_방재실협의서-' + String(st.tenant || '').replace(/\s+/g, '-') + '_001.jpg' });
      persist(db); return bundle(db, id);
    },
    apiFireDoc: function (a, id) {
      auth(a); var st = load().stores.filter(function (x) { return x.id === id; })[0], d = st && st.fireDoc ? JSON.parse(st.fireDoc) : null;
      if (!d) throw new Error('올린 종합방재실 협의서가 없습니다.');
      return { url: PHOTOS[d.f] || '', r: d.r || 0, f: d.f };
    },
    apiFireDocRotate: function (a, id, r) {
      auth(a); var db = load(), st = db.stores.filter(function (x) { return x.id === id; })[0], d = st && st.fireDoc ? JSON.parse(st.fireDoc) : null;
      if (!d) throw new Error('올린 종합방재실 협의서가 없습니다.');
      d.r = Number(r); st.fireDoc = JSON.stringify(d); persist(db); return { r: d.r };
    },
    apiFireDocDelete: function (a, id) {
      var role = auth(a), db = load(), st = db.stores.filter(function (x) { return x.id === id; })[0];
      if (!st || !st.fireDoc) throw new Error('올린 종합방재실 협의서가 없습니다.');
      st.fireDoc = ''; persist(db); return bundle(db, id);
    },
    apiSavePhrases: function (a, list) {
      auth(a);
      var out = list.map(function (p) { return { t: String(p.t || '').trim(), c: PHRASE_CATS.indexOf(p.c) >= 0 ? p.c : '기타' }; }).filter(function (p) { return p.t; });
      localStorage.setItem('dr_mockphrases', JSON.stringify(out));
      return out;
    },
    apiGuidePage: function (a, d, p) {
      auth(a);
      var mine = G.images[d];
      if (mine) return mine[p] || null;
      return window.__MOCK_PAGE_IMAGES ? 'guide_pages/' + d + '/p' + String(p).padStart(3, '0') + '.jpg' : null;
    },
    apiGuideIndex: function (a) { auth(a); return G.sources.concat(G.archive).reduce(function (o, g) { return o.concat(G.index[g.id] || []); }, []); },
    apiGuideRemoveArchived: function (a, id) { auth(a); G.archive = G.archive.filter(function (g) { return g.id !== id; }); return G.state(); },
    apiGuideAdmin: function (a) { auth(a); return G.state(); },
    apiGuidePdfChunk: function (a, fileId, offset) {
      auth(a);
      var f = G.pdfs.filter(function (x) { return x.fileId === fileId; })[0];
      if (!f) throw new Error('지침 폴더에 있는 PDF만 색인할 수 있습니다.');
      return fetch(f.path).then(function (r) { if (!r.ok) throw new Error('미리보기에서는 PDF를 읽을 수 없습니다.'); return r.arrayBuffer(); }).then(function (buf) {
        var u = new Uint8Array(buf), start = offset || 0, end = Math.min(u.length, start + 5 * 1024 * 1024), bin = '';
        for (var i = start; i < end; i += 32768) bin += String.fromCharCode.apply(null, u.subarray(i, Math.min(end, i + 32768)));
        return { size: u.length, offset: start, data: btoa(bin) };
      }, function (e) { throw new Error('미리보기에서는 PDF 색인 만들기를 할 수 없습니다 (구글 웹앱에서 동작). ' + e.message); });
    },
    apiGuideBegin: function (a, info) {
      var role = auth(a);
      if (!info.title || !info.short) throw new Error('지침 이름과 줄임말을 입력해 주세요.');
      var f = G.pdfs.filter(function (x) { return x.fileId === info.fileId; })[0];
      var b = G.building, resume = b && b.fileId === f.fileId && b.fileUpdated === f.updated && !!b.localPages === !!info.localPages;
      if (!resume) { b = { id: 'g' + Date.now().toString(36), fileId: f.fileId, fileName: f.name, fileUpdated: f.updated, localPages: !!info.localPages, startedAt: now(), startedBy: role, saved: {} }; }
      b.title = info.title; b.short = info.short; b.replaces = info.replaces || '';
      G.building = b;
      return { id: b.id, have: Object.keys(b.saved).map(Number), resumed: !!resume };
    },
    apiGuideSavePages: function (a, id, pages) {
      auth(a);
      if (!G.building || G.building.id !== id) throw new Error('색인 작업 정보가 없습니다.');
      if (window.__mockFailSaveAfter != null && Object.keys(G.building.saved).length >= window.__mockFailSaveAfter) { if (!(--window.__mockFailTimes > 0)) window.__mockFailSaveAfter = null; throw new Error('네트워크 오류 (시험)'); }
      pages.forEach(function (pg) { G.building.saved[pg.p] = pg.data; });
      return { saved: pages.length };
    },
    apiGuideFinish: function (a, id, meta, entries) {
      var role = auth(a), b = G.building;
      if (!b || b.id !== id) throw new Error('색인 작업 정보가 없습니다.');
      var count = Object.keys(b.saved).length;
      if (count < meta.pages) throw new Error('쪽 이미지가 ' + count + ' / ' + meta.pages + '쪽만 저장되었습니다. "이어서 만들기"를 눌러 주세요.');
      var pos = -1;
      G.sources = G.sources.filter(function (g, i) {
        var gone = g.id === b.replaces || g.fileId === b.fileId;
        if (!gone) return true;
        if (pos < 0) pos = i;
        if (!(g.fileId === b.fileId && g.fileUpdated === b.fileUpdated)) G.archive.unshift(Object.assign({}, g, { archivedAt: now() }));
        return false;
      });
      var src = { id: id, title: b.title, short: b.short, pages: meta.pages, landscape: !!meta.landscape, localPages: b.localPages, fileId: b.fileId, fileName: b.fileName, fileUpdated: b.fileUpdated, entries: entries.length, builtAt: now(), builtBy: role };
      if (pos < 0) G.sources.push(src); else G.sources.splice(pos, 0, src);
      entries.forEach(function (e) { e.d = id; });
      G.index[id] = entries; G.images[id] = b.saved; G.building = null;
      return G.state();
    },
    apiGuideRemove: function (a, id) { auth(a); G.sources = G.sources.filter(function (g) { return g.id !== id; }); return G.state(); },
    apiGuideRename: function (a, id, info) { auth(a); G.sources.forEach(function (g) { if (g.id === id) { g.title = info.title; g.short = info.short; } }); return G.state(); },
    apiGuideCancel: function (a) { auth(a); G.building = null; return G.state(); },
    apiListStores: function (a) { auth(a); return load().stores; },
    apiGetStore: function (a, id) { auth(a); return bundle(load(), id); },
    apiSaveReview: function (a, review, finalize) {
      var role = auth(a), db = load(), data = clean(review), store;
      var cid = /^c-[\w-]{6,60}$/.test(String(review.clientId || '')) ? review.clientId : '';
      if (!review.storeId && cid && db.stores.some(function (x) { return x.id === cid; })) review = Object.assign({}, review, { storeId: cid });
      if (!review.storeId) {
        var seq = Math.max(db.lastSeq || 0, db.stores.reduce(function (m, s) { return Math.max(m, s.seq); }, 0)) + 1;
        db.lastSeq = seq;
        var first = data.reviewDate || today();
        store = { id: cid || uuid(), seq: seq, docNo: APP.DOC_PREFIX + '_' + String(seq).padStart(3, '0') + '_' + first.replace(/-/g, '').slice(2, 8), firstDate: first, status: '협의중', currentRound: 1 };
        db.stores.push(store);
        data.round = 1;
      } else {
        store = db.stores.filter(function (s) { return s.id === review.storeId; })[0];
        if (store.status === '컨펌완료') throw new Error('컨펌완료된 매장입니다. 대시보드에서 컨펌완료를 취소한 뒤 수정해 주세요.');
        data.round = Number(review.round) || 1;
      }
      data.storeId = store.id;
      data.status = finalize ? '검토완료' : (review.status === '검토완료' ? '검토완료' : '작성중');
      data.savedAt = now(); data.savedBy = role;
      var ex = db.reviews.filter(function (r) { return r.storeId === store.id && r.round === data.round; })[0];
      if (ex) {
        var cl = review._sigCleared || [];
        Object.keys(SIG_WHO).forEach(function (w) { var c = SIG_WHO[w];
          if (!data[c.sig] && ex[c.sig] && cl.indexOf(c.sig) < 0) { data[c.sig] = ex[c.sig]; data[c.date] = ex[c.date]; }
          if (!data[c.name] && ex[c.name]) data[c.name] = ex[c.name];
          if (!data[c.tel] && ex[c.tel]) data[c.tel] = ex[c.tel]; });
      }
      if (ex) { data.id = ex.id; data.chiefOk = !!ex.chiefOk; data.chiefOkBy = ex.chiefOkBy || ''; data.chiefOkAt = ex.chiefOkAt || ''; Object.assign(ex, data); } else { data.id = uuid(); db.reviews.push(data); }
      sync(db, store.id); persist(db);
      return bundle(db, store.id);
    },
    apiSendDocReq: function (a, id, round, keys, extra) {
      var role = auth(a), db = load();
      var r = db.reviews.filter(function (x) { return x.storeId === id && Number(x.round) === Number(round); })[0];
      if (!r) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
      if (!okEmail_(r.contractorEmail)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
      var names = {}; DOC_NAMES.forEach(function (d) { names[d[0]] = d[1]; });
      keys = (keys || []).filter(function (k) { return DOC_REQ_KEYS.indexOf(k) >= 0 && r[k] === '미제출'; });
      if (!keys.length) throw new Error('요청할 미제출 서류가 없습니다.');
      var m = mailMake_('[' + APP.STORE_LABEL + '] ' + r.tenant + ' 미제출 서류 제출 요청', [{ t: '안녕하세요' }].concat(keys.map(function (k) { return { t: '· ' + names[k] }; })), String(extra || '').trim());
      (window.__mockMails = window.__mockMails || []).push({ kind: 'doc', to: r.contractorEmail, subject: m.subject, body: m.body });
      addLog(db, id, { t: 'doc', to: r.contractorEmail, by: role, round: Number(round), d: keys.map(function (k) { return names[k]; }).join(', ') });
      persist(db);
      var out = bundle(db, id); out.fromOk = true; return out;
    },
    apiSigRequest: function (a, id, round, reqs, uri, name) {
      var role = auth(a), db = load();
      var st = db.stores.filter(function (x) { return x.id === id; })[0];
      var r = db.reviews.filter(function (x) { return x.storeId === id && Number(x.round) === Number(round); })[0];
      if (!st || !r) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
      if (!/^data:application\/pdf/.test(uri)) throw new Error('PDF 내용이 올바르지 않습니다.');
      window.__mockPdf = { name: name, bytes: Math.round(uri.split(',')[1].length * 3 / 4) };
      var pend = {}; try { pend = JSON.parse(st.sigPending || '{}'); } catch (e) { pend = {}; }
      var em = JSON.parse(localStorage.getItem('dr_mock_sigemails') || '{}');
      reqs.forEach(function (q) {
        if (!okEmail_(q.email)) throw new Error(SIG_WHO[q.who].l + ' 이메일 형식이 맞지 않습니다.');
        var token = (Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2) + Date.now().toString(16) + '0000000000000000000000').slice(0, 48);
        SIGS[token] = { storeId: id, round: Number(round), who: q.who, email: q.email, exp: Date.now() + 7 * 864e5, pdfUrl: 'https://drive.google.com/mock-pdf' };
        localStorage.setItem('dr_mock_sig_' + token, JSON.stringify(SIGS[token]));
        (window.__mockMails = window.__mockMails || []).push({ kind: 'sig', who: q.who, to: q.email, token: token, subject: '[' + APP.STORE_LABEL + '] ' + r.tenant + ' 공사 도면 검토서 서명 요청', body: '서명은 휴대폰으로 진행 가능합니다. PC에서는 마우스로 서명할 수 있습니다. ?sign=' + token });
        pend[round + ':' + q.who] = { at: now(), to: q.email, exp: Date.now() + 7 * 864e5 };
        if (q.who !== 'resp') em[q.who] = q.email;
      });
      localStorage.setItem('dr_mock_sigemails', JSON.stringify(em));
      st.sigPending = JSON.stringify(pend);
      addLog(db, id, { t: 'sigreq', by: role, round: Number(round), d: reqs.map(function (q) { return SIG_WHO[q.who].l + ' ' + q.email; }).join(' · ') });
      persist(db);
      var out = bundle(db, id); out.fromOk = true; out.sigEmails = em; return out;
    },
    apiSignInfo: function (token) {
      var tk = JSON.parse(localStorage.getItem('dr_mock_sig_' + token) || 'null');
      if (!tk) throw new Error('이미 서명했거나 더 이상 쓸 수 없는 링크입니다. 시설팀에 새 링크를 요청해 주세요.');
      var db = load(), c = SIG_WHO[tk.who];
      var st = db.stores.filter(function (x) { return x.id === tk.storeId; })[0], r = db.reviews.filter(function (x) { return x.storeId === tk.storeId && Number(x.round) === tk.round; })[0];
      return { label: APP.STORE_LABEL, tenant: r.tenant, round: tk.round, docNo: st.docNo, who: c.l, org: c.org || r[c.orgKey] || r.contractorCompany || '', name: r[c.name] || '', tel: r[c.tel] || '', pdfUrl: tk.pdfUrl, until: '11/7' };
    },
    apiSignSubmit: function (token, data) {
      var tk = JSON.parse(localStorage.getItem('dr_mock_sig_' + token) || 'null');
      if (!tk) throw new Error('이미 서명했거나 더 이상 쓸 수 없는 링크입니다. 시설팀에 새 링크를 요청해 주세요.');
      if (!String(data.name || '').trim()) throw new Error('성명을 입력해 주세요.');
      if (String(data.tel || '').replace(/\D/g, '').length < 9) throw new Error('연락처를 입력해 주세요.');
      if (String(data.sig || '').indexOf('data:image/png;base64,') !== 0) throw new Error('서명을 그려 주세요.');
      var db = load(), c = SIG_WHO[tk.who];
      var r = db.reviews.filter(function (x) { return x.storeId === tk.storeId && Number(x.round) === tk.round; })[0];
      r[c.name] = data.name.trim(); r[c.tel] = data.tel; r[c.sig] = data.sig; r[c.date] = today();
      var st = db.stores.filter(function (x) { return x.id === tk.storeId; })[0];
      var pend = {}; try { pend = JSON.parse(st.sigPending || '{}'); } catch (e) { pend = {}; } delete pend[tk.round + ':' + tk.who]; st.sigPending = JSON.stringify(pend);
      addLog(db, tk.storeId, { t: 'sig', round: tk.round, d: c.l + ' ' + data.name.trim() + ' · ' + data.tel + ' (원격 서명)' });
      localStorage.removeItem('dr_mock_sig_' + token);
      persist(db);
      return { ok: true, who: c.l, tenant: r.tenant };
    },
    apiSetChiefOk: function (a, id, round, on) {
      var role = auth(a), db = load();
      if (role !== '소장') throw new Error('소장 확인은 소장 PIN으로 접속했을 때만 할 수 있습니다.');
      var r = db.reviews.filter(function (x) { return x.storeId === id && Number(x.round) === Number(round); })[0];
      if (!r) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
      Object.assign(r, on ? { chiefOk: true, chiefOkBy: role, chiefOkAt: now() } : { chiefOk: false, chiefOkBy: '', chiefOkAt: '' });
      sync(db, id); persist(db);
      return bundle(db, id);
    },
    apiNextRound: function (a, id) {
      var role = auth(a), db = load();
      var rs = db.reviews.filter(function (r) { return r.storeId === id; }).sort(function (x, y) { return x.round - y.round; });
      var last = rs[rs.length - 1];
      var next = Object.assign({}, last, { notes: '', notesPhotos: '', rulesAck: false, safetySig: '', salesSig: '', respSig: '', safetySigDate: '', salesSigDate: '', respSigDate: '', chiefOk: false, chiefOkBy: '', chiefOkAt: '', reviewDate: today(), id: uuid(), round: last.round + 1, status: '작성중', savedAt: now(), savedBy: role });
      db.reviews.push(next); sync(db, id); persist(db);
      return bundle(db, id);
    },
    apiSpecInfo: function (a) {
      auth(a);
      var miss = window.__mockSpecMissing || [];
      var names = { tenant: '01_Tenant 시방서.zip', crown: '02_B1F The Crown 시방서.zip' };
      return { from: APP.SPEC_FROM, fromName: APP.SPEC_FROM_NAME, fromOk: !window.__mockNoAlias, label: APP.STORE_LABEL, signature: APP.SPEC_SIGNATURE,
        specs: SPECS.map(function (sp) { return miss.indexOf(sp.k) >= 0 ? { k: sp.k, l: sp.l, missing: true } : { k: sp.k, l: sp.l, name: names[sp.k], size: sp.k === 'tenant' ? 4404019 : 3250585 }; }) };
    },
    apiSendSpec: function (a, id, round, keys, extra) {
      var role = auth(a), db = load();
      var s = db.stores.filter(function (x) { return x.id === id; })[0];
      if (!s) throw new Error('매장을 찾을 수 없습니다. 먼저 검토서를 저장해 주세요.');
      var r = db.reviews.filter(function (x) { return x.storeId === id && Number(x.round) === Number(round); })[0];
      if (!r) throw new Error('저장된 검토서가 없습니다. 먼저 저장해 주세요.');
      var to = String(r.contractorEmail || '').trim();
      if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error('시공업체 이메일이 비어 있거나 형식이 맞지 않습니다.');
      if (!keys || !keys.length) throw new Error('보낼 시방서를 골라 주세요.');
      var miss = window.__mockSpecMissing || [];
      var items = keys.map(function (k) {
        var sp = SPECS.filter(function (x) { return x.k === k; })[0];
        if (miss.indexOf(k) >= 0) throw new Error('지침 폴더에 ' + sp.l + ' ZIP 파일이 없습니다.');
        return { k: k, l: sp.l, name: sp.l + '.zip', url: 'https://drive.google.com/file/d/mock-' + k + '/view' };
      });
      var mail = specMail_(r.tenant, items, String(extra || '').trim());
      (window.__mockMails = window.__mockMails || []).push({ to: to, from: window.__mockNoAlias ? '' : APP.SPEC_FROM, subject: mail.subject, body: mail.body });
      var list = []; try { list = JSON.parse(s.specSent || '[]'); } catch (e) { list = []; }
      items.forEach(function (it) { list.push({ k: it.k, l: it.l, at: now(), to: to, by: role, round: Number(round) }); });
      s.specSent = JSON.stringify(list);
      persist(db);
      var out = bundle(db, id); out.fromOk = !window.__mockNoAlias; return out;
    },
    apiSetConfirmed: function (a, id, on) {
      var role = auth(a), db = load();
      var s = db.stores.filter(function (x) { return x.id === id; })[0];
      Object.assign(s, on ? { status: '컨펌완료', confirmedBy: role, confirmedAt: now() } : { status: '협의중', confirmedBy: '', confirmedAt: '' });
      persist(db);
      return db.stores;
    }
  };
  /* 지침: 처음에는 tools/build_guide_index.py 로 만든 색인 2개가 들어 있는 상태 (메모리에만 보관) */
  var G = {
    pdfs: [
      { fileId: 'pdf-g', name: '시설공사지침_2024.07.09.pdf', path: 'guides/시설공사지침_2024.07.09.pdf', size: 4199369, updated: '2026-10-28T00:23:00' },
      { fileId: 'pdf-s', name: '통합안전관리지침_26.pdf', path: 'guides/통합안전관리지침_26.pdf', size: 15154925, updated: '2026-10-28T00:43:00' }
    ],
    sources: [], archive: [], index: {}, images: {}, building: null,
    client: function () {
      var one = function (g, old) { var o = { id: g.id, title: g.title, short: g.short, pages: g.pages, landscape: !!g.landscape, images: !!(G.images[g.id] || window.__MOCK_PAGE_IMAGES) }; if (old) { o.archived = true; o.archivedAt = g.archivedAt; } return o; };
      return G.sources.map(function (g) { return one(g); }).concat(G.archive.map(function (g) { return one(g, true); }));
    },
    state: function () {
      return { folderUrl: 'https://drive.google.com/', folderName: '도면협의_지침', pdfs: G.pdfs,
        sources: G.sources.map(function (g) { return Object.assign({ legacy: false, images: true }, g); }), archive: G.archive.slice(), building: G.building && Object.assign({}, G.building, { saved: undefined }), guides: G.client() };
    }
  };
  (typeof GUIDE_SOURCES !== 'undefined' ? GUIDE_SOURCES : []).forEach(function (g) {
    var f = G.pdfs.filter(function (x) { return x.fileId === 'pdf-' + g.id; })[0];
    G.index[g.id] = GUIDE_INDEX.filter(function (e) { return e.d === g.id; });
    G.sources.push({ id: g.id, title: g.title, short: g.short, pages: g.pages, landscape: !!g.landscape, localPages: g.id === 'g',
      fileId: f ? f.fileId : '', fileName: f ? f.name : '', fileUpdated: f ? f.updated : '', entries: G.index[g.id].length, builtAt: '2026-10-28 00:50', builtBy: '소장' });
  });
  window.__mockGuides = G;

  var PHOTOS = window.__mockPhotos = {};
  function phrasesNow() { try { return JSON.parse(localStorage.getItem('dr_mockphrases')) || DEFAULT_PHRASES; } catch (e) { return DEFAULT_PHRASES; } }

  function runner(ok, fail) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return function (cb) { return runner(cb, fail); };
        if (name === 'withFailureHandler') return function (cb) { return runner(ok, cb); };
        return function () {
          var args = arguments;
          setTimeout(function () {
            var r;
            (window.__mockCalls = window.__mockCalls || []).push(name);
            if (window.__mockOffline && name !== 'apiLogin') { fail && fail(new Error('NetworkError: Connection failure due to HTTP 0')); return; }
            try { r = API[name].apply(null, args); } catch (e) { fail && fail(e); return; }
            Promise.resolve(r).then(function (v) { ok && ok(v == null ? v : JSON.parse(JSON.stringify(v))); }, function (e) { fail && fail(e); });
          }, window.__mockDelay || 120);
        };
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };
  window.__mockReset = function () { localStorage.removeItem(KEY); };
})();
