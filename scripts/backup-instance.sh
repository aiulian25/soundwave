#!/usr/bin/env bash
# A full, consistent backup of one SoundWave instance: the PostgreSQL database and the audio and
# data folders, with checksums. See docs/BACKUP_RESTORE.md for what it covers and how to restore.
#
# Usage: scripts/backup-instance.sh [-f docker-compose.prod.yml] [--output DIR] [--include-secrets]
#
# SoundWave stops while this runs, so the database and the files agree, and starts again afterwards
# even if the backup fails. Redis is left out on purpose: see the runbook.
set -euo pipefail

compose_file=""
output_root="backups"
include_secrets=0
while [ $# -gt 0 ]; do
  case "$1" in
    -f) compose_file="$2"; shift 2 ;;
    --output) output_root="$2"; shift 2 ;;
    --include-secrets) include_secrets=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

compose=(docker compose)
if [ -n "${COMPOSE_COMMAND:-}" ]; then
  read -r -a compose <<< "$COMPOSE_COMMAND"
elif [ -n "$compose_file" ]; then
  compose+=(-f "$compose_file")
fi

umask 077
backup_dir="$output_root/soundwave-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"

restart_app() { "${compose[@]}" start soundwave >/dev/null 2>&1 || echo "WARNING: could not start SoundWave again; start it by hand." >&2; }

echo "==> Recording the running version"
{
  echo "created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "app_version=$("${compose[@]}" exec -T soundwave python -c 'from config.version import APP_VERSION; print(APP_VERSION)' 2>/dev/null | tr -d '\r')"
  echo "app_image=$(docker inspect --format '{{.Image}}' "$("${compose[@]}" ps -q soundwave)" 2>/dev/null)"
  echo "postgres=$("${compose[@]}" exec -T soundwave-pg sh -c 'postgres --version' | tr -d '\r')"
} > "$backup_dir/VERSION"

echo "==> Stopping SoundWave so the database and files agree"
trap restart_app EXIT
"${compose[@]}" stop soundwave >/dev/null

echo "==> Dumping the database"
"${compose[@]}" exec -T soundwave-pg sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"

helper=("${compose[@]}" run --rm --no-deps -T --entrypoint)

echo "==> Recording checksums of every media and data file"
"${helper[@]}" sh soundwave -c 'cd /app && find audio data -type f -print0 | sort -z | xargs -0 -r sha256sum' > "$backup_dir/MANIFEST.sha256"

echo "==> Copying the audio and data folders"
"${helper[@]}" tar soundwave -C /app -cf - audio data > "$backup_dir/files.tar"

if [ "$include_secrets" -eq 1 ]; then
  echo "==> Copying secrets (protect this backup like the secrets themselves)"
  mkdir -p "$backup_dir/secrets"
  [ -f .env ] && cp .env "$backup_dir/secrets/.env"
  "${helper[@]}" cat soundwave /app/cookies.txt > "$backup_dir/secrets/cookies.txt"
fi

( cd "$backup_dir" && sha256sum database.dump files.tar > ARCHIVES.sha256 )

echo "Backup written to $backup_dir"
if [ "$include_secrets" -eq 0 ]; then
  echo "Secrets are not in it. Keep DJANGO_SECRET_KEY (and TOTP_ENC_KEY if set) safe separately:"
  echo "without them, two-factor secrets in the database cannot be read after a restore."
fi
