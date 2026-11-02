#!/usr/bin/env bash
# Checks this checkout and any running stack. Each check says PASS, FAIL or SKIP, and SKIP never
# counts as passing: it means that check could not run here. Changes nothing.
# Exits non-zero if anything failed.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

passed=0
failed=0
skipped=0

pass() { echo "PASS  $1"; passed=$((passed + 1)); }
fail() { echo "FAIL  $1"; failed=$((failed + 1)); }
skip() { echo "SKIP  $1 ($2)"; skipped=$((skipped + 1)); }

run_check() {
  local description="$1"
  shift
  if "$@" >/dev/null 2>&1; then pass "$description"; else fail "$description"; fi
}

if command -v python3 >/dev/null 2>&1; then
  run_check "Python settings compile" python3 -m py_compile backend/config/settings.py
else
  skip "Python settings compile" "python3 not installed"
fi

for ignored in .env cookies.txt audio/sample.m4a data/db.sqlite3 backups/sample.dump; do
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    run_check "$ignored is ignored by git" git check-ignore -q "$ignored"
  else
    skip "$ignored is ignored by git" "not a git checkout"
  fi
done

if ! command -v docker >/dev/null 2>&1; then
  skip "Compose files are valid" "docker not installed"
  skip "Build context excludes secrets" "docker not installed"
  skip "Running stack is ready" "docker not installed"
else
  if [ -f .env ]; then
    run_check "docker-compose.yml is valid" docker compose -f docker-compose.yml config --quiet
    run_check "docker-compose.prod.yml is valid" docker compose -f docker-compose.prod.yml config --quiet
  else
    skip "Compose files are valid" "no .env file to read required values from"
  fi
  run_check "Build context excludes secrets" scripts/check-build-context.sh

  if [ -n "$(docker compose ps -q soundwave 2>/dev/null)" ]; then
    run_check "Running stack is ready" scripts/check-readiness.sh
  else
    skip "Running stack is ready" "no SoundWave container running here"
  fi
fi

if [ -d frontend/node_modules ]; then
  run_check "Frontend lint" sh -c 'cd frontend && npm run lint'
  run_check "Frontend types" sh -c 'cd frontend && npx tsc --noEmit -p .'
  run_check "Frontend unit tests" sh -c 'cd frontend && npm test'
else
  skip "Frontend lint, types and unit tests" "run npm ci in frontend/ first"
fi

echo
echo "$passed passed, $failed failed, $skipped skipped"
if [ "$failed" -ne 0 ]; then
  exit 1
fi
