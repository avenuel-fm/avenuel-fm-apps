# 시안 만들기: python mock.py  → 1_새규칙_PC.png, 2_새규칙_휴대폰.png, 3_지금과_바뀜.png
from playwright.sync_api import sync_playwright
CSS = """:root{--navy:#1E3A5F;--white:#fff;--sub:#5F6B7A;--line:#D8DDE5;--tint:#F1F4F8;--ok:#1E3A5F}
*{box-sizing:border-box}body{margin:0;background:#fff;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;color:var(--navy);padding:24px}
h2{font-size:18px;margin:0 0 4px}p.n{font-size:13px;color:var(--sub);margin:0 0 12px}
.lab{font-size:13px;color:var(--sub);margin:18px 0 6px}
.bar{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-top:2px solid var(--line);padding:8px 16px;background:#fff}
.bar .st{margin-right:auto;font-size:13px;color:var(--sub);display:inline-flex;align-items:center;gap:4px}
.dot{width:8px;height:8px;border-radius:2px;background:var(--navy);display:inline-block}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:40px;padding:0 20px;border:1px solid var(--line);border-radius:2px;background:#fff;color:var(--navy);font-size:15px;font-weight:500;min-width:112px}
.btn.pri{background:var(--navy);border-color:var(--navy);color:#fff}
.phone .btn{height:44px}.phone{width:390px}.pc{width:900px}
.row{display:flex;gap:32px;align-items:flex-start}
table{border-collapse:collapse;font-size:13px;margin-top:8px}td,th{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--tint)}
.x{color:#B42318}"""
ICON_P = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z"/></svg>'
def bar(state, btns, cls='pc'):
    return f'<div class="{cls}"><div class="bar"><span class="st">{state}</span>{btns}</div></div>'
P = f'<span class="btn">{ICON_P}인쇄 (B4)</span>'
SAVE = '<span class="btn pri">저장</span>'
BUSY = '<span class="btn pri" style="opacity:.6">PDF 만드는 중…</span>'
VIEW = '<span class="btn">PDF 보기</span>'
DIRTY = '<i class="dot"></i>저장 안 함'; DONE = '✓ 저장됨 · 14:32'
def page(body): return f'<style>{CSS}</style>{body}'
pc = page(f'''<h2>새 규칙 — PC (종합업무일지 · 공조기 환기온도)</h2>
<p class="n">남색은 「저장」 하나만 · 저장하면 PDF가 같이 만들어짐 · 저장 뒤 같은 자리가 「PDF 보기」 · 오른쪽 아래, 인쇄는 그 왼쪽</p>
<div class="lab">① 내용을 고친 뒤 (저장 안 함)</div>{bar(DIRTY, P+SAVE)}
<div class="lab">② 저장 누른 직후 (저장 + PDF 만드는 중, 버튼 잠김)</div>{bar('저장하는 중…', P.replace('class="btn"','class="btn" style="opacity:.5"')+BUSY)}
<div class="lab">③ 저장이 끝남 — 저장 자리가 「PDF 보기」로 바뀜 (누르면 앱 안 PDF 화면)</div>{bar(DONE, P+VIEW)}
<div class="lab">④ 저장 뒤 다시 고침 → ①로 돌아가 「저장」 (다시 저장하면 PDF도 새로 만듦)</div>{bar(DIRTY, P+SAVE)}''')
ph = page(f'''<h2>새 규칙 — 휴대폰 (TBM · 공조기 · 공사장 점검 …)</h2>
<p class="n">인쇄는 PC만. 휴대폰은 오른쪽 아래 버튼 하나(저장 ⇄ PDF 보기), 상태 글자는 왼쪽</p>
<div class="row"><div><div class="lab">① 고친 뒤</div>{bar(DIRTY, SAVE, 'phone')}</div>
<div><div class="lab">③ 저장 끝</div>{bar(DONE, VIEW, 'phone')}</div></div>''')
CH = page(f'''<h2>화면별 지금 → 새 규칙</h2>
<table><tr><th>화면</th><th>지금 아래 줄</th><th>새 규칙</th></tr>
<tr><td>종합업무일지 (PC)</td><td class="x">저장 안 함 | 인쇄 | (PDF 열기) | PDF로 저장 | <b>저장(남색)</b></td><td>저장 안 함 ··· 인쇄 | <b>저장(남색) ⇄ PDF 보기</b></td></tr>
<tr><td>공조기 환기온도</td><td class="x"><b>저장(남색)</b> | 인쇄 | (PDF 열기) | PDF 만들기(남색) — 휴대폰은 저장·PDF 만들기</td><td>PC: 인쇄 | 저장 ⇄ PDF 보기 · 휴대폰: 저장 ⇄ PDF 보기</td></tr>
<tr><td>TBM (휴대폰)</td><td class="x">저장 | PDF로 저장(남색) ⇄ PDF 열기(남색)</td><td>저장(남색) ⇄ PDF 보기 하나로 (사진 비면 확인 질문은 그대로)</td></tr>
<tr><td>공사장 점검</td><td class="x">PDF 열기 | 점검 끝 · PDF(남색) — 고르면 자동 저장</td><td>자동 저장은 그대로, 오른쪽 아래 <b>「점검 끝」(남색) ⇄ PDF 보기</b> (공사장 점검 세션 「공사 완료」 시안과 맞춤)</td></tr>
<tr><td>명일 작업 예정</td><td class="x">저장(남색) | 그림으로 저장(초록)</td><td><b>질문:</b> 저장 뒤 PDF 자동으로 할지? (제안: PDF 말고 지금처럼 「그림으로 저장」만 흰 버튼으로, 순서는 그림으로 저장 | 저장)</td></tr>
<tr><td>출근현황</td><td class="x">날짜 바꾸기 | 그림으로 저장(남색)</td><td>저장할 내용이 없는 보기 화면 → 남색 없이 흰 버튼 둘 (제안)</td></tr>
<tr><td>전열필증</td><td>저장·PDF 없음 (QR 라벨 인쇄만)</td><td>대상 아님 — 그대로</td></tr></table>''')
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, html, w in [('1_새규칙_PC', pc, 960), ('2_새규칙_휴대폰', ph, 900), ('3_지금과_바뀜', CH, 1100)]:
        pg = b.new_page(viewport={'width': w, 'height': 400}); pg.set_content(html); pg.wait_for_timeout(300)
        pg.screenshot(path=name + '.png', full_page=True); pg.close()
    b.close()
