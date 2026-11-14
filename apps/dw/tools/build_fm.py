"""도면협의 Supabase 판: src/Index.html + Styles + App → fm/dw/app.html (바로가기 페이지에서 바로 여는 앱, 구글 웹앱 없이)
화면 코드는 같고, 서버 통로만 fm/dw/dw-api.js(Supabase)로 바뀝니다. App.html·Styles.html 을 고치면 다시 돌리고 GitHub 에 올립니다.
바꿔 타는 날(config.js LIVE) 전까지는 app.html 로만 시험. (docs/설계/DW_Supabase이관.md)
사용: python tools/build_fm.py
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rd = lambda f: open(os.path.join(ROOT, 'src', f), encoding='utf-8').read()
ix, styles, app = rd('Index.html'), rd('Styles.html'), rd('App.html')
ver = re.search(r"VERSION: '([\d.]+)'", rd('Code.gs')).group(1)

HEAD = ('<meta name="theme-color" content="#FFFFFF">\n  <meta name="robots" content="noindex">\n'
        '  <link rel="manifest" href="manifest.webmanifest">\n  <link rel="icon" href="../icon-192.png">\n  <link rel="apple-touch-icon" href="../icon-192.png">\n'
        '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js"></script>\n'
        '  <script src="../apps.js"></script>\n  <script src="config.js"></script>\n'
        '  <script>window.DW_VERSION = ' + repr(ver) + ';</script>\n  <script src="dw-api.js"></script>\n')
# 주소의 ?store= ?sign= 를 Code.gs doGet 과 같은 규칙으로
START = ("<script>(function () { var q = new URLSearchParams(location.search), s = q.get('store') || '', t = q.get('sign') || '';\n"
         "    window.__START_STORE = /^[-\\w]{6,60}$/.test(s) ? s : ''; window.__SIGN = /^[0-9a-f]{40,80}$/.test(t) ? t : ''; })();</script>")
for a in ['<base target="_top">\n', "<?!= include('Styles') ?>", "<?!= include('App') ?>",
          "<script>window.__START_STORE = '<?= startStore ?>'; window.__SIGN = '<?= signToken ?>';</script>"]:
    assert ix.count(a) == 1, a
out = (ix.replace('<base target="_top">\n', '')
         .replace('<title>', HEAD + '  <title>', 1)
         .replace("<?!= include('Styles') ?>", styles)
         .replace("<script>window.__START_STORE = '<?= startStore ?>'; window.__SIGN = '<?= signToken ?>';</script>", START)
         .replace("<?!= include('App') ?>", app))
assert '<?' not in out, '남은 템플릿 태그'
out = '<!-- 자동 생성: apps/dw/tools/build_fm.py (src/Index.html · Styles · App). 직접 고치지 마세요. -->\n' + out
dst = os.path.join(ROOT, '..', '..', 'fm', 'dw', 'app.html')
open(dst, 'w', encoding='utf-8').write(out)
print('fm/dw/app.html', len(out), 'bytes · v' + ver)
