#!/usr/bin/env bash
# Proves what .dockerignore lets into a build, without ever packaging anything real: the context
# is a throwaway tree of EMPTY files carrying the names of tracked files, plus harmless sentinels
# named like secrets. Fails if a sentinel gets in, or if a source file the image needs stays out.
# Needs Docker with BuildKit. Leaves no image behind.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
context="$work/context"
mkdir -p "$context"

cp "$repo_root/.dockerignore" "$context/.dockerignore"
cd "$repo_root"
git ls-files backend frontend docker_assets Dockerfile | while IFS= read -r tracked; do
  mkdir -p "$context/$(dirname "$tracked")"
  : > "$context/$tracked"
done

sentinels=(
  .env .env.local .env.bak.20260101 cookies.txt cookies.txt.bak
  backend/.env backend/cookies.txt backend/config/.env.production frontend/.env frontend/src/.env
  backend/private.pem backend/server.key backend/client_secret.json frontend/id_rsa
  audio/sentinel.m4a data/sentinel.db cache/sentinel es/sentinel redis/sentinel backups/sentinel
  backend/dump.sql backend/db.sqlite3 backend/backup.tar.gz backend/old.bak frontend/old.zip
  backend/celerybeat-schedule
  .venv/sentinel backend/.venv/sentinel backend/venv/sentinel
  SOUNDWAVE_REPOSITORY_AUDIT.md backend/SOUNDWAVE_REPOSITORY_AUDIT.md
)
for sentinel in "${sentinels[@]}"; do
  mkdir -p "$context/$(dirname "$sentinel")"
  : > "$context/$sentinel"
done

printf 'FROM scratch\nCOPY . /\n' > "$work/Dockerfile"
docker build --quiet --file "$work/Dockerfile" --output "type=local,dest=$work/out" "$context" >/dev/null

failed=0
for sentinel in "${sentinels[@]}"; do
  if [ -e "$work/out/$sentinel" ]; then
    echo "LEAK: $sentinel reached the build context"
    failed=1
  fi
done

# Tracked source that is excluded on purpose: rebuilt inside the image, or never served.
deliberately_excluded='^(backend/static/assets/|frontend/dist/|frontend/test-results/|frontend/playwright-report/)'
while IFS= read -r tracked; do
  if [ ! -e "$work/out/$tracked" ] && ! [[ "$tracked" =~ $deliberately_excluded ]]; then
    echo "MISSING: $tracked is needed but was excluded"
    failed=1
  fi
done < <(git ls-files backend frontend docker_assets Dockerfile)

if [ "$failed" -ne 0 ]; then
  exit 1
fi
echo "Build context OK: ${#sentinels[@]} secret-like sentinels excluded, all source included."
