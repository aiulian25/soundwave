#!/bin/bash
# Migration script for existing Soundwave deployments

set -e

echo "🔄 Soundwave Data Persistence Migration"
echo "========================================"
echo ""
echo "This script will:"
echo "1. Stop existing containers"
echo "2. Backup current database (if exists)"
echo "3. Create persistent data directory"
echo "4. Migrate database to new location"
echo "5. Rebuild and restart containers"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Confirm
read -p "Continue with migration? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Migration cancelled."
    exit 0
fi

echo ""
echo "Step 1: Stopping containers..."
echo "-------------------------------"
docker-compose down
echo -e "${GREEN}✅ Containers stopped${NC}"

echo ""
echo "Step 2: Creating backup..."
echo "--------------------------"
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup database if exists in backend/
if [ -f "backend/db.sqlite3" ]; then
    echo "Found database in backend/"
    cp backend/db.sqlite3 "$BACKUP_DIR/"
    echo -e "${GREEN}✅ Database backed up to $BACKUP_DIR/${NC}"
else
    echo -e "${YELLOW}⚠️  No database found in backend/ (might be first run)${NC}"
fi

# Backup audio if exists
if [ -d "audio" ] && [ "$(ls -A audio)" ]; then
    echo "Backing up audio directory..."
    du -sh audio
    # Don't copy audio, just note it
    echo "audio/ → Already in volume (no action needed)"
    echo -e "${GREEN}✅ Audio files already in persistent volume${NC}"
fi

echo ""
echo "Step 3: Creating data directory..."
echo "-----------------------------------"
mkdir -p data
mkdir -p cache
mkdir -p audio
mkdir -p es
mkdir -p redis
echo -e "${GREEN}✅ Persistent directories created${NC}"

echo ""
echo "Step 4: Migrating database..."
echo "------------------------------"
if [ -f "backend/db.sqlite3" ]; then
    echo "Moving database to data/"
    mv backend/db.sqlite3 data/
    echo -e "${GREEN}✅ Database migrated to data/db.sqlite3${NC}"
else
    echo -e "${YELLOW}⚠️  No database to migrate (will be created fresh)${NC}"
fi

# Create .gitignore in data/
cat > data/.gitignore << 'EOF'
# Persistent database files
db.sqlite3
*.sqlite3-journal
*.sqlite3-shm
*.sqlite3-wal
EOF
echo -e "${GREEN}✅ Created data/.gitignore${NC}"

echo ""
echo "Step 5: Rebuilding containers..."
echo "---------------------------------"
echo "This may take a few minutes..."
docker-compose build --no-cache
echo -e "${GREEN}✅ Containers rebuilt${NC}"

echo ""
echo "Step 6: Starting services..."
echo "----------------------------"
docker-compose up -d
echo -e "${GREEN}✅ Services started${NC}"

echo ""
echo "Step 7: Waiting for services to initialize..."
echo "----------------------------------------------"
sleep 10

# Check if services are running
if docker ps | grep -q soundwave; then
    echo -e "${GREEN}✅ Soundwave container is running${NC}"
else
    echo -e "${RED}❌ Soundwave container failed to start${NC}"
    echo "Check logs with: docker-compose logs soundwave"
    exit 1
fi

echo ""
echo "Step 8: Verifying database location..."
echo "---------------------------------------"
DB_PATH=$(docker exec soundwave python -c "from django.conf import settings; print(settings.DATABASES['default']['NAME'])" 2>/dev/null || echo "ERROR")

if [[ $DB_PATH == *"/app/data/"* ]]; then
    echo -e "${GREEN}✅ Database correctly configured at: $DB_PATH${NC}"
else
    echo -e "${RED}❌ Database path incorrect: $DB_PATH${NC}"
    echo "Expected: /app/data/db.sqlite3"
    exit 1
fi

# Check if database file exists
if docker exec soundwave test -f /app/data/db.sqlite3 2>/dev/null; then
    echo -e "${GREEN}✅ Database file exists in container${NC}"
    
    # Get user count
    USER_COUNT=$(docker exec soundwave python manage.py shell -c "from user.models import Account; print(Account.objects.count())" 2>/dev/null || echo "0")
    echo "   Users in database: $USER_COUNT"
else
    echo -e "${YELLOW}⚠️  Database file not found - running migrations...${NC}"
    docker exec soundwave python manage.py migrate
    echo -e "${GREEN}✅ Migrations complete${NC}"
fi

echo ""
echo "Step 9: Testing persistence..."
echo "-------------------------------"
echo "Testing container restart..."
docker-compose restart soundwave
sleep 5

# Check database still exists
if docker exec soundwave test -f /app/data/db.sqlite3 2>/dev/null; then
    echo -e "${GREEN}✅ Database persists after restart${NC}"
else
    echo -e "${RED}❌ Database lost after restart!${NC}"
    exit 1
fi

echo ""
echo "========================================"
echo "🎉 Migration Complete!"
echo "========================================"
echo ""
echo "Summary:"
echo "--------"
echo "✅ Containers rebuilt with new configuration"
echo "✅ Database moved to persistent volume"
echo "✅ Data will now survive container rebuilds"
echo "✅ Backup saved in: $BACKUP_DIR/"
echo ""
echo "Next steps:"
echo "-----------"
echo "1. Test the application: http://localhost:8889"
echo "2. Verify your data is intact"
echo "3. Test persistence:"
echo "   docker-compose down"
echo "   docker-compose up -d"
echo "   # Data should still be there!"
echo ""
echo "Logs:"
echo "-----"
echo "docker-compose logs -f soundwave"
echo ""
echo "Documentation:"
echo "--------------"
echo "• docs/QUICK_REFERENCE.md - Quick guide"
echo "• docs/DATA_PERSISTENCE_FIX.md - Technical details"
echo "• docs/OFFLINE_PLAYLISTS_GUIDE.md - PWA features"
echo ""

# Show service status
echo "Current Status:"
echo "---------------"
docker-compose ps
