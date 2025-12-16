# SoundWave - Quick Start Guide

## Installation Steps

1. **Install Docker** (if not already installed)
   ```bash
   # Check if Docker is installed
   docker --version
   docker-compose --version
   ```

2. **Navigate to the project directory**
   ```bash
   cd /home/iulian/projects/zi-tube/soundwave
   ```

3. **Create environment file**
   ```bash
   cp .env.example .env
   # Edit .env with your preferred settings
   ```

4. **Build and start the containers**
   ```bash
   docker-compose build
   docker-compose up -d
   ```

5. **Check if services are running**
   ```bash
   docker-compose ps
   ```

6. **View logs** (if needed)
   ```bash
   docker-compose logs -f soundwave
   ```

7. **Access SoundWave**
   - Open browser: http://localhost:123456
   - Login with credentials from .env file

## First Time Setup

After logging in:

1. **Add a YouTube URL to download**
   - Go to Downloads section
   - Paste a YouTube video URL
   - Click "Add to Queue"

2. **Subscribe to a channel**
   - Go to Channels section
   - Add a channel URL
   - Enable subscription

3. **Browse your library**
   - Go to Library section
   - Click any audio to play

## Stopping SoundWave

```bash
docker-compose down
```

## Updating SoundWave

```bash
git pull
docker-compose build
docker-compose up -d
```

## Backup Your Data

Your audio files and database are stored in:
- `./audio/` - Audio files
- `./es/` - ElasticSearch data
- `./redis/` - Redis data
- `./cache/` - Cache files

Make regular backups of these directories!
