// 시안 찍기 (WS 시방서 검색) — 실제 업무지원 화면(fm/ws/app.html)을 가짜 자료로 띄우고 새 화면 모양을 얹어 찍음
// 실행: apps/ws 폴더에서  node ../../docs/시안/WS-시방서검색/make_mock.js
const { chromium } = require(require.resolve('playwright', { paths: [require('path').join(__dirname, '../../../apps/ws')] }));
const http = require('http'), fs = require('fs'), path = require('path');
const FM = path.join(__dirname, '..', '..', '..', 'fm'), OUT = __dirname, PORT = 8139;
const TOK = 'S001.' + (Date.now() + 3600e3) + '.boss';
const FAKE = `window.supabase = { createClient() { return {
  auth: { async getSession() { return { data: { session: { user: { email: 'x@x' } } } }; } },
  async rpc(fn) { return { data: fn === 'ws_bootstrap' ? { ok: true, user: { staff_id: 'S001', name: '홍길동', part: '전방파트', role: '소장' }, toastSec: 2.6, needSign: false, docs: { signs: 7 }, fire: { counts: { ok: 120, bad: 2, wait: 30, miss: 0, total: 152 } } } : { ok: true }, error: null }; },
  storage: { from() { return { getPublicUrl(p) { return { data: { publicUrl: p } }; } }; } } }; } };`;
http.createServer((req, res) => {
  const f = path.join(FM, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(FM) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', /\.html$/.test(f) ? 'text/html; charset=utf-8' : 'application/javascript'); res.end(fs.readFileSync(f));
}).listen(PORT);

// 지침 쪽 그림 흉내 (글 줄 + 노란 표시)
const lines = ['3.4 방화구획 및 관통부 처리', '가. 매장 경계벽이 방화구획인 경우 배관·덕트·전선 관통부는', '    내화충전재로 틈새 없이 메운다.', '나. 방화구획 관통부 처리 후 감리 확인 사진을 제출한다.',
  '다. 방화셔터 하강 구역에는 집기·진열대를 두지 않는다.', '라. 천장 내부 방화구획 벽체는 슬래브 하부까지 연장한다.', '', '3.5 감지기 및 스프링클러', '가. 천장 높이 변경 시 감지기 위치를 재배치한다.', '나. 스프링클러 헤드는 살수 장애가 없도록 한다.'];
const PAGE = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="848" viewBox="0 0 600 848"><rect width="600" height="848" fill="#fff"/>' +
  '<text x="48" y="60" font-size="13" fill="#888" font-family="sans-serif">롯데백화점 Tenant 시설공사 지침 · 소방</text>' +
  lines.map((t, i) => '<text x="48" y="' + (120 + i * 30) + '" font-size="' + (/^\d/.test(t) ? 16 : 14) + '" font-weight="' + (/^\d/.test(t) ? 700 : 400) + '" fill="#222" font-family="sans-serif">' + t.replace(/&/g, '&amp;') + '</text>').join('') +
  Array.from({ length: 14 }, (_, i) => '<rect x="48" y="' + (440 + i * 26) + '" width="' + (420 + (i * 37) % 80) + '" height="9" rx="3" fill="#E3E6EA"/>').join('') +
  '<text x="300" y="820" font-size="12" fill="#999" text-anchor="middle" font-family="sans-serif">- 12 -</text></svg>');

const CSS = `
.sp{max-width:1400px;margin:0 auto;padding:16px}
.spbar{display:flex;gap:10px;align-items:center}
.spq{position:relative;flex:1}.spq svg{position:absolute;left:14px;top:15px;color:var(--muted)}
.spq .inp{height:50px;padding-left:44px;border:2px solid var(--blue);font-size:17px}
.spf{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.spf button{white-space:nowrap;flex:none;min-height:36px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:13px;color:var(--sub)}
.spf button span{color:var(--muted);margin-left:2px}.spf button.on{background:var(--ink);border-color:var(--ink);color:#fff;font-weight:500}.spf button.on span{color:#C9D1DB}
.spf .old{border-style:dashed;margin-left:auto}
.spg{display:grid;grid-template-columns:240px minmax(0,1fr) minmax(0,1.1fr);gap:16px;margin-top:14px;align-items:start}
.spside{display:flex;flex-direction:column;gap:12px}.spside .card{padding:14px}.spside h3{font-size:13px;margin:0 0 8px;color:var(--sub)}
.spchips{display:flex;flex-wrap:wrap;gap:6px}.spchips button{min-height:32px;padding:0 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);font-size:13px}
.spg li{list-style:none;margin:0 0 8px;font-size:13px;line-height:1.5}.spg ul{padding:0;margin:0}
.srct{display:inline-block;font-size:11px;font-weight:500;border-radius:4px;padding:2px 6px;white-space:nowrap}
.s0{background:var(--blue-bg);color:var(--blue-d)}.s1{background:var(--orange-bg);color:var(--orange)}.s2{background:var(--green-bg);color:var(--green)}
.sphit{background:var(--card);border:1px solid var(--line2);border-radius:10px;padding:12px 14px;margin-bottom:8px}
.sphit.on{border:2px solid var(--blue);padding:11px 13px;box-shadow:0 0 0 3px var(--blue-bg)}
.pgb{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;border-radius:6px;background:var(--ink);color:#fff;font-size:13px;border:0}
.mk{background:#FFE58A;color:#18202B;font-weight:500;padding:0 2px;border-radius:2px}
.spwhere{font-size:12px;color:var(--sub);margin-top:6px}.sptxt{font-size:14px;line-height:1.7;margin-top:4px}
.spact{display:flex;gap:6px;margin-top:8px}.spact .btn{flex:1}
.sppv{position:sticky;top:12px;background:var(--card);border:1px solid var(--line2);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;height:calc(100vh - 210px)}
.sppv-h{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line3)}
.sppv-b{flex:1;overflow:auto;background:#E9ECF0;padding:12px}
.sppg{position:relative;width:100%;max-width:560px;margin:0 auto;box-shadow:0 2px 8px rgba(0,0,0,.15)}.sppg img{display:block;width:100%}
.hl{position:absolute;background:rgba(255,214,0,.32);outline:2px solid #E8A200;border-radius:3px}
.sppv-f{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--line3)}
.spnote{font-size:12px;color:var(--muted);line-height:1.6}
@media(max-width:760px){.sp{padding:12px}.pcon{display:none}.sppv-h{flex-wrap:wrap}.sppv-h b{flex-basis:calc(100% - 90px)!important}.spg{grid-template-columns:1fr}.spside,.sppv{display:none}.spf{flex-wrap:nowrap;overflow-x:auto}.spf .old{margin-left:0}}
.sheet{position:fixed;inset:0;background:rgba(24,32,43,.55);z-index:60;display:flex;align-items:flex-end}
.sheet .sppv{position:static;display:flex;width:100%;height:88vh;border-radius:16px 16px 0 0}
`;
const SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const HITS = [
  ['s0', '시설공사', 12, '소방 · 3.4 방화구획 및 관통부 처리', '…매장 경계벽이 <span class="mk">방화구획</span>인 경우 배관·덕트·전선 관통부는 내화충전재로 틈새 없이 메운다…'],
  ['s0', '시설공사', 12, '소방 · 3.4 방화구획 및 관통부 처리', '…<span class="mk">방화구획</span> 관통부 처리 후 감리 확인 사진을 제출한다…'],
  ['s1', '통합안전', 31, '방화및방염관련 · 2. 방화구획', '…공사 중 <span class="mk">방화구획</span>을 임시로 해체할 때에는 방재실과 협의하고 작업 종료 후 즉시 복구한다…'],
  ['s2', '설비공사', 8, '설비공사 지침 6/10 · 덕트', '…<span class="mk">방화구획</span>을 관통하는 덕트에는 방화댐퍼를 설치하고 점검구를 둔다…'],
  ['s0', '시설공사', 27, '전기 · 5.2 배선', '…<span class="mk">방화구획</span> 관통 배선은 금속관 또는 내화충전 처리한다…']];
const hit = (x, i) => '<div class="sphit' + (i === 0 ? ' on' : '') + '"><div style="display:flex;align-items:center;gap:8px"><button class="pgb">' + SEARCH.replace(/18/g, '13') + 'p.' + x[2] + '</button><span class="srct ' + x[0] + '">' + x[1] + '</span></div>' +
  '<div class="spwhere">' + x[3] + '</div><div class="sptxt">' + x[4] + '</div>' +
  '<div class="spact"><button class="btn sm">쪽 크게 보기</button><button class="btn sm pri">참조 복사 (' + x[1] + ', p.' + x[2] + ')</button></div></div>';
const PV = '<div class="sppv"><div class="sppv-h"><span class="srct s0">시설공사</span><b style="font-size:14px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">소방 · 3.4 방화구획 및 관통부 처리</b><span class="spnote pcon">PDF 12쪽</span>' +
  '<button class="btn sm" style="margin-left:auto">−</button><span class="spnote">100%</span><button class="btn sm">+</button><button class="btn sm">PDF 원본</button><button class="btn sm" aria-label="닫기">✕</button></div>' +
  '<div class="sppv-b"><div class="sppg"><img src="' + PAGE + '"><span class="hl" style="left:7%;top:15.6%;width:82%;height:6.6%"></span></div></div>' +
  '<div class="sppv-f"><span class="spnote">노란 표시 = 검색어가 있는 줄</span><button class="btn sm pri" style="margin-left:auto">참조 복사 (시설공사, p.12)</button></div></div>';
const SCREEN = '<div class="sp"><div class="spbar"><label class="spq">' + SEARCH + '<input class="inp" value="방화구획" aria-label="검색어"></label></div>' +
  '<div class="spf"><button class="on">전체 <span>47</span></button><button>시설공사 <span>21</span></button><button>통합안전 <span>14</span></button><button>설비공사 <span>12</span></button><button class="old">이전 판 포함</button></div>' +
  '<div class="spg"><aside class="spside">' +
  '<div class="card"><h3>자주 찾는 말</h3><div class="spchips">' + ['방화구획', '방화셔터', '감지기', '방염', '분전반', '스프링클러', '제연'].map(w => '<button>' + w + '</button>').join('') + '</div></div>' +
  '<div class="card"><h3>검색하는 지침 (3)</h3><ul><li><span class="srct s0">시설공사</span> 롯데백화점 Tenant 시설공사 지침 (2024.07) · 86쪽</li><li><span class="srct s1">통합안전</span> 통합안전관리지침 · 52쪽</li><li><span class="srct s2">설비공사</span> Tenant 설비공사 지침 · 40쪽</li></ul>' +
  '<div class="spnote" style="margin-top:6px">지침 추가·개정은 도면협의 앱 <b>지침 관리</b>에서 합니다. 여기서는 읽기만 합니다.</div></div>' +
  '<div class="spnote">비슷한 말도 찾음: 방화 구획, 방화벽</div></aside>' +
  '<section><div class="spnote" style="margin-bottom:8px">결과 <b style="color:var(--ink)">47건</b><span class="pcon"> · 결과를 누르면 오른쪽에 그 쪽이 보입니다</span></div>' + HITS.map(hit).join('') + '</section>' + PV + '</div></div>';

(async () => {
  const b = await chromium.launch();
  const shot = async (vp, name, fn) => {
    const c = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
    await c.route('https://cdn.jsdelivr.net/npm/@supabase/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE }));
    await c.route(/fonts\.googleapis|cdnjs/, r => r.fulfill({ body: '' }));
    await c.addInitScript(t => localStorage.setItem('ws_token', t), TOK);
    const p = await c.newPage(); await p.goto('http://localhost:' + PORT + '/ws/app.html'); await p.locator('.grid6').waitFor();
    await p.addStyleTag({ content: CSS }); await p.evaluate(fn, { SCREEN, PV, SEARCH });
    await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, name) }); await c.close();
  };
  const tileFn = ({ SEARCH }) => { const t = document.querySelectorAll('.grid6 .tile')[3]; t.classList.remove('soon'); t.innerHTML = '<span class="ico">' + SEARCH.replace(/18/g, '20') + '</span><b>시방서 검색</b><small>지침 3개 · 186쪽</small>'; t.style.outline = '3px solid #E8A200'; };
  const screenFn = ({ SCREEN }) => { document.getElementById('app').innerHTML = topbar('업무지원 ›', '시방서 검색') + SCREEN; };
  await shot({ width: 1280, height: 720 }, '시안1_메인_시방서검색칸.png', tileFn);
  await shot({ width: 1440, height: 900 }, '시안2_PC_검색과_쪽보기.png', screenFn);
  await shot({ width: 390, height: 844 }, '시안3_휴대폰_검색.png', screenFn);
  await shot({ width: 390, height: 844 }, '시안4_휴대폰_쪽보기.png', (a) => { document.getElementById('app').innerHTML = topbar('업무지원 ›', '시방서 검색') + a.SCREEN + '<div class="sheet">' + a.PV + '</div>'; });
  await b.close(); process.exit(0);
})();
