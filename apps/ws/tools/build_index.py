"""parts/ 조각 → src/Index.html (업무지원 앱 화면 한 파일 만들기)
조각을 파일 이름 순서(00, 10, 20 …)로 바이트 그대로 이어 붙입니다. 화면 코드는 parts/ 에서 고치고 이 도구를 다시 돌립니다.
  python tools/build_index.py          src/Index.html 을 새로 만듦
  python tools/build_index.py --check  만들 결과가 지금 src/Index.html 과 같은지만 확인 (파일은 안 바꿈)
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARTS = os.path.join(ROOT, 'parts')
DST = os.path.join(ROOT, 'src', 'Index.html')

names = sorted(n for n in os.listdir(PARTS) if n[:2].isdigit())
out = b''.join(open(os.path.join(PARTS, n), 'rb').read() for n in names)

if '--check' in sys.argv:
    cur = open(DST, 'rb').read() if os.path.exists(DST) else b''
    same = cur == out
    print('src/Index.html 과 조각 합친 결과:', '같음' if same else '다름 (build:index 를 돌려야 함)')
    sys.exit(0 if same else 1)

open(DST, 'wb').write(out)
print('src/Index.html', len(out), 'bytes ·', len(names), '조각')
