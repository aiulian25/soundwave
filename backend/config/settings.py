"""
Django settings for SoundWave project.
"""

import os
from pathlib import Path
from urllib.parse import urlparse

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent

# Security settings
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-secret-key-change-in-production')
DEBUG = os.environ.get('DJANGO_DEBUG', 'False') == 'True'

# ALLOWED_HOSTS configuration
# Can be set via DJANGO_ALLOWED_HOSTS env var (comma-separated)
# Falls back to extracting hostname from SW_HOST, or defaults to localhost
def get_allowed_hosts():
    """Build ALLOWED_HOSTS from environment variables."""
    import re
    
    hosts = set()
    
    # Check for explicit DJANGO_ALLOWED_HOSTS
    env_hosts = os.environ.get('DJANGO_ALLOWED_HOSTS', '')
    if env_hosts:
        hosts.update(h.strip() for h in env_hosts.split(',') if h.strip())
    
    # Extract hostname from SW_HOST
    sw_host = os.environ.get('SW_HOST', '')
    if sw_host:
        parsed = urlparse(sw_host)
        if parsed.hostname:
            hosts.add(parsed.hostname)
    
    # Extract hostnames from CORS_ALLOWED_ORIGINS
    cors_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '')
    if cors_origins:
        for origin in cors_origins.split(','):
            parsed = urlparse(origin.strip())
            if parsed.hostname:
                hosts.add(parsed.hostname)
    
    # Default safe hosts for development
    if not hosts:
        hosts = {'localhost', '127.0.0.1'}
    
    # Always include localhost for health checks
    hosts.add('localhost')
    hosts.add('127.0.0.1')
    
    # Allow local network access (private IP ranges)
    # This is safe as these IPs are not routable from the internet
    if os.environ.get('ALLOW_LOCAL_NETWORK', 'True') == 'True':
        # Add Docker internal hosts
        hosts.add('host.docker.internal')
        
        # Add explicit local network IPs from env var
        local_ips = os.environ.get('LOCAL_NETWORK_IPS', '')
        if local_ips:
            hosts.update(ip.strip() for ip in local_ips.split(',') if ip.strip())
        
        # Add common local network subnets (192.168.0.x and 192.168.1.x)
        # These are the most common home network ranges
        for subnet in [0, 1]:
            for host_num in range(1, 255):
                hosts.add(f'192.168.{subnet}.{host_num}')
        
        # Add 10.0.0.x range as well (common for some routers)
        for host_num in range(1, 255):
            hosts.add(f'10.0.0.{host_num}')
    
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

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'common.middleware.AuthDebugMiddleware',  # Debug authentication
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # Custom middleware for multi-tenancy
    'config.middleware.UserIsolationMiddleware',
    'config.middleware.StorageQuotaMiddleware',
]

ROOT_URLCONF = 'config.urls'

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

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': os.path.join(DATA_DIR, 'db.sqlite3'),
        'OPTIONS': {
            'timeout': 30,  # Wait up to 30 seconds for lock to be released
        },
    }
}

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
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': f"redis://{REDIS_HOST}:6379/1",
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
REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'common.rate_limiter.SustainedRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'login': '10/minute',
        'burst': '30/minute',
        'sustained': '1000/hour',
        'strict_anon': '5/minute',
    },
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# CORS settings
CORS_ALLOWED_ORIGINS_ENV = os.environ.get('CORS_ALLOWED_ORIGINS', '')
if CORS_ALLOWED_ORIGINS_ENV:
    CORS_ALLOWED_ORIGINS = [origin.strip() for origin in CORS_ALLOWED_ORIGINS_ENV.split(',')]
else:
    CORS_ALLOWED_ORIGINS = [
        "http://localhost:8889",
        "http://127.0.0.1:8889",
        "http://192.168.50.71:8889",
    ]
CORS_ALLOW_CREDENTIALS = True

# CSRF settings for development cross-origin access
CSRF_TRUSTED_ORIGINS_ENV = os.environ.get('CORS_ALLOWED_ORIGINS', '')
if CSRF_TRUSTED_ORIGINS_ENV:
    CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in CSRF_TRUSTED_ORIGINS_ENV.split(',')]
else:
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:8889",
        "http://127.0.0.1:8889",
        "http://192.168.50.71:8889",
    ]

# Determine if running in production/HTTPS mode
# Set SECURE_COOKIES=True in production with HTTPS
_USE_SECURE_COOKIES = os.environ.get('SECURE_COOKIES', 'auto').lower()
if _USE_SECURE_COOKIES == 'auto':
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
CSRF_COOKIE_HTTPONLY = True  # Prevent JavaScript access to CSRF cookie

SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = USE_SECURE_COOKIES
SESSION_COOKIE_HTTPONLY = True  # Prevent JavaScript access to session cookie
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7  # 7 days session expiry

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
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin' if USE_SECURE_COOKIES else None
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Spectacular settings
SPECTACULAR_SETTINGS = {
    'TITLE': 'SoundWave API',
    'DESCRIPTION': 'Audio archiving and streaming platform',
    'VERSION': '1.0.0',
}

# Celery settings
CELERY_BROKER_URL = f"redis://{os.environ.get('REDIS_HOST', 'localhost')}:6379/0"
CELERY_RESULT_BACKEND = f"redis://{os.environ.get('REDIS_HOST', 'localhost')}:6379/0"
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = TIME_ZONE

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
