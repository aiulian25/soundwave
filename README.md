# 🎵 SoundWave

![SoundWave Banner](https://img.shields.io/badge/SoundWave-Audio%20Archive-5C6BC0?style=for-the-badge)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**SoundWave** is a self-hosted audio archiving and streaming platform inspired by TubeArchivist. Download, organize, and enjoy your YouTube audio collection offline through a beautiful dark-themed web interface.

## ✨ Features

### Core Features
- 🎧 **Audio-Only Downloads** - Extract high-quality audio from YouTube using yt-dlp
- 📚 **Smart Organization** - Index audio files with full metadata (title, artist, duration, etc.)
- 🔍 **Powerful Search** - Find your audio quickly with ElasticSearch-powered indexing
- 🎵 **Built-in Player** - Stream your collection directly in the browser
- ▶️ **Auto-Play / Continuous Playback** - Automatically plays next track in queue
- 🔁 **Repeat Modes** - Repeat one track, repeat all, or normal playback
- 🔀 **Shuffle** - Smart shuffle and regular shuffle modes
- 📊 **Channel Subscriptions** - Subscribe to YouTube channels and automatically download new audio
- 📝 **Playlists** - Create custom playlists or sync YouTube playlists
- 🔄 **Force Recheck** - Per-playlist force recheck to verify and re-download missing files
- ✨ **Smart Playlists** - Dynamic auto-updating playlists based on rules (Most Played, Recently Added, Genre filters, and more)
- 🌐 **Multi-Language UI** - Full English and Romanian translations across all pages

### Analytics & Achievements
- 🏆 **Achievements System** - 37 unlockable achievements across 6 categories (Tracks, Hours, Streaks, Artists, Channels, Special)
- 🔥 **Listening Streaks** - Track daily listening streaks with visual weekly activity grid
- 📅 **Yearly Wrapped** - Spotify-style year-in-review with top artists, tracks, and personalized insights
- 🎉 **Achievement Notifications** - Real-time celebration popup with confetti when unlocking achievements
- 📈 **Listening History** - Complete history of played tracks with "On This Day" memories
- 📊 **Analytics Dashboard** - Detailed listening insights, genre breakdown, peak hours, and more

### Lyrics Features
- 🎤 **Synced Lyrics** - Display lyrics in sync with music playback (online & offline)
- 📤 **LRC Upload** - Upload your own .lrc files for synced lyrics
- 🔎 **Lyrics Search** - Search and apply lyrics from LRCLIB database
- 💾 **Persistent Lyrics** - Uploaded lyrics are saved permanently with the track

### Export & Download
- 📥 **Export Dialog** - Export tracks as MP3 or FLAC with embedded metadata
- 🎵 **Embedded Lyrics** - Export with synced lyrics (SYLT for MP3, LRC for FLAC)
- 🖼️ **Embedded Artwork** - Include album art in exported files
- 🎚️ **Quality Selection** - Choose export quality (320kbps, 192kbps, 128kbps)

### PWA & Offline Features
- 📱 **PWA Support** - Install as mobile/desktop app with rounded app icon
- 💾 **Full Offline Playback** - Cache playlists with audio, lyrics, and metadata for offline use
- 🔄 **Background Caching** - Non-blocking progress indicator while caching
- 🖼️ **Media Session Artwork** - Album art in system notifications (all browsers)
- 🔋 **Battery Efficient** - Lightweight frontend with no background polling; server handles all heavy work
- ⚙️ **Configurable Sync** - Optional cross-device playback sync (can be disabled in settings)

### Visual & UI
- 🌙 **Dark Theme** - Beautiful Material Design dark UI
- 🎨 **Audio Visualizer** - Multiple visualization themes (Classic, Neon, Minimal, etc.)
- 📐 **Responsive Grid** - 2-column layout on mobile, scales to 4 columns on desktop
- 🖼️ **Offline Fallbacks** - Album art fallback icons when offline

### Other Features
- 📈 **Statistics** - Track plays, downloads, and library stats
- 🔐 **User Management** - Multi-user support with authentication
- ⚡ **Background Tasks** - Celery-powered async downloads and updates
- 💾 **Persistent Storage** - Data survives container rebuilds
- 🚫 **Smart Error Handling** - Automatically skips permanently unavailable videos (copyright blocked, private, removed)
- 🗑️ **Deleted Video Detection** - Detects `[Deleted video]` / `[Private video]` entries from YouTube, skips download attempts, and preserves locally-kept copies
- 👤 **Admin User Management** - Full user deletion with cascade cleanup of audio files, channels, playlists, and avatars

## 🏗️ Architecture

- **Backend**: Django REST Framework (Python)
- **Frontend**: React + TypeScript + Material-UI
- **Database**: PostgreSQL (SQLite fallback for local development)
- **Search Engine**: ElasticSearch
- **Task Queue**: Celery + Redis
- **Audio Extraction**: yt-dlp + FFmpeg
- **Containerization**: Docker

## 📋 Prerequisites

- **Docker** (version 20.10+) and **Docker Compose V2** (`docker compose`, not the old `docker-compose`)
- **Python 3** on the host (for generating secrets in Step 3 — usually pre-installed)
- 2-4GB available RAM
- Dual-core CPU (quad-core recommended)
- Storage space for your audio library

## ⚠️ Important Notes

### Elasticsearch Version Update (v9.0.0)

As of February 2026, SoundWave uses **Elasticsearch 9.0.0**. If you're upgrading from a previous installation that used Elasticsearch 8.x:

- **New installations**: No action needed, just follow the Quick Start guide.
- **Existing installations with ES 8.x data**: Your data will be automatically upgraded on first start with ES 9.x.
- **Downgrade warning**: If you previously ran ES 9.x and try to use ES 8.x, it will fail because Lucene index formats are not backwards compatible. Always ensure your docker-compose uses ES 9.0.0 or later.

If you encounter Elasticsearch startup errors mentioning "Lucene912 codec not found", update your `docker-compose.yml` to use `elasticsearch:9.0.0` or delete the ES volume to start fresh:
```bash
docker compose down
docker volume rm soundwave_es_data  # Warning: this deletes search index data
docker compose up -d
```

## 🚀 Quick Start

### Step 1: Download Files

```bash
# Create a directory for SoundWave
mkdir soundwave && cd soundwave

# Download docker-compose.yml
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/docker-compose.prod.yml -O docker-compose.yml
```

### Step 2: Create Data Directories

**Important:** Docker needs these directories and files to exist before starting.

```bash
# Create directories
mkdir -p ./audio ./cache ./data

# Create an empty cookies.txt (required by the container — add YouTube cookies here if needed)
touch ./cookies.txt

# Set permissions for container user (1000:1000)
sudo chown -R 1000:1000 ./audio ./cache ./data
```

Or use the setup script:
```bash
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/setup-dirs.sh
chmod +x setup-dirs.sh
./setup-dirs.sh
```

### Step 3: Create Environment File

```bash
# Generate all secrets
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")
SW_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(16))")
REDIS_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
PG_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(32))")
ES_PASS=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")

cat > .env << EOF
# Change SW_HOST to your server's IP/hostname if accessing from other machines
SW_HOST=http://localhost:8889
SW_USERNAME=admin
SW_PASSWORD=$SW_PASS
ELASTIC_PASSWORD=$ES_PASS
REDIS_HOST=soundwave-redis
REDIS_PASSWORD=$REDIS_PASS
# Change to your local timezone (e.g. Europe/London, America/New_York, Europe/Bucharest)
TZ=UTC
DJANGO_SECRET_KEY=$SECRET_KEY
# PostgreSQL
POSTGRES_DB=soundwave
POSTGRES_USER=soundwave
POSTGRES_PASSWORD=$PG_PASS
# Optional: uncomment and set to your server hostname/IP if getting 400 Bad Request errors
# DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.100
# Optional: auto-update yt-dlp on startup (recommended for production)
# SW_AUTO_UPDATE_YTDLP=true
# Optional: API keys for lyrics and artwork enrichment
# LASTFM_API_KEY=
# LASTFM_API_SECRET=
# FANART_API_KEY=
EOF

# Show your generated admin password — save this somewhere safe!
echo "Admin password: $SW_PASS"
```

### Step 4: Start SoundWave

```bash
docker compose up -d
```

Docker will automatically create the `pg_data` volume for PostgreSQL data. No manual volume creation is needed.

### Step 5: Access the Application

- **URL:** http://localhost:8889
- **Username:** `admin`
- **Password:** the value of `SW_PASSWORD` from your `.env` (generated in Step 3)

```bash
# Retrieve your admin password
grep SW_PASSWORD .env
```

> ⚠️ **First login:** Go to **Settings → Account** and change your admin password to something memorable.

Wait ~60-90 seconds on first start — PostgreSQL and Elasticsearch need time to initialize before SoundWave starts.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SW_HOST` | Application URL | `http://localhost:8889` |
| `SW_USERNAME` | Initial admin username | `admin` |
| `SW_PASSWORD` | Initial admin password (**change after first login**) | — |
| `ELASTIC_PASSWORD` | ElasticSearch password (**required** in production) | — |
| `REDIS_HOST` | Redis hostname | `soundwave-redis` |
| `TZ` | Timezone | `UTC` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated allowed origins | `http://localhost:8889` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated allowed hosts | Auto-detected from `SW_HOST` |
| `DJANGO_SECRET_KEY` | Django secret key (**required** in production) | — |
| `REDIS_PASSWORD` | Redis authentication password (**required** in production) | — |
| `POSTGRES_DB` | PostgreSQL database name | `soundwave` |
| `POSTGRES_USER` | PostgreSQL username | `soundwave` |
| `POSTGRES_PASSWORD` | PostgreSQL password (**required** in production) | — |
| `DJANGO_DEBUG` | Enable Django debug mode | `False` |
| `ALLOW_LOCAL_NETWORK` | Allow access from 192.168.x.x local network IPs | `false` |
| `SECURE_COOKIES` | Cookie security: `auto`, `true`, or `false` | `auto` |
| `TOKEN_EXPIRY_HOURS` | API token lifetime in hours | `168` (7 days) |
| `SW_AUTO_UPDATE_YTDLP` | Auto-update yt-dlp on startup | `false` |
| `LASTFM_API_KEY` | Last.fm API key for artist/track metadata | — |
| `LASTFM_API_SECRET` | Last.fm API secret | — |
| `FANART_API_KEY` | Fanart.tv API key for high-res artwork | — |

### Data Directories

| Directory / Volume | Purpose |
|-------------------|--------|
| `./audio` | Downloaded audio files |
| `./cache` | Temporary cache files |
| `./data` | App data (avatars, migration scripts) |
| `./cookies.txt` | YouTube cookies file (must exist; can be empty) |
| `pg_data` (Docker volume) | PostgreSQL database — created automatically by Docker Compose |
| `es_data` (Docker volume) | Elasticsearch index — created automatically by Docker Compose |
| `redis_data` (Docker volume) | Redis persistence — created automatically by Docker Compose |

## � Dashboard Integration (Homepage)

SoundWave provides a TubeArchivist-compatible API for integration with [Homepage](https://gethomepage.dev/) and other dashboard applications.

### Setup

1. **Generate an API Key** in SoundWave: Settings → API Keys → Create
2. **Add to your Homepage services.yaml:**

```yaml
- SoundWave:
    icon: http://your-soundwave-host:8889/img/logo.png
    href: http://your-soundwave-host:8889
    description: Self-Hosted Audio
    widget:
      type: tubearchivist
      url: http://your-soundwave-host:8889
      key: YOUR_API_KEY_HERE
      fields: ["downloads", "videos", "channels", "playlists"]
```

### Widget Fields

| Field | Description |
|-------|-------------|
| `downloads` | Pending downloads |
| `videos` | Total audio files |
| `channels` | Subscribed channels |
| `playlists` | Total playlists |

For detailed API documentation, see [docs/WIDGET_API.md](docs/WIDGET_API.md).

## �📖 Usage

### Downloading Audio

1. Navigate to the **Downloads** section
2. Paste YouTube URLs (videos, playlists, or channels)
3. Click **Add to Queue**
4. SoundWave will download audio-only files automatically

### Subscribing to Channels

1. Go to **Channels**
2. Add a YouTube channel URL
3. SoundWave will periodically check for new uploads

### Creating Playlists

1. Visit **Playlists**
2. Create a new custom playlist or add a YouTube playlist URL
3. Add audio files from your library

### Using Smart Playlists

Smart Playlists automatically update based on rules you define:

1. Go to **Smart Playlists** in the sidebar
2. **Auto Playlists** (system presets) are created automatically:
   - 🔥 **Most Played** - Your top 50 most played tracks
   - ✨ **Recently Added** - Tracks added in the last 30 days
   - 🕰️ **Rediscover** - Tracks not played in over 60 days
   - 🆕 **Never Played** - Tracks you haven't listened to yet
   - ⚡ **Quick Hits** - Tracks under 3 minutes
   - 🎸 **Epic Tracks** - Tracks over 6 minutes
3. **Create Custom Smart Playlists**:
   - Click "Create" to make a new smart playlist
   - Add rules like "Genre contains Rock" or "Play count > 10"
   - Combine rules with AND/OR logic
   - Set ordering (most played, random, etc.) and track limits
   - Preview matches before saving
4. Smart playlists update automatically as your library changes

### Offline Playback (PWA)

1. Install SoundWave as a PWA (click install icon in browser)
2. Open a playlist and tap **Save Offline**
3. Wait for caching to complete (progress shown in snackbar)
4. Playlist is now available offline with audio, lyrics, and metadata!

### Playing Audio

- Click any audio file to start playback
- Use the player controls at the bottom
- Tap the album art to open the visualizer
- Swipe up/down on album art to show/hide lyrics
- Track your listening progress automatically

### Achievements & Streaks

1. Go to **Achievements** in the sidebar (trophy icon)
2. View your **current streak** and weekly activity at the top
3. Browse achievements by category using the tabs:
   - **All** - View all 37 achievements
   - **Tracks** - Song milestones (First Song to 50,000 songs)
   - **Time** - Listening hour milestones
   - **Streaks** - Consecutive day achievements
   - **Variety** - Artist and channel diversity
   - **Special** - Night Owl, Weekend Warrior, etc.
4. Progress bars show how close you are to unlocking each achievement
5. Achievements unlock automatically as you listen - watch for the confetti celebration!

### Yearly Wrapped

1. Click **Yearly Wrapped** in the sidebar (gift icon)
2. View your listening summary for the year:
   - Your **Listening Personality** type
   - **Monthly breakdown** of listening activity
   - **Top 5 Artists** and **Top 5 Tracks** with artwork
   - Total **hours, tracks, artists, and channels**
3. Use the year dropdown to view previous years' summaries

## 🛠️ Development

### Build From Source

```bash
# Clone the repository
git clone https://github.com/aiulian25/soundwave.git
cd soundwave

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Create data directories
mkdir -p ./audio ./cache ./data
sudo chown -R 1000:1000 ./audio ./cache ./data

# Build and start
docker compose build
docker compose up -d
```

### Backend Development

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend Development

```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at `http://localhost:3000` with hot reload.

## 📁 Project Structure

```
soundwave/
├── backend/                # Django backend
│   ├── audio/             # Audio file management
│   ├── channel/           # Channel subscriptions
│   ├── playlist/          # Playlist management
│   ├── download/          # Download queue
│   ├── task/              # Background tasks
│   ├── user/              # User authentication
│   ├── stats/             # Statistics
│   ├── appsettings/       # App configuration
│   └── common/            # Shared utilities
├── frontend/              # React frontend
│   ├── src/
│   │   ├── components/    # Reusable components
│   │   ├── pages/         # Page components
│   │   ├── api/           # API client
│   │   ├── context/       # React contexts (PWA, Settings)
│   │   ├── hooks/         # Custom React hooks
│   │   ├── theme/         # Material-UI theme
│   │   ├── utils/         # Utilities (offline storage, caching)
│   │   └── types/         # TypeScript types
├── docker_assets/         # Docker helper scripts
├── docs/                  # Documentation
├── docker-compose.yml     # Docker orchestration (development)
├── docker-compose.prod.yml # Docker orchestration (production)
├── Dockerfile            # Application container
├── setup-dirs.sh         # Directory setup script
└── README.md             # This file
```

## 🐛 Troubleshooting

### Permission Denied Errors

```bash
# Re-run directory setup
sudo chown -R 1000:1000 ./audio ./cache ./data
```

### Container Won't Start

```bash
# Check logs
docker compose logs soundwave

# Check ElasticSearch
docker compose logs soundwave-es

# Check PostgreSQL
docker compose logs soundwave-pg

# Restart services
docker compose restart
```

### PostgreSQL Won't Start

Ensure `POSTGRES_PASSWORD` is set in your `.env` file — it is required in production.

```bash
# Check PostgreSQL health
docker inspect --format='{{.State.Health.Status}}' soundwave-pg

# View PostgreSQL logs
docker compose logs soundwave-pg
```

If the `pg_data` volume is corrupted, you can reset it (⚠️ **this deletes all data**):

```bash
docker compose down
docker volume rm soundwave_pg_data
docker compose up -d
```

### Upgrading from SQLite (existing v1.10.x installations)

If you are upgrading from a version that used SQLite (`./data/db.sqlite3`), your data needs to be migrated once to PostgreSQL.

**Before starting**, make sure your `.env` contains the new `POSTGRES_*` variables (see Step 3 in Quick Start).

```bash
# 1. Pull the new images
docker compose pull

# 2. Stop the old soundwave container (keep other services running)
docker compose stop soundwave

# 3. Start PostgreSQL
docker compose up -d soundwave-pg

# Wait for it to become healthy
until [ "$(docker inspect --format='{{.State.Health.Status}}' soundwave-pg 2>/dev/null)" = "healthy" ]; do
  echo -n "."; sleep 2
done && echo " PostgreSQL ready!"

# 4. Create the PostgreSQL schema
docker compose run --rm soundwave python /app/backend/manage.py migrate --no-input

# 5. Download and run the data migration script
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/scripts/migrate_sqlite_to_pg.py -O ./data/migrate.py
docker compose run --rm soundwave python /app/data/migrate.py
rm ./data/migrate.py

# 6. Start everything
docker compose up -d
```

### Download Failures

- Ensure yt-dlp is up to date: Set `SW_AUTO_UPDATE_YTDLP=true`
- Check FFmpeg is installed in the container
- Review download logs in the admin panel

### Offline Playback Not Working

- Ensure you cached the playlist while online
- Check that Service Worker is registered (Settings > PWA)
- Clear browser cache and re-cache the playlist

### Port Already in Use

Change the port in `docker-compose.yml`:
```yaml
ports:
  - "YOUR_PORT:8888"
```

## 📝 Recent Changes

### v1.11.0 - Full Audit Implementation & i18n (May 2026)

#### Internationalisation (i18n) — All Pages
- ✅ **Fully translated UI** — Every page, label, and error message supports English and Romanian
- ✅ **Smart Playlists** — System preset names and descriptions translated by `preset_type`
- ✅ **Achievements** — All 36 achievement names/descriptions translated in both locales
- ✅ **Listening streak day names** — Backend abbreviated day names (Mon/Tue/…) correctly translated
- ✅ **Year Wrapped** — Listening personality types, peak month, and favorite day translated
- ✅ **Settings page** — Full-width single-column layout on desktop (no artificial 600 px cap)

#### Security Hardening (Audit fixes)
- ✅ **SSRF allowlist fix (#14)** — Artwork URL validation parses hostname, not string prefix; bypasses like `i.ytimg.com.evil.com` now rejected
- ✅ **MD5 → SHA-256 (#4)** — Rate-limiter cache keys now use SHA-256 instead of MD5
- ✅ **`DJANGO_DEBUG` defaults to `False` (#17)** — Debug mode must be explicitly enabled via env var
- ✅ **`AuthDebugMiddleware` conditional (#11)** — Middleware only loaded when `AUTH_DEBUG=true`
- ✅ **Celery result expiry (#13)** — Task results auto-expire after 1 hour (env-overridable) to prevent Redis bloat
- ✅ **Atomic `play_count` increment (#9)** — Uses `F('play_count') + 1` to eliminate race condition
- ✅ **File-delete order fix (#15)** — `Audio.delete()` removes DB row first, then cleans up disk file
- ✅ **Bare `except:` replaced (#16)** — Swallowed exceptions now emit structured `logger.warning/exception` calls
- ✅ **Backup file removed (#10)** — `LoginPage.tsx.backup` removed; `*.backup`/`*.bak` added to `.gitignore`
- ✅ **`/media/` rate limiting (#12)** — Cache-backed concurrent stream limiter per user/IP
- ✅ **API versioning (#18)** — All routes available under `/api/v1/` with `/api/` as backward-compatible alias
- ✅ **Dynamic sitemap/robots.txt (#19)** — Served by Django using `SW_HOST` so self-hosted domains are correct
- ✅ **PWA offline fallback page (#20)** — Custom `offline.html` precached in service worker; returned on navigation miss

#### Database Migration
- ✅ **PostgreSQL as production database (#8)** — Replaces SQLite for multi-process safety; SQLite retained for local dev fallback
- ✅ **Migration script** — One-time SQLite → PostgreSQL data migration for existing deployments

### v1.10.1 - Security Hardening (March 2026)

#### Container Hardening
- ✅ **Drop All Capabilities** - `cap_drop: ALL` on all containers in production
- ✅ **No Privilege Escalation** - `security_opt: no-new-privileges:true` on all services
- ✅ **Read-Only Root Filesystem** - Production container runs with `read_only: true` + tmpfs for /tmp
- ✅ **Resource Limits** - CPU and memory limits on all containers to reduce DoS risk
- ✅ **Docker HEALTHCHECK** - Dockerfile-level health check for the application
- ✅ **OS Security Patches** - `apt-get upgrade` in Dockerfile applies latest patches at build time
- ✅ **Service Health Dependencies** - `depends_on: condition: service_healthy` for proper startup ordering

#### Redis Authentication
- ✅ **Password-Protected Redis** - Redis requires authentication in production (`REDIS_PASSWORD` env var)
- ✅ **Authenticated Celery Broker** - Celery connects to Redis with password
- ✅ **Authenticated Django Cache** - Cache backend uses Redis password

#### Application Security Headers
- ✅ **Content-Security-Policy** - Restrictive CSP preventing XSS, clickjacking, and injection attacks
- ✅ **Referrer-Policy** - `strict-origin-when-cross-origin` to prevent URL leakage
- ✅ **Permissions-Policy** - Disables camera, geolocation, microphone, payment, USB APIs
- ✅ **Cross-Origin-Resource-Policy** - `same-origin` on non-media responses
- ✅ **Cross-Origin-Opener-Policy** - Always `same-origin` (previously HTTPS-only)

#### Production Server
- ✅ **Gunicorn** - Production uses gunicorn instead of Django runserver (3 workers, 2 threads)
- ✅ **Worker Recycling** - `max-requests` prevents memory leaks in long-running workers
- ✅ **Custom Session Cookie Name** - `sw_session` reduces fingerprinting surface

#### Security Logging & Monitoring
- ✅ **Audit Logging** - Login success/failure, lockouts, and logouts logged with IP (no secrets logged)
- ✅ **Django Security Logger** - `django.security` and `django.request` loggers configured
- ✅ **Vulnerability Scanning** - `make scan` target runs Trivy, Grype, and Hadolint

### v1.10.0 - Playlist Recheck & Admin Tools (March 2026)

#### Force Recheck Per Playlist
- ✅ **Force Recheck Button** - Available on both PlaylistCard (grid view) and PlaylistDetailPage
- ✅ **File Verification** - Verifies every track's audio file exists on disk, re-downloads missing ones
- ✅ **Retry Unavailable** - Force mode retries previously permanently-failed videos (copyright, private)
- ✅ **Backend `force=True` flag** - `download_playlist_task` accepts force parameter for deep recheck

#### Deleted / Private Video Detection
- ✅ **Auto-Detection** - Recognizes `[Deleted video]` and `[Private video]` entries from yt-dlp extract_flat
- ✅ **Skip Downloads** - Never attempts to download deleted/private videos (saves time and avoids errors)
- ✅ **Preserve Local Files** - If we already have the audio locally, it is kept even if YouTube removes the video
- ✅ **Force Recheck Protection** - Force recheck never deletes local copies of deleted/private videos
- ✅ **Accurate Counts** - `downloaded_count` now uses PlaylistItems to correctly count locally-kept tracks
- ✅ **Summary Logging** - Sync messages include count of deleted/private videos skipped

#### Admin: Permanent User Deletion
- ✅ **Full Cascade Delete** - Removes user and all related data (audio, channels, playlists, queue, stats, settings)
- ✅ **Filesystem Cleanup** - Deletes audio files and empty channel directories from disk
- ✅ **Avatar Cleanup** - Removes user avatar files
- ✅ **Safety Guards** - Prevents self-deletion and deletion of the last admin
- ✅ **Username Confirmation** - Frontend requires typing the username to confirm deletion

#### Playlist Sync Reliability
- ✅ **YouTube Cookies Support** - All yt-dlp calls use cookies.txt for authenticated requests
- ✅ **Eliminated API Amplification** - `link_audio_to_playlists` uses DB lookups instead of re-fetching YouTube
- ✅ **Better Error Visibility** - Removed silent failures, added proper logging
- ✅ **Task Name Collision Fix** - Renamed offline download task to avoid Celery registry conflicts

### v1.9.0 - Achievements & Yearly Wrapped (February 2026)

#### Achievement System
- ✅ **37 Achievements** across 6 categories:
  - 🎵 **Tracks**: First Song, 100/500/1000/5000/10000/50000 songs milestones
  - ⏱️ **Hours**: 1/10/50/100/500/1000 hours listening milestones
  - 🔥 **Streaks**: 3/7/14/30/60/90/180/365 day streak achievements
  - 🎤 **Artists**: 10/25/50/100 different artists explored
  - 📺 **Channels**: 5/10/25/50 different channels discovered
  - ⭐ **Special**: Night Owl, Early Bird, Weekend Warrior, Marathon Listener, Explorer, Dedicated Fan
- ✅ **Achievement Notifications** - Real-time popup with confetti animation when unlocking
- ✅ **Progress Tracking** - Visual progress bars for each achievement
- ✅ **Achievement Categories** - Tabbed interface to browse by category

#### Listening Streaks
- ✅ **Daily Streak Tracking** - Track consecutive listening days
- ✅ **Weekly Activity Grid** - Visual 7-day activity indicator
- ✅ **Current & Longest Streak** - Display of streak statistics
- ✅ **Streak Preservation** - Automatic daily tracking via listening history

#### Yearly Wrapped
- ✅ **Spotify-Style Summary** - Beautiful year-in-review page
- ✅ **Listening Personality** - AI-determined personality type based on habits
- ✅ **Monthly Listening Chart** - Visual breakdown of listening by month
- ✅ **Top 5 Artists & Tracks** - With album artwork and play counts
- ✅ **Stats Cards** - Total hours, tracks, artists, and channels
- ✅ **Year Selector** - View wrapped for any previous year

#### UI/UX Improvements
- ✅ **Achievements Page** - New dedicated page accessible from sidebar
- ✅ **Wrapped Page** - New yearly wrapped page with gradient design
- ✅ **Navigation Links** - Trophy and gift icons in sidebar
- ✅ **AchievementNotification Component** - Modal with multi-achievement support

### v1.9.2 - Media Streaming Auth Fix (February 2026)
- ✅ **Multi-Method Auth** - Media streaming supports session, header token, and query param authentication
- ✅ **Browser Compatibility** - Audio/video elements work with `?token=xxx` since they can't send Authorization headers
- ✅ **Fixes 403 Errors** - Resolves media playback failures after v1.9.1 security hardening

### v1.9.1 - Deep Security Hardening (February 2026)

#### SSRF Protection
- ✅ **URL Allowlist** - All external artwork fetching restricted to trusted domains (YouTube, MusicBrainz, Fanart.tv, Last.fm)
- ✅ **Audio Export** - Artwork URL validation prevents server-side request forgery
- ✅ **Tag Writer** - Cover art downloads validated against allowlist
- ✅ **Artwork Proxy** - Centralized URL validation for all artwork requests

#### Input Validation
- ✅ **Smart Playlists** - Allowlist validation for fields, operators, and order_by parameters
- ✅ **File Uploads** - Extension and MIME type validation for local audio uploads
- ✅ **500MB Size Limit** - Maximum file size enforcement for uploads

#### Brute Force Protection
- ✅ **Password Change** - Per-user rate limiting (5 attempts, 30-min lockout)
- ✅ **2FA Endpoints** - Rate limiting on verify, disable, and regenerate codes
- ✅ **Profile Updates** - Protection against automated attacks

#### Information Disclosure Fixes
- ✅ **Error Messages** - Generic messages prevent exception detail exposure
- ✅ **Debug Logging** - Sensitive data removed from logs (requires `DEBUG_LOGGING=true`)
- ✅ **Auth Debug** - Token/cookie values no longer logged (requires `AUTH_DEBUG=true`)

#### Media Security
- ✅ **Authentication Required** - All `/media/*` endpoints now require authentication
- ✅ **Streaming Protected** - Audio files no longer accessible without valid token

### v1.8.0 - Security Hardening & Session Management (February 2026)

#### Login Security
- ✅ **Rate Limiting** - 3 failed login attempts triggers 60-minute lockout
- ✅ **Visual Feedback** - Shows remaining attempts after each failed login
- ✅ **Lockout Timer** - Countdown display when account is locked
- ✅ **Redis-backed** - Lockout state persists across restarts

#### Session & Token Security
- ✅ **Token Expiry** - API tokens expire after 7 days (configurable)
- ✅ **Session Timeout** - Automatic logout on token expiration
- ✅ **Secure Cookies** - HTTPS-only cookies in production
- ✅ **HTTPOnly Cookies** - Prevents XSS cookie theft

#### Host Security
- ✅ **ALLOWED_HOSTS** - Dynamic host validation (no more `*` wildcard)
- ✅ **Local Network Support** - Private IPs (192.168.x.x) allowed by default
- ✅ **HSTS Headers** - Strict Transport Security for HTTPS deployments

#### Additional Security Headers
- ✅ `X-Frame-Options: DENY` - Prevents clickjacking
- ✅ `X-Content-Type-Options: nosniff` - Prevents MIME sniffing
- ✅ `Secure` cookie flag for HTTPS

### v1.7.0 - LRC Upload, Export & Media Session (January 2026)

#### LRC Upload & Lyrics Management
- ✅ Upload custom .lrc files for synced lyrics
- ✅ Persistent storage of uploaded lyrics with original filename
- ✅ Enhanced lyrics search with suggestions panel
- ✅ Fixed lyrics suggestions overflow UI

#### Export Dialog
- ✅ Export tracks as MP3 or FLAC format
- ✅ Embed synced lyrics (SYLT tag for MP3, LRC metadata for FLAC)
- ✅ Embed plain lyrics (USLT tag)
- ✅ Embed album artwork in exported files
- ✅ Quality selection (High/Medium/Low for MP3)

#### PWA & Media Session
- ✅ New rounded app icon with gradient design
- ✅ Album artwork in system media notifications
- ✅ Artwork proxy endpoint for Chromium browser support
- ✅ Fixed favicon and all PWA icon sizes

#### Player Improvements
- ✅ Fixed repeat button (repeat one, repeat all, off)
- ✅ Proper queue wrap-around for repeat all mode
- ✅ Channel name fallback for artist in notifications

### v1.6.0 - Auto-Play & Infrastructure Improvements (January 2026)

#### Auto-Play / Continuous Playback
- ✅ Continuous playback - songs auto-play next track when finished
- ✅ Queue system for Library, Playlists, Search, Favorites, Channels, Home
- ✅ Previous/Next track navigation in player
- ✅ Smart shuffle and regular shuffle modes
- ✅ Works from any starting position in a list

#### Infrastructure Improvements
- ✅ Replaced third-party ElasticSearch image with official `docker.elastic.co/elasticsearch/elasticsearch:8.11.3`
- ✅ Fixed SQLite "database is locked" errors with 30-second timeout
- ✅ Reduced Celery worker concurrency to 2 to prevent DB contention
- ✅ ElasticSearch health checks and disk watermark configuration

### v1.5.0 - Offline Playback & UI Improvements (January 2026)

#### Offline Playback
- ✅ Full offline playback with cached audio, lyrics, and metadata
- ✅ Service Worker authentication fix for 406 errors
- ✅ IndexedDB lyrics caching (database version 2)
- ✅ Proper playlist lookup by playlist_id for offline mode
- ✅ Album art fallback icons when images fail to load offline
- ✅ Non-blocking caching progress snackbar (auto-dismisses after 2s)
- ✅ Completion notification when caching finishes

#### UI/UX Improvements
- ✅ Responsive 2-column playlist grid on mobile (3 on tablet, 4 on desktop)
- ✅ Audio visualizer with multiple themes
- ✅ Synced lyrics display with swipe gesture
- ✅ Auto-dismissing offline notification (5 seconds)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by [TubeArchivist](https://github.com/tubearchivist/tubearchivist)
- Built with [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- UI designed with [Material-UI](https://mui.com/)

## 📚 Documentation

- 📖 [Quick Reference](docs/QUICK_REFERENCE.md) - Quick start guide
- 🔧 [Data Persistence Fix](docs/DATA_PERSISTENCE_FIX.md) - Technical details on persistence
- 📱 [Offline Playlists Guide](docs/OFFLINE_PLAYLISTS_GUIDE.md) - PWA offline features
- ✅ [Audit Summary](docs/AUDIT_SUMMARY_COMPLETE.md) - Complete audit results
- 🎨 [PWA Implementation](docs/PWA_COMPLETE.md) - Progressive Web App features
- 🔒 [Security Audit](docs/SECURITY_AND_PWA_AUDIT_COMPLETE.md) - Security verification
- 📝 [Change Log](docs/CHANGELOG.md) - Recent changes and improvements

## 📞 Support

- 🐛 [Issue Tracker](https://github.com/aiulian25/soundwave/issues)

---

Made with ❤️ by the SoundWave team
