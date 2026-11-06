"""Apps Script 템플릿(Index.html)을 모의 백엔드가 붙은 단일 미리보기 HTML로 조립합니다.
사용: python3 test/build_preview.py [--local-libs] [--ship]
  --ship: 배포용 (쪽 이미지 없이 문장 미리보기)
"""
import pathlib, sys

root = pathlib.Path(__file__).resolve().parent.parent
src = root / 'src'
dev = pathlib.Path(__file__).resolve().parent  # 이 파일이 있는 폴더 (dw/test)

index = (src / 'Index.html').read_text(encoding='utf-8')
styles = (src / 'Styles.html').read_text(encoding='utf-8')
app = (src / 'App.html').read_text(encoding='utf-8')
backend = '\n'.join([
    '<script>',
    (src / 'Code.gs').read_text(encoding='utf-8'),
    'var __GD = ' + (root / 'guide_pages' / 'index.json').read_text(encoding='utf-8') + ';\nvar GUIDE_SOURCES = __GD.sources, GUIDE_INDEX = __GD.index;' +
    ('' if '--ship' in sys.argv else '\nwindow.__MOCK_PAGE_IMAGES = true;') +
    ('\nwindow.__PDFJS_BASE = "node_modules/pdfjs-dist/build/";' if '--local-libs' in sys.argv else ''),
    (dev / 'mock.js').read_text(encoding='utf-8'),
    '</script>',
])

html = index.replace("<?!= include('Styles') ?>", styles)
html = html.replace("'<?= startStore ?>'", "(new URLSearchParams(location.search).get('store') || '')")
html = html.replace("'<?= signToken ?>'", "(new URLSearchParams(location.search).get('sign') || '')")
html = html.replace("<?!= include('App') ?>", backend + '\n' + app)

if '--local-libs' in sys.argv:
    # PDF·QR 도구는 출력할 때 불러옴 → 개발 폴더의 파일을 쓰도록 주소만 바꿈
    html = html.replace('<div id="layer"></div>', '<div id="layer"></div>\n  <script>window.__LIB_H2P = "node_modules/html2pdf.js/dist/html2pdf.bundle.min.js"; window.__LIB_QR = "node_modules/qrcode-generator/qrcode.js";</script>')

out = dev / 'preview.html'
out.write_text(html, encoding='utf-8')
print('wrote', out)
