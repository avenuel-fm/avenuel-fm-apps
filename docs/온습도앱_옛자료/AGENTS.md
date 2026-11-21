# 에비뉴엘 몰 기후 PWA — Agent 작업 안내

본 프로젝트는 상위 `c:\avenuel\AGENTS.md`의 전역 개발 및 디자인 가이드라인을 엄격히 준수합니다.

<!-- ASTRYX:START -->
<!-- astryx-managed sha256:7b8a3492512cdfd3a9119b0524ff944a969695e66bba6531ddf7fca464ec3cb3 -->
Astryx, a design system and UI library by Meta, is available on this computer.
Use it when you build or change UI, pick components, or style or theme an app.
<!-- ASTRYX:END -->

## 🎨 필수 디자인 규칙
- 모든 화면은 `design/tokens.css`의 CSS 변수만 사용합니다.
- 상세 규칙: `design/DESIGN_RULES.md` 및 `design/rules.html` 참조
- 바탕 흰색, 구역은 1px 선(`--line`)으로 분리, 그림자/그라데이션/반투명 금지, 모서리 2px(`--radius`).
- 상단 남색 머리줄(`--header-h: 52px`), 페이지 제목(`--size-xl: 24px`, 굵게).
- 주요 버튼 1개만 남색 채움(`btn-primary`), 보조 버튼은 흰 바탕+남색 테두리(`btn-secondary`), 입력칸 40px(`--control-h`).
- 상태는 색상이 아닌 모양(채움/테두리)과 글자로 구분, 빨강(`--error`)은 오류 문구 전용.
