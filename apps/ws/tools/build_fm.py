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
           '<script src="config.js"></script>\n<script>window.WS_VERSION = ' + repr(ver) + ';</script>\n<script src="ws-api.js"></script>\n')
assert ix.count('<base target="_top">\n') == 1 and ix.count("<?!= include('Styles'); ?>") == 1
app = ix.replace('<base target="_top">\n', HEAD_SB).replace("<?!= include('Styles'); ?>", styles)
app = app.replace('<?!= JSON.stringify(execUrl) ?>', "''").replace('<?!= JSON.stringify(APP.version) ?>', repr(ver))
assert '<?' not in app, '남은 템플릿 태그'
app = '<!-- 자동 생성: tools/build_fm.py (src/Index.html). 직접 고치지 마세요. -->\n' + app
open(os.path.join(ROOT, '..', '..', 'fm', 'ws', 'app.html'), 'w', encoding='utf-8').write(app)
print('../../fm/ws/app.html', len(app), 'bytes · v' + ver)
