"""src/Check.html → fm/ws/check.html (GitHub 바로가기 페이지에서 직접 여는 QR 점검 입력 화면, 결정 42)
화면 코드는 같고, 서버 통로만 fetch로 바꿉니다. Check.html을 고치면 이 스크립트를 다시 돌리고 GitHub에 다시 올립니다.
사용: python3 tools/build_fm.py
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'src/Check.html'), encoding='utf-8').read()
styles = open(os.path.join(ROOT, 'src/Styles.html'), encoding='utf-8').read()
BOOT = r"""<script src="../apps.js"></script>
<script>
/* GitHub에서 여는 QR 점검 화면 — 구글 웹앱과 fetch로 주고받음 (쿠키 없이 → 여러 구글 계정이어도 오류 없음) */
(function () {
  var m = location.search.match(/[?&]fe=([^&#]*)/);
  var qr = m ? decodeURIComponent(m[1]) : '';
  window.FM_QR = /^([a-f0-9]{32}|[2-9a-km-np-z]{12})$/.test(qr) ? qr : '';
  var EX = ((window.FM_APPS || {}).ws || {}).exec || '';
  function j(r) { if (!r.ok) throw new Error('서버 응답 ' + r.status); return r.json(); }
  function need() { if (!EX) throw new Error('apps.js에 업무지원 웹앱 주소가 없습니다'); }
  window.FM_CHECK = {
    init: function (q) {
      try { need(); } catch (e) { return Promise.reject(e); }
      return fetch(EX + '?api=check&fe=' + encodeURIComponent(q), { credentials: 'omit', cache: 'no-store' }).then(j);
    },
    submit: function (q, d) {
      try { need(); } catch (e) { return Promise.reject(e); }
      return fetch(EX, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'checkSubmit', qr: q, d: d }) }).then(j);
    }
  };
})();
</script>
"""
out = src
assert '<base target="_top">' in out and "<?!= include('Styles'); ?>" in out and '<?!= JSON.stringify(qr) ?>' in out
out = out.replace('<base target="_top">\n', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>소화기 점검 · 에비뉴엘 시설팀</title>\n<meta name="robots" content="noindex">\n')
out = out.replace("<?!= include('Styles'); ?>", styles)
out = out.replace('<?!= JSON.stringify(qr) ?>', "''")
i = out.index('<script>\n/* 서버 통로')
out = out[:i] + BOOT + out[i:]
out = '<!-- 자동 생성: tools/build_fm.py (src/Check.html). 직접 고치지 마세요. -->\n' + out
assert '<?' not in out
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'check.html'), 'w', encoding='utf-8').write(out)
print('../../fm/ws/check.html (저장소 맨 위 fm 폴더)', len(out), 'bytes')

# ── Supabase 이관 3단계: src/Index.html → fm/ws/app.html (바로가기 페이지에서 바로 여는 앱, 구글 웹앱 없이) ──
#    바꿔 타는 날 전까지는 app.html 로만 시험. 바꿔 타는 날 fm/ws/index.html 을 이 앱으로 (docs/설계/WS_Supabase이관.md 4.8)
code = open(os.path.join(ROOT, 'src/Code.gs'), encoding='utf-8').read()
ver = re.search(r"version: '([\d.]+)'", code).group(1)
ix = open(os.path.join(ROOT, 'src/Index.html'), encoding='utf-8').read()
HEAD_SB = ('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           '<meta name="theme-color" content="#FFFFFF">\n<link rel="manifest" href="manifest.webmanifest">\n'
           '<link rel="icon" href="../icon-192.png">\n<link rel="apple-touch-icon" href="../icon-192.png">\n'
           '<title>업무지원 · 에비뉴엘 시설팀</title>\n<meta name="robots" content="noindex">\n'
           '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>\n'
           '<script src="config.js?v=' + ver + '"></script>\n<script>window.WS_VERSION = ' + repr(ver) + ';</script>\n<script src="ws-api.js?v=' + ver + '"></script>\n')   # ?v=판: 바로가기 페이지는 10분 캐시 → 새 화면에 옛 통로가 붙는 일 막음
assert ix.count('<base target="_top">\n') == 1 and ix.count("<?!= include('Styles'); ?>") == 1
app = ix.replace('<base target="_top">\n', HEAD_SB).replace("<?!= include('Styles'); ?>", styles)
app = app.replace('<?!= JSON.stringify(execUrl) ?>', "''").replace('<?!= JSON.stringify(APP.version) ?>', repr(ver))
assert '<?' not in app, '남은 템플릿 태그'
app = '<!-- 자동 생성: tools/build_fm.py (src/Index.html). 직접 고치지 마세요. -->\n' + app
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'app.html'), 'w', encoding='utf-8').write(app)
print('../../fm/ws/app.html', len(app), 'bytes · v' + ver)

# ── 외부용 시방서 검색 단독 페이지 (결정 142·146): 시방서 코드만 떼어 담은 가벼운 파일 → 업무지원 앱의 다른 코드·통로는 안 들어감 ──
#    서버 함수는 로그인 없는 ws_spec_pub_* 3개만 (14_spec.sql). 검색은 서버에서, 색인 전체는 내려주지 않음
J0, J1 = ix.index('/* ── 시방서 검색 (결정 140'), ix.index('/* ── 메인 메뉴 켜기·끄기')
CSS = ix[ix.index('<style>'):ix.index('</style>') + 8]   # 모양(글자 모양뿐)은 통째로 — 머리·알림·띠 모양을 같이 씀
ICONS = ''.join(l.strip() + '\n' for l in ix.splitlines() if re.match(r"\s+(search|x): '<svg", l))
assert ICONS.count('<svg') == 2 and J0 < J1
PUB_JS = r"""window.WS_PUB = true;
const S = { view: 'spec', sp: null };
const ICON = {
%ICONS%};
function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(id) { return document.getElementById(id); }
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast hide'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.remove('hide'); clearTimeout(toast.k); toast.k = setTimeout(() => t.classList.add('hide'), 2600);
}
const C = window.WS_CONFIG || {};
const SB = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function rpc(fn, a) { return SB.rpc(fn, a).then(r => { if (r.error) throw new Error(r.error.message); return r.data; }); }
const API = {
  specPubBoot: () => rpc('ws_spec_pub_boot', {}),
  specPubSearch: (q, g) => rpc('ws_spec_pub_search', { p_q: String(q || '').slice(0, 40), p_guides: g }),
  specPubPage: (d, p) => rpc('ws_spec_pub_page', { p_guide: String(d || ''), p_page: Number(p) || 0 })
};
function call(fn, ...a) { return API[fn](...a).catch(e => { toast('서버 오류: ' + (e && e.message || e)); throw e; }); }
function go(v) { S.view = v; }
function render() { $('app').innerHTML = S.sp ? renderSpec() : ''; if (S.sp && S.sp.boot) spDraw(); }
"""
PUB_END = r"""// 소스 보기·저장 단축키 막기 (F12, Ctrl+U, Ctrl+S, Ctrl+Shift+I/J/C) — 숨김이 아니라 손쉬운 복사를 줄이는 정도
document.addEventListener('keydown', e => { const k = (e.key || '').toLowerCase(); if (k === 'f12' || ((e.ctrlKey || e.metaKey) && (k === 'u' || k === 's' || (e.shiftKey && 'ijc'.indexOf(k) >= 0)))) e.preventDefault(); });
document.addEventListener('contextmenu', e => e.preventDefault());
openSpec();
"""
pub = ('<!-- 자동 생성: tools/build_fm.py (src/Index.html 의 시방서 검색 부분만). 직접 고치지 마세요. -->\n<!DOCTYPE html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="theme-color" content="#FFFFFF">\n'
       '<link rel="icon" href="../icon-192.png">\n<title>시방서 검색 · 에비뉴엘 시설팀</title>\n<meta name="robots" content="noindex">\n'
       '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>\n'
       '<script src="config.js?v=' + ver + '"></script>\n' + styles + CSS + '\n</head>\n<body>\n<div id="app"></div>\n<script>\n'
       + PUB_JS.replace('%ICONS%', ICONS) + ix[J0:J1] + PUB_END + '</script>\n</body>\n</html>\n')
assert '<?' not in pub and 'ws-api.js' not in pub and 'renderMain' not in pub
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'spec.html'), 'w', encoding='utf-8').write(pub)
print('../../fm/ws/spec.html', len(pub), 'bytes')

# ── Supabase 이관 3-4: src/Check.html → fm/ws/check-sb.html (QR 점검 입력을 Supabase로, 매장 직원은 기기 등록 없이) ──
#    바꿔 타는 날 check.html 을 이것으로 바꿈. 그 전까지 지금 check.html(구글)은 그대로
BOOT_SB = r"""<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>
<script src="config.js"></script>
<script>
/* QR 점검 입력 — Supabase (supabase/05_fire.sql ws_check_init · ws_check_submit, 비로그인도 됨). 파일은 버킷 fire/{QR}/ 아래 */
(function () {
  var m = location.search.match(/[?&]fe=([^&#]*)/);
  var qr = m ? decodeURIComponent(m[1]) : '';
  window.FM_QR = /^([a-f0-9]{32}|[2-9a-km-np-z]{12})$/.test(qr) ? qr : '';
  var C = window.WS_CONFIG || {}, BUCKET = C.SUPABASE_BUCKET_NAME || 'ws-files';
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  function rpc(fn, a) { return sb.rpc(fn, a).then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; }); }
  function blob(d) {
    var x = /^data:([^;,]+)[^,]*;base64,(.*)$/.exec(String(d || '')); if (!x) return null;
    var b = atob(x[2]), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return new Blob([a], { type: x[1] });
  }
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, ''); }
  // 사진은 화면이 이미 설정 크기(사진긴변px·사진품질)로 줄여 옴 → 그대로 올림
  function up(q, d, ext) {
    var b = blob(d); if (!b) return Promise.resolve(null);
    var path = 'fire/' + q + '/' + new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7) + '/' + rid() + '.' + ext;
    return sb.storage.from(BUCKET).upload(path, b, { contentType: b.type, upsert: false }).then(function (r) {
      if (r.error) throw new Error('사진을 올리지 못했습니다: ' + r.error.message);
      return { path: path, url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
    });
  }
  window.FM_CHECK = {
    init: function (q) { return rpc('ws_check_init', { p_qr: q }); },
    submit: function (q, d) {
      // 이미 있는데 덮어쓰기를 안 골랐으면 사진을 올리기 전에 알림 (버킷에 쓸모없는 파일이 남지 않게)
      var first = d.overwrite ? Promise.resolve(null) : rpc('ws_check_init', { p_qr: q });
      return first.then(function (i) {
        if (i && i.ok && i.exists) return { ok: false, exists: true, error: '이번 달 입력이 이미 있습니다.' };
        return Promise.all([up(q, d.photo, 'jpg'), up(q, d.signA, 'png'), up(q, d.signB, 'png')]).then(function (f) {
          var files = {}; ['photo', 'memo', 'name'].forEach(function (k, n) { if (f[n]) files[k] = f[n]; });
          return rpc('ws_check_submit', { p_qr: q, p_d: { state: d.state, overwrite: !!d.overwrite }, p_files: files });
        });
      });
    }
  };
})();
</script>
"""
chk = src
chk = chk.replace('<base target="_top">\n', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<title>소화기 점검 · 에비뉴엘 시설팀</title>\n<meta name="robots" content="noindex">\n')
chk = chk.replace("<?!= include('Styles'); ?>", styles).replace('<?!= JSON.stringify(qr) ?>', "''")
i = chk.index('<script>\n/* 서버 통로')
chk = '<!-- 자동 생성: tools/build_fm.py (src/Check.html, Supabase 판). 직접 고치지 마세요. -->\n' + chk[:i] + BOOT_SB + chk[i:]
assert '<?' not in chk
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'check-sb.html'), 'w', encoding='utf-8').write(chk)
print('../../fm/ws/check-sb.html', len(chk), 'bytes')

# ── Supabase 이관 3-5: 전열필증 QR(?eh=) 보기 → fm/ws/eh-sb.html (로그인 없음, 읽기만 — 06_eh.sql ws_eh_view) ──
#    모양은 Code.gs ehViewPage_ 와 같음. 바꿔 타는 날 바로가기 index.html 이 ?eh= 를 이 페이지로 보냄
EH_SB = r"""<!-- 자동 생성: tools/build_fm.py (Code.gs ehViewPage_ 의 Supabase 판). 직접 고치지 마세요. -->
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>전열기기 신고필증 · 에비뉴엘 시설팀</title>
<meta name="robots" content="noindex">
%STYLES%
<style>.w{max-width:520px;margin:0 auto;padding:20px 16px}.eht{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line2);border-radius:12px;overflow:hidden;font-size:16px}
.eht th{width:96px;text-align:left;background:var(--blue-bg);color:var(--blue-d);padding:12px;font-size:14px;border-top:1px solid var(--line3)}.eht td{padding:12px;border-top:1px solid var(--line3);font-weight:700}
.banner{background:var(--red-bg);color:var(--red);border-radius:12px;padding:16px;line-height:1.6}h1{font-size:20px;margin:0 0 4px}.s{color:var(--muted);font-size:13px;margin-bottom:14px}</style>
</head>
<body>
<div class="w"><h1>전열기기 신고필증</h1><div class="s">롯데백화점 에비뉴엘 월드타워점 · 시설팀</div><div id="b">불러오는 중…</div></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>
<script src="config.js"></script>
<script>
(function () {
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var row = function (k, x) { return '<tr><th>' + k + '</th><td>' + esc(x) + '</td></tr>'; };
  var bad = function (e, no) { return '<div class="banner">' + esc(e) + (no ? '<br><small>' + esc(no) + '</small>' : '') + '</div>'; };
  var out = document.getElementById('b');
  var m = location.search.match(/[?&]eh=([^&#]*)/), qr = m ? decodeURIComponent(m[1]) : '';
  var C = window.WS_CONFIG || {};
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  sb.rpc('ws_eh_view', { p_qr: qr }).then(function (r) {
    if (r.error) throw new Error(r.error.message);
    var v = r.data, i = v.item || {};
    out.innerHTML = v.ok
      ? '<table class="eht">' + row('관리번호', i.no) + row('사용장소', i.floor + ' · ' + i.store) + row('기기명', i.name) + row('용량', i.w ? Number(i.w).toLocaleString() + ' W' : '') +
        row('제조사', i.maker) + row('책임자', i.m1 + (i.m2 ? ' / ' + i.m2 : '')) + row('승인일자', String(i.date).replace(/-/g, '.')) + row('승인', '시설소장') + '</table>'
      : bad(v.error, v.no);
  }).catch(function (e) { out.innerHTML = bad('필증 정보를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.'); });
})();
</script>
</body>
</html>
"""
eh = EH_SB.replace('%STYLES%', styles)
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'eh-sb.html'), 'w', encoding='utf-8').write(eh)
print('../../fm/ws/eh-sb.html', len(eh), 'bytes')
