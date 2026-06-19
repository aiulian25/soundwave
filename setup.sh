#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔════════════════════════════════════════╗"
echo "║   🎵 SoundWave - Pre-Launch Setup 🎵   ║"
echo "╔════════════════════════════════════════╗"
echo -e "${NC}"
echo ""

# Navigate to project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Step 1: Create .env file with freshly generated strong secrets (DEP-01)
echo -e "${YELLOW}📝 Step 1/6: Creating environment file...${NC}"

# Generate a URL-safe random secret (hex — no characters that break connection URLs)
gen_secret() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 24
    else
        head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
}

# Set KEY=value in .env only if the key is currently empty/placeholder.
set_secret_if_empty() {
    local key="$1" val="$2"
    local current
    current=$(grep -E "^${key}=" .env | head -1 | cut -d= -f2-)
    if [ -z "$current" ]; then
        if grep -qE "^${key}=" .env; then
            sed -i.bak "s|^${key}=.*|${key}=${val}|" .env && rm -f .env.bak
        else
            echo "${key}=${val}" >> .env
        fi
    fi
}

if [ ! -f .env ]; then
    cp .env.example .env

    # Generate strong, unique secrets for anything left blank in the template.
    ADMIN_PW=$(gen_secret)
    set_secret_if_empty SW_PASSWORD "$ADMIN_PW"
    set_secret_if_empty POSTGRES_PASSWORD "$(gen_secret)"
    set_secret_if_empty REDIS_PASSWORD "$(gen_secret)"
    set_secret_if_empty ELASTIC_PASSWORD "$(gen_secret)"
    set_secret_if_empty DJANGO_SECRET_KEY "$(gen_secret)$(gen_secret)"
    chmod 600 .env 2>/dev/null || true

    echo -e "${GREEN}✅ Created .env with freshly generated strong secrets${NC}"
    echo -e "${YELLOW}ℹ️  Initial admin login: ${SW_USERNAME:-admin} / ${ADMIN_PW}${NC}"
    echo -e "${YELLOW}   (You'll be required to change this password on first login.)${NC}"
else
    echo -e "${BLUE}ℹ️  .env file already exists — leaving secrets untouched${NC}"
fi
echo ""

# Step 2: Create directories
echo -e "${YELLOW}📁 Step 2/6: Creating volume directories...${NC}"
mkdir -p audio cache es redis
chmod -R 755 audio cache es redis 2>/dev/null || true
echo -e "${GREEN}✅ Directories created: audio, cache, es, redis${NC}"
echo ""

# Step 3: Check if npm is installed
echo -e "${YELLOW}🔍 Step 3/6: Checking prerequisites...${NC}"
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed. Please install Node.js and npm first.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm found: $(npm --version)${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ docker is not installed. Please install Docker first.${NC}"
    exit 1
fi
echo -e "${GREEN}✅ docker found: $(docker --version | cut -d' ' -f3)${NC}"
echo ""

# Step 4: Build frontend
echo -e "${YELLOW}⚛️  Step 4/6: Building React frontend...${NC}"
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi
echo "Building production bundle..."
npm run build
cd ..
echo -e "${GREEN}✅ Frontend built successfully${NC}"
echo ""

# Step 5: Start database services
echo -e "${YELLOW}🗄️  Step 5/6: Starting database services...${NC}"
docker compose up -d soundwave-es soundwave-redis
echo -e "${BLUE}⏳ Waiting 30 seconds for Elasticsearch to initialize...${NC}"
for i in {30..1}; do
    echo -ne "${YELLOW}   $i seconds remaining...\r${NC}"
    sleep 1
done
echo -e "${GREEN}✅ Database services ready${NC}"
echo ""

# Step 6: Start main application
echo -e "${YELLOW}🚀 Step 6/6: Starting SoundWave application...${NC}"
docker compose up -d soundwave
echo -e "${BLUE}⏳ Waiting for application to start...${NC}"
sleep 10
echo -e "${GREEN}✅ Application container started${NC}"
echo ""

# Run migrations
echo -e "${YELLOW}🔄 Running database migrations...${NC}"
echo "Creating migrations for audio models..."
docker exec soundwave python manage.py makemigrations audio || echo "No new migrations needed"
echo "Applying all migrations..."
docker exec soundwave python manage.py migrate
echo -e "${GREEN}✅ Migrations completed${NC}"
echo ""

# Create superuser
echo -e "${YELLOW}👤 Setting up admin user...${NC}"
docker exec soundwave python manage.py shell << 'PYEOF'
from django.contrib.auth import get_user_model
import os

User = get_user_model()
username = os.getenv('SW_USERNAME', 'admin')
password = os.getenv('SW_PASSWORD', 'soundwave')

if not User.objects.filter(username=username).exists():
    User.objects.create_superuser(username, 'admin@soundwave.local', password)
    print(f'✅ Admin user created: {username}')
else:
    print(f'ℹ️  Admin user already exists: {username}')
PYEOF
echo ""

# Collect static files
echo -e "${YELLOW}📦 Collecting static files...${NC}"
docker exec soundwave python manage.py collectstatic --noinput
echo -e "${GREEN}✅ Static files collected${NC}"
echo ""

# Check container health
echo -e "${YELLOW}🏥 Checking service health...${NC}"
echo ""
docker compose ps
echo ""

# Final summary
echo -e "${GREEN}"
echo "╔════════════════════════════════════════╗"
echo "║          🎉 Setup Complete! 🎉         ║"
echo "╚════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "${BLUE}📊 Service Information:${NC}"
echo -e "${GREEN}   🌐 Application:${NC} http://localhost:123456"
echo -e "${GREEN}   👤 Username:${NC}    admin"
echo -e "${GREEN}   🔑 Password:${NC}    soundwave"
echo ""
echo -e "${BLUE}📝 Useful Commands:${NC}"
echo -e "${YELLOW}   View logs:${NC}       docker compose logs -f soundwave"
echo -e "${YELLOW}   Stop services:${NC}   docker compose down"
echo -e "${YELLOW}   Restart:${NC}         docker compose restart soundwave"
echo -e "${YELLOW}   Shell access:${NC}    docker exec -it soundwave bash"
echo ""
echo -e "${BLUE}🧪 Next Steps:${NC}"
echo "   1. Open http://localhost:123456 in your browser"
echo "   2. Login with admin / soundwave"
echo "   3. Test local file upload"
echo "   4. Install PWA (look for install icon in address bar)"
echo "   5. Test offline mode"
echo ""
echo -e "${GREEN}🎵 Enjoy SoundWave! 🎵${NC}"
echo ""
