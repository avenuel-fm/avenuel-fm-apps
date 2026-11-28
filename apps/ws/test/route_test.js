// 길찾기 계산 시험 (결정 246 · 바닥 안 최단 결정 308): 입구는 매장 변 한가운데 · 바닥 안에서 가로·세로로 가장 짧은 길 · 중심선 안 씀
// 실행: node test/route_test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = { mapContainer: { addEventListener() {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fm', 'map', 'js', 'cad', 'routeFinder.js'), 'utf8'), ctx);
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ortho = pts => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.1 || Math.abs(p.y - pts[i - 1].y) < 0.1);
const len = pts => pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
const run = (a, b, others, cor) => JSON.parse(JSON.stringify(ctx.routeCompute(a, b, others, cor)));
const inPoly = (p, poly) => ctx.rtInPoly(p, poly);
const insideAll = (pts, polys, step = 2) => pts.every((p, i) => {   // 선 위 점들이 바닥 안(경계 1 허용)
  if (!i) return true; const q = pts[i - 1], L = Math.hypot(p.x - q.x, p.y - q.y), n = Math.max(1, Math.ceil(L / step));
  for (let k = 0; k <= n; k++) { const x = q.x + (p.x - q.x) * k / n, y = q.y + (p.y - q.y) * k / n;
    if (![[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => polys.some(pl => inPoly({ x: x + dx, y: y + dy }, pl)))) return false; }
  return true;
});

// ㄱ자 복도: 가로 0~1000 (y 100~160), 세로 (x 940~1000, y 100~600)
const L = [{ x: 0, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 600 }, { x: 940, y: 600 }, { x: 940, y: 160 }, { x: 0, y: 160 }];
const A = rect(100, 0, 200, 100);      // 복도 위쪽 매장, 아래 변이 복도에 붙음
const B = rect(700, 160, 200, 120);    // 복도 아래쪽 매장
const C = rect(780, 300, 160, 200);    // 세로 복도 왼쪽 매장 (오른쪽 변이 복도)
let r = run(A, B, [C], [L]);
ok(r.ok, '입구 → 복도 → 입구 길을 찾음');
ok(r.ok && ortho(r.points), '선이 가로·세로뿐 (대각선 없음)');
ok(r.ok && Math.abs(r.points[0].x - 200) < 0.1 && Math.abs(r.points[0].y - 100) < 0.1, '출발은 복도 쪽 변의 한가운데(200,100)');
const e = r.points[r.points.length - 1];
ok(e && Math.abs(e.x - 800) < 0.1 && Math.abs(e.y - 160) < 0.1, '도착은 복도 쪽 변의 한가운데(800,160)');
ok(r.ok && r.points.length === 4 && Math.abs(len(r.points) - 660) < 2, '가장 짧은 길 · 꺾임 두 번 (' + (r.ok && len(r.points).toFixed(1)) + ')');
const midY = r.ok ? r.points[1].y : 0;
ok(midY > 115 && midY < 145, '같은 길이면 복도 가운데 쪽 (y=' + midY + ')');
// 꺾인 복도 지나기: A → C (세로 복도 쪽)
r = run(A, C, [B], [L]);
ok(r.ok && ortho(r.points), 'ㄱ자로 꺾어 지나감');
ok(r.ok && insideAll(r.points.slice(1, -1), [L]), '선이 바닥 밖으로 안 나감');
const inside = (p, poly) => p.x > poly[0].x + 0.5 && p.x < poly[1].x - 0.5 && p.y > poly[0].y + 0.5 && p.y < poly[2].y - 0.5;
ok(r.ok && r.points.every(p => ![A, B, C].some(s => inside(p, s))), '어느 매장 안쪽 점도 지나지 않음');
// 복도 없음 · 끊긴 복도
ok(run(A, B, [], []).ok === false, '복도가 없으면 안내 문구');
const far = rect(3000, 100, 500, 60);
r = run(A, B, [], [L, far]); ok(r.ok, '떨어진 다른 복도가 있어도 길은 찾음');
const D = rect(3100, 160, 100, 100); r = run(A, D, [], [L, far]); ok(r.ok === false && /끊겨/.test(r.error || ''), '이어지지 않은 복도는 「끊겨 있습니다」 (' + (r.error || 'ok') + ')');

// ── 겹치거나 어긋난 바닥 · 좁은 바닥 (결정 256) ──
const V1 = rect(100, 0, 60, 600), V2 = rect(140, 0, 60, 600);        // 겹친 두 세로 복도
r = run(rect(0, 100, 100, 100), rect(200, 400, 100, 100), [], [V1, V2]);
ok(r.ok && ortho(r.points), '겹친 두 복도도 길이 이어짐 (직각)');
const H = rect(0, 300, 400, 6), Vn = rect(200, 0, 6, 296);              // 폭 6의 좁은 복도, 끝이 4 모자라 안 닿음 (작은 틈은 건넘)
r = run(rect(230, 100, 50, 60), rect(100, 306, 60, 60), [], [H, Vn]);
ok(r.ok && ortho(r.points), '폭이 좁고 끝이 조금 못 닿은 복도도 길이 이어짐');
const M1 = rect(0, 100, 300, 60), M2 = rect(400, 100, 300, 60);       // 같은 줄인데 100 떨어진 복도 → 끊김
r = run(rect(50, 0, 100, 100), rect(450, 160, 100, 100), [], [M1, M2]);
ok(r.ok === false && /끊겨/.test(r.error || ''), '사이가 바닥이 아닌 빈 곳은 건너지 않고 「끊겨 있습니다」');
const M3 = rect(0, 100, 300, 60), M4 = rect(300, 100, 300, 60);       // 딱 맞닿은 복도는 이어짐
r = run(rect(50, 0, 100, 100), rect(400, 160, 100, 100), [], [M3, M4]);
ok(r.ok && ortho(r.points), '맞닿은 같은 줄 복도는 이어짐');
const U = rect(0, 100, 100, 100);
const r1 = run(U, rect(200, 400, 100, 100), [], [V1, V2]), r2 = run(U, rect(200, 300, 100, 100), [], [V1, V2]);
ok(r1.ok && r2.ok, '한 기능실에서 두 매장으로 가는 선이 모두 그려짐');

// ── 사용자 사례 (11-26): 중심선을 따라 위로 돌아가던 것 → 바닥 안 최단 ──
// 가로 띠(EPS 앞) y 270~330 · 세로 복도 x 410~560 (위로 길게 0~700) · 위쪽 대각선 갈래
const band = rect(100, 270, 400, 60), vert = rect(410, 0, 150, 700), diagArm = [{ x: 560, y: 0 }, { x: 760, y: 0 }, { x: 600, y: 300 }, { x: 560, y: 300 }];
const EPS = rect(130, 330, 90, 60), CAR = rect(200, 560, 208, 150), CHA = rect(100, 0, 300, 240), SHO = rect(280, 330, 128, 110);
r = run(EPS, CAR, [CHA, SHO], [band, vert, diagArm]);
ok(r.ok && ortho(r.points), '사례: 길을 찾음 · 가로·세로');
ok(r.ok && Math.min(...r.points.map(p => p.y)) >= 270, '사례: 위로 돌아가지 않음 (가장 위 y=' + (r.ok && Math.min(...r.points.map(p => p.y))) + ')');
ok(r.ok && r.points.some(p => p.y > 285 && p.y < 315), '사례: 가로 띠 가운데쯤으로 감 (' + (r.ok && JSON.stringify(r.points)) + ')');
ok(r.ok && len(r.points) < 700, '사례: 가장 짧은 길 (' + (r.ok && len(r.points).toFixed(0)) + ')');
ok(r.ok && insideAll(r.points.slice(1, -1), [band, vert, diagArm]), '사례: 선이 바닥 안');

// ── 대각선 복도: 계단 모양은 곧게 폄 ──
const DB = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 680, y: 600 }, { x: 600, y: 600 }];   // 폭 80쯤의 비스듬한 복도
r = run(rect(0, -100, 80, 100), rect(600, 600, 80, 100), [], [DB]);
ok(r.ok, '대각선 복도: 길을 찾음 (' + (r.error || '') + ')');
ok(r.ok && r.points.length <= 6, '대각선 복도: 계단 모양 대신 곧은 선 (점 ' + (r.ok && r.points.length) + '개)');
ok(r.ok && insideAll(r.points.slice(1, -1), [DB]), '대각선 복도: 선이 바닥 안');
// 큰 층도 빠르게
const big = [rect(0, 0, 6000, 80), rect(0, 0, 80, 2500), rect(0, 2420, 6000, 80), rect(5920, 0, 80, 2500)];
let t = Date.now(); r = run(rect(100, 80, 100, 100), rect(5800, 2320, 100, 100), [], big);
ok(r.ok && Date.now() - t < 2000, '층 전체 크기도 2초 안 (' + (Date.now() - t) + 'ms)');
// 바닥이 관통하거나 걸친 매장은 지나감 (결정 364): 가로 복도(y 100~160)가 매장 M(400~600, 60~200)을 관통
const cor = rect(0, 100, 1000, 60), M = rect(400, 60, 200, 140);
r = run(rect(50, 0, 100, 100), rect(850, 0, 100, 100), [M], [cor]);
ok(r.ok && ortho(r.points) && r.points.some((p, i) => i && p.x > 600 && r.points[i - 1].x < 400), '바닥이 관통한 매장 위를 바닥 따라 지나감 ' + JSON.stringify(r.points || r.error));
ok(r.ok && insideAll(r.points.slice(1, -1), [cor]), '그래도 바닥 밖으로는 안 나감');
// 바닥이 안 덮은 매장은 지금처럼 막힘: 복도가 매장 앞에서 끊기고 매장 안을 돌아가야만 하면 길 없음
r = run(rect(50, 0, 100, 100), rect(850, 0, 100, 100), [rect(400, 60, 200, 140)], [rect(0, 100, 400, 60), rect(600, 100, 400, 60)]);
ok(!r.ok, '바닥이 안 덮은 매장은 못 지나감 (' + (r.error || '') + ')');
// 입구가 바닥에 걸친 매장을 건너 바닥으로 나감: 출발 매장 아래에 매장 N(바닥이 걸쳐 덮음)
const N = rect(100, 90, 100, 40);
r = run(rect(100, 0, 100, 90), rect(850, 0, 100, 90), [N], [rect(0, 90, 1000, 70)]);   // 바닥이 N 을 덮고 출발 매장 아래 변에 붙음
ok(r.ok, '입구 앞을 바닥이 덮은 매장이 막고 있어도 건너서 나감 ' + (r.error || ''));
process.exit(fail ? 1 : 0);
