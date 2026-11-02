#!/usr/bin/env bash
# Whether SoundWave is really working, not only answering: database, Redis, the Celery worker
# and the scheduler. Exits non-zero when something needs attention.
# Usage: scripts/check-readiness.sh [-f docker-compose.prod.yml]
set -euo pipefail
exec docker compose "$@" exec -T soundwave python manage.py readiness
