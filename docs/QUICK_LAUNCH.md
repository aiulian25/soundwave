# 🚀 SoundWave - Quick Launch Guide

## ⚡ One-Command Setup

```bash
cd /home/iulian/projects/zi-tube/soundwave
./setup.sh
```

This automated script will:
1. ✅ Create `.env` file with default settings
2. ✅ Create volume directories
3. ✅ Build React frontend
4. ✅ Start database services (Elasticsearch + Redis)
5. ✅ Start SoundWave application
6. ✅ Run database migrations
7. ✅ Create admin user
8. ✅ Collect static files

**Time:** ~2-3 minutes

## 🔐 Default Access

- **URL:** http://localhost:123456
- **Username:** admin
- **Password:** soundwave

## 📋 Manual Setup (If Needed)

### Step 1: Environment File
```bash
cp .env.example .env
```

### Step 2: Build Frontend
```bash
cd frontend
npm install
npm run build
cd ..
```

### Step 3: Start Services
```bash
docker compose up -d
```

### Step 4: Run Migrations
```bash
# Wait 30 seconds for Elasticsearch
sleep 30

# Run migrations
docker exec soundwave python manage.py makemigrations audio
docker exec soundwave python manage.py migrate
```

### Step 5: Create Admin User
```bash
docker exec -it soundwave python manage.py createsuperuser
```

## 🛠️ Common Commands

### View Logs
```bash
docker compose logs -f soundwave
```

### Stop Services
```bash
docker compose down
```

### Restart Application
```bash
docker compose restart soundwave
```

### Access Container Shell
```bash
docker exec -it soundwave bash
```

### Check Service Status
```bash
docker compose ps
```

## 🧪 Testing Checklist

After launch, verify:

1. ✅ Visit http://localhost:123456
2. ✅ Login with admin/soundwave
3. ✅ Test local file upload
4. ✅ Check PWA install prompt
5. ✅ Test offline mode
6. ✅ Verify media controls

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Change port in docker-compose.yml
nano docker-compose.yml
# Edit: "YOUR_PORT:8888"
```

### Elasticsearch Won't Start
```bash
sudo sysctl -w vm.max_map_count=262144
```

### Reset Everything
```bash
docker compose down -v
rm -rf audio cache es redis
./setup.sh
```

## 📊 What's Included

- ✅ Multi-tenant audio streaming
- ✅ Local file upload with metadata
- ✅ PWA with offline support
- ✅ Media Session API (native controls)
- ✅ 11 optimized icons for all platforms
- ✅ Service worker caching
- ✅ Background sync
- ✅ Lyrics support
- ✅ Artwork management
- ✅ 2FA authentication
- ✅ Theme customization

## 🎯 Next Steps

1. Run `./setup.sh`
2. Wait 2-3 minutes
3. Open http://localhost:123456
4. Login and enjoy!

**📚 Full documentation:** See `PRE_LAUNCH_CHECKLIST.md`
