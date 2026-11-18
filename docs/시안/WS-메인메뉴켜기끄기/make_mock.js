// 시안 (11-19): 메인 메뉴 켜기·끄기 — 지금 업무지원 화면(fm/ws/app.html)을 가짜 자료로 띄우고 바뀔 모양을 얹어 찍음
// 실행: apps/ws 폴더에서  python tools/build_fm.py  뒤  node ../../docs/시안/WS-메인메뉴켜기끄기/make_mock.js
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../../../apps/ws')] }));
const FM = path.join(__dirname, '..', '..', '..', 'fm'), OUT = __dirname, PORT = 8146, BASE = 'http://localhost:' + PORT;
const user = role => ({ staff_id: 'S003', name: role === '소장' ? '홍길동' : '이영희', part: '전방파트', role });
let ROLE = '직원';
const RPC = {
  ws_bootstrap: () => ({ ok: true, user: user(ROLE), toastSec: 2.6, needSign: false, docs: { signs: 5 }, fire: { counts: { ok: 120, bad: 2, wait: 0, miss: 0, total: 180 } } }),
  ws_admin_staff: () => ({ ok: true, toastSec: 2.6, staff: [{ staff_id: 'S001', name: '홍길동', part: '관리', role: '소장' }, { staff_id: 'S003', name: '이영희', part: '전방파트', role: '직원' }, { staff_id: 'S009', name: '김관찰', part: '관리', role: '옵저버' }] }),
  ws_risk_get: () => ({ ok: true, rows: Array(24).fill({}) })
};
const FAKE = `window.supabase={createClient(){return{auth:{async getSession(){return{data:{session:{user:{email:'team@avenuel-fm.app'}}}}}},async rpc(f,a){const r=await fetch('/rpc/'+f,{method:'POST',body:JSON.stringify(a)}).then(r=>r.json());return{data:r,error:null}},storage:{from(){return{getPublicUrl(p){return{data:{publicUrl:p}}}}}}}}};`;
const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/rpc/')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify((RPC[u.pathname.slice(5)] || (() => ({ ok: true })))())); }
  const f = path.join(FM, decodeURIComponent(u.pathname)); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/javascript'); res.end(fs.readFileSync(f)); }).listen(PORT);
// 메인: 꺼진 칸은 흐리게 + 자물쇠 + 「사용 중지」, 누르면 알림
const OFF = () => { const t = [...document.querySelectorAll('.grid6 .tile')].find(x => /지도/.test(x.textContent));
  t.style.cssText = 'opacity:.45;border-style:dashed;background:transparent';
  t.querySelector('small').innerHTML = '🔒 지금은 사용 중지';
  const d = document.createElement('div'); d.className = 'toast'; d.textContent = '지도는 지금 사용 중지입니다 (관리자·옵저버만 열림)'; document.body.appendChild(d); };
// 관리자·옵저버: 꺼진 칸도 열리지만 「사용 중지 중」 표시
const OFF_ADMIN = () => { const t = [...document.querySelectorAll('.grid6 .tile')].find(x => /지도/.test(x.textContent));
  t.querySelector('small').innerHTML = '에비뉴엘 도면 · <b style="color:#B45309">직원에게 꺼짐</b>'; };
// 환경설정: 「메인 메뉴」 칸
const SET = () => { const hs = [...document.querySelectorAll('h3.sth')]; const at = hs.find(h => /직원/.test(h.textContent)).parentElement;
  const row = (n, s, on) => '<div class="strow"><span class="fname"><b>' + n + '</b><small>' + s + '</small></span><div class="seg setseg" style="width:150px;grid-template-columns:1fr 1fr;display:grid"><button class="' + (on ? 'on' : '') + '">켜짐</button><button class="' + (on ? '' : 'on') + '">꺼짐</button></div></div>';
  const box = document.createElement('div');
  box.innerHTML = '<h3 class="sth" style="margin-top:8px">메인 메뉴</h3><div class="card">' + row('서류작업', 'TBM · 명일 작업 · 종합업무일지 …', true) + row('점검', '소화기 · 전열필증 · 공사장 점검', true) + row('시방서 검색', '도면협의 지침 찾기', true) + row('지도', '에비뉴엘 도면', false) +
    '</div><small style="color:var(--muted);line-height:1.6;display:block;margin-top:6px">꺼진 메뉴는 직원 화면에서 흐리게 보이고 눌러도 열리지 않습니다. <b>소장·관리자·옵저버</b>는 꺼진 메뉴도 열 수 있습니다.</small>';
  at.parentElement.insertBefore(box, at); };
(async () => { const b = await chromium.launch();
  const shot = async (vp, role, fn, name, set) => { ROLE = role; const c = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 500, hasTouch: vp.width < 500 });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE })); await c.route(/fonts\.googleapis|cdnjs/, r => r.fulfill({ body: '' }));
    await c.addInitScript(() => localStorage.setItem('ws_token', 'S003.' + (Date.now() + 3600e3) + '.emp'));
    const p = await c.newPage(); await p.goto(BASE + '/ws/app.html'); await p.locator('.grid6').waitFor(); await p.waitForTimeout(300);
    if (set) { await p.evaluate(() => openSet()); await p.locator('h3.sth').first().waitFor(); }
    await p.evaluate(fn); if (set) await p.evaluate(() => [...document.querySelectorAll('h3.sth')].find(h => /메인 메뉴/.test(h.textContent)).scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, name) }); await c.close(); };
  await shot({ width: 390, height: 844 }, '직원', OFF, '시안1_메인_직원_지도꺼짐.png');
  await shot({ width: 390, height: 844 }, '옵저버', OFF_ADMIN, '시안2_메인_관리자옵저버.png');
  await shot({ width: 390, height: 844 }, '소장', SET, '시안3_환경설정_메인메뉴.png', true);
  await b.close(); srv.close(); })();
