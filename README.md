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
- 📊 **Channel Subscriptions** - Subscribe to YouTube channels and automatically download new audio
- 📝 **Playlists** - Create custom playlists or sync YouTube playlists

### PWA & Offline Features
- 📱 **PWA Support** - Install as mobile/desktop app
- 💾 **Full Offline Playback** - Cache playlists with audio, lyrics, and metadata for offline use
- 🎤 **Synced Lyrics** - Display lyrics in sync with music playback (online & offline)
- 🔄 **Background Caching** - Non-blocking progress indicator while caching

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

## 🏗️ Architecture

- **Backend**: Django REST Framework (Python)
- **Frontend**: React + TypeScript + Material-UI
- **Search Engine**: ElasticSearch
- **Task Queue**: Celery + Redis
- **Audio Extraction**: yt-dlp + FFmpeg
- **Containerization**: Docker

## 📋 Prerequisites

- Docker & Docker Compose
- 2-4GB available RAM
- Dual-core CPU (quad-core recommended)
- Storage space for your audio library

## 🚀 Quick Start

### Step 1: Download Files

```bash
# Create a directory for SoundWave
mkdir soundwave && cd soundwave

# Download docker-compose.yml
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/docker-compose.prod.yml -O docker-compose.yml
```

### Step 2: Create Data Directories

**Important:** Docker needs these directories to exist with proper permissions before starting.

```bash
# Create directories
mkdir -p ./audio ./cache ./data

# Set permissions for container user (1000:1000)
sudo chown -R 1000:1000 ./audio ./cache ./data
```

Or use the setup script:
```bash
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/setup-dirs.sh
chmod +x setup-dirs.sh
./setup-dirs.sh
```

### Step 3: Create Environment File (Optional)

```bash
cat > .env << EOF
SW_HOST=http://localhost:8889
SW_USERNAME=admin
SW_PASSWORD=soundwave
ELASTIC_PASSWORD=soundwave
REDIS_HOST=soundwave-redis
TZ=UTC
EOF
```

### Step 4: Start SoundWave

```bash
docker compose up -d
```

### Step 5: Access the Application

- **URL:** http://localhost:8889
- **Username:** admin
- **Password:** soundwave

Wait ~30-60 seconds for all services to initialize on first start.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SW_HOST` | Application URL | `http://localhost:8889` |
| `SW_USERNAME` | Initial admin username | `admin` |
| `SW_PASSWORD` | Initial admin password | `soundwave` |
| `ELASTIC_PASSWORD` | ElasticSearch password | `soundwave` |
| `REDIS_HOST` | Redis hostname | `soundwave-redis` |
| `TZ` | Timezone | `UTC` |
| `SW_AUTO_UPDATE_YTDLP` | Auto-update yt-dlp | `false` |

### Data Directories

| Directory | Purpose |
|-----------|---------|
| `./audio` | Downloaded audio files |
| `./cache` | Temporary cache files |
| `./data` | Database and app data |

## 📖 Usage

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

# Restart services
docker compose restart
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
