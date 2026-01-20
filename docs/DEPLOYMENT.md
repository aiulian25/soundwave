# 🚀 SoundWave - Easy Deployment Guide

## For End Users (No Build Required)

### Quick Start (3 Steps)

**1. Download docker-compose.yml**
```bash
wget https://raw.githubusercontent.com/aiulian25/soundwave/main/docker-compose.yml
```

**2. Create .env file**
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

**3. Start SoundWave**
```bash
docker compose up -d
```

That's it! 🎉

**Access:** http://localhost:8889  
**Login:** admin / soundwave

---

## What This Does

The Docker Compose file:
- ✅ Pulls pre-built image from GitHub Container Registry (`ghcr.io/aiulian25/soundwave:latest`)
- ✅ Starts ElasticSearch for search functionality
- ✅ Starts Redis for task queue
- ✅ Automatically runs migrations
- ✅ Creates admin user

**No npm, no build, no compilation needed!**

> **Note**: If the image pull fails (image not published yet), see the "Building Locally" section below.

---

## Directory Structure

After running, you'll have:
```
your-folder/
├── docker-compose.yml  (downloaded)
├── .env               (created)
├── audio/             (created automatically)
├── cache/             (created automatically)
├── data/              (created automatically)
├── es/                (created automatically)
└── redis/             (created automatically)
```

---

## Customization

Edit `.env` before starting to customize:
- Change port from 8889 to something else
- Change admin username/password
- Adjust timezone

Example custom .env:
```bash
SW_HOST=http://localhost:3000
SW_USERNAME=myadmin
SW_PASSWORD=mysecretpassword
ELASTIC_PASSWORD=elasticpass
REDIS_HOST=soundwave-redis
TZ=America/New_York
```

Then update port in docker-compose.yml:
```yaml
ports:
  - "3000:8888"  # Change 8889 to 3000
```

---

## Stopping/Starting

```bash
# Stop
docker compose down

# Start
docker compose up -d

# View logs
docker compose logs -f soundwave

# Restart
docker compose restart soundwave
```

---

## Updating

```bash
# Pull latest image
docker compose pull

# Restart with new version
docker compose up -d
```

---

## Building Locally

If the pre-built image is not available (not published yet or want latest code):

**Prerequisites**: Node.js 18+ and npm

```bash
# Clone repository
git clone https://github.com/aiulian25/soundwave.git
cd soundwave

# Build frontend
cd frontend
npm install
npm run build
cd ..

# Build Docker image and start
docker compose build
docker compose up -d
```

Alternatively, uncomment the `build:` section in docker-compose.yml and it will build automatically:
```yaml
# In docker-compose.yml, uncomment:
build:
  context: .
  dockerfile: Dockerfile
```

Then run: `docker compose up -d --build`

---

## System Requirements

- Docker & Docker Compose
- 2-4GB RAM
- Dual-core CPU (quad-core recommended)
- Storage for your audio library

---

## Troubleshooting

**Port already in use?**
```bash
# Change port in .env and docker-compose.yml
ports:
  - "9000:8888"  # Use port 9000 instead
```

**Can't access after starting?**
```bash
# Wait 30-60 seconds for services to initialize
docker compose logs -f soundwave
```

**Forgot password?**
```bash
# Reset admin password
docker compose exec soundwave python manage.py changepassword admin
```

---

✨ **That's it! Enjoy SoundWave!**
