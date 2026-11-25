// 길찾기 계산 시험 (결정 246): 직각만 · 입구는 복도 쪽 가장 긴 변의 한가운데 · 복도 중앙선 따라감
// 실행: node test/route_test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = { mapContainer: { addEventListener() {} }, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'fm', 'map', 'js', 'cad', 'routeFinder.js'), 'utf8'), ctx);
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ortho = pts => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.1 || Math.abs(p.y - pts[i - 1].y) < 0.1);
const run = (a, b, others, cor) => JSON.parse(JSON.stringify(ctx.routeCompute(a, b, others, cor)));

// ㄱ자 복도: 가로 0~1000 (y 100~160), 세로 (x 940~1000, y 100~600)
const L = [{ x: 0, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 600 }, { x: 940, y: 600 }, { x: 940, y: 160 }, { x: 0, y: 160 }];
const A = rect(100, 0, 200, 100);      // 복도 위쪽 매장, 아래 변이 복도에 붙음
const B = rect(700, 160, 200, 120);    // 복도 아래쪽 매장
const C = rect(780, 300, 160, 200);    // 세로 복도 왼쪽 매장 (오른쪽 변이 복도)
let r = run(A, B, [C], [L]);
ok(r.ok, '입구 → 복도 → 입구 길을 찾음');
ok(r.ok && ortho(r.points), '선이 가로·세로뿐 (대각선 없음)');
ok(r.ok && Math.abs(r.points[0].x - 200) < 0.1 && Math.abs(r.points[0].y - 100) < 0.1, '출발은 복도 쪽 변의 한가운데(200,100)');
ok(r.ok && r.points.some(p => Math.abs(p.y - 130) < 0.1), '복도 가로 중앙선(y=130)을 따라감');
const e = r.points[r.points.length - 1];
ok(e && Math.abs(e.x - 800) < 0.1 && Math.abs(e.y - 160) < 0.1, '도착은 복도 쪽 변의 한가운데(800,160)');
// 꺾인 복도 지나기: A → C (세로 복도 쪽)
r = run(A, C, [B], [L]);
ok(r.ok && ortho(r.points), 'ㄱ자로 꺾어 지나감');
ok(r.ok && r.points.some(p => Math.abs(p.x - 970) < 0.1), '세로 중앙선(x=970)을 지남');
// 매장 안으로 안 들어감
const inside = (p, poly) => p.x > poly[0].x + 0.5 && p.x < poly[1].x - 0.5 && p.y > poly[0].y + 0.5 && p.y < poly[2].y - 0.5;
ok(r.ok && r.points.every(p => ![A, B, C].some(s => inside(p, s))), '어느 매장 안쪽 점도 지나지 않음');
// 복도 없음 · 끊긴 복도
ok(run(A, B, [], []).ok === false, '복도가 없으면 안내 문구');
const far = rect(3000, 100, 500, 60);
r = run(A, B, [], [L, far]); ok(r.ok, '떨어진 다른 복도가 있어도 길은 찾음');
const D = rect(3100, 160, 100, 100); r = run(A, D, [], [L, far]); ok(r.ok === false && /끊겨/.test(r.error || ''), '이어지지 않은 복도는 「끊겨 있습니다」');

// ── 겹치거나 어긋난 바닥 · 좁은 바닥 (결정 256) ──
const V1 = rect(100, 0, 60, 600), V2 = rect(140, 0, 60, 600);        // 겹친 두 세로 복도 (가운데 선이 다름)
r = run(rect(0, 100, 100, 100), rect(200, 400, 100, 100), [], [V1, V2]);
ok(r.ok && ortho(r.points), '겹친 두 복도(가운데 선이 어긋남)도 길이 이어짐 (직각)');
const H = rect(0, 300, 400, 6), Vn = rect(200, 0, 6, 296);              // 폭 6의 좁은 복도, 끝이 4 모자라 안 닿음 (8 이하 틈은 건넘)
r = run(rect(230, 100, 50, 60), rect(100, 306, 60, 60), [], [H, Vn]);
ok(r.ok && ortho(r.points), '폭이 좁고 끝이 조금 못 닿은 복도도 길이 이어짐');
const M1 = rect(0, 100, 300, 60), M2 = rect(400, 100, 300, 60);       // 같은 줄인데 100 떨어진 복도 → 사이가 바닥이 아니라서 끊김
r = run(rect(50, 0, 100, 100), rect(450, 160, 100, 100), [], [M1, M2]);
ok(r.ok === false && /끊겨/.test(r.error || ''), '사이가 바닥이 아닌 빈 곳은 건너지 않고 「끊겨 있습니다」');
const M3 = rect(0, 100, 300, 60), M4 = rect(300, 100, 300, 60);       // 딱 맞닿은 복도는 이어짐
r = run(rect(50, 0, 100, 100), rect(400, 160, 100, 100), [], [M3, M4]);
ok(r.ok && ortho(r.points), '맞닿은 같은 줄 복도는 이어짐');
// 같은 기능실에서 두 매장으로 (한쪽은 겹친 바닥 쪽)
const U = rect(0, 100, 100, 100);
const r1 = run(U, rect(200, 400, 100, 100), [], [V1, V2]), r2 = run(U, rect(200, 300, 100, 100), [], [V1, V2]);
ok(r1.ok && r2.ok, '한 기능실에서 두 매장으로 가는 선이 모두 그려지고 (같은 길과 겹쳐도 됨)');
// 대각선 복도 (결정 272): 중심선(cl) 선분으로 길 찾기
const runD = (a, b, others, cor, cls) => JSON.parse(JSON.stringify(ctx.routeCompute(a, b, others, cor, cls)));
const DIAG = [[0, 0, 600, 600]], DP = [rect(0, 0, 10, 10)];          // 폭 모양은 길찾기에 안 쓰임 (비어 있지만 않으면 됨)
let d = runD(rect(150, 40, 100, 60), rect(450, 550, 100, 60), [], DP, DIAG);
ok(d.ok && d.points.length === 4, '대각선 복도: 입구 → 대각선 → 입구 (점 4개)');
ok(d.ok && Math.abs(d.points[1].x - 200) < 0.1 && Math.abs(d.points[1].y - 200) < 0.1, '출발 입구에서 곧게 내려가 대각선에 닿음(200,200)');
ok(d.ok && Math.abs(d.points[2].x - 500) < 0.1 && Math.abs(d.points[2].y - 500) < 0.1, '대각선을 따라 (500,500)까지');
// 갈라지는 복도(Y자): 대각선 중간(300,300)에서 가로로 (300,300)→(700,300)
const BR = [[0, 0, 600, 600], [300, 300, 700, 300]];
d = runD(rect(150, 40, 100, 60), rect(650, 340, 100, 60), [], DP, BR);
ok(d.ok && d.points.some(p => Math.abs(p.x - 300) < 0.1 && Math.abs(p.y - 300) < 0.1), '갈림길(300,300)에서 꺾어 가로 복도로 감');
// 끊긴 복도는 「끊겨 있습니다」
d = runD(rect(150, 40, 100, 60), rect(850, 140, 100, 60), [], DP, [[0, 0, 600, 600], [800, 100, 1000, 300]]);
ok(d.ok === false && /끊겨/.test(d.error || ''), '이어지지 않은 대각선 복도는 「끊겨 있습니다」');
// 기울지 않은 중심선만 있으면 옛 계산 그대로
d = runD(A, B, [C], [L], [[0, 130, 1000, 130]]);
ok(d.ok && ortho(d.points), '가로·세로 중심선만이면 옛 계산 사용');
process.exit(fail ? 1 : 0);
