#!/bin/bash
# 세션을 열 때 GitHub 최신 내용을 자동으로 받습니다. (덮어쓰기 없음: 안전할 때만 받음)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export GIT_TERMINAL_PROMPT=0
cd "$ROOT" || exit 0
[ -d .git ] || { echo "[avenuel-fm-apps] git 저장소가 아님 - 건너뜀"; exit 0; }

if ! timeout 60 git fetch origin 2>/dev/null; then
  echo "[avenuel-fm-apps] GitHub에 연결하지 못함 (인터넷/로그인 확인) - 건너뜀"; exit 0
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "[avenuel-fm-apps] 저장 안 된 수정이 있어 자동 받기를 건너뜀 - 직접 확인 필요"; exit 0
fi
if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  echo "[avenuel-fm-apps] 지금 갈래($(git branch --show-current))는 GitHub와 연결되지 않아 건너뜀"; exit 0
fi
before=$(git rev-parse HEAD)
if git pull --ff-only >/dev/null 2>&1; then
  after=$(git rev-parse HEAD)
  if [ "$before" = "$after" ]; then
    echo "[avenuel-fm-apps] 이미 최신 (갈래: $(git branch --show-current))"
  else
    echo "[avenuel-fm-apps] 새로 받음 ($(git rev-list --count "$before..$after")개 변경):"
    git log --oneline "$before..$after" | head -10
    git diff --name-only "$before..$after" | grep -q '^apps/ws/package.json$' && echo "  ※ apps/ws 에서 npm install 을 다시 해야 할 수 있음"
  fi
else
  echo "[avenuel-fm-apps] 자동 받기 실패 (다른 PC 작업과 갈라졌을 수 있음) - 직접 확인 필요"
fi
