"""apps/design/tokens.css 를 모든 앱의 표시 구간에 넣습니다. 사용: python apps/design/sync.py [--check]
Apps Script 화면은 다른 파일을 불러올 수 없어, 값은 이 파일 한 곳에서 고치고 앱마다 복사해 넣습니다."""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGETS = ['apps/ws/src/Styles.html', 'apps/dw/src/Styles.html', 'fm/map/css/common.css',
           'fm/index.html', 'fm/ws/index.html', 'fm/dw/index.html', 'fm/hub/index.html',
           'apps/thermal-reporter/web/tokens.css']
A, B = '/* DESIGN-TOKENS:START */', '/* DESIGN-TOKENS:END */'

tokens = open(os.path.join(ROOT, 'apps/design/tokens.css'), encoding='utf-8').read().strip()
block = A + '\n' + tokens + '\n' + B
stale = []
for rel in TARGETS:
    path = os.path.join(ROOT, rel)
    if not os.path.exists(path): continue  # 열화상 작성기는 아직 저장소에 없는 로컬 도구
    text = open(path, encoding='utf-8', newline='').read()
    assert text.count(A) == 1 and text.count(B) == 1, rel + ': 표시 구간이 없습니다'
    nl = '\r\n' if '\r\n' in text else '\n'
    new = re.sub(re.escape(A) + r'.*?' + re.escape(B), lambda _: block.replace('\n', nl), text, flags=re.S)
    if new != text:
        stale.append(rel)
        if '--check' not in sys.argv:
            open(path, 'w', encoding='utf-8', newline='').write(new)
print('맞출 파일:', stale or '없음')
sys.exit(1 if stale and '--check' in sys.argv else 0)
