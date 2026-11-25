/* ───────── 점검 › 하자점검 메일 발송 (docs/설계/WS_하자점검.md, 결정 270) ─────────
   바로가기 앱(Supabase 판)이 doPost {action:'hjMail', token, id, to} 로 부름.
   ① 직원 확인(PIN 로그인 번호표) + 보낼 PDF 정보 ← Supabase ws_hj_mail_info
   ② PDF 를 드라이브로 옮기고(Archive.gs archiveOne_ 와 같은 일) 「링크가 있는 사람 보기」
   ③ 메일 한 통 → 기록 ws_hj_mail_done.  추가 권한 없음 (MailApp) */
const HJ_FROM = 'max2122@nate.com', HJ_FROM_NAME = '잠실점 에비뉴엘 시설팀', HJ_LABEL = '잠실점 에비뉴엘';
const HJ_SIG = ['에비뉴엘 시설팀', 'T. 02-3213-2456 / 02-3213-2119 / 02-3213-2122', 'E. max2122@nate.com', 'W. http://www.maxerve.co.kr/'];

function hjEsc_(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
/** 편집기 확인용 (권한 허용은 이 앱이 이미 쓰는 MailApp 만 필요) */
function hjMailAuthCheck() { Logger.log('오늘 남은 발송 수 ' + MailApp.getRemainingDailyQuota() + ' · 답장 주소 ' + HJ_FROM); }

function hjMail_(b) {
  const to = String(b.to || '').trim(), id = String(b.id || ''), token = String(b.token || '');
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) throw new Error('받는 사람 이메일 형식이 맞지 않습니다.');
  if (!id || !token) throw new Error('요청이 올바르지 않습니다.');
  const info = JSON.parse(sbReq_('post', '/rest/v1/rpc/ws_hj_mail_info', { p_token: token, p_id: id }).getContentText());
  if (!info.ok) return info;
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('오늘 보낼 수 있는 메일 수를 다 썼습니다. 내일 다시 보내 주세요.');
  const f = info.file;
  let driveId = f.drive_id || '';
  if (!driveId) {   // 아직 Supabase 에만 있는 PDF → 드라이브로
    if (!f.storage_path) throw new Error('PDF 파일을 찾지 못했습니다. 「PDF 생성」을 다시 눌러 주세요.');
    archiveOne_(f);
    const row = JSON.parse(sbReq_('get', '/rest/v1/files?select=drive_id&id=eq.' + f.id).getContentText())[0];
    driveId = row && row.drive_id;
    if (!driveId) throw new Error('PDF를 드라이브에 저장하지 못했습니다. 다시 해 주세요.');
  }
  const url = driveUrl_(driveId), name = f.file_name || (info.day + '_하자점검.pdf');
  const subject = '[' + HJ_LABEL + '] 하자내용 송부';
  const l1 = '안녕하세요, 잠실점 에비뉴엘 시설팀입니다.', l2 = '금일 준공점검 하자내용을 아래 링크로 보내드립니다.';
  const sig = HJ_SIG.map(function (l, i) {
    const h = hjEsc_(l).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/([\w.+-]+@[\w-]+\.[\w.-]+)/g, '<a href="mailto:$1">$1</a>');
    return i === 0 ? '<b>' + h + '</b>' : h;
  }).join('<br>');
  const html = '<div style="font-family:sans-serif;font-size:14px;line-height:1.7">' + l1 + '<br>' + l2 + '<br><br>· 하자점검서 : <a href="' + hjEsc_(url) + '">' + hjEsc_(name) + '</a>' +
    '<div style="margin-top:20px;padding-top:10px;border-top:1px solid #ddd;color:#333">' + sig + '</div></div>';
  const text = l1 + '\n' + l2 + '\n\n· 하자점검서 : ' + url + '\n\n──────────\n' + HJ_SIG.join('\n');
  MailApp.sendEmail({ to: to, subject: subject, body: text, htmlBody: html, name: HJ_FROM_NAME, replyTo: HJ_FROM });   // 보낸 사람 = 구글 계정 주소, 답장은 nate (MailApp 은 이 앱이 이미 허용받은 권한)
  const done = JSON.parse(sbReq_('post', '/rest/v1/rpc/ws_hj_mail_done', { p_token: token, p_id: id, p_to: to }).getContentText());
  return { ok: true, item: done.item };
}
