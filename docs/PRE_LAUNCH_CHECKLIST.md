# 🚀 Pre-Launch Checklist - SoundWave Deployment

## ✅ Required Steps Before Building Container

### 1. Create Environment File
**Status:** ⚠️ **REQUIRED**

Copy the example environment file and customize it:

```bash
cd /path/to/soundwave
cp .env.example .env
```

**Default Credentials:**
- **Username:** `admin`
- **Password:** `soundwave`
- **Elasticsearch Password:** `soundwave`
- **Port:** `123456`

**Optional: Customize .env file**
```bash
nano .env
```

Edit these values if needed:
- `SW_HOST` - Change if using different port or domain
- `SW_USERNAME` - Admin username (default: admin)
- `SW_PASSWORD` - Admin password (default: soundwave)
- `ELASTIC_PASSWORD` - Elasticsearch password (default: soundwave)
- `TZ` - Your timezone (default: UTC)

### 2. Create Database Migrations
**Status:** ⚠️ **REQUIRED**

The local audio files feature has new models that need migrations:

```bash
# Start only the database services first
docker compose up -d soundwave-es soundwave-redis

# Wait 30 seconds for Elasticsearch to initialize
sleep 30

# Create migrations (run from host or inside container)
cd backend
python manage.py makemigrations audio
python manage.py migrate

# OR if you prefer to do it after container starts:
docker compose up -d soundwave
docker exec -it soundwave python manage.py makemigrations audio
docker exec -it soundwave python manage.py migrate
```

### 3. Verify Python Dependencies
**Status:** ✅ **ALREADY CONFIGURED**

All required packages are in `requirements.txt`:
- ✅ `mutagen>=1.47.0` - Audio metadata extraction (local files)
- ✅ `pylast>=5.2.0` - Last.fm API client (artwork)
- ✅ All other dependencies present

### 4. Build Frontend
**Status:** ⚠️ **REQUIRED**

Build the React frontend before starting container:

```bash
cd frontend
npm install
npm run build
```

The build output goes to `frontend/dist/` which will be served by Django.

### 5. Create Required Directories
**Status:** ⚠️ **RECOMMENDED**

Ensure volume directories exist with proper permissions:

```bash
cd /path/to/soundwave
mkdir -p audio cache es redis
chmod -R 755 audio cache es redis
```

## 📋 Complete Setup Script

Run this complete setup script:

```bash
#!/bin/bash
set -e

echo "🚀 SoundWave - Pre-Launch Setup"
echo "================================"
echo ""

# Navigate to project directory
cd /path/to/soundwave

# Step 1: Create .env file
echo "📝 Step 1/5: Creating environment file..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✅ Created .env file with default settings"
else
    echo "ℹ️  .env file already exists"
fi

# Step 2: Create directories
echo ""
echo "📁 Step 2/5: Creating volume directories..."
mkdir -p audio cache es redis
chmod -R 755 audio cache es redis
echo "✅ Directories created"

# Step 3: Build frontend
echo ""
echo "⚛️  Step 3/5: Building React frontend..."
cd frontend
npm install
npm run build
cd ..
echo "✅ Frontend built successfully"

# Step 4: Start database services
echo ""
echo "🗄️  Step 4/5: Starting database services..."
docker compose up -d soundwave-es soundwave-redis
echo "⏳ Waiting 30 seconds for Elasticsearch to initialize..."
sleep 30
echo "✅ Database services ready"

# Step 5: Start main application
echo ""
echo "🚀 Step 5/5: Starting SoundWave application..."
docker compose up -d soundwave
echo "⏳ Waiting for application to start..."
sleep 10

# Run migrations
echo ""
echo "🔄 Running database migrations..."
docker exec -it soundwave python manage.py makemigrations audio
docker exec -it soundwave python manage.py migrate
echo "✅ Migrations completed"

# Create superuser (optional)
echo ""
echo "👤 Creating admin user..."
docker exec -it soundwave python manage.py shell -c "
from django.contrib.auth import get_user_model
User = get_user_model()
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin', 'admin@soundwave.local', 'soundwave')
    print('✅ Admin user created')
else:
    print('ℹ️  Admin user already exists')
"

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo ""
echo "🌐 Application: http://localhost:123456"
echo "👤 Username: admin"
echo "🔑 Password: soundwave"
echo ""
echo "📊 To view logs:"
echo "   docker compose logs -f soundwave"
echo ""
echo "🛑 To stop:"
echo "   docker compose down"
echo ""
```

Save this as `setup.sh` and run:
```bash
chmod +x setup.sh
./setup.sh
```

## 🔐 Default Credentials

### Admin User
- **Username:** `admin`
- **Password:** `soundwave`
- **URL:** `http://localhost:123456`

### Elasticsearch
- **Password:** `soundwave`
- **Port:** `92000` (internal)
- **URL:** `http://soundwave-es:92000` (internal)

### Redis
- **Port:** `6379` (internal)
- **No password required**

## 📊 Port Configuration

Current ports in `docker-compose.yml`:
- **Application:** `123456` → `8888` (mapped to host)
- **Elasticsearch:** `92000` (internal only)
- **Redis:** `6379` (internal only)

To change the external port, edit `docker-compose.yml`:
```yaml
ports:
  - "YOUR_PORT:8888"  # Change YOUR_PORT to desired port
```

## 🗂️ Volume Mounts

Data persisted in these directories:
- `./audio` → User audio files, YouTube downloads
- `./cache` → Application cache
- `./es` → Elasticsearch data
- `./redis` → Redis persistence

**⚠️ Important:** Don't delete these directories - they contain your data!

## 🔧 Environment Variables Reference

### Required Variables
```bash
SW_HOST=http://localhost:123456          # Application URL
SW_USERNAME=admin                         # Admin username
SW_PASSWORD=soundwave                     # Admin password
ELASTIC_PASSWORD=soundwave                # Elasticsearch password
REDIS_HOST=soundwave-redis                # Redis hostname
ES_URL=http://soundwave-es:92000         # Elasticsearch URL
TZ=UTC                                   # Timezone
```

### Optional Variables
```bash
SW_AUTO_UPDATE_YTDLP=true                # Auto-update yt-dlp
DJANGO_DEBUG=false                        # Debug mode (keep false in production)

# Last.fm API (for metadata and artwork)
LASTFM_API_KEY=6220a784c283f5df39fbf5fd9d9ffeb9
LASTFM_API_SECRET=                       # Your secret here

# Fanart.tv API (for high quality artwork)
FANART_API_KEY=73854834d14a5f351bb2233fc3c9d755
```

### Getting API Keys

**Last.fm API:**
1. Visit: https://www.last.fm/api/account/create
2. Fill in application details
3. Copy API Key and Secret to `.env`

**Fanart.tv API:**
1. Visit: https://fanart.tv/get-an-api-key/
2. Register for personal API key
3. Copy API Key to `.env`

## 🧪 Testing Checklist

After starting the container, verify:

### 1. Container Health
```bash
docker compose ps
# All services should be "Up"
```

### 2. Application Logs
```bash
docker compose logs -f soundwave
# Should see "Starting development server at http://0.0.0.0:8888/"
```

### 3. Web Access
Visit `http://localhost:123456`
- ✅ Page loads
- ✅ Can login with admin/soundwave
- ✅ No console errors

### 4. Database Connection
```bash
docker exec -it soundwave python manage.py dbshell
# Should connect to database without errors
```

### 5. Elasticsearch Health
```bash
curl -u elastic:soundwave http://localhost:123456/api/health/
# Should return health status
```

### 6. Test Each Feature

**Local Files Upload:**
- Navigate to Local Files page
- Upload a test audio file
- Verify metadata extraction works
- Check file appears in list

**PWA Features:**
- Open Chrome DevTools > Application > Manifest
- Verify all icons load
- Check service worker registered
- Test offline mode

**Media Controls:**
- Play any audio
- Check native controls appear (notification tray)
- Test play/pause from system controls

## 🐛 Troubleshooting

### Issue: .env file not found
```bash
cp .env.example .env
```

### Issue: Port already in use
```bash
# Find what's using port 123456
sudo lsof -i :123456

# Change port in docker-compose.yml
nano docker-compose.yml
# Edit: "YOUR_PORT:8888"
```

### Issue: Elasticsearch won't start
```bash
# Increase vm.max_map_count
sudo sysctl -w vm.max_map_count=262144

# Make permanent
echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
```

### Issue: Permission denied on volumes
```bash
sudo chown -R $USER:$USER audio cache es redis
chmod -R 755 audio cache es redis
```

### Issue: Migrations fail
```bash
# Reset migrations (WARNING: loses data)
docker compose down -v
rm -rf backend/audio/migrations/00*.py
docker compose up -d
docker exec -it soundwave python manage.py makemigrations audio
docker exec -it soundwave python manage.py migrate
```

### Issue: Frontend not loading
```bash
cd frontend
npm run build
docker compose restart soundwave
```

## 📝 Summary

**Before running `docker compose up`:**

1. ✅ Copy `.env.example` to `.env`
2. ✅ Create volume directories (`audio`, `cache`, `es`, `redis`)
3. ✅ Build frontend (`cd frontend && npm install && npm run build`)
4. ✅ Start database services first
5. ✅ Run migrations after containers start
6. ✅ Test application at `http://localhost:123456`

**Quick Start (One Command):**
```bash
cp .env.example .env && \
mkdir -p audio cache es redis && \
cd frontend && npm install && npm run build && cd .. && \
docker compose up -d
```

**Then run migrations:**
```bash
sleep 30  # Wait for services
docker exec -it soundwave python manage.py makemigrations audio
docker exec -it soundwave python manage.py migrate
```

**Access the app:**
- URL: http://localhost:123456
- Username: admin
- Password: soundwave

🎉 **You're ready to launch!**
