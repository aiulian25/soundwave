#!/usr/bin/env bash
#
# Rotate SoundWave service secrets (DEP-01) on a RUNNING deployment.
#
# Why a script: for Postgres and Elasticsearch the password is only set on first
# volume init, so editing .env alone makes the app use a new password while the
# datastore still holds the old one — auth breaks. This applies the new secrets to
# the LIVE services (Postgres ALTER USER, Elasticsearch password API, Redis recreate)
# AND updates .env, so rotation completes without data loss.
#
# Usage:
#   scripts/rotate-secrets.sh [-f docker-compose.prod.yml] [--dry-run] [--yes]
#
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.prod.yml"
DRY_RUN=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    -f) COMPOSE_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -f .env ] || { echo "ERROR: .env not found in $(pwd)"; exit 1; }
[ -f "$COMPOSE_FILE" ] || { echo "ERROR: compose file '$COMPOSE_FILE' not found"; exit 1; }

DC="docker compose -f $COMPOSE_FILE"

getenv() { grep -E "^$1=" .env | head -1 | cut -d= -f2- || true; }

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

PG_USER="$(getenv POSTGRES_USER)"; PG_USER="${PG_USER:-soundwave}"
PG_DB="$(getenv POSTGRES_DB)"; PG_DB="${PG_DB:-soundwave}"
OLD_PG="$(getenv POSTGRES_PASSWORD)"
OLD_ES="$(getenv ELASTIC_PASSWORD)"

NEW_PG="$(gen_secret)"
NEW_REDIS="$(gen_secret)"
NEW_ES="$(gen_secret)"

echo "This will rotate Postgres, Redis, and Elasticsearch passwords on the running"
echo "stack ($COMPOSE_FILE) and update .env. A timestamped .env backup is kept."
if [ "$DRY_RUN" -eq 1 ]; then echo "(dry-run: no changes will be made)"; fi
if [ "$ASSUME_YES" -ne 1 ] && [ "$DRY_RUN" -ne 1 ]; then
  read -r -p "Continue? [y/N] " ans
  case "$ans" in y|Y) ;; *) echo "Aborted."; exit 0 ;; esac
fi

run() { if [ "$DRY_RUN" -eq 1 ]; then echo "DRY-RUN> $*"; else eval "$@"; fi; }

# Ensure the datastores are up before we try to talk to them.
if [ "$DRY_RUN" -ne 1 ]; then
  $DC ps soundwave-pg  >/dev/null 2>&1 || { echo "ERROR: soundwave-pg not running"; exit 1; }
  $DC ps soundwave-es  >/dev/null 2>&1 || { echo "ERROR: soundwave-es not running"; exit 1; }
fi

echo "==> Rotating Postgres password (ALTER USER ${PG_USER})"
run "$DC exec -T -e PGPASSWORD='$OLD_PG' soundwave-pg \
      psql -h 127.0.0.1 -U '$PG_USER' -d '$PG_DB' \
      -c \"ALTER USER \\\"$PG_USER\\\" WITH PASSWORD '$NEW_PG';\""

echo "==> Rotating Elasticsearch 'elastic' password (security API)"
run "$DC exec -T soundwave-es \
      curl -fsS -u 'elastic:$OLD_ES' -X POST \
      'http://localhost:9200/_security/user/elastic/_password' \
      -H 'Content-Type: application/json' -d '{\"password\":\"$NEW_ES\"}'"

echo "==> Backing up .env and writing new secrets"
if [ "$DRY_RUN" -ne 1 ]; then
  cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
  sed -i.tmp \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$NEW_PG|" \
    -e "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$NEW_REDIS|" \
    -e "s|^ELASTIC_PASSWORD=.*|ELASTIC_PASSWORD=$NEW_ES|" \
    .env && rm -f .env.tmp
  chmod 600 .env 2>/dev/null || true
fi

echo "==> Recreating containers to pick up the new secrets"
# Postgres/Elasticsearch ignore the *_PASSWORD env on an existing volume and keep the
# value we just set above; Redis reads --requirepass fresh; the app reconnects.
run "$DC up -d"

echo "Done. Old passwords are now rejected. Backup: .env.bak.* (delete once verified)."
