#!/usr/bin/env bash
# Restores a backup made by scripts/backup-instance.sh onto an EMPTY instance, and proves every file
# came back byte for byte. It refuses to overwrite existing data: move that aside yourself first.
# See docs/BACKUP_RESTORE.md for the order of steps around this script.
#
# Usage: scripts/restore-instance.sh [-f docker-compose.prod.yml] BACKUP_DIR
set -euo pipefail

compose_file=""
backup_dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    -f) compose_file="$2"; shift 2 ;;
    *) backup_dir="$1"; shift ;;
  esac
done
[ -n "$backup_dir" ] || { echo "Usage: $0 [-f compose-file] BACKUP_DIR" >&2; exit 2; }

compose=(docker compose)
if [ -n "${COMPOSE_COMMAND:-}" ]; then
  read -r -a compose <<< "$COMPOSE_COMMAND"
elif [ -n "$compose_file" ]; then
  compose+=(-f "$compose_file")
fi
helper=("${compose[@]}" run --rm --no-deps -T --entrypoint)

echo "==> Checking the backup itself"
( cd "$backup_dir" && sha256sum --check --quiet ARCHIVES.sha256 )
cat "$backup_dir/VERSION"

echo "==> Starting only the database, with SoundWave stopped"
"${compose[@]}" stop soundwave >/dev/null 2>&1 || true
"${compose[@]}" up -d --wait soundwave-pg >/dev/null

table_count=$("${compose[@]}" exec -T soundwave-pg sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from information_schema.tables where table_schema = '"'"'public'"'"'"' | tr -d '\r')
if [ "$table_count" != "0" ]; then
  echo "Refusing: the database already has $table_count tables. Restore onto an empty instance." >&2
  exit 1
fi
existing_files=$("${helper[@]}" sh soundwave -c 'cd /app && find audio data -type f | wc -l' | tr -d '\r ')
if [ "$existing_files" != "0" ]; then
  echo "Refusing: the audio and data folders already hold $existing_files files. Move them aside first." >&2
  exit 1
fi

echo "==> Restoring the database"
"${compose[@]}" exec -T soundwave-pg sh -c 'pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$backup_dir/database.dump"

echo "==> Restoring the audio and data folders"
"${helper[@]}" tar soundwave -C /app -xpf - < "$backup_dir/files.tar"

echo "==> Comparing every restored file with the manifest"
"${helper[@]}" sh soundwave -c 'cd /app && sha256sum --check --quiet' < "$backup_dir/MANIFEST.sha256"

echo "Restored. Start SoundWave with: docker compose up -d"
