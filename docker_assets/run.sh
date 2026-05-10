#!/bin/bash

# Don't exit on error - we handle errors ourselves
set +e

echo "Starting SoundWave..."

# Determine if running in production mode
IS_PRODUCTION="false"
if [ "${DJANGO_DEBUG}" = "False" ] || [ "${DJANGO_DEBUG}" = "false" ] || [ -z "${DJANGO_DEBUG}" ]; then
    IS_PRODUCTION="true"
fi

# Ensure data directories exist and are writable
echo "Checking data directories..."
for dir in /app/data /app/audio /app/cache; do
    if [ ! -d "$dir" ]; then
        echo "Creating $dir..."
        mkdir -p "$dir" 2>/dev/null || echo "Warning: Could not create $dir"
    fi
    if [ ! -w "$dir" ]; then
        echo "ERROR: $dir is not writable. Please run: sudo chown -R 1000:1000 $dir"
    fi
done

# Wait for ElasticSearch with better health check
echo "Waiting for ElasticSearch..."
ES_RETRIES=0
ES_MAX_RETRIES=30
while [ $ES_RETRIES -lt $ES_MAX_RETRIES ]; do
    ES_HEALTH=$(curl -s -u elastic:$ELASTIC_PASSWORD $ES_URL/_cluster/health 2>/dev/null)
    if [ $? -eq 0 ] && echo "$ES_HEALTH" | grep -q '"status"'; then
        ES_STATUS=$(echo "$ES_HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        if [ "$ES_STATUS" = "green" ] || [ "$ES_STATUS" = "yellow" ]; then
            echo "ElasticSearch is up! (status: $ES_STATUS)"
            break
        fi
        echo "ElasticSearch status: $ES_STATUS - waiting..."
    else
        echo "ElasticSearch is unavailable - sleeping"
    fi
    sleep 3
    ES_RETRIES=$((ES_RETRIES + 1))
done

if [ $ES_RETRIES -eq $ES_MAX_RETRIES ]; then
    echo "WARNING: ElasticSearch may not be fully ready, continuing anyway..."
fi

# Build Redis URL with optional password
REDIS_URL="redis://${REDIS_HOST}:6379"
if [ -n "${REDIS_PASSWORD}" ]; then
    REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_HOST}:6379"
fi
export REDIS_URL

# Wait for Redis
echo "Waiting for Redis..."
if [ -n "${REDIS_PASSWORD}" ]; then
    until python -c "import redis; r = redis.Redis(host='${REDIS_HOST}', port=6379, password='${REDIS_PASSWORD}'); r.ping()" 2>/dev/null; do
        echo "Redis is unavailable - sleeping"
        sleep 3
    done
else
    until python -c "import redis; r = redis.Redis(host='${REDIS_HOST}', port=6379); r.ping()" 2>/dev/null; do
        echo "Redis is unavailable - sleeping"
        sleep 3
    done
fi
echo "Redis is up!"

# Wait for PostgreSQL when the app is configured to use it.
if [ -n "${DATABASE_URL}" ] || [ -n "${POSTGRES_HOST}" ]; then
    echo "Waiting for PostgreSQL..."
    PG_RETRIES=0
    PG_MAX_RETRIES=30
    while [ $PG_RETRIES -lt $PG_MAX_RETRIES ]; do
        python - <<'PY'
import os
import sys
from urllib.parse import urlparse

try:
    import psycopg
except Exception:
    sys.exit(1)

database_url = os.environ.get('DATABASE_URL', '').strip()
host = os.environ.get('POSTGRES_HOST', '').strip() or 'localhost'
port = os.environ.get('POSTGRES_PORT', '5432').strip() or '5432'
dbname = os.environ.get('POSTGRES_DB', 'soundwave').strip() or 'soundwave'
user = os.environ.get('POSTGRES_USER', 'soundwave').strip() or 'soundwave'
password = os.environ.get('POSTGRES_PASSWORD', '').strip()

if database_url:
    parsed = urlparse(database_url)
    host = parsed.hostname or host
    port = str(parsed.port or port)
    dbname = parsed.path.lstrip('/') or dbname
    user = parsed.username or user
    password = parsed.password or password

dsn = f'host={host} port={port} dbname={dbname} user={user}'
if password:
    dsn = f'{dsn} password={password}'

conn = psycopg.connect(dsn, connect_timeout=3)
conn.close()
PY
        if [ $? -eq 0 ]; then
            echo "PostgreSQL is up!"
            break
        fi
        echo "PostgreSQL is unavailable - sleeping"
        sleep 3
        PG_RETRIES=$((PG_RETRIES + 1))
    done

    if [ $PG_RETRIES -eq $PG_MAX_RETRIES ]; then
        echo "WARNING: PostgreSQL may not be fully ready, continuing anyway..."
    fi
fi

# Create migrations
echo "=== Creating migrations ==="
python manage.py makemigrations

# Run migrations with error handling
echo "=== Running migrations ==="
python manage.py migrate 2>&1
MIGRATE_EXIT=$?

if [ $MIGRATE_EXIT -ne 0 ]; then
    echo "=== Migration failed (exit code: $MIGRATE_EXIT), attempting to fix... ==="
    
    # First try: fake-initial for initial migrations
    echo "Trying --fake-initial..."
    python manage.py migrate --fake-initial 2>&1
    
    if [ $? -ne 0 ]; then
        echo "=== Still failing. Resetting all migration state... ==="
        # Clear all migration history and start fresh
        python manage.py shell << 'FIXMIG'
from django.db import connection
cursor = connection.cursor()
try:
    # Check what tables exist
        tables = connection.introspection.table_names()
    print(f"Existing tables: {tables}")
    
    if 'django_migrations' in tables:
        # Clear problematic migration records
        cursor.execute("DELETE FROM django_migrations WHERE app IN ('user', 'channel', 'audio', 'playlist', 'download', 'stats');")
        connection.commit()
        print("Cleared app migration history")
except Exception as e:
    print(f"Error during fix: {e}")
FIXMIG
        # Try migration again
        python manage.py migrate 2>&1
    fi
fi
echo "=== Migrations complete ==="

# Create superuser if it doesn't exist
python manage.py shell << END
from user.models import Account
if not Account.objects.filter(username='$SW_USERNAME').exists():
    Account.objects.create_superuser('$SW_USERNAME', 'admin@soundwave.local', '$SW_PASSWORD')
    print('Superuser created')
else:
    print('Superuser already exists')
END

# Collect static files
python manage.py collectstatic --noinput

# Start Celery worker in background with proper error handling
# Limit concurrency to avoid SQLite locks
echo "Starting Celery worker..."
celery -A config worker \
    --loglevel=info \
    --concurrency=2 \
    --max-tasks-per-child=100 \
    --time-limit=600 \
    --soft-time-limit=580 \
    --logfile=/tmp/celery-worker.log \
    >> /tmp/celery-worker.log 2>&1 &
WORKER_PID=$!
echo "Celery worker started (PID: $WORKER_PID)"

# Start Celery beat scheduler in background
echo "Starting Celery beat scheduler..."
celery -A config beat \
    --loglevel=info \
    --logfile=/tmp/celery-beat.log \
    >> /tmp/celery-beat.log 2>&1 &
BEAT_PID=$!
echo "Celery beat started (PID: $BEAT_PID)"

# Start Django/Gunicorn server
# Use gunicorn in production for security and performance; runserver in development
echo "Starting Django application..."
if [ "$IS_PRODUCTION" = "true" ]; then
    echo "→ Production mode: Gunicorn"
    exec gunicorn config.wsgi:application \
        --bind 0.0.0.0:8888 \
        --workers 3 \
        --threads 2 \
        --timeout 120 \
        --max-requests 1000 \
        --max-requests-jitter 100 \
        --access-logfile - \
        --error-logfile - \
        --log-level info
else
    echo "→ Development mode: Django runserver"
    python manage.py runserver 0.0.0.0:8888
fi
