/* ───────────────────────── Supabase 이관 5단계: 주 1회 파일을 구글 드라이브로 (docs/설계/WS_Supabase이관.md 4.16) ─────────────────────────
   시트 메뉴 「⑫ Supabase: 주 1회 드라이브로 옮기기 켜기」로 예약 (매주 일요일 새벽 4시).
   파일 하나씩: Supabase 버킷에서 받기 → 드라이브(예전과 같은 폴더)에 저장 → 「링크가 있는 사람 보기」 → DB files 줄 고침 → 그다음에만 버킷 원본 지움.
   7일 지난 파일만 (그 주에 PDF를 다시 만들 때는 아직 Supabase 주소를 씀). 4분 반에 다 못 하면 1분 뒤 이어서.
   다 끝나면: 버킷에만 남은 파일 정리(2일 지난 것) → DB 백업(CSV, 드라이브 Supabase백업/날짜) → 실패가 있으면 스크립트 주인에게 메일.
   필요: 스크립트 속성 SUPABASE_URL · SUPABASE_SERVICE_KEY, Supabase 에서 supabase/10_archive.sql 실행 */

const ARC_ROOT = ['시설팀 통합업무', '20_업무지원'];
const ARC_DAYS = 7, ARC_ORPHAN_DAYS = 2, ARC_PAGE = 100, ARC_BUDGET = 270000;
const ARC_TABLES = ['files', 'settings', 'staff', 'change_log', 'signs', 'next_work', 'tbm', 'risk_list', 'daily_log', 'roster', 'roster_changes',
  'default_holidays', 'fire_ext', 'fire_checks', 'eh_stores', 'eh_devices', 'cs_sites', 'cs_items', 'cs_checks'];   // 기기 표(ws_sessions)는 백업 안 함

function archiveMenu_() {
  migrateConf_();   // 열쇠가 없으면 여기서 안내
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'archiveFilesToDrive') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('archiveFilesToDrive').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(4).inTimezone(TZ).create();
  const r = archiveFilesToDrive();
  SpreadsheetApp.getUi().alert('매주 일요일 새벽 4시에 Supabase 파일(7일 지난 것)을 드라이브로 옮기도록 켰습니다.\n\n지금 한 번 돌린 결과: ' + archiveSay_(r));
}
function archiveSay_(r) {
  return r.done ? '옮김 ' + r.n + '개, 버킷 정리 ' + r.orphans + '개, 백업 ' + r.backup + (r.fails.length ? '\n실패 ' + r.fails.length + '건 (메일 보냄)' : '')
    : '옮김 ' + r.n + '개 — 남은 것은 1분 뒤 이어서 합니다';
}

/** 주 1회 예약이 부름 (처음부터) */
function archiveFilesToDrive() { return archiveRun_(false); }
/** 시간이 모자라 1분 뒤 이어서 */
function archiveContinue_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'archiveContinue_') ScriptApp.deleteTrigger(tr); });
  return archiveRun_(true);
}

function archiveRun_(cont, budgetMs) {
  migrateConf_();   // 열쇠가 없으면 아무것도 안 하고 멈춤
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { done: false, n: 0, fails: [], busy: true };
  try {
    const p = PropertiesService.getScriptProperties();
    if (!cont || !p.getProperty('ARC_CUTOFF')) {
      p.setProperties({ ARC_CUTOFF: new Date(Date.now() - ARC_DAYS * 86400000).toISOString(), ARC_CURSOR: '', ARC_FAILS: '[]', ARC_N: '0' });
    }
    const cutoff = p.getProperty('ARC_CUTOFF'), end = Date.now() + (budgetMs == null ? ARC_BUDGET : budgetMs);
    let cursor = p.getProperty('ARC_CURSOR') || '', n = Number(p.getProperty('ARC_N')) || 0, fails = JSON.parse(p.getProperty('ARC_FAILS') || '[]');
    const save = function () { p.setProperties({ ARC_CURSOR: cursor, ARC_N: String(n), ARC_FAILS: JSON.stringify(fails.slice(-200)) }); };
    let more = true;
    // 번호(id) 순서로 커서를 넘김 → 실패한 파일에 막혀 같은 자리를 돌지 않음 (실패는 다음 주에 다시)
    page: while (Date.now() < end) {
      const rows = JSON.parse(sbReq_('get', '/rest/v1/files?select=id,kind,storage_path,file_name,drive_folder&is_archived=eq.false&storage_path=not.is.null' +
        '&created_at=lt.' + encodeURIComponent(cutoff) + (cursor ? '&id=gt.' + cursor : '') + '&order=id&limit=' + ARC_PAGE).getContentText());
      if (!rows.length) { more = false; break; }
      for (let i = 0; i < rows.length; i++) {
        if (Date.now() >= end) break page;
        try { archiveOne_(rows[i]); n++; } catch (e) { fails.push((rows[i].file_name || rows[i].storage_path) + ': ' + e.message); }
        cursor = rows[i].id;
        save();
      }
    }
    save();
    if (more) {
      ScriptApp.newTrigger('archiveContinue_').timeBased().after(60000).create();
      return { done: false, n: n, fails: fails };
    }
    let orphans = 0, backup = '';
    try { orphans = archiveOrphans_(); } catch (e) { fails.push('버킷 정리: ' + e.message); }
    try { backup = archiveBackup_(); } catch (e) { fails.push('DB 백업: ' + e.message); }
    p.deleteProperty('ARC_CUTOFF');
    log_('예약 작업', 'Supabase 파일 드라이브로', '', '옮김 ' + n + ', 버킷 정리 ' + orphans + ', 백업 ' + backup + ', 실패 ' + fails.length);
    if (fails.length) {
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[업무지원] Supabase 파일 드라이브 옮기기 실패 ' + fails.length + '건',
        '옮긴 파일 ' + n + '개, 실패 ' + fails.length + '건. 실패한 파일은 Supabase에 그대로 있고 다음 주에 다시 해 봅니다.\n\n' + fails.join('\n'));
    }
    return { done: true, n: n, fails: fails, orphans: orphans, backup: backup };
  } finally {
    lock.releaseLock();
  }
}

/** 파일 하나: 드라이브 저장 → 공유 → DB 고침 → 원본 지움 (DB 고치기 전에 멈추면 원본은 그대로) */
function archiveOne_(f) {
  const folder = folderPath_(ARC_ROOT.concat(String(f.drive_folder || '기타').split('/').filter(String)));
  const name = f.file_name || String(f.storage_path).split('/').pop(), tag = 'ws-file:' + f.id;
  let id = '';
  // 지난번에 드라이브 저장까지만 하고 멈췄으면 그 파일을 씀 (두 번 저장 안 함)
  for (const it = folder.getFilesByName(name); !id && it.hasNext();) { const x = it.next(); if (x.getDescription() === tag) id = x.getId(); }
  if (!id) id = saveBlob_(folder, sbReq_('get', '/storage/v1/object/ws-files/' + f.storage_path).getBlob(), name, tag);
  DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const up = JSON.parse(sbReq_('patch', '/rest/v1/files?id=eq.' + f.id + '&is_archived=eq.false',
    { file_url: driveFileUrl_(f.kind, id), drive_id: id, is_archived: true, storage_path: null }, { Prefer: 'return=representation' }).getContentText());
  if (up.length !== 1) throw new Error('DB 줄을 고치지 못함');
  try { sbReq_('delete', '/storage/v1/object/ws-files', { prefixes: [f.storage_path] }); } catch (e) { /* 남은 원본은 아래 버킷 정리가 지움 */ }
}

/** 버킷에만 있고 DB(files.storage_path)가 가리키지 않는 파일 지움: 저장이 거절된 사진, 원본 지우기 실패분. 막 올린 것은 남김(2일) */
function archiveOrphans_() {
  const live = {};
  for (let off = 0; ; off += 1000) {
    const rows = JSON.parse(sbReq_('get', '/rest/v1/files?select=storage_path&storage_path=not.is.null&order=id&limit=1000&offset=' + off).getContentText());
    rows.forEach(function (r) { live[r.storage_path] = 1; });
    if (rows.length < 1000) break;
  }
  const old = Date.now() - ARC_ORPHAN_DAYS * 86400000, dead = [];
  const walk = function (prefix) {
    for (let off = 0; ; off += 1000) {
      const items = JSON.parse(sbReq_('post', '/storage/v1/object/list/ws-files', { prefix: prefix, limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } }).getContentText());
      items.forEach(function (it) {
        const path = prefix + it.name;
        if (it.id === null) walk(path + '/');   // 폴더
        else if (!live[path] && new Date(it.created_at).getTime() < old) dead.push(path);
      });
      if (items.length < 1000) break;
    }
  };
  walk('');
  for (let i = 0; i < dead.length; i += 100) sbReq_('delete', '/storage/v1/object/ws-files', { prefixes: dead.slice(i, i + 100) });
  return dead.length;
}

/** DB 표마다 CSV 하나 → 드라이브 Supabase백업/YYYY-MM-DD (엑셀에서 한글이 보이게 BOM) */
function archiveBackup_() {
  const day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const folder = folderPath_(ARC_ROOT.concat(['Supabase백업', day]));
  const cell = function (v) {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  ARC_TABLES.forEach(function (t) {
    const rows = JSON.parse(sbReq_('post', '/rest/v1/rpc/ws_backup', { p_table: t }).getContentText());
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const csv = [cols.map(cell).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return cell(r[c]); }).join(','); })).join('\r\n');
    saveBlob_(folder, Utilities.newBlob('﻿' + csv, 'text/csv'), t + '.csv', 'Supabase 백업 ' + day);
  });
  return day + ' 표 ' + ARC_TABLES.length + '개';
}
