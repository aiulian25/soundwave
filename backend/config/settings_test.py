"""Test settings — self-contained so `manage.py test` runs without Redis/ES/Postgres.

Usage:
    python manage.py test --settings=config.settings_test
"""

import os

# Set safe defaults BEFORE importing the base settings (which reads these at import
# time and creates data/media directories). Keeps tests off /app and out of prod paths.
os.environ.setdefault('DJANGO_DEBUG', 'True')
os.environ.setdefault('DJANGO_SECRET_KEY', 'test-only-secret-key-not-for-production')
os.environ.setdefault('DATA_DIR', '/tmp/sw_test_data')
os.environ.setdefault('MEDIA_ROOT', '/tmp/sw_test_media')

from config.settings import *  # noqa: F401,F403,E402

# Fast, isolated in-memory database.
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Local-memory cache so rate-limiting / lockout code has a working backend without Redis.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'sw-test',
    }
}

# Keep throttling out of the way of functional assertions.
RATELIMIT_ENABLED = False
MEDIA_RATE_LIMIT_ENABLED = False

# Fast password hashing for tests.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
