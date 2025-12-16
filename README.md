# 🎵 SoundWave

![SoundWave Banner](https://img.shields.io/badge/SoundWave-Audio%20Archive-5C6BC0?style=for-the-badge)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**SoundWave** is a self-hosted audio archiving and streaming platform inspired by TubeArchivist. Download, organize, and enjoy your YouTube audio collection offline through a beautiful dark-themed web interface.

## ✨ Features

- 🎧 **Audio-Only Downloads** - Extract high-quality audio from YouTube using yt-dlp
- 📚 **Smart Organization** - Index audio files with full metadata (title, artist, duration, etc.)
- 🔍 **Powerful Search** - Find your audio quickly with ElasticSearch-powered indexing
- 🎵 **Built-in Player** - Stream your collection directly in the browser
- 📊 **Channel Subscriptions** - Subscribe to YouTube channels and automatically download new audio
- 📝 **Playlists** - Create custom playlists or sync YouTube playlists
- � **PWA Support** - Install as mobile/desktop app with offline capabilities
- 💾 **Persistent Storage** - Data survives container rebuilds
- 🔄 **Offline Playlists** - Download playlists for offline playback
- �📈 **Statistics** - Track plays, downloads, and library stats
- 🌙 **Dark Theme** - Beautiful Material Design dark UI
- 🔐 **User Management** - Multi-user support with authentication
- ⚡ **Background Tasks** - Celery-powered async downloads and updates

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

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/soundwave.git
cd soundwave
```

### 2. Create Environment File

```bash
cp .env.example .env
# Edit .env if you want to change default credentials
# Default: admin / soundwave
```

### 3. Start the Application

```bash
docker compose up -d
```

That's it! The application will:
- Pull/build all necessary images
- Start ElasticSearch and Redis
- Start the SoundWave application
- Run database migrations automatically

**Access:** http://localhost:8889  
**Default credentials:** admin / soundwave

### First-Time Setup

The application automatically:
- Creates the admin user on first run
- Runs database migrations
- Collects static files
- Initializes the search index

Just wait ~30-60 seconds after `docker compose up -d` for services to be ready.

## 📖 Detailed Setup (Old Method)

Copy the example environment file and customize it:

```bash
cp .env.example .env
```

Edit `.env` with your preferred settings:

```env
SW_HOST=http://localhost:123456
SW_USERNAME=admin
SW_PASSWORD=your_secure_password
ELASTIC_PASSWORD=your_elastic_password
TZ=America/New_York
```

### 3. Start SoundWave

```bash
docker-compose up -d
```

### 4. Access the Application

Open your browser and navigate to:
```
http://localhost:123456
```

Login with the credentials you set in `.env`:
- **Username**: admin (or your SW_USERNAME)
- **Password**: soundwave (or your SW_PASSWORD)

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
2. Create a new custom playlist
3. Add audio files from your library

### Playing Audio

- Click any audio file to start playback
- Use the player controls at the bottom
- Track your listening progress automatically

## 🛠️ Development

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
│   │   ├── theme/         # Material-UI theme
│   │   └── types/         # TypeScript types
├── docker_assets/         # Docker helper scripts
├── docker-compose.yml     # Docker orchestration
├── Dockerfile            # Application container
└── README.md             # This file
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SW_HOST` | Application URL | `http://localhost:123456` |
| `SW_USERNAME` | Initial admin username | `admin` |
| `SW_PASSWORD` | Initial admin password | `soundwave` |
| `ELASTIC_PASSWORD` | ElasticSearch password | Required |
| `REDIS_HOST` | Redis hostname | `soundwave-redis` |
| `TZ` | Timezone | `UTC` |
| `SW_AUTO_UPDATE_YTDLP` | Auto-update yt-dlp | `false` |

### Audio Quality

By default, SoundWave downloads the best available audio quality. You can configure this in the settings or via yt-dlp options in `task/tasks.py`.

## 🐛 Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs soundwave

# Check ElasticSearch
docker-compose logs soundwave-es

# Restart services
docker-compose restart
```

### Download Failures

- Ensure yt-dlp is up to date: Set `SW_AUTO_UPDATE_YTDLP=true`
- Check FFmpeg is installed in the container
- Review download logs in the admin panel

### Port Already in Use

If port 123456 is in use, change it in `docker-compose.yml`:

```yaml
ports:
  - "YOUR_PORT:8000"
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Inspired by [TubeArchivist](https://github.com/tubearchivist/tubearchivist)
- Built with [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- UI designed with [Material-UI](https://mui.com/)

## � Documentation

- 📖 [Quick Reference](docs/QUICK_REFERENCE.md) - Quick start guide
- 🔧 [Data Persistence Fix](docs/DATA_PERSISTENCE_FIX.md) - Technical details on persistence
- 📱 [Offline Playlists Guide](docs/OFFLINE_PLAYLISTS_GUIDE.md) - PWA offline features
- ✅ [Audit Summary](docs/AUDIT_SUMMARY_COMPLETE.md) - Complete audit results
- 🎨 [PWA Implementation](docs/PWA_COMPLETE.md) - Progressive Web App features
- 🔒 [Security Audit](docs/SECURITY_AND_PWA_AUDIT_COMPLETE.md) - Security verification
- 📝 [Change Log](docs/CHANGELOG.md) - Recent changes and improvements
- 📂 [All Documentation](docs/) - Complete documentation index

## 📞 Support

- 💬 [Discord Community](#)
- 🐛 [Issue Tracker](https://github.com/yourusername/soundwave/issues)
- 📖 [Full Documentation](https://docs.soundwave.app)

---

Made with ❤️ by the SoundWave team
