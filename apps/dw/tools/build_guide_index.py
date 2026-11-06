"""지침 PDF → 검색 색인(guide_pages/index.json) + 쪽 이미지(guide_pages/<id>/pNNN.jpg)

사용법:
  python3 tools/build_guide_index.py tools/guides.json guide_pages

만든 guide_pages 폴더를 드라이브에 통째로 올리고 시트 메뉴 ④로 연결하면 끝입니다 (코드 재배포 불필요).

guides.json 예시:
  [
    {"id": "g", "title": "롯데백화점 Tenant 시설공사 지침 (2024.07.09)", "short": "시설공사 지침",
     "pdf": "시설공사지침.pdf", "localPages": true},
    {"id": "s", "title": "타워&몰 통합안전관리지침 (26년 개정판)", "short": "통합안전관리지침",
     "pdf": "통합안전관리지침.pdf", "localPages": false}
  ]
- id: 영문 한 글자 이상 (쪽 이미지 폴더 이름으로도 씀)
- localPages: 쪽 아래에 "6/10" 같은 지침 안의 쪽 번호가 있으면 true

필요 프로그램: poppler-utils (pdfinfo, pdftotext, pdftoppm), Pillow
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image

PAGE_WIDTH_PX = 1000      # 세로형 쪽 이미지 가로 크기
PAGE_WIDTH_PX_LANDSCAPE = 1400  # 가로형 쪽 (글씨가 작아 더 크게)
JPEG_QUALITY = 78


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def compact(s):
    return re.sub(r'\s+', '', s)


def page_count(pdf):
    return int(re.search(r'Pages:\s+(\d+)', run(['pdfinfo', pdf])).group(1))


def section_of(line):
    """'■ 롯데백화점 Tenant 설비공사 지침' → '설비공사 지침', '■ 방화및방염관련' → '방화및방염관련'"""
    s = line.lstrip('■').strip()
    s = re.sub(r'^롯데백화점\s*Tenant\s*', '', s)
    s = re.sub(r'[_\s]+', ' ', s).strip()
    return s[:40]


def page_lines_bbox(pdf):
    """pdftotext -bbox-layout 결과 → {쪽: [(압축텍스트, (x0,y0,x1,y1) 0~1 비율)]}"""
    xml = run(['pdftotext', '-bbox-layout', pdf, '-'])
    pages = {}
    for pi, pm in enumerate(re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', xml, re.S), start=1):
        w, h = float(pm.group(1)), float(pm.group(2))
        lines = []
        for lm in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>', pm.group(3), re.S):
            words = re.findall(r'<word[^>]*>(.*?)</word>', lm.group(5), re.S)
            text = compact(html.unescape(''.join(words)))
            if not text:
                continue
            box = (float(lm.group(1)) / w, float(lm.group(2)) / h, float(lm.group(3)) / w, float(lm.group(4)) / h)
            lines.append((text, tuple(round(v, 4) for v in box)))
        pages[pi] = lines
    return pages


def extract_entries(pdf, local_pages):
    n = page_count(pdf)
    entries = []
    sec = ''
    for p in range(1, n + 1):
        txt = run(['pdftotext', '-f', str(p), '-l', str(p), pdf, '-'])
        for line in txt.split('\n'):
            if line.strip().startswith('■'):
                sec = section_of(line.strip())
                break
        lp = ''
        if local_pages:
            lpm = re.findall(r'(?<![\d.])(\d{1,2})\s*/\s*(\d{1,2})(?![\d.])', txt)
            lp = '/'.join(lpm[-1]) if lpm else ''
        head = ''
        cur = None
        labels = []

        def flush():
            nonlocal cur, labels
            if cur and labels:
                cur['l'] = ' '.join(labels)
                labels = []
            if cur and len(compact(cur['t'])) >= 8:
                cur['t'] = re.sub(r'\s+', ' ', cur['t']).strip()
                entries.append(cur)
            cur = None

        for raw in txt.split('\n'):
            line = raw.strip()
            if not line or line.startswith('■'):
                continue
            if re.fullmatch(r'\d{1,3}\s*/\s*\d{1,3}', line):
                continue
            if re.match(r'^(\d+(-\d+)?\.\s*[가-힣A-Za-z(]|[가-하]\.\s)', line) and len(line) <= 30 and not re.search(r'제\s*\d+\s*조', line):
                flush()
                head = line
                if len(line) > 20:
                    cur = {'p': p, 's': sec, 'lp': lp, 'h': head, 't': line}
                continue
            if re.match(r'^(▶|※|-\s?|·|•|○|\[|[①-⑳]|\(\d+\)|\d+\))', line):
                flush()
                cur = {'p': p, 's': sec, 'lp': lp, 'h': head, 't': line}
                continue
            if len(line) <= 6 and re.fullmatch(r'[가-힣\s/·]+', line):
                labels.append(line)  # 표 구분 칸: 검색에는 쓰고 본문에는 안 보임
                continue
            if cur is None:
                cur = {'p': p, 's': sec, 'lp': lp, 'h': head, 't': line}
            else:
                cur['t'] += ' ' + line
        flush()
    return entries


def split_long(e, limit=200):
    t = e['t']
    if len(t) <= limit:
        return [e]
    parts, buf = [], ''
    for piece in re.split(r'(?<=[.다])\s+', t):
        if buf and len(buf) + len(piece) + 1 > limit:
            parts.append(buf)
            buf = piece
        else:
            buf = (buf + ' ' + piece).strip()
    if buf:
        parts.append(buf)
    out = []
    for i, part in enumerate(parts):
        d = dict(e)
        d['t'] = part
        if i and 'l' in d:
            del d['l']
        out.append(d)
    return out


def attach_boxes(entries, lines_by_page):
    """항목마다 쪽 위 줄 위치를 붙임: b = [[x0,y0,x1,y1,항목 안 글자 위치], ...] (노란 표시용)"""
    cursor = {}
    hit = 0
    for e in entries:
        lines = lines_by_page.get(e['p'], [])
        ec = compact(e['t'])
        head = ec[:10]
        start = cursor.get(e['p'], 0)
        anchor = None
        # 1) 항목 첫 글자들을 담은 줄 (긴 항목을 나눈 조각은 줄 중간에서 시작할 수 있음)
        for rng in (range(start, len(lines)), range(0, start)):
            for i in rng:
                text = lines[i][0]
                if len(text) >= 4 and (head in text or (len(text) >= 6 and ec.startswith(text[:min(len(text), 12)]))):
                    anchor = i
                    break
            if anchor is not None:
                break
        boxes, used, misses = [], 0, 0
        if anchor is not None:
            for i in range(anchor, min(len(lines), anchor + 40)):
                text, box = lines[i]
                if i == anchor and head in text:
                    pos = 0
                elif len(text) < 3:
                    continue  # 괄호·기호만 있는 짧은 줄은 건너뜀
                else:
                    pos = ec.find(text, max(0, used - 4))
                    if pos < 0 and len(text) > 6:
                        pos = ec.find(text[:6], max(0, used - 4))
                if pos >= 0:
                    boxes.append([*box, pos])
                    used = pos + len(text)
                    misses = 0
                    if used >= len(ec) - 1:
                        cursor[e['p']] = i + 1
                        break
                else:
                    misses += 1
                    if misses >= 4:
                        break
        if boxes:
            e['b'] = boxes
            hit += 1
    return hit


def page_size(pdf):
    m = re.search(r'Page size:\s+([\d.]+)\s+x\s+([\d.]+)', run(['pdfinfo', pdf]))
    return float(m.group(1)), float(m.group(2))


def render_pages(pdf, n, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        w_pt, h_pt = page_size(pdf)
        target = PAGE_WIDTH_PX_LANDSCAPE if w_pt > h_pt else PAGE_WIDTH_PX
        dpi = max(60, round(target / (w_pt / 72)))
        subprocess.run(['pdftoppm', '-r', str(dpi), '-png', pdf, os.path.join(tmp, 'p')], check=True)
        for f in sorted(os.listdir(tmp)):
            num = int(re.search(r'(\d+)\.png$', f).group(1))
            im = Image.open(os.path.join(tmp, f)).convert('RGB')
            if im.width > target:
                im = im.resize((target, round(im.height * target / im.width)))
            im.save(os.path.join(out_dir, 'p%03d.jpg' % num), quality=JPEG_QUALITY, optimize=True)


def main():
    cfg_path, pages_dir = sys.argv[1], sys.argv[2]
    cfg_dir = os.path.dirname(os.path.abspath(cfg_path))
    sources = json.load(open(cfg_path, encoding='utf-8'))
    all_entries, meta = [], []
    for src in sources:
        pdf = src['pdf'] if os.path.isabs(src['pdf']) else os.path.join(cfg_dir, src['pdf'])
        n = page_count(pdf)
        entries = [x for e in extract_entries(pdf, src.get('localPages', False)) for x in split_long(e)]
        for e in entries:
            e['d'] = src['id']
            if not e['s']:
                e['s'] = src['short']
        hit = attach_boxes(entries, page_lines_bbox(pdf))
        render_pages(pdf, n, os.path.join(pages_dir, src['id']))
        w_pt, h_pt = page_size(pdf)
        meta.append({'id': src['id'], 'title': src['title'], 'short': src['short'], 'pages': n,
                     'landscape': w_pt > h_pt})
        all_entries += entries
        print(f"{src['short']}: {n}쪽, 항목 {len(entries)}개, 줄 위치 {hit}개, 쪽 이미지 {n}장")
    out = os.path.join(pages_dir, 'index.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'sources': meta, 'index': all_entries}, f, ensure_ascii=False, separators=(',', ':'))
    print('wrote', out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
