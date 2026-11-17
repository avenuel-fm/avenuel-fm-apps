# 롯데 잠실점 쇼핑맵 뷰어 & CAD 에디터 프로젝트 - 세션 인수인계 (SESSION HANDOVER)

> **이 문서는 다른 PC(회사 Claude, 다른 Antigravity 세션 등)에서 이전 작업 대화와 개발 맥락을 100% 그대로 이어받아 작업을 계속하기 위해 생성된 마스터 컨텍스트 문서입니다.**

---

## 1. 프로젝트 개요 및 핵심 원칙
- **목적**: 롯데 잠실점 쇼핑맵 도면(에비뉴엘, 백화점, 캐슬플라자)을 브라우저에서 인터랙티브하게 조회하고, 매장/기능실/방화구역/제연구획/소방심벌/설비 배관선(자-모 연결선)을 전문 CAD 수준으로 편집 및 출력하는 시스템.
- **아키텍처**: 순수 Vanilla JS 모듈형 구조 (HTML 4개는 껍데기만 유지하고, `css/` 4개 파일과 `js/` 17개 파일이 모든 비즈니스 로직을 공유).
- **개발 규칙 (Ponytail 원칙)**:
  - 최소한의 코드로 최대의 효과 (YAGNI, 불필요한 추상화 배제).
  - 기존 코드 철저히 재사용.
  - 버그 발생 시 호출처가 아닌 공통 함수 레벨에서 근본 수정.
  - 아이패드 프로 (2세대 12.9인치 등) 및 사파리 터치/제스처 완벽 지원.

---

## 2. 지금까지 진행된 대화 및 작업 히스토리 (상세)

### [Phase 1] 뷰어 모듈화 및 코어 기능
- 23만 자의 거대한 단일 HTML 파일을 HTML 4개와 CSS 4개, JS 17개 모듈로 완벽 분리.
- 매장/기능실 편집 모달: 클릭 시 선택 토글(다시 누르면 닫힘), 우측 하단 플로팅 토스트 스타일 팝업.
- 도면 축척(Scale) 캘리브레이션: 도면의 두 점을 실측하여 1px당 실제 미터(`metersPerPixel`) 자동 산출.
- 연회색 CAD 그리드: 1m~5m 간격 바닥 격자 표시 및 레이어 체크박스 토글.

### [Phase 2] 방화구역 / 제연구획 / 외벽 편집 CAD
- 방화구역(면적), 제연구획(선/면), 외벽(선/면) 구분.
- 외벽 정점 핸들 드래그 수정, 외벽 자석 스냅(Magnet Snap) 및 8px 평행 오프셋 충돌 방지.
- 소방 심벌 4종: 청정소화기, 분말소화기, 소화전, 공기호흡기 도면 위 배치 및 삭제.

### [Phase 3] 건물 분리 및 통합 메인보드 대시보드
- [index.html](index.html): 통합 메인보드 대시보드 (에비뉴엘 활성, 백화점/캐슬플라자는 '준비중' 비활성).
- [lotte_jamsil_map_viewer.html](lotte_jamsil_map_viewer.html): 에비뉴엘 전용 뷰어 (B1~6F).
- [lotte_dept_viewer.html](lotte_dept_viewer.html): 백화점 전용 뷰어 (B4~12F).
- [lotte_castle_viewer.html](lotte_castle_viewer.html): 캐슬플라자 전용 뷰어 (B1~2F).
- 로컬스토리지 키 격리: `_dept`, `_castle` 접미사를 통해 3개 건물 간 데이터 오염 100% 방지.

### [Phase 4] 기능실(자) ➔ 매장(모) 설비 배관/간선 라인 시스템 (최신 작업)
1. **설비 라디오 버튼 4종**:
   - `전기`: 파란색 (`#2563eb`), 3px, 점선 흐름(자➔모), `00 A` 입력칸.
   - `수도`: 하늘색 (`#0284c7`), 3px, 점선 흐름(자➔모), `00 mm` 입력칸.
   - `가스`: 노란색 (`#eab308`), 3px, 점선 흐름(자➔모), **규격 입력 비활성화 (`disabled`)**.
   - `배수`: 검은색 (`#0f172a`), 3px, 점선 흐름(모➔자), `00 mm` 입력칸.
2. **사전 가드**: 도면에 등록된 기능실이 없으면 `⚠️ 도면에 등록된 기능실이 없습니다...` 토스트를 띄우고 그리기 차단.
3. **가이드 배너**: `자[선택 중...] ➔ 모[선택 중...]` 상태 및 자에서 모로 흐르는 점선 애니메이션 인디케이터 바 표시.
4. **매장 클릭 시 하이라이트**: 매장(모) 클릭 시 해당 매장과 연결된 자 라인만 선명하게 점선 애니메이션 활성화.
5. **선분 삭제**: 선분 또는 스펙 배지 클릭 시 삭제 확인 창(`confirm`) 및 `Delete` 키 삭제 지원.
6. **직각(Orthogonal / Shift) 스냅**: 선분을 그리는 "모든 5대 기능"에 Shift 키 및 `[📐 직각 (Shift)]` 버튼 지원.

### [Phase 5] 설비 연결선 테스트 및 버그 수정 (2026-11-17, Claude Code 세션 avenuel-map)
- 1F에서 기능실 가드, 4종 그리기, 하이라이트, 레이어 필터, 삭제, 새로고침 유지 모두 정상 확인.
- 수정한 버그 4건 (브라우저 재확인 완료):
  1. 수도선이 전기선과 같은 파란색으로 보임 → `css/cad-tools.css` `.util-line-water` stroke `#0284c7`.
  2. 선 클릭 시 빨간 선택 표시 안 보임 (CSS `!important`에 밀림) → `utilityLineEditor.js`에서 `style.setProperty(..., 'important')`.
  3. 규격 입력칸에서 Backspace 시 그린 점이 지워짐 → `app.js` Backspace 분기에 INPUT/TEXTAREA 포커스 확인 추가.
  4. Ctrl+Z가 설비 연결선을 되돌리지 못함 → `undoManager.js` 스냅샷에 `utilityLines` 추가, `utilityLineRepository.js` 추가/삭제 시 `pushUndoState`.
- 알려진 남은 점: `utilityLineEditor.js`의 Delete 키 삭제는 confirm 뒤 선택이 풀려서 실제로 동작하지 않음 (클릭 삭제는 정상). 아이패드 실제 터치는 미시험.
- 로컬 실행: 파일을 직접 열면(file://) 동작하지 않음. 폴더에서 `python -m http.server 8765` 후 http://localhost:8765/lotte_jamsil_map_viewer.html.

### [Phase 6] avenuel-fm-apps 통합 (2026-11-17)
- 위치 이동: `C:\avenuel\lotte_map_handover\` → `C:\avenuel\avenuel-fm-apps\apps\map\`.
- 작업 세션: [업무지원] 프로젝트 세션의 하위 세션 `avenuel-map`에서 이어서 진행.
- 목표: Supabase에 올려 업무지원 앱에서 사용.
- 남은 일 (avenuel-fm-apps `CLAUDE.md` 규칙을 따름: 「진행시켜」 전에는 코드 수정 금지, WS 결정은 짝수 번호):
  1. `docs/설계/`에 도면 앱 설계 문서 새로 작성 (`apps/ws`, `apps/dw`의 Supabase 이관 문서 참고).
  2. localStorage 저장(매장/기능실, 구역, 심벌, 설비 연결선, 축척)을 Supabase 표로 이관.
  3. 업무지원 앱 로그인(PIN+서명)과 DW 디자인 기준에 맞추기, 배포 위치 결정(`fm/` GitHub Pages 등).
  4. 도면 SVG는 외부 S3(editor4-public-assets) 주소에 의존 — 계속 쓸 수 있는지 확인.
  5. avenuel-fm-apps `CLAUDE.md` 폴더 지도에 `apps/map/` 추가.

---

## 3. 프로젝트 파일 구조도

```
apps/map/   (전: C:\avenuel\lotte_map_handover)
├── index.html                   # 통합 메인보드 대시보드
├── lotte_jamsil_map_viewer.html # 에비뉴엘 전용 뷰어
├── lotte_dept_viewer.html       # 백화점 전용 뷰어
├── lotte_castle_viewer.html     # 캐슬플라자 전용 뷰어
├── CLAUDE.md                    # 클로드 코딩 규칙 및 안내서
├── SESSION_HANDOVER.md          # 현재 세션 전체 대화 및 인수인계 문서
├── css/
│   ├── common.css               # 변수, 폰트, 리셋, 아이패드 반응형
│   ├── layout.css               # 헤더, 사이드바, 메인보드 탭, 뷰포트 레이아웃
│   ├── modals.css               # 시설 모달, 축척 모달, 팝오버
│   └── cad-tools.css            # 드로잉 배너, 심벌, 설비 라인 애니메이션 CSS
└── js/
    ├── config/floors.js         # 건물/층 데이터 및 SVG URL, 크롭 좌표, switchCurrentBuilding
    ├── core/
    │   ├── dom.js               # 공통 DOM 셀렉터 레지스트리
    │   ├── geometry.js          # 다각형 연산, 평행 오프셋, 직각 스냅(snapToOrtho)
    │   ├── grid.js              # CAD 바닥 그리드(격자)
    │   ├── panZoom.js           # 줌/패닝, 핀치줌, 마우스무브 러버밴드 프리뷰
    │   └── mapViewer.js         # SVG 로드, 매장/도형 바인딩, 레이어 렌더링
    ├── storage/
    │   ├── storeRepository.js   # 매장/기능실 스펙 로컬 저장소
    │   ├── zoneRepository.js    # 방화구역/제연구획 로컬 저장소
    │   ├── utilityLineRepository.js # 설비 배관/간선 로컬 저장소
    │   └── undoManager.js       # 실행 취소 (Ctrl+Z) 매니저
    ├── cad/
    │   ├── storeEditor.js       # 매장/기능실 추가 및 수정
    │   ├── zoneEditor.js        # 방화구역/제연구획/외벽 드로잉 CAD
    │   ├── symbolEditor.js      # 소방 심벌 4종 CAD
    │   └── utilityLineEditor.js # 기능실(자)-매장(모) 설비 배관/간선 CAD 엔진
    ├── scale/scaleCalibrator.js # 축척 2점 기준선 실측 캘리브레이션
    ├── freehand/freehandLayer.js# 자유 손/펜 메모 및 거리/면적 실측
    └── app.js                   # 메인 부트스트랩, 키보드/마우스 이벤트 디스패처
```

---

## 4. 다른 PC(회사 Claude)에서 바로 이어서 시작하는 명령어

avenuel-fm-apps 폴더에서 Claude에게 아래 문장을 입력하면 맥락이 이어집니다:

> **"`apps/map/SESSION_HANDOVER.md` 파일을 읽고 이전 작업 맥락을 파악한 뒤, 이어서 작업을 진행하자."**
