"""반응형 전수 점검: 모든 화면 × 휴대폰·태블릿·PC 크기
- 페이지 가로 넘침, 화면 밖으로 벗어난 요소, 글자가 칸을 넘친 요소, 화면보다 큰 팝업, 너무 작은 터치 버튼
사용: python3 dev/ui_audit.py [--shots]   (dev/http 서버 자동 실행)"""
import asyncio, json, pathlib, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent
PORT = 8780
URL = f'http://127.0.0.1:{PORT}/preview.html'
SHOTS = '--shots' in sys.argv
# --stress: 기기 글꼴이 넓거나(삼성·안드로이드 기본 글꼴 등) 글자가 큰 경우를 흉내 냄
STRESS = "*{font-family:'DejaVu Sans',sans-serif !important;letter-spacing:.03em}" if '--stress' in sys.argv else ''
OUT = ROOT / 'shots' / ('audit_stress' if '--stress' in sys.argv else 'audit')
OUT.mkdir(parents=True, exist_ok=True)

SIZES = [
    ('폰S', 320, 568, True), ('폰', 360, 740, True), ('아이폰', 390, 844, True), ('폰L', 430, 932, True),
    ('폰가로', 844, 390, True), ('태블릿세로', 768, 1024, True), ('아이패드세로', 820, 1180, True),
    ('태블릿가로', 1024, 768, True), ('아이패드가로', 1180, 820, True), ('아이패드프로', 1366, 1024, True),
    ('노트북', 1280, 800, False), ('PC', 1440, 900, False), ('PC-FHD', 1920, 1080, False),
]

AUDIT_JS = r"""
() => {
  const W = innerWidth, H = innerHeight, out = [];
  const sel = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '') +
    (e.dataset && e.dataset.act ? '[' + e.dataset.act + ']' : '') + (e.textContent ? ' "' + e.textContent.trim().replace(/\s+/g, ' ').slice(0, 18) + '"' : '');
  if (document.documentElement.scrollWidth > W + 1) out.push('페이지가로넘침 ' + document.documentElement.scrollWidth + '>' + W);
  const all = Array.from(document.querySelectorAll('body *'));
  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.closest('.page-holder') || e.closest('[aria-hidden=true]')) continue;
    if (e.closest('#toast')) continue;
    if (e.classList.contains('sr') || e.closest('.sr')) continue;
    if (e.closest('.npaper')) continue; // 특이사항 편집칸 안 (사진 손잡이는 일부러 사진 밖으로 나옴)
    // 스크롤 영역 안은 제외 (의도한 가로 스크롤)
    let a = e.parentElement, inScroll = false;
    while (a && a !== document.body) { const o = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(o.overflowX)) { inScroll = true; break; } a = a.parentElement; }
    if (!inScroll && (r.right > W + 1 || r.left < -1)) out.push('화면밖 ' + sel(e) + ' ' + Math.round(r.left) + '~' + Math.round(r.right));
    const tag = e.tagName;
    if (!/(auto|scroll)/.test(cs.overflowX) && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'svg' && tag !== 'path' && tag !== 'CANVAS' && tag !== 'IMG' &&
        !e.closest('svg') && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.display !== 'inline' && !(cs.textOverflow === 'ellipsis' && cs.overflowX === 'hidden')) {
      // 자식 중 스크롤 영역 때문이면 제외
      out.push('글자넘침 ' + sel(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
    }
    if (cs.position === 'fixed' && /dialog|gpanel|sigsheet|menu|gprev|pv-card/.test(e.className) && (r.bottom > H + 1 || r.top < -1)) {
      let ov = e.closest('.overlay'); const sc = ov && /(auto|scroll)/.test(getComputedStyle(ov).overflowY);
      if (!sc) out.push('팝업이화면보다큼 ' + sel(e) + ' ' + Math.round(r.top) + '~' + Math.round(r.bottom) + '/' + H);
    }
    if ((tag === 'BUTTON' || (tag === 'A' && e.classList.contains('btn'))) && window.__touch && (r.height < 32 || r.width < 32) && !e.closest('.page-holder'))
      out.push('작은버튼 ' + sel(e) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (tag === 'INPUT' && e.type !== 'checkbox' && e.type !== 'radio' && r.width < 56) out.push('좁은입력칸 ' + sel(e) + ' ' + Math.round(r.width));
  }
  // .dialog 나 .overlay 가 화면보다 큰데 스크롤 안 되는 경우
  document.querySelectorAll('.dialog').forEach(d => { const r = d.getBoundingClientRect(); if (r.height > H + 1 && !/(auto|scroll)/.test(getComputedStyle(d).overflowY) && !/(auto|scroll)/.test(getComputedStyle(d.parentElement).overflowY)) out.push('대화상자가화면보다큼 ' + Math.round(r.height) + '/' + H); });
  return Array.from(new Set(out));
}
"""

SEED = r"""
async () => {
  const call = (n, ...args) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[n](...args));
  const A = { role: '소장', pin: '1234' };
  const mk = async (r, rounds, confirm) => {
    let b = await call('apiSaveReview', A, r, false);
    for (let i = 1; i < rounds; i++) b = await call('apiNextRound', A, b.store.id);
    if (confirm) await call('apiSetConfirmed', A, b.store.id, true);
    return b.store.id;
  };
  const d = n => { const t = new Date(Date.now() + n * 864e5); return t.toISOString().slice(0, 10); };
  window.__ids = [];
  window.__ids.push(await mk({ tenant: '아주아주긴테넌트이름 · 프리미엄 라이프스타일 편집숍 (팝업 1차)', reviewDate: d(-3), openDate: d(4), fireCheckDate: d(2), periodStart: d(-6), periodEnd: d(3), storeType: '팝업', location: '3', contractorCompany: '대한민국인테리어디자인건설주식회사', contractorName: '김시공', contractorTel: '010-1234-5678', contractorEmail: 'very.long.contractor.address@daehanminguk-interior-design.co.kr', docCad: '미제출', docFRPlan: '미제출', ownerCompany: '롯데쇼핑 에비뉴엘 잠실점 영업팀', notes: '첫 줄\n(설비공사 지침 6/10, p.30)' }, 3, false));
  window.__ids.push(await mk({ tenant: '샤넬', reviewDate: d(-10), openDate: d(20), storeType: '본매장', location: '1F' }, 1, true));
  window.__ids.push(await mk({ tenant: '에르메스 VP', reviewDate: d(-1), openDate: d(-2), storeType: 'VP', location: 'B1' }, 2, false));
  for (let i = 0; i < 4; i++) window.__ids.push(await mk({ tenant: '매장 ' + i, reviewDate: d(-i), openDate: d(i * 3), periodStart: d(i * 3 - 9), periodEnd: d(i * 3 - 1), fireCheckDate: d(i * 3 - 2), storeType: '본매장', location: String(i + 2) }, 1 + (i % 3), i === 2));
  return window.__ids.length;
}
"""


async def screen(page, name, size, issues):
    found = await page.evaluate(AUDIT_JS)
    if found:
        issues.setdefault(name, {})[size] = found
    if SHOTS:
        await page.screenshot(path=OUT / f'{name}_{size}.png', full_page=False)


async def open_editor(page, idx=0):
    await page.evaluate("() => { document.querySelector('[data-act=dash]') && document.querySelector('[data-act=dash]').click(); }")
    await page.wait_for_selector('[data-act=new]')
    await page.evaluate("id => document.querySelector('[data-act=open][data-id=\"' + id + '\"]').click()", await page.evaluate(f'window.__ids[{idx}]'))
    await page.wait_for_selector('#notes')
    await page.wait_for_timeout(150)


async def run_size(b, label, w, h, touch, issues):
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch and w < 900, device_scale_factor=1)
    page = await ctx.new_page()
    await page.route('**/fonts.g*/**', lambda r: r.abort())
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)))
    if STRESS:
        await ctx.add_init_script("document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = " + repr(STRESS) + "; document.head.appendChild(st); });")
    await page.goto(URL)
    await page.evaluate('localStorage.clear(); sessionStorage.clear()')
    await page.reload()
    await page.evaluate(f'window.__touch = {str(touch).lower()}')
    await page.wait_for_selector('#pin')
    await screen(page, '01로그인', label, issues)
    await page.fill('#pin', '1234'); await page.click('button[type=submit]')
    await page.wait_for_selector('[data-act=new]')
    await page.evaluate(SEED)
    await page.evaluate("document.querySelector('[data-act=refresh]').click()")
    await page.wait_for_timeout(500)
    await page.evaluate(f'window.__touch = {str(touch).lower()}')
    await screen(page, '02대시보드', label, issues)
    await page.evaluate("document.querySelector('[data-act=tab][data-tab=cal]').click()")
    await page.wait_for_selector('.cal')
    await screen(page, '20달력', label, issues)
    await page.evaluate("document.querySelector('[data-act=tab][data-tab=all]').click()")
    await page.evaluate("document.querySelector('.vlink').click()")
    await page.wait_for_selector('.vend')
    await screen(page, '24업체이력', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    await page.evaluate("document.querySelector('.todo').click()")
    await page.wait_for_timeout(100)
    await screen(page, '25할일걸러보기', label, issues)
    await page.evaluate("document.querySelector('.todo').click()")
    # 컨펌 대화상자
    await page.evaluate("document.querySelector('[data-act=confirm]').click()")
    await page.wait_for_selector('.dialog')
    await screen(page, '03컨펌팝업', label, issues)
    await page.evaluate("document.querySelector('.dialog [data-dv]').click()")
    # 보관 알림
    await page.evaluate("localStorage.setItem('dr_pending', JSON.stringify({'x#1': {key: 'x#1', review: {round: 1}, tenant: '아주아주긴테넌트이름 · 프리미엄 라이프스타일 편집숍', at: '2026-10-28 20:00', err: '컨펌완료된 매장입니다. 대시보드에서 컨펌완료를 취소한 뒤 수정해 주세요.'}}))")
    await page.evaluate("document.querySelector('[data-act=refresh]').click()")
    await page.wait_for_selector('.pendbar')
    await screen(page, '04보관알림', label, issues)
    await page.evaluate("localStorage.removeItem('dr_pending')")

    # 검토서
    await open_editor(page, 0)
    await screen(page, '05검토서위', label, issues)
    await page.evaluate("document.querySelector('[data-act=specOpen]').click()")
    await page.wait_for_selector('[data-spk=tenant]')
    await page.evaluate("document.querySelector('[data-spk=tenant]').click()")
    await page.wait_for_timeout(80)
    await page.evaluate("document.querySelector('[data-spk=crown]').click()")
    await page.wait_for_timeout(80)
    await screen(page, '21시방서발송', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    await page.evaluate("document.getElementById('s5').scrollIntoView(); document.querySelector('[data-act=docReq]').click()")
    await page.wait_for_selector('[data-dk=docCad]')
    await screen(page, '22서류요청', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    await page.evaluate("document.getElementById('s7').scrollIntoView(); document.querySelector('[data-act=sigReq]').click()")
    await page.wait_for_selector('[data-sw]')
    await page.evaluate("[...document.querySelectorAll('[data-sw]')].forEach(c => { if (!c.checked && !c.disabled) c.click(); })")
    await page.wait_for_timeout(100)
    await screen(page, '23원격서명요청', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    for sec in ['s2', 's3', 's4', 's5', 's6', 's7', 's9']:
        await page.evaluate(f"document.getElementById('{sec}').scrollIntoView()")
        await page.wait_for_timeout(60)
        await screen(page, '06검토서_' + sec, label, issues)
    # 차단기 팝업
    await page.evaluate("document.getElementById('s3').scrollIntoView()")
    await page.fill('#f-elecKw', '50'); await page.fill('#f-mainBreakerA', '50')
    await page.evaluate("document.querySelector('#f-mainBreakerA').blur()")
    await page.wait_for_timeout(200)
    if not await page.locator('.dialog').count():
        await page.evaluate("var x=document.querySelector('[data-act=brkpopup]'); if (x) x.click()")
    await page.wait_for_timeout(200)
    await screen(page, '07차단기팝업', label, issues)
    await page.evaluate("var o=document.querySelector('.overlay'); if (o) o.click()")
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    await page.fill('#f-mainBreakerA', '150')
    # 서명
    await page.evaluate("document.querySelector('[data-act=sig]').click()")
    await page.wait_for_selector('.sigsheet')
    await screen(page, '08서명', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 문구
    await page.evaluate("document.getElementById('s6').scrollIntoView()")
    await page.evaluate("document.querySelector('[data-act=phrases]').click()")
    await page.wait_for_selector('.phmenu')
    await screen(page, '09문구목록', label, issues)
    await page.evaluate("document.querySelector('[data-phact=manage]').click()")
    await page.wait_for_selector('.phmgr')
    await screen(page, '10문구관리', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 지침 검색 · 미리보기
    await page.evaluate("document.querySelector('[data-act=guide]').click()")
    await page.wait_for_selector('#gq')
    await page.fill('#gq', '방화구획')
    await page.wait_for_selector('#gres .hit')
    await screen(page, '11지침검색', label, issues)
    await page.evaluate("document.querySelector('#gres .pgbtn').click()")
    await page.wait_for_selector('#gprev .pv-page img, #gprev .pv-text', timeout=10000)
    await page.wait_for_timeout(300)
    await screen(page, '12쪽미리보기', label, issues)
    await page.evaluate("var c=document.querySelector('[data-pv=close]'); if (c) c.click()")
    await page.press('body', 'Escape')
    await page.evaluate("var c=document.querySelector('.gpanel [aria-label*=닫기], .gpanel [data-gclose]'); if (c) c.click()")
    await page.evaluate("var p=document.querySelector('#gpanel'); if (p) p.remove(); var q=document.querySelector('#gprev'); if (q) q.remove()")
    # 누락 항목
    await page.evaluate("document.querySelector('[data-act=finalize]').click()")
    await page.wait_for_timeout(300)
    if await page.locator('.dialog').count():
        await screen(page, '13누락안내', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 차수 삭제 대화상자
    await page.evaluate("var x=document.querySelector('[data-act=delround]'); if (x && !x.disabled) x.click()")
    await page.wait_for_timeout(200)
    if await page.locator('.dialog').count():
        await screen(page, '14차수삭제', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 출력
    await page.evaluate("document.querySelector('[data-act=print]').click()")
    await page.wait_for_selector('.page')
    await page.wait_for_timeout(300)
    await screen(page, '15출력', label, issues)
    await page.evaluate("document.querySelector('[data-act=backEdit]').click()")
    await page.wait_for_selector('#notes')
    # 컨펌완료 매장 (잠김)
    await open_editor(page, 1)
    await screen(page, '16잠긴검토서', label, issues)
    # 새 검토서
    await page.evaluate("document.querySelector('[data-act=dash]').click()")
    await page.wait_for_selector('[data-act=new]')
    await page.evaluate("document.querySelector('[data-act=new]').click()")
    await page.wait_for_selector('#notes')
    await screen(page, '17새검토서', label, issues)
    # 지침 관리
    await page.evaluate("document.querySelector('[data-act=dash]').click()")
    await page.wait_for_selector('[data-act=gadmin]')
    await page.evaluate("window.__mockGuides.archive.push(Object.assign({}, window.__mockGuides.sources[1], {id: 'old1', title: '타워&몰 통합안전관리지침 (25년 개정판, 아주 긴 이름 시험용 텍스트)', archivedAt: '2026-10-28 15:00'})); window.__mockGuides.building = {id: 'b1', fileId: 'pdf-s', fileName: '통합안전관리지침_26.pdf', title: '통합안전관리지침', short: '통합안전관리지침', startedAt: '2026-10-28 15:00'}")
    await page.evaluate("document.querySelector('[data-act=gadmin]').click()")
    await page.wait_for_selector('.gadm')
    await page.wait_for_timeout(150)
    await screen(page, '18지침관리', label, issues)
    await page.evaluate("document.querySelector('.gadm section:last-child [data-act=gbuild]').click()")
    await page.wait_for_selector('#gfShort')
    await screen(page, '19색인만들기', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 1.8.2 종합방재실 협의서: 입력 버튼 · 찍기/고르기 창 · 올린 뒤 · A4 보기 팝업
    await open_editor(page, 0)
    await page.evaluate("document.querySelector('#f-fireCheckDate').scrollIntoView({block:'center'})")
    await screen(page, '27협의서입력', label, issues)
    await page.evaluate("document.querySelector('#fdSlot [data-act=fdAdd]').click()")
    await page.wait_for_selector('.fdpick')
    await screen(page, '28협의서고르기', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    await page.evaluate("""async () => { const c = document.createElement('canvas'); c.width = 1600; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#ddd'; x.fillRect(0, 0, 1600, 1200);
      const url = c.toDataURL('image/jpeg', 0.5); const call = (n, ...a) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[n](...a));
      const b = await call('apiFireDocUpload', {role:'소장', pin:'1234'}, window.__DR.store.id, url); window.__DR.store = b.store; }""")
    await open_editor(page, 0)
    await page.evaluate("document.querySelector('#f-fireCheckDate').scrollIntoView({block:'center'})")
    await screen(page, '29협의서올린뒤', label, issues)
    await page.evaluate("document.querySelector('#fdSlot [data-act=fdView]').click()")
    await page.wait_for_selector('#fdvImg')
    await page.wait_for_timeout(250)
    await screen(page, '30협의서보기', label, issues)
    await page.evaluate("document.getElementById('layer').innerHTML=''")
    # 원격 서명 페이지 (메일 링크)
    tok = await page.evaluate("""async () => { const call = (n, ...a) => new Promise((ok, no) => google.script.run.withSuccessHandler(ok).withFailureHandler(no)[n](...a));
      await call('apiSigRequest', {role:'소장', pin:'1234'}, window.__ids[0], 3, [{who:'resp', email:'a@b.co'}], 'data:application/pdf;base64,AAAA', 'x.pdf');
      return window.__mockMails.filter(m => m.kind === 'sig').pop().token; }""")
    await page.goto(URL + '?sign=' + tok)
    await page.wait_for_selector('#spPad')
    await screen(page, '26서명페이지', label, issues)
    if errs:
        issues.setdefault('JS오류', {})[label] = errs
    await ctx.close()


async def main():
    issues = {}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        only = [a for a in sys.argv[1:] if not a.startswith('--')]
        for label, w, h, touch in SIZES:
            if only and label not in only:
                continue
            try:
                await run_size(b, label, w, h, touch, issues)
            except Exception as e:
                issues.setdefault('점검중단', {})[label] = [str(e)[:300]]
        await b.close()
    total = sum(len(v) for s in issues.values() for v in s.values())
    for name in sorted(issues):
        print(name)
        for size, found in issues[name].items():
            for f in found[:12]:
                print('   ', size, '|', f)
            if len(found) > 12:
                print('   ', size, '| …', len(found) - 12, '건 더')
    print('문제', total, '건')
    (ROOT / 'shots' / ('audit_result_stress.json' if STRESS else 'audit_result.json')).write_text(json.dumps(issues, ensure_ascii=False, indent=1))
    return total


srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    n = asyncio.run(main())
finally:
    srv.terminate()
sys.exit(1 if n else 0)
