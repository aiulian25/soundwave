"""What the whole system needs to be doing its job, beyond the web process answering.

Every check is bounded and none fails loudly: an operator reading this during an outage needs
the full picture, not the first exception.
"""

import time

from django.conf import settings
from django.core.cache import cache
from django.db import Error as DatabaseError, connection
from kombu.exceptions import OperationalError as BrokerError
from redis import Redis, RedisError

HEARTBEAT_KEY = 'system_heartbeat'
# Set well beyond the interval, so one late run is not an alarm.
HEARTBEAT_INTERVAL_SECONDS = 60
HEARTBEAT_STALE_SECONDS = 3 * HEARTBEAT_INTERVAL_SECONDS
HEARTBEAT_LIFETIME_SECONDS = 24 * 60 * 60
CHECK_TIMEOUT_SECONDS = 2
WORKER_PING_TIMEOUT_SECONDS = 1
REDIS_PRESSURE_RATIO = 0.8


def record_heartbeat():
    cache.set(HEARTBEAT_KEY, time.time(), HEARTBEAT_LIFETIME_SECONDS)


def _check_database():
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except DatabaseError as error:
        return {'ok': False, 'detail': type(error).__name__}
    return {'ok': True}


def _check_redis():
    from config.celery import DEFAULT_QUEUE_NAME, DOWNLOAD_QUEUE_NAME

    client = Redis.from_url(
        settings.CELERY_BROKER_URL,
        socket_connect_timeout=CHECK_TIMEOUT_SECONDS,
        socket_timeout=CHECK_TIMEOUT_SECONDS,
    )
    try:
        memory = client.info('memory')
        queued_tasks = client.llen(DEFAULT_QUEUE_NAME)
        queued_downloads = client.llen(DOWNLOAD_QUEUE_NAME)
    except (RedisError, OSError) as error:
        return {'ok': False, 'detail': type(error).__name__}
    finally:
        client.close()

    used, limit = memory.get('used_memory', 0), memory.get('maxmemory', 0)
    return {
        'ok': True,
        'queued_tasks': queued_tasks,
        'queued_downloads': queued_downloads,
        'used_memory_bytes': used,
        'max_memory_bytes': limit,
        'under_pressure': bool(limit) and used / limit >= REDIS_PRESSURE_RATIO,
    }


def _check_worker():
    """One worker per queue: with either missing, that queue's work would only pile up."""
    from config.celery import WORKERS_EXPECTED, app

    try:
        replies = app.control.ping(timeout=WORKER_PING_TIMEOUT_SECONDS)
    except (BrokerError, RedisError, OSError) as error:
        return {'ok': False, 'detail': type(error).__name__}
    return {'ok': len(replies) >= WORKERS_EXPECTED, 'workers': len(replies)}


def _check_scheduler():
    """The scheduler's own heartbeat, carried out by a worker. A worker down makes this stale too."""
    try:
        last_beat = cache.get(HEARTBEAT_KEY)
    except (RedisError, OSError) as error:
        return {'ok': False, 'detail': type(error).__name__}
    if last_beat is None:
        return {'ok': False, 'detail': 'no heartbeat yet'}
    age_seconds = int(time.time() - last_beat)
    return {'ok': age_seconds <= HEARTBEAT_STALE_SECONDS, 'last_heartbeat_seconds_ago': age_seconds}


def readiness_report():
    checks = {
        'database': _check_database(),
        'redis': _check_redis(),
        'worker': _check_worker(),
        'scheduler': _check_scheduler(),
    }
    return {'ready': all(check['ok'] for check in checks.values()), 'checks': checks}
