/* ── 시방서 검색 (결정 140, WS_시방서검색.md): 도면협의 지침 검색 자료를 읽기만. 검색 방식은 fm/dw/app.html searchGuide 와 같음 ── */
const SP_KW = ['방화구획', '방화셔터', '감지기', '방염', '분전반', '스프링클러', '제연'];
async function openSpec() {
  S.sp = S.sp || { q: '', off: {}, old: false, sel: null, zoom: 1, big: false, imgs: {}, hits: [] };
  go('spec');
  try {
    if (S.sp.boot) {}
    else if (window.WS_PUB) { S.sp.boot = await call('specPubBoot'); S.sp.idx = []; }   // 외부용(spec.html): 색인은 내려주지 않고 서버에서 찾음 (결정 146)
    else { const [b, x] = await Promise.all([call('specBoot'), call('specIndex')]); S.sp.boot = b; S.sp.idx = x.entries || []; }
  } catch (e) { S.sp.err = '시방서를 불러오지 못했습니다. 다시 열어 주세요.'; }
  if (S.view === 'spec') { render(); const i = $('spQ'); if (i && !('ontouchstart' in window)) i.focus(); }
}
const spG = () => (S.sp.boot && S.sp.boot.guides) || [];
const spGuide = id => spG().find(g => g.id === id) || { id, short: '지침', title: '지침', pages: 0 };
const spNo = id => Math.max(0, spG().findIndex(g => g.id === id)) % 4;
const spTag = id => { const g = spGuide(id); return '<span class="srct s' + spNo(id) + '">' + h(g.short) + '</span>' + (g.archived ? '<span class="srct sold">이전 판</span>' : ''); };
const spRef = e => { const g = spGuide(e.d); return e.lp ? '(' + (e.s || g.short) + ' ' + e.lp + ', p.' + e.p + ')' : '(' + g.short + (e.s && e.s !== g.short ? ' ' + e.s : '') + ', p.' + e.p + ')'; };
const spWhere = e => { const g = spGuide(e.d); return (e.lp ? (e.s || g.short) + ' ' + e.lp : (e.s && e.s !== g.short ? e.s : '')) + (e.h ? ' · ' + e.h : ''); };
const spCmp = w => String(w).toLowerCase().replace(/\s+/g, '');
function spTerms(q) {
  const out = [q], seen = [spCmp(q)];
  (S.sp.boot.synonyms || []).forEach(g => { if (g.some(w => spCmp(w) === seen[0])) g.forEach(w => { if (seen.indexOf(spCmp(w)) < 0) { seen.push(spCmp(w)); out.push(w); } }); });
  return out;
}
/** 글 안에서 찾기 (띄어쓰기 무시까지) → [시작, 길이] */
function spFind(t, term) {
  const at = t.toLowerCase().indexOf(term.toLowerCase());
  if (at >= 0) return [at, term.length];
  const cq = spCmp(term), map = []; let s = '';
  for (let i = 0; i < t.length; i++) if (!/\s/.test(t[i])) { s += t[i].toLowerCase(); map.push(i); }
  const k = cq ? s.indexOf(cq) : -1;
  return k < 0 ? null : [map[k], map[k + cq.length - 1] + 1 - map[k]];
}
function spSearch() {
  const q = S.sp.q.trim(), counts = {}, out = [], skip = {};
  spG().forEach(g => { counts[g.id] = 0; if (g.archived && !S.sp.old) skip[g.id] = true; });
  S.sp.terms = q ? spTerms(q) : [];
  if (!q) return { hits: out, counts };
  if (S.sp.cnt) Object.assign(counts, S.sp.cnt);   // 외부용: 지침별 건수는 서버가 셈
  for (const e of S.sp.idx || []) {
    if (skip[e.d]) continue;
    const t = String(e.t || ''); let f = null;
    for (const w of S.sp.terms) { f = spFind(t, w); if (f) break; }
    if (!f) { const meta = spCmp((e.h || '') + ' ' + (e.l || '')); if (!S.sp.terms.some(w => meta.indexOf(spCmp(w)) >= 0)) continue; }
    if (!S.sp.cnt) counts[e.d] = (counts[e.d] || 0) + 1;
    if (!S.sp.off[e.d] && out.length < 80) out.push({ e, at: f ? f[0] : -1, len: f ? f[1] : 0 });
  }
  return { hits: out, counts };
}
function spSnip(x) {
  const t = String(x.e.t || '');
  if (x.at < 0) return h(t.length > 150 ? t.slice(0, 150) + '…' : t);
  const s = Math.max(0, x.at - 60), en = Math.min(t.length, x.at + x.len + 90);
  return (s > 0 ? '…' : '') + h(t.slice(s, x.at)) + '<span class="mk">' + h(t.slice(x.at, x.at + x.len)) + '</span>' + h(t.slice(x.at + x.len, en)) + (en < t.length ? '…' : '');
}
/** 노란 상자: 검색어가 걸친 글자 위치 상자 (fm/dw hlBoxes) */
function spBoxes(x) {
  const b = x.e.b || [];
  if (!b.length || x.at < 0) return b;
  const t = String(x.e.t), cAt = t.slice(0, x.at).replace(/\s+/g, '').length, cLen = Math.max(1, t.slice(x.at, x.at + x.len).replace(/\s+/g, '').length);
  const out = b.filter((box, i) => box[4] < cAt + cLen && (i + 1 < b.length ? b[i + 1][4] : 1e9) > cAt);
  return out.length ? out : [b[0]];
}
function renderSpec() {
  const top = window.WS_PUB ? '<header class="top"><div class="top-in"><div class="ttl"><small class="spteam">잠실점 에비뉴엘 시설팀</small><b>시방서 검색</b></div><span class="sppub">공사 지침 · 읽기 전용</span></div></header>' : topbar('업무지원 ›', '시방서 검색');
  if (S.sp.err) return top + '<div class="wrap"><div class="banner b-red">' + h(S.sp.err) + '</div></div>';
  if (!S.sp.boot) return top + '<div class="wrap"><div class="banner b-gray">시방서를 불러오는 중…</div></div>';
  const cur = spG().filter(g => !g.archived);
  return top + '<div class="sp">' +
    '<label class="spq">' + ICON.search + '<input id="spQ" class="inp" aria-label="검색어" placeholder="예: 방화구획, 감지기, 방염" autocomplete="off" value="' + h(S.sp.q) + '" oninput="spQ(this.value)" onkeydown="if(event.key===\'Escape\')spQ(this.value=\'\')"></label>' +
    '<div class="spf" id="spF" role="tablist" aria-label="지침 고르기"></div>' +
    '<div class="spg"><aside class="spside">' +
    '<div class="card"><h3>자주 찾는 말</h3><div class="spchips">' + SP_KW.map(w => '<button type="button" onclick="spQ(\'' + w + '\',1)">' + w + '</button>').join('') + '</div></div>' +
    '<div class="card"><h3>검색하는 지침 (' + cur.length + ')</h3>' + (cur.length ? '<div id="spGL"></div>' : '<div class="spnote">아직 없습니다.</div>') +
    '<div class="spnote" style="margin-top:var(--sp-1)">' + (window.WS_PUB ? '문의: 에비뉴엘 시설팀 (롯데백화점 지침 최신판)' : '지침 추가·개정은 도면협의 앱 <b>지침 관리</b>에서 합니다. 여기서는 읽기만 합니다.') + '</div></div>' +
    '<div class="spnote" id="spSyn"></div></aside>' +
    '<section id="spRes" aria-live="polite"></section><div id="spPv" class="sppvw"></div></div></div>' +
    '<div id="spBig"></div>';
}
function spQ(v, setBox) { S.sp.q = v; S.sp.sel = null; if (setBox) $('spQ').value = v; spGo(); }
/** 외부용(spec.html)은 서버에서 찾아 받은 뒤 그림 — 전체 색인을 내려주지 않음, 고른 지침만 최대 80건 (결정 146) */
let spT = 0, spN = 0;
function spGo() {
  if (!window.WS_PUB) return spDraw();
  clearTimeout(spT);
  const q = S.sp.q.trim(), n = ++spN;
  if (!q) { S.sp.idx = []; S.sp.cnt = null; return spDraw(); }
  spT = setTimeout(async () => {
    let r = null; try { r = await call('specPubSearch', q, spG().filter(g => !S.sp.off[g.id]).map(g => g.id)); } catch (e) {}
    if (n !== spN) return;   // 그사이 검색어가 바뀜
    S.sp.idx = (r && r.entries) || []; S.sp.cnt = (r && r.counts) || {}; spDraw();
  }, 250);
}
function spDraw() {
  const r = spSearch(), hits = S.sp.hits = r.hits, f = $('spF'), box = $('spRes');
  if (!box) return;
  const hasOld = spG().some(g => g.archived);
  const vis = spG().filter(g => S.sp.old || !g.archived), on = vis.filter(g => !S.sp.off[g.id]), gl = $('spGL');
  // 휴대폰: 위 단추를 눌러 켜고 끔 / PC: 왼쪽 「검색하는 지침」 체크박스 (사용자 11-17)
  f.innerHTML = vis.map(g => '<button type="button" aria-pressed="' + !S.sp.off[g.id] + '" class="' + (S.sp.off[g.id] ? '' : 'on') + '" onclick="spOn(\'' + h(g.id) + '\')">' + (S.sp.off[g.id] ? '' : '✓ ') + h(g.short) + (g.archived ? ' (이전 판)' : '') + ' <span>' + (r.counts[g.id] || 0) + '</span></button>').join('') +
    (hasOld ? '<button type="button" class="old' + (S.sp.old ? ' on' : '') + '" aria-pressed="' + S.sp.old + '" onclick="spOld()">' + (S.sp.old ? '✓ ' : '') + '이전 판 포함</button>' : '');
  if (gl) gl.innerHTML = vis.map(g => '<label class="spck"><input type="checkbox" data-g="' + h(g.id) + '"' + (S.sp.off[g.id] ? '' : ' checked') + ' onchange="spOn(this.dataset.g)"><span class="spck-t">' + spTag(g.id) + ' ' + h(g.title) + (g.pages ? ' · ' + g.pages + '쪽' : '') + '</span><span class="spck-n">' + (S.sp.q.trim() ? r.counts[g.id] || 0 : '') + '</span></label>').join('') +
    (hasOld ? '<label class="spck old"><input type="checkbox"' + (S.sp.old ? ' checked' : '') + ' onchange="spOld()"><span class="spck-t">이전 판도 검색</span></label>' : '');
  $('spSyn').textContent = S.sp.terms.length > 1 ? '비슷한 말도 찾음: ' + S.sp.terms.slice(1).join(', ') : '';
  if (S.sp.sel == null && hits.length) S.sp.sel = 0;
  if (!spG().length) box.innerHTML = '<div class="banner b-gray">검색할 지침이 아직 없습니다. 도면협의 앱의 <b>지침 관리</b>에서 지침 PDF로 색인을 만들어 주세요.</div>';
  else if (!on.length) box.innerHTML = '<div class="banner b-gray">검색할 지침을 하나 이상 고르세요.</div>';
  else if (!S.sp.q.trim()) box.innerHTML = '<div class="spnote">검색어를 넣거나 자주 찾는 말을 누르세요.</div>';
  else if (!hits.length) box.innerHTML = '<div class="banner b-gray">「' + h(S.sp.q) + '」에 해당하는 내용이 없습니다.</div>';
  else box.innerHTML = '<div class="spnote" style="margin-bottom:var(--sp-2)">결과 <b style="color:var(--ink)">' + hits.length + (hits.length >= 80 ? '+' : '') + '건</b><span class="pcon"> · 결과를 누르면 오른쪽에 그 쪽이 보입니다</span></div>' +
    hits.map((x, i) => '<div class="sphit' + (i === S.sp.sel ? ' on' : '') + '" onclick="spSel(' + i + ')"><div class="sphd"><button type="button" class="pgb" onclick="event.stopPropagation();spSel(' + i + ',1)" aria-label="' + x.e.p + '쪽 크게 보기">' + ICON.search + 'p.' + x.e.p + '</button>' + spTag(x.e.d) + '</div>' +
      (spWhere(x.e) ? '<div class="spwhere">' + h(spWhere(x.e)) + '</div>' : '') + '<div class="sptxt">' + spSnip(x) + '</div>' +
      '<div class="spact"><button type="button" class="btn sm" onclick="event.stopPropagation();spSel(' + i + ',1)">쪽 크게 보기</button><button type="button" class="btn sm pri" onclick="event.stopPropagation();spCopy(' + i + ')">참조 복사 ' + h(spRef(x.e)) + '</button></div></div>').join('');
  spFit(); spPv();
}
function spOn(id) { S.sp.off[id] = !S.sp.off[id]; S.sp.sel = null; spGo(); }
function spOld() { S.sp.old = !S.sp.old; S.sp.sel = null; spGo(); }
function spSel(i, big) {
  S.sp.sel = i; S.sp.big = !!big;
  document.querySelectorAll('#spRes .sphit').forEach((el, k) => el.classList.toggle('on', k === i));
  spPv();
}
function spZoom(d) { S.sp.zoom = Math.max(0.75, Math.min(2.5, S.sp.zoom + d)); spPv(); }
function spBigClose() { S.sp.big = false; spPv(); }
function spCopy(i) {
  const x = S.sp.hits[i]; if (!x) return;
  const ref = spRef(x.e);
  (navigator.clipboard ? navigator.clipboard.writeText(ref) : Promise.reject()).then(() => toast('복사했습니다 ' + ref), () => toast('복사하지 못했습니다. 길게 눌러 직접 고르세요: ' + ref));
}
function spImg(d, p) {
  const k = d + ':' + p;
  if (!S.sp.imgs[k]) S.sp.imgs[k] = spGuide(d).images === false ? Promise.resolve({ img: '', pdf: '' }) : call(window.WS_PUB ? 'specPubPage' : 'specPage', d, p).catch(() => { delete S.sp.imgs[k]; return { img: '', pdf: '' }; });
  return S.sp.imgs[k];
}
/** 쪽 보기: PC는 오른쪽 칸(늘 떠 있음), 「쪽 크게 보기」·휴대폰은 화면 위 창 */
function spPv() {
  const side = $('spPv'), big = $('spBig'), x = S.sp.hits[S.sp.sel];
  if (!side || !big) return;
  side.innerHTML = x ? spPvHtml(x, false) : '';
  big.innerHTML = x && S.sp.big ? '<div class="spsheet" onclick="if(event.target===this)spBigClose()" role="dialog" aria-modal="true" aria-label="쪽 크게 보기">' + spPvHtml(x, true) + '</div>' : '';
  const sel = S.sp.sel;
  if (!x) return;
  spImg(x.e.d, x.e.p).then(r => {
    if (S.sp.sel !== sel || S.sp.hits[sel] !== x) return;
    document.querySelectorAll('.sppv').forEach(pv => {
      const b = pv.querySelector('.sppv-b'), o = pv.querySelector('.spo');
      if (o) { o.style.display = r.pdf ? '' : 'none'; o.onclick = () => window.open(r.pdf, '_blank'); }
      if (!r.img) { b.innerHTML = '<div class="sppv-t"><div class="spnote" style="margin-bottom:var(--sp-2)">이 쪽의 그림이 없습니다. 도면협의 앱 <b>지침 관리</b>에서 이 지침을 다시 만들면 생깁니다.</div>' + spSnip(x) + '</div>'; return; }
      b.innerHTML = '<div class="sppg"><img alt="' + h(spGuide(x.e.d).short + ' ' + x.e.p + '쪽') + '" src="' + h(r.img) + '">' +
        spBoxes(x).map(z => '<span class="hl" style="left:' + ((z[0] - 0.004) * 100) + '%;top:' + ((z[1] - 0.004) * 100) + '%;width:' + ((z[2] - z[0] + 0.008) * 100) + '%;height:' + ((z[3] - z[1] + 0.008) * 100) + '%"></span>').join('') + '</div>';
      const img = b.querySelector('img'), place = () => {   // 100% = 쪽 한 장이 칸 안에 다 들어오는 크기, + 로 키우면 그때 스크롤 (사용자 11-17)
        const fit = Math.min(b.clientWidth - 24, (b.clientHeight - 24) * (img.naturalWidth || 600) / (img.naturalHeight || 848));
        b._fit = Math.max(200, fit);
        b.querySelector('.sppg').style.width = Math.round(b._fit * S.sp.zoom) + 'px';
        const f = b.querySelector('.hl'); b.scrollTop = f && S.sp.zoom > 1 ? Math.max(0, f.offsetTop - b.clientHeight * 0.3) : 0;
        b.classList.toggle('pan', b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight);
      };
      if (img.complete) place(); else img.onload = place;
    });
  });
}
/** PC 쪽 칸: 아래 끝을 「뒤로」 버튼 5px 위까지 (뒤로 줄 위 여백 5px), 결과를 내려도 칸은 그 자리에 */
function spFit() {
  const w = $('spPv'), bar = document.querySelector('.sp ~ .backbar');
  if (!w || !w.offsetParent) return;
  const gap = bar ? bar.offsetHeight : 16, top = w.parentElement.getBoundingClientRect().top + scrollY, H = Math.max(420, innerHeight - top - gap);
  w.style.setProperty('--sppvh', H + 'px'); w.style.top = (innerHeight - gap - H) + 'px';
}
window.addEventListener('resize', () => { if (S.view === 'spec' && S.sp && S.sp.boot) { spFit(); spPv(); } });
// 확대한 쪽을 마우스 왼쪽 버튼으로 끌어서 움직임 (터치는 브라우저가 그대로 처리)
document.addEventListener('mousedown', e => {
  const b = e.button === 0 && e.target.closest && e.target.closest('.sppv-b.pan');
  if (!b) return;
  e.preventDefault();
  const x = e.clientX, y = e.clientY, l = b.scrollLeft, t = b.scrollTop;
  const move = m => { b.scrollLeft = l - (m.clientX - x); b.scrollTop = t - (m.clientY - y); };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); b.classList.remove('drag'); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); b.classList.add('drag');
});
// 안드로이드·아이패드: 쪽 칸 안에서만 두 손가락으로 확대·축소 (한 손가락 이동은 브라우저, 화면 전체 확대는 touch-action으로 막음)
document.addEventListener('touchstart', e => {
  const b = e.touches.length === 2 && e.target.closest && e.target.closest('.sppv-b'), g = b && b.querySelector('.sppg');
  if (!g || !b._fit) return;
  const T = e.touches, dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY), r = b.getBoundingClientRect();
  const d0 = dist(T), w0 = g.offsetWidth, mx = (T[0].clientX + T[1].clientX) / 2 - r.left, my = (T[0].clientY + T[1].clientY) / 2 - r.top;
  const px = b.scrollLeft + mx, py = b.scrollTop + my;   // 두 손가락 가운데에 있던 곳을 그 자리에 붙잡아 둠
  const move = m => {
    if (m.touches.length < 2) return;
    m.preventDefault();
    S.sp.zoom = Math.max(0.75, Math.min(2.5, w0 * dist(m.touches) / d0 / b._fit));
    const w = Math.round(b._fit * S.sp.zoom); g.style.width = w + 'px';
    b.scrollLeft = px * w / w0 - mx; b.scrollTop = py * w / w0 - my;
  };
  const end = () => {
    ['touchmove', 'touchend', 'touchcancel'].forEach((k, i) => b.removeEventListener(k, i ? end : move));
    const n = b.closest('.sppv').querySelector('.sptools .spnote'); if (n) n.textContent = Math.round(S.sp.zoom * 100) + '%';
    b.classList.toggle('pan', b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight);
  };
  b.addEventListener('touchmove', move, { passive: false }); b.addEventListener('touchend', end); b.addEventListener('touchcancel', end);
}, { passive: true });
document.addEventListener('gesturestart', e => { if (e.target.closest && e.target.closest('.sppv-b')) e.preventDefault(); });   // 아이패드 사파리 화면 전체 확대 막기
function spPvHtml(x, big) {
  return '<div class="sppv' + (big ? ' big' : '') + '"><div class="sppv-h">' + spTag(x.e.d) + '<b class="spttl">' + h(spWhere(x.e) || spGuide(x.e.d).title) + '</b><span class="spnote pcon">PDF ' + x.e.p + '쪽</span>' +
    '<span class="sptools"><button type="button" class="btn sm" onclick="spZoom(-0.25)" aria-label="작게">−</button><span class="spnote">' + Math.round(S.sp.zoom * 100) + '%</span><button type="button" class="btn sm" onclick="spZoom(0.25)" aria-label="크게">+</button>' +
    '<button type="button" class="btn sm spo" style="display:none">PDF 원본</button>' + (big ? '<button type="button" class="btn sm" onclick="spBigClose()" aria-label="닫기">' + ICON.x + '</button>' : '') + '</span></div>' +
    '<div class="sppv-b"><div class="spnote" style="padding:var(--sp-8);text-align:center">쪽 그림을 불러오는 중…</div></div>' +
    '<div class="sppv-f"><button type="button" class="btn sm pri" onclick="spCopy(' + S.sp.sel + ')">참조 복사 ' + h(spRef(x.e)) + '</button></div></div>';
}
// PC 마우스 오른쪽 버튼 막기 (휴대폰 길게 누르기는 그대로)
if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) document.addEventListener('contextmenu', e => e.preventDefault());
