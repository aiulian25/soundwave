"""
Django settings for SoundWave project.
"""

import logging
import os
from pathlib import Path
from urllib.parse import urlparse

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent
logger = logging.getLogger(__name__)

# Security settings
_SECRET_KEY_DEFAULT = 'dev-secret-key-change-in-production'
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', _SECRET_KEY_DEFAULT)
DEBUG = os.environ.get('DJANGO_DEBUG', 'False') == 'True'

# Fail loudly if using the default secret key in production
if SECRET_KEY == _SECRET_KEY_DEFAULT and not DEBUG:
    raise ValueError(
        'DJANGO_SECRET_KEY environment variable must be set in production. '
        'Generate one with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"'
    )

# ALLOWED_HOSTS configuration
# Can be set via DJANGO_ALLOWED_HOSTS env var (comma-separated).
# Falls back to SW_HOST / CORS origins and safe localhost defaults.
def _env_bool(name, default=False):
    return os.environ.get(name, 'True' if default else 'False').strip().lower() in {'1', 'true', 'yes', 'on'}


def _split_env_list(name):
    value = os.environ.get(name, '')
    return [item.strip() for item in value.split(',') if item.strip()]


def get_allowed_hosts():
    """Build ALLOWED_HOSTS from environment variables."""
    hosts = set(_split_env_list('DJANGO_ALLOWED_HOSTS'))

    # Support a wildcard host only when explicitly allowed for development.
    if '*' in hosts:
        if not DEBUG and not _env_bool('ALLOW_LOCAL_NETWORK', False):
            raise ValueError(
                'Wildcard ALLOWED_HOSTS is only allowed when DEBUG is enabled or ALLOW_LOCAL_NETWORK is true.'
            )
        return ['*']

    # Extract hostname from SW_HOST.
    sw_host = os.environ.get('SW_HOST', '')
    if sw_host:
        parsed = urlparse(sw_host)
        if parsed.hostname:
            hosts.add(parsed.hostname)

    # Extract hostnames from CORS_ORIGINS (with backward-compatible fallback).
    for origin in _split_env_list('CORS_ORIGINS') or _split_env_list('CORS_ALLOWED_ORIGINS'):
        parsed = urlparse(origin)
        if parsed.hostname:
            hosts.add(parsed.hostname)

    # Safe localhost defaults for development and health checks.
    hosts.update({'localhost', '127.0.0.1'})

    # Local-network access is opt-in and uses explicit hosts only.
    if _env_bool('ALLOW_LOCAL_NETWORK', DEBUG):
        hosts.add('host.docker.internal')
        hosts.update(_split_env_list('LOCAL_NETWORK_IPS'))

    return list(hosts)


ALLOWED_HOSTS = get_allowed_hosts()

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'corsheaders',
    'drf_spectacular',
    'django_celery_beat',
    # SoundWave apps
    'user',
    'common',
    'audio',
    'channel',
    'playlist',
    'download',
    'task',
    'appsettings',
    'stats',
]

ROOT_URLCONF = 'config.urls'

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Security headers (CSP, Referrer-Policy, Permissions-Policy)
    'config.security_middleware.SecurityHeadersMiddleware',
    # Custom middleware for multi-tenancy
    'config.middleware.UserIsolationMiddleware',
    'config.middleware.StorageQuotaMiddleware',
]

if os.environ.get('AUTH_DEBUG', 'false').lower() == 'true':
    MIDDLEWARE.insert(7, 'common.middleware.AuthDebugMiddleware')

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR.parent / 'frontend' / 'dist', BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database
# Use /app/data for persistent storage across container rebuilds
import os
DATA_DIR = os.environ.get('DATA_DIR', '/app/data')
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR, exist_ok=True)


def _build_database_config():
    database_url = os.environ.get('DATABASE_URL', '').strip()
    postgres_host = os.environ.get('POSTGRES_HOST', '').strip()
    postgres_port = os.environ.get('POSTGRES_PORT', '5432').strip() or '5432'
    postgres_db = os.environ.get('POSTGRES_DB', '').strip() or 'soundwave'
    postgres_user = os.environ.get('POSTGRES_USER', '').strip() or 'soundwave'
    postgres_password = os.environ.get('POSTGRES_PASSWORD', '').strip()

    if database_url:
        parsed = urlparse(database_url)
        if parsed.scheme in {'postgres', 'postgresql'}:
            return {
                'default': {
                    'ENGINE': 'django.db.backends.postgresql',
                    'NAME': parsed.path.lstrip('/') or postgres_db,
                    'USER': parsed.username or postgres_user,
                    'PASSWORD': parsed.password or postgres_password,
                    'HOST': parsed.hostname or postgres_host or 'localhost',
                    'PORT': str(parsed.port or postgres_port),
                    'CONN_MAX_AGE': int(os.environ.get('POSTGRES_CONN_MAX_AGE', '60')),
                }
            }
        if parsed.scheme == 'sqlite':
            sqlite_path = parsed.path or os.path.join(DATA_DIR, 'db.sqlite3')
            return {
                'default': {
                    'ENGINE': 'django.db.backends.sqlite3',
                    'NAME': sqlite_path,
                    'OPTIONS': {
                        'timeout': 30,
                    },
                }
            }

    if postgres_host or os.environ.get('POSTGRES_DB') or os.environ.get('POSTGRES_USER') or os.environ.get('POSTGRES_PASSWORD'):
        return {
            'default': {
                'ENGINE': 'django.db.backends.postgresql',
                'NAME': postgres_db,
                'USER': postgres_user,
                'PASSWORD': postgres_password,
                'HOST': postgres_host or 'localhost',
                'PORT': postgres_port,
                'CONN_MAX_AGE': int(os.environ.get('POSTGRES_CONN_MAX_AGE', '60')),
            }
        }

    return {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': os.path.join(DATA_DIR, 'db.sqlite3'),
            'OPTIONS': {
                'timeout': 30,  # Wait up to 30 seconds for lock to be released
            },
        }
    }


DATABASES = _build_database_config()


# Enable SQLite WAL mode for better concurrent access performance
# This is set via direct connection on module load
def enable_wal_mode():
    """Enable WAL mode for SQLite to prevent 'database is locked' errors"""
    if DATABASES['default']['ENGINE'] != 'django.db.backends.sqlite3':
        return

    import sqlite3

    db_path = os.path.join(DATA_DIR, 'db.sqlite3')
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.execute("PRAGMA busy_timeout=30000;")  # 30 second timeout
            conn.close()
            logger.info("[Settings] Enabled WAL mode for SQLite: %s", db_path)
        except Exception as e:
            logger.warning("[Settings] Failed to enable WAL mode: %s", e)

# Try to enable WAL mode on module load
enable_wal_mode()

# Custom user model
AUTH_USER_MODEL = 'user.Account'

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = os.environ.get('TZ', 'UTC')
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = '/assets/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [
    BASE_DIR.parent / 'frontend' / 'dist' / 'assets',
    BASE_DIR.parent / 'frontend' / 'dist',  # For manifest.json, service-worker.js, etc.
]

# WhiteNoise configuration
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = True
WHITENOISE_INDEX_FILE = False  # Don't serve index.html for directories
WHITENOISE_MIMETYPES = {
    '.js': 'application/javascript',
    '.css': 'text/css',
}

# Media files
MEDIA_URL = '/media/'
# Ensure MEDIA_ROOT exists and is writable
MEDIA_ROOT = os.environ.get('MEDIA_ROOT', '/app/audio')
if not os.path.exists(MEDIA_ROOT):
    os.makedirs(MEDIA_ROOT, exist_ok=True)

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Cache configuration (using Redis for rate limiting, with fallback)
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD', '')
_REDIS_AUTH = f":{REDIS_PASSWORD}@" if REDIS_PASSWORD else ""
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': f"redis://{_REDIS_AUTH}{REDIS_HOST}:6379/1",
        'KEY_PREFIX': 'soundwave',
        'TIMEOUT': 3600,  # 1 hour default timeout
    }
}

# Login security settings
MAX_LOGIN_ATTEMPTS = 3  # Number of failed attempts before lockout
LOGIN_LOCKOUT_DURATION = 60 * 60  # 60 minutes in seconds

# Token expiry settings
TOKEN_EXPIRY_HOURS = int(os.environ.get('TOKEN_EXPIRY_HOURS', 24 * 7))  # Default: 7 days
TOKEN_EXPIRY_HOURS_EXTENDED = int(os.environ.get('TOKEN_EXPIRY_HOURS_EXTENDED', 24 * 30))  # Default: 30 days (for "remember me")
# REST Framework
RATELIMIT_ENABLED = _env_bool('RATELIMIT_ENABLED', True)
RATELIMIT_DEFAULT = os.environ.get('RATELIMIT_DEFAULT', '').strip()
MEDIA_RATE_LIMIT_ENABLED = _env_bool('MEDIA_RATE_LIMIT_ENABLED', RATELIMIT_ENABLED)
MEDIA_MAX_CONCURRENT_STREAMS_USER = int(os.environ.get('MEDIA_MAX_CONCURRENT_STREAMS_USER', '20'))
MEDIA_MAX_CONCURRENT_STREAMS_IP = int(os.environ.get('MEDIA_MAX_CONCURRENT_STREAMS_IP', '30'))
MEDIA_STREAM_SLOT_TTL = int(os.environ.get('MEDIA_STREAM_SLOT_TTL', '300'))
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'common.rate_limiter.SustainedRateThrottle',
    ] if RATELIMIT_ENABLED else [],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/minute',
        'burst': '60/minute',
        'sustained': '10000/hour',  # Increased from 1000 to prevent 429 on page load
        'strict_anon': '5/minute',
    },
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# CORS settings
_cors_origins = _split_env_list('CORS_ORIGINS') or _split_env_list('CORS_ALLOWED_ORIGINS')
if _cors_origins:
    CORS_ALLOWED_ORIGINS = _cors_origins
else:
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:8889",
        "http://127.0.0.1:8889",
    ]
CORS_ALLOW_CREDENTIALS = True

# CSRF settings for development cross-origin access
_csrf_trusted_origins = _split_env_list('CORS_ORIGINS') or _split_env_list('CORS_ALLOWED_ORIGINS')
if _csrf_trusted_origins:
    CSRF_TRUSTED_ORIGINS = _csrf_trusted_origins
else:
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:8889",
        "http://127.0.0.1:8889",
    ]

# Compatibility flag for deployment templates that expect a CSRF toggle.
# Django's CSRF protection remains enabled via middleware.
WTF_CSRF_ENABLED = _env_bool('WTF_CSRF_ENABLED', True)

# Determine if running in production/HTTPS mode
# Set SECURE_COOKIES=True in production with HTTPS
_USE_SECURE_COOKIES = os.environ.get('SECURE_COOKIES', 'auto').lower()
if _USE_SECURE_COOKIES == 'auto':
    # If SW_HOST is explicitly HTTP, force non-secure cookies for LAN/dev usability.
    # This avoids setting `Secure` cookies that browsers will not send over HTTP.
    _sw_host = os.environ.get('SW_HOST', '').strip()
    _sw_scheme = urlparse(_sw_host).scheme.lower() if _sw_host else ''
    if _sw_scheme == 'http':
        USE_SECURE_COOKIES = False
    else:
        # Auto-detect: secure if any CORS origin uses HTTPS (excluding localhost)
        _has_https = any(
            origin.startswith('https://') and 'localhost' not in origin
            for origin in CSRF_TRUSTED_ORIGINS
        )
        USE_SECURE_COOKIES = _has_https
elif _USE_SECURE_COOKIES in ('true', '1', 'yes'):
    USE_SECURE_COOKIES = True
else:
    USE_SECURE_COOKIES = False

# Cookie security settings
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SECURE = USE_SECURE_COOKIES
CSRF_COOKIE_HTTPONLY = False  # SPA must read csrf cookie to send X-CSRFToken header

SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = USE_SECURE_COOKIES
SESSION_COOKIE_HTTPONLY = True  # Prevent JavaScript access to session cookie
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days session expiry
SESSION_COOKIE_NAME = 'sw_session'  # Non-default name to reduce fingerprinting

# Additional security settings for production
if USE_SECURE_COOKIES:
    # HSTS - tell browsers to only use HTTPS
    SECURE_HSTS_SECONDS = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    
    # Redirect HTTP to HTTPS (if behind a proxy that handles SSL)
    SECURE_SSL_REDIRECT = os.environ.get('SSL_REDIRECT', 'False') == 'True'
    
    # Proxy SSL header (for nginx/reverse proxy setups)
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

# Security headers
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Spectacular settings
SPECTACULAR_SETTINGS = {
    'TITLE': 'SoundWave API',
    'DESCRIPTION': 'Audio archiving and streaming platform',
    'VERSION': '1.0.0',
}

# Celery settings
CELERY_BROKER_URL = f"redis://{_REDIS_AUTH}{os.environ.get('REDIS_HOST', 'localhost')}:6379/0"
CELERY_RESULT_BACKEND = f"redis://{_REDIS_AUTH}{os.environ.get('REDIS_HOST', 'localhost')}:6379/0"
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE
CELERY_RESULT_EXPIRES = int(os.environ.get('CELERY_RESULT_EXPIRES', str(60 * 60)))

# ElasticSearch settings
ES_URL = os.environ.get('ES_URL', 'http://localhost:92000')
ES_USER = os.environ.get('ELASTIC_USER', 'elastic')
ES_PASSWORD = os.environ.get('ELASTIC_PASSWORD', 'soundwave')

# SoundWave settings
SW_HOST = os.environ.get('SW_HOST', 'http://localhost:123456')
SW_AUTO_UPDATE_YTDLP = os.environ.get('SW_AUTO_UPDATE_YTDLP', 'false') == 'true'

# Last.fm API settings
# Register for API keys at: https://www.last.fm/api/account/create
LASTFM_API_KEY = os.environ.get('LASTFM_API_KEY', '')
LASTFM_API_SECRET = os.environ.get('LASTFM_API_SECRET', '')

# Fanart.tv API settings
# Register for API key at: https://fanart.tv/get-an-api-key/
FANART_API_KEY = os.environ.get('FANART_API_KEY', '')

# Security logging — log auth events and security-relevant actions
# Avoids logging sensitive personal data; focuses on events for anomaly detection
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'security': {
            'format': '[{asctime}] {levelname} {name} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'security',
        },
    },
    'loggers': {
        'django.security': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'security.audit': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
