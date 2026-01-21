#!/bin/bash

# Don't exit on error - we handle errors ourselves
set +e

echo "Starting SoundWave..."

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

# Wait for Redis
echo "Waiting for Redis..."
until python -c "import redis; r = redis.Redis(host='${REDIS_HOST}', port=6379); r.ping()" 2>/dev/null; do
    echo "Redis is unavailable - sleeping"
    sleep 3
done
echo "Redis is up!"

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
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]
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

# Start Celery worker in background
celery -A config worker --loglevel=info &

# Start Celery beat in background
celery -A config beat --loglevel=info &

# Start Django server
python manage.py runserver 0.0.0.0:8888
