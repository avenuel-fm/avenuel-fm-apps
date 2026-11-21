// 옛 [구역별 온습도 확인] 시트 → Supabase 옮기기 SQL 만들기 (WS_온습도공조기 4장, 결정 182)
// 쓰는 법: 구글 시트에서 탭 3개를 각각 「파일 › 다운로드 › CSV」로 받은 뒤
//   node tools/climate_csv.js 기록.csv 공조기.csv 에어커튼.csv
// → supabase/19_climate_data.sql 이 생김. Supabase SQL 편집기에 붙여 실행 (18_climate.sql 다음). 여러 번 실행해도 됨.
// 규칙: 처음 기록부터 전부 · 같은 날짜·장비가 두 번이면 수정시각이 늦은 것 · 공조기 옛 번호는 ahu_unit.old_no 로 (3·37·38 → OLD-*)
//       이미 앱에서 넣은 기록이 더 새것이면 그대로 둠 · 끝에 「시트 숫자 = DB 숫자」 맞춰 보기 표
const fs = require('fs'), path = require('path');

/** CSV 한 덩어리 → 줄 배열 (따옴표·쉼표·줄바꿈 안의 값 처리) */
function parseCsv(txt) {
  txt = String(txt).replace(/^﻿/, '');
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
/** 머리글 이름으로 열 찾기 → 객체 배열 */
function table(txt) {
  const [head, ...rows] = parseCsv(txt);
  if (!head) return [];
  const H = head.map(x => x.trim());
  return rows.map((r, i) => { const o = { _row: i + 2 }; H.forEach((k, j) => { o[k] = (r[j] || '').trim(); }); return o; });
}
const num = v => { const s = String(v == null ? '' : v).replace(/,/g, '').trim(); return s !== '' && isFinite(s) ? Number(s) : null; };
/** '2025-05-01' · '2025. 5. 1' · '2025-05-01 14:05' · '2025. 5. 1 오후 2:05:00' → { d, hm } */
function dateOf(v) {
  const m = /(\d{4})\D{1,3}(\d{1,2})\D{1,3}(\d{1,2})/.exec(String(v || ''));
  if (!m) return null;
  const d = m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  const rest = String(v).slice(m.index + m[0].length), t = /(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})/i.exec(rest);
  let hm = null;
  if (t) { let hh = Number(t[2]) % (t[1] ? 12 : 24); if (/오후|PM/i.test(t[1] || '')) hh += 12; hm = String(hh).padStart(2, '0') + ':' + t[3]; }
  return { d, hm };
}
/** 옛 시각 글 「오후 9:50」「오전 12:00 (24시)」 → 분 (startMin 열이 없는 옛 줄용) */
function minOf(v) {
  const s = String(v || '');
  if (/24시/.test(s)) return 1440;
  const t = /(오전|오후)?\s*(\d{1,2}):(\d{2})/.exec(s);
  if (!t) return null;
  return (Number(t[2]) % 12 + (t[1] === '오후' ? 12 : t[1] ? 0 : Math.floor(Number(t[2]) / 12) * 12)) * 60 + Number(t[3]);
}
const q = v => v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";

/** 공조기·에어커튼 시트 → 같은 날짜·장비는 수정시각 늦은 것 하나 (같으면 아래 줄) */
function usageRows(txt, kind) {
  const out = {}, bad = [];
  table(txt).forEach(r => {
    const dt = dateOf(r['날짜']), unit = String(r['번호'] || r['공조기번호'] || r['에어커튼번호'] || '').trim();
    if (!dt || !unit) { bad.push(r._row); return; }
    const off = /^(y|yes|true|1|미가동)$/i.test(r['미가동'] || '');
    let s = num(r['startMin']), e = num(r['endMin']);
    if (!off && s == null && e == null) { s = minOf(r['가동시작']); e = minOf(r['가동종료']); }
    if (!off && (s == null || e == null)) { s = null; e = null; }   // 한쪽만 = 아직 입력 안 함 (옛 앱과 같음)
    const upd = num(r['수정시각']) || 0, k = dt.d + '|' + unit;
    const row = { kind, d: dt.d, unit: kind === 'hvac' ? String(Math.round(Number(unit))) : unit, s: off ? null : s, e: off ? null : e, off,
      sup: num(r['급기온도']), exh: num(r['배기온도']), upd, row: r._row };
    if (kind === 'hvac' && !/^\d+$/.test(row.unit)) { bad.push(r._row); return; }
    const o = out[k]; if (!o || upd >= o.upd) out[k] = row;
  });
  return { rows: Object.values(out).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : a.unit < b.unit ? -1 : 1), bad };
}
/** 온습도 기록 시트 → 줄 (id 같은 줄은 한 번) */
function climateRows(txt) {
  const seen = {}, rows = [], bad = [];
  table(txt).forEach(r => {
    const id = r['id'], t = num(r['실내온도']), h = num(r['실내습도']);
    let at = null;
    const ts = num(r['ts']);
    if (ts && ts > 1e12) at = new Date(ts + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');   // 한국 시각 글
    else { const dt = dateOf(r['측정시각']); if (dt && dt.hm) at = dt.d + ' ' + dt.hm; }
    if (!id || !at || t == null || h == null || !r['층'] || !r['구역']) { bad.push(r._row); return; }
    if (seen[id]) return; seen[id] = 1;
    const di = num(r['불쾌지수']);
    rows.push({ id, at, floor: r['층'], zone: r['구역'], t, h, di: di == null ? Math.round((0.81 * t + 0.01 * h * (0.99 * t - 14.3) + 46.3) * 10) / 10 : di, ot: num(r['실외온도']), oh: num(r['실외습도']) });
  });
  return { rows, bad };
}
const runMin = r => r.off ? 0 : r.s == null ? null : Math.max(0, (r.e === 0 ? 1440 : r.e) - r.s);

/** SQL 만들기. 끝의 맞춰 보기 표: 시트 숫자(이 도구가 센 것)와 DB 숫자가 같아야 함 */
function buildSql(cl, hv, ct) {
  const L = ['-- 19_climate_data.sql — tools/climate_csv.js 로 만듦 (' + new Date().toISOString().slice(0, 10) + '). 손으로 고치지 않음.',
    '-- 옛 [구역별 온습도 확인] 시트 기록 → Supabase (결정 182). 18_climate.sql 다음에 실행. 여러 번 실행해도 됨.', 'begin;'];
  const chunk = (arr, f, head, tail) => { for (let i = 0; i < arr.length; i += 500) L.push(head + '\n' + arr.slice(i, i + 500).map(f).join(',\n') + '\n' + tail); };
  chunk(cl.rows, r => '(' + [q(r.id), q(r.at), q(r.floor), q(r.zone), r.t, r.h, r.di, r.ot == null ? 'null' : r.ot, r.oh == null ? 'null' : r.oh].join(',') + ')',
    'insert into public.climate_record (id, measured_at, log_date, floor, zone, t, h, di, out_t, out_h, author, src)\nselect v.id, (v.at || \':00+09\')::timestamptz, ((v.at || \':00\')::timestamp - interval \'6 hours\')::date, v.fl, v.zn, v.t::numeric, v.h::numeric, v.di::numeric, v.ot::numeric, v.oh::numeric, \'옛 앱\', \'sheet\'\nfrom (values',
    ') v(id, at, fl, zn, t, h, di, ot, oh)\non conflict (id) do nothing;');
  L.push('create temp table cl_old (kind text, d date, u text, s int, e int, off boolean, sup numeric, exh numeric, upd timestamptz) on commit drop;');
  chunk(hv.rows.concat(ct.rows), r => '(' + [q(r.kind), q(r.d), q(r.unit), r.s == null ? 'null' : r.s, r.e == null ? 'null' : r.e, r.off, r.sup == null ? 'null' : r.sup, r.exh == null ? 'null' : r.exh, r.upd ? r.upd : 0].join(',') + ')',
    'insert into cl_old select kind, d::date, u, s::int, e::int, off::boolean, sup::numeric, exh::numeric, to_timestamp(upd::numeric / 1000.0) from (values', ') v(kind, d, u, s, e, off, sup, exh, upd);');
  L.push(`-- 공조기 옛 번호 → 지금 번호 (ahu_unit.old_no). 못 찾은 번호는 맨 아래 표에 나옴
insert into public.equip_usage (kind, log_date, unit, start_min, end_min, off, supply_t, exhaust_t, updated_at, editor, src)
select o.kind, o.d, coalesce(a.no, o.u), o.s, o.e, o.off, o.sup, o.exh, o.upd, '옛 앱', 'sheet'
from cl_old o left join public.ahu_unit a on o.kind = 'hvac' and a.old_no::text = o.u
where o.kind = 'curtain' or a.no is not null
on conflict (kind, log_date, unit) do update set start_min = excluded.start_min, end_min = excluded.end_min, off = excluded.off,
  supply_t = excluded.supply_t, exhaust_t = excluded.exhaust_t, updated_at = excluded.updated_at, editor = excluded.editor, src = excluded.src
where public.equip_usage.src = 'sheet' or public.equip_usage.updated_at < excluded.updated_at;   -- 앱에서 더 늦게 고친 것은 그대로`);
  const sumMin = rs => rs.reduce((a, r) => a + (runMin(r) || 0), 0);
  L.push(`-- 맞춰 보기: 시트 = DB 이어야 함. 공조기는 시트 = DB + 「못 찾은 번호」 줄 (DB 시간이 다르면 앱에서 더 늦게 고친 같은 날 기록이 남은 것)
select '온습도 기록' 종류, ${cl.rows.length} 시트_건수, (select count(*) from public.climate_record where src = 'sheet') db_건수, null::numeric 시트_시간, null::numeric db_시간
union all select '공조기', ${hv.rows.length}, (select count(*) from public.equip_usage where kind = 'hvac' and src = 'sheet'), ${(sumMin(hv.rows) / 60).toFixed(2)},
  (select round(sum(public.ws_run_min(off, start_min, end_min)) / 60.0, 2) from public.equip_usage where kind = 'hvac' and src = 'sheet')
union all select '에어커튼', ${ct.rows.length}, (select count(*) from public.equip_usage where kind = 'curtain' and src = 'sheet'), ${(sumMin(ct.rows) / 60).toFixed(2)},
  (select round(sum(public.ws_run_min(off, start_min, end_min)) / 60.0, 2) from public.equip_usage where kind = 'curtain' and src = 'sheet')
union all select '못 찾은 공조기 번호: ' || coalesce(string_agg(distinct o.u, ', '), '없음'), count(*), 0, round(coalesce(sum(public.ws_run_min(o.off, o.s, o.e)), 0) / 60.0, 2), null
  from cl_old o where o.kind = 'hvac' and not exists (select 1 from public.ahu_unit a where a.old_no::text = o.u);`);
  L.push('commit;');
  return L.join('\n\n') + '\n';
}

module.exports = { parseCsv, usageRows, climateRows, buildSql, minOf, dateOf, runMin };

if (require.main === module) {
  const [a, b, c] = process.argv.slice(2);
  if (!a || !b || !c) { console.log('쓰는 법: node tools/climate_csv.js 기록.csv 공조기.csv 에어커튼.csv'); process.exit(1); }
  const rd = f => fs.readFileSync(f, 'utf8');
  const cl = climateRows(rd(a)), hv = usageRows(rd(b), 'hvac'), ct = usageRows(rd(c), 'curtain');
  const out = path.join(__dirname, '..', 'supabase', '19_climate_data.sql');
  fs.writeFileSync(out, buildSql(cl, hv, ct));
  const h = rs => (rs.reduce((x, r) => x + (runMin(r) || 0), 0) / 60).toFixed(1);
  console.log('온습도 ' + cl.rows.length + '건 · 공조기 ' + hv.rows.length + '건 ' + h(hv.rows) + '시간 · 에어커튼 ' + ct.rows.length + '건 ' + h(ct.rows) + '시간');
  [['기록', cl], ['공조기', hv], ['에어커튼', ct]].forEach(([n, x]) => { if (x.bad.length) console.log('  ' + n + ' 시트에서 읽지 못한 줄 ' + x.bad.length + '개: ' + x.bad.slice(0, 20).join(', ') + (x.bad.length > 20 ? ' …' : '')); });
  console.log('→ ' + out + ' (Supabase SQL 편집기에서 실행, 맨 아래 표에서 시트 = DB 확인)');
}
