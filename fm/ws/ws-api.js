// 업무지원(WS) Supabase 통로 (이관 3단계) — 화면의 run('이름', …)을 구글 서버 대신 Supabase로 보냄
// 화면 코드는 그대로 두고 이 파일이 서버 함수와 같은 이름·같은 답 모양을 돌려줌 (docs/설계/WS_Supabase이관.md 4.3)
// 필요: config.js(window.WS_CONFIG), @supabase/supabase-js v2 (window.supabase)
(function () {
  const C = window.WS_CONFIG || {};
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ws_sb_auth' }   // 기기 등록을 기억 (한 번만)
  });
  const BUCKET = C.SUPABASE_BUCKET_NAME || 'ws-files';

  /* ── 사진 줄이기: 가로·세로 긴 쪽 1200px 이하, JPEG 80% (요청서 4번). PDF·엑셀·서명 PNG는 그대로 ── */
  function loadImage(src) {
    return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('사진을 읽지 못했습니다')); im.src = src; });
  }
  async function compressImage(input, max = 1200, quality = 0.8) {
    const url = typeof input === 'string' ? input : URL.createObjectURL(input);
    try {
      const im = await loadImage(url);
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('사진을 줄이지 못했습니다')), 'image/jpeg', quality));
    } finally { if (typeof input !== 'string') URL.revokeObjectURL(url); }
  }
  function dataUrlToBlob(d) {
    const m = /^data:([^;,]+)([^,]*),(.*)$/.exec(String(d || ''));   // PDF 도구는 ';filename=…;base64' 처럼 덧붙임
    if (!m) throw new Error('파일 내용이 올바르지 않습니다');
    const bin = /;base64$/.test(m[2]) ? atob(m[3]) : decodeURIComponent(m[3]), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] });
  }
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, ''); }
  /** 버킷에 올리고 { path, url } — 경로는 영문·숫자만 (한글 경로는 Supabase가 받지 않음). 사진은 먼저 줄임 */
  async function upload(kind, blob) {
    if (blob.type.startsWith('image/') && blob.type !== 'image/png') blob = await compressImage(blob);
    const k = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
    const path = kind + '/' + k + '/' + rid() + '.' + (EXT[blob.type] || 'bin');
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('파일을 올리지 못했습니다: ' + error.message);
    return { path, url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  }

  /* ── DB 함수 부르기: 오류 글('LOGIN' 등)을 그대로 넘겨 화면의 call()이 알아듣게 ── */
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }

  /* ── 서버 함수 (Code.gs와 같은 이름·같은 답) — 옮긴 것만. 3-2 묶음부터 차례로 더함 ── */
  const API = {
    async login(pin, device, signPng) {
      let f = null;
      if (signPng) f = await upload('sign', dataUrlToBlob(signPng));
      return rpc('ws_login', { p_pin: pin, p_device: device, p_sign_url: f && f.url, p_sign_path: f && f.path });
    },
    async signToday(token, signPng) {
      const f = await upload('sign', dataUrlToBlob(signPng));
      return rpc('ws_sign_today', { p_token: token, p_sign_url: f.url, p_sign_path: f.path });
    },
    async bootstrap(token) {
      const r = await rpc('ws_bootstrap', { p_token: token });
      r.app = { id: 'WS', title: '업무지원', version: window.WS_VERSION || '' };
      return r;
    },

    /* ── 3-2 서류작업 (supabase/03_docs.sql). 사진·PDF는 버킷에 먼저 올리고 주소·경로만 DB 함수에 ── */
    nextWorkGet: (token, date) => rpc('ws_next_work_get', { p_token: token, p_date: date || '' }),
    nextWorkSave: (token, date, rows, ver) => rpc('ws_next_work_save', { p_token: token, p_date: date, p_rows: rows || [], p_ver: ver || '' }),
    tbmGet: (token, want) => rpc('ws_tbm_get', { p_token: token, p_want: want || '' }),
    async tbmSave(token, d) {
      const s = await tbmSplit(d);
      return rpc('ws_tbm_save', { p_token: token, p_d: s.d, p_files: s.files });
    },
    async tbmSavePdf(token, dataUri, signIds, d, want) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      const s = d ? await tbmSplit(d) : { d: null, files: {} };
      s.files.pdf = await upload('tbm_pdf', pdf);
      return rpc('ws_tbm_save_pdf', { p_token: token, p_files: s.files, p_sign_ids: signIds || [], p_d: s.d, p_want: want || '' });
    },
    async logGet(token, day) { return withAc(await rpc('ws_log_get', { p_token: token, p_day: day || '' })); },
    async logSave(token, day, d, ver) {
      const s = await logSplit(d);
      return withAc(await rpc('ws_log_save', { p_token: token, p_day: day, p_d: s.d, p_ver: ver || '', p_files: s.files }));
    },
    async logSavePdf(token, day, dataUri, d, ver) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      const s = d ? await logSplit(d) : { d: null, files: {} };
      s.files.pdf = await upload('log_pdf', pdf);
      return withAc(await rpc('ws_log_save_pdf', { p_token: token, p_day: day, p_files: s.files, p_d: s.d, p_ver: ver || '' }));
    }
  };

  /** 화면이 만든 PDF(data:) → Blob. 틀리면 { ok:false, error } (Code.gs와 같은 안내) */
  function pdfBlob(uri) {
    if (!/^data:application\/pdf[^,]*;base64,.{100}/.test(String(uri || ''))) return { ok: false, error: 'PDF 내용이 올바르지 않습니다' };
    const b = dataUrlToBlob(uri);
    return b.size > 30 * 1024 * 1024 ? { ok: false, error: 'PDF가 너무 큽니다' } : b;
  }
  /** TBM: 새로 고른 사진(data:)만 올리고 d에서는 뺌 */
  async function tbmSplit(d) {
    const files = {}, rest = Object.assign({}, d);
    for (const k of ['meet', 'chant']) { if (d[k]) files[k] = await upload('tbm_' + k, dataUrlToBlob(d[k])); delete rest[k]; }
    return { d: rest, files };
  }
  /** 일지: 새 야간 그림만 올림. '-' (빼기)는 그대로 넘김 */
  async function logSplit(d) {
    const files = {}, rest = Object.assign({}, d);
    if (d.night && d.night !== '-') { files.night = await upload('log_night', dataUrlToBlob(d.night)); delete rest.night; }
    return { d: rest, files };
  }
  /* 공조기·에어커튼 가동시간은 구글(온습도 앱 읽기)에 남음 → 업무지원 구글 웹앱 ?api=logac 로 받음. 같은 날은 10분 기억 */
  const AC = {};
  async function withAc(r) {
    if (!r || !r.day) return r;
    const c = AC[r.day];
    if (c && Date.now() - c.at < 600e3) { r.ac = c.ac; return r; }
    try {
      const j = await (await fetch(C.WS_GAS_URL + '?api=logac&day=' + r.day)).json();
      if (!j.ok) throw new Error(j.error || '');
      r.ac = j.ac;
      if (!j.ac.err) AC[r.day] = { at: Date.now(), ac: j.ac };
    } catch (e) { r.ac = { err: '온습도 앱 기록을 불러오지 못했습니다' }; }
    return r;
  }

  window.WS_API = {
    sb, upload, compressImage, dataUrlToBlob,
    /** 기기 등록 상태: 등록됐으면 { email, at } , 아니면 null */
    async device() {
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      let at = ''; try { at = localStorage.getItem('ws_dev_at') || ''; } catch (e) {}
      return s ? { email: s.user.email || '', at } : null;   // at = 이 기기에서 등록한 날 (계정 전체의 마지막 로그인이 아님)
    },
    async register(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (!error) try { localStorage.setItem('ws_dev_at', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); } catch (e) {}
      if (error) throw new Error(/invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 확인해 주세요.' : '등록하지 못했습니다: ' + error.message);
    },
    async unregister(token) {
      try { if (token) await rpc('ws_logout', { p_token: token }); } catch (e) { /* 표가 이미 없어도 등록은 풂 */ }
      await sb.auth.signOut();
    },
    run(fn, ...args) {
      if (!API[fn]) return Promise.reject(new Error('아직 옮기지 않은 기능입니다 (Supabase 이관 중): ' + fn));
      return API[fn](...args);
    }
  };
})();
