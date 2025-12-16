"""
Django settings for SoundWave project.
"""

import os
from pathlib import Path

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent

# Security settings
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'dev-secret-key-change-in-production')
DEBUG = os.environ.get('DJANGO_DEBUG', 'False') == 'True'
ALLOWED_HOSTS = ['*']

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

# REST Framework
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 50,
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

# CORS settings
CORS_ALLOWED_ORIGINS = [
    "http://localhost:8889",
    "http://127.0.0.1:8889",
    "http://192.168.50.71:8889",
]
CORS_ALLOW_CREDENTIALS = True

# CSRF settings for development cross-origin access
CSRF_TRUSTED_ORIGINS = [
    "http://localhost:8889",
    "http://127.0.0.1:8889",
    "http://192.168.50.71:8889",
]
CSRF_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SECURE = False
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_SECURE = False

# Security headers for development
SECURE_CROSS_ORIGIN_OPENER_POLICY = None  # Disable COOP header for development

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
