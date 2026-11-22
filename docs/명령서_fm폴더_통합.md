# 명령서: fm 폴더를 avenuel-fm-apps 한 곳으로 합치기

작성: 2026-11-22 (집 PC) · 실행: 회사 PC · **코딩 전 설계 문서. 직원 화면 주소는 바뀌지 않습니다.**

## 0. 왜 둘로 나뉘어 있었나 (추정)

- 직원이 쓰는 화면 주소 `avenuel-fm.github.io/fm/` 는 **저장소 이름이 `fm`** 이어야 나옵니다. (GitHub Pages 규칙: 주소 = 계정 + 저장소 이름)
- 그래서 `fm` 저장소가 따로 만들어졌고, 작업장 `avenuel-fm-apps` 안에도 `fm/` 사본을 두고 빌드 도구가 거기에 결과를 만듭니다. 둘 사이는 사람이 복사했습니다.
- 지금 두 곳은 71개 파일이 동일합니다 (집 PC 확인, 줄 끝 문자만 다름).

## 1. 목표 구조

```
avenuel-fm-apps/          ← 유일한 원본 (모든 작업은 여기서)
  apps/ docs/ ...
  fm/                     ← 화면 파일 원본 (지금 그대로)
  .github/workflows/deploy-fm.yml   ← 새로 추가: 버튼 한 번으로 fm 저장소에 복사

fm (저장소)               ← 직원 화면용 "복사본". 직접 고치지 않음 (자동으로 채워짐)
```

- 주소·QR·TinyURL(`avenuel-dr` 등)은 **그대로**입니다. 직원 쪽 변화 없음.
- 복사는 **사람이 버튼을 누를 때만** 일어납니다 (push 해도 자동 배포 안 됨). 직원이 쓰는 중에 갑자기 바뀌는 일이 없습니다.

## 2. 검토한 다른 방법과 채택하지 않은 이유

| 방법 | 문제 |
|---|---|
| `fm` 저장소를 `avenuel-fm-apps/fm`에 서브모듈로 넣기 | 이미 `fm/` 안에 같은 파일이 있어 충돌. 서브모듈은 비개발자가 다루기 어렵고 커밋이 두 번(안쪽, 바깥쪽) 필요 |
| `avenuel-fm-apps` 자체를 Pages로 공개 | Pages는 저장소 맨 위 또는 `docs/` 폴더만 가능, 주소가 `…/avenuel-fm-apps/`로 바뀌어 **QR·TinyURL·바로가기가 모두 깨짐**. 설계 문서까지 공개됨 |
| **GitHub Actions로 `fm/` → `fm` 저장소 복사 (채택)** | 주소 불변, 원본 한 곳, 복사는 수동 버튼 |

## 3. 작업 순서 (회사 PC)

### 단계 0. 사전 확인 (바꾸는 것 없음)
1. 두 저장소를 최신으로 받기(앱 시작 시 자동 받기가 합니다).
2. `fm` 저장소에만 있는 파일이 없는지: `fm` 저장소 파일 목록과 `avenuel-fm-apps/fm/` 목록 비교. 있으면(예: `CNAME`, `.nojekyll`, `README`) 먼저 `avenuel-fm-apps/fm/` 안에 같은 파일을 만들어 둡니다. (3단계 복사가 `fm` 저장소를 원본과 똑같이 맞추므로, 빠진 파일은 지워집니다.)
3. `fm` 저장소 Settings → Pages 가 `main` 브랜치 / 루트(/) 인지 기록.
4. 파일 내용 비교(줄 끝 문자 무시)로 71개가 모두 같은지 확인. 다르면 **어느 쪽이 최신인지 사람이 결정**한 뒤 맞춥니다.

### 단계 1. 복사용 열쇠(토큰) 만들기 — 직접 하셔야 합니다
- GitHub → Settings → Developer settings → Fine-grained tokens → 새 토큰
  - 대상 저장소: **`fm` 하나만**, 권한: Contents = Read and write
  - 기간: 1년(만료 날짜를 달력에 적어 두기)
- `avenuel-fm-apps` 저장소 → Settings → Secrets and variables → Actions → 새 비밀값 이름 `FM_DEPLOY_TOKEN` 에 붙여넣기.
- 토큰 값은 채팅·문서·파일에 적지 않습니다.

### 단계 2. 복사 설정 파일 추가
`avenuel-fm-apps/.github/workflows/deploy-fm.yml` 를 새로 만듭니다 (아래 초안). **연습 모드가 기본값**이라 처음엔 아무것도 올라가지 않습니다.

```yaml
name: fm 저장소로 복사
on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: "연습만 하기 (true면 바뀔 목록만 보여주고 올리지 않음)"
        default: "true"
concurrency: deploy-fm
jobs:
  copy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: avenuel-fm/fm
          token: ${{ secrets.FM_DEPLOY_TOKEN }}
          path: _fm_target
      - name: 복사
        run: rsync -a --delete --exclude='.git' fm/ _fm_target/
      - name: 바뀐 목록
        working-directory: _fm_target
        run: git status --short
      - name: 올리기
        if: ${{ github.event.inputs.dry_run == 'false' }}
        working-directory: _fm_target
        run: |
          git config user.name "fm-deploy"
          git config user.email "fm-deploy@users.noreply.github.com"
          git add -A
          git diff --cached --quiet || git commit -m "avenuel-fm-apps ${GITHUB_SHA::7} 에서 복사"
          git push
```
(`actions/checkout` 버전은 실행 당시 최신 안정판으로 확인.)

### 단계 3. 연습 실행
- 저장소 Actions 탭 → "fm 저장소로 복사" → Run workflow → 연습만 하기 = true.
- 로그의 「바뀐 목록」이 **비어 있어야 정상**입니다 (파일이 이미 같으므로). 줄 끝 문자 때문에 `dw/index.html` 등이 보이면 `.gitattributes`로 줄 끝을 통일하거나 그대로 올려도 화면에는 영향 없음.
- 목록에 **삭제(D)가 있으면 멈추고** 단계 0-2로 돌아갑니다.

### 단계 4. 실제 실행 (직원이 안 쓰는 시간 권장)
- 연습 결과가 비어 있거나 의도한 것만 있을 때 dry_run = false 로 실행.
- 5분 뒤 확인: `…/fm/` 첫 화면, `…/fm/ws/`, `…/fm/dw/`, `…/fm/map/`, `…/fm/hub/` 열림 + 로그인 화면, QR 점검 화면(`?eq=`) 1개.

### 단계 5. 규칙 문서 고치기 (실행이 끝난 뒤)
- `CLAUDE.md` 의 `fm/` 설명과 61행: "수동으로 fm 저장소에 올림" → "Actions 탭에서 복사 실행 (연습 → 실제)".
- `apps/dw/설치_및_테스트_안내.md` 등의 "바로가기 저장소에 올리기" 문구는 같은 방식으로 정리 (한꺼번에 하지 않고 건드릴 때마다).
- `fm` 저장소 README 에 "자동 복사본, 직접 수정 금지(원본: avenuel-fm-apps/fm)" 한 줄 (이 README는 `avenuel-fm-apps/fm/README.md` 로 넣어야 복사 때 지워지지 않음).

### 단계 6. 정리
- 집·회사 PC 의 `Desktop/app/fm` 폴더는 이제 **볼 필요 없음**. 최소 2주 사용해 보고 문제없으면 삭제합니다. 자동 받기 설정(`.claude/sync-github.sh`)에서 `fm` 항목도 이때 뺍니다.

## 4. 되돌리기

- 복사로 잘못 올라간 경우: `fm` 저장소에서 마지막 "…에서 복사" 커밋을 되돌리기(Revert) → 1~2분 안에 이전 화면 복구.
- 설정 파일(`deploy-fm.yml`)만 지우면 예전 방식(손 복사)으로 즉시 복귀. 다른 것은 바뀐 게 없습니다.

## 5. 주의

- 이 작업의 코드 변경은 새 파일 1개(`deploy-fm.yml`)뿐. 앱 코드·구글 배포·DB 는 건드리지 않습니다.
- 토큰 만료일이 지나면 복사가 실패합니다 (직원 화면은 그대로 유지, 복사만 안 됨). 만료 전 갱신.
- 이 문서의 Pages 설정·`fm` 저장소 파일 목록은 **회사에서 직접 확인해야 하는 가정**입니다 (집 PC에서 GitHub 설정 화면은 보지 않았습니다).
