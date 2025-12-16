#!/bin/bash

set -e

echo "Starting SoundWave..."

# Wait for ElasticSearch
echo "Waiting for ElasticSearch..."
until curl -s -u elastic:$ELASTIC_PASSWORD $ES_URL/_cluster/health > /dev/null; do
    echo "ElasticSearch is unavailable - sleeping"
    sleep 3
done
echo "ElasticSearch is up!"

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

# Run migrations
echo "=== Running migrations ==="
python manage.py migrate

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
