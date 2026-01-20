# Quick Setup Guide: User Settings Persistence

## Summary
User preferences (theme, volume, repeat, shuffle) now persist in the database and survive container restarts, logouts, and browser clears.

## What Was Added

### Backend
- ✅ `UserConfig` model to store settings
- ✅ `/api/user/config/` endpoints (GET/POST)
- ✅ Admin interface for viewing user settings

### Frontend
- ✅ `useUserSettings()` hook for managing settings
- ✅ `SettingsContext` for global access
- ✅ Player saves volume/repeat/shuffle automatically
- ✅ Theme syncs with backend

## Setup Steps

### 1. Apply Database Migration

```bash
# Using Docker:
docker-compose exec soundwave python backend/manage.py migrate user

# Or with make:
make migrate

# Verify:
docker-compose exec soundwave python backend/manage.py dbshell
# Then in SQLite shell:
.tables  # Should show user_userconfig
.quit
```

### 2. Test the Implementation

**Test Volume Persistence:**
1. Login to the app
2. Adjust volume slider to 50%
3. Logout and login again
4. Volume should be at 50%

**Test Repeat/Shuffle:**
1. Enable shuffle (green icon)
2. Set repeat to "one" (shows repeat-one icon)
3. Refresh page
4. Settings should be restored

**Test Theme:**
1. Change theme in Settings page
2. Logout and login
3. Theme should be preserved

**Test Container Restart:**
1. Change multiple settings
2. Stop container: `docker-compose down`
3. Start container: `docker-compose up -d`
4. Login - all settings should be restored

## How Settings Are Stored

```
localStorage (immediate, fallback)
     ↓
Backend API (/api/user/config/)
     ↓
Database (user_userconfig table)
     ↓
Docker Volume (data/)
```

**Persistence Levels:**
- ✅ Page refresh - localStorage + backend
- ✅ Logout/login - backend
- ✅ Browser clear - backend  
- ✅ Container restart - database volume
- ✅ System reboot - database volume

## API Usage

### Get Settings
```bash
curl -H "Authorization: Token YOUR_TOKEN" http://localhost:123456/api/user/config/
```

### Update Settings
```bash
curl -X POST \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"volume": 75, "theme": "blue"}' \
  http://localhost:123456/api/user/config/
```

## Troubleshooting

**Settings not saving:**
- Check browser console for errors
- Verify user is authenticated (token present)
- Check backend logs: `docker-compose logs -f soundwave`

**Settings reset after container restart:**
- Verify database volume is mounted: `docker-compose config | grep volumes`
- Check data/db.sqlite3 file exists and is writeable

**Migration issues:**
```bash
# Check migration status:
docker-compose exec soundwave python backend/manage.py showmigrations user

# If migration isn't applied:
docker-compose exec soundwave python backend/manage.py migrate user
```

## Default Values

| Setting | Default | Options |
|---------|---------|---------|
| theme | dark | dark, light, blue, green, white, lightBlue |
| volume | 80 | 0-100 |
| repeat_mode | none | none, one, all |
| shuffle_enabled | false | true, false |
| audio_quality | high | low, medium, high, best |
| items_per_page | 50 | any integer |

## Files Changed

**Backend:**
- `backend/user/models.py` - UserConfig model
- `backend/user/serializers.py` - UserConfigSerializer  
- `backend/user/views.py` - UserConfigView
- `backend/user/admin_users.py` - UserConfigAdmin
- `backend/user/migrations/0001_initial_userconfig.py` - Migration

**Frontend:**
- `frontend/src/hooks/useUserSettings.ts` - Settings hook
- `frontend/src/context/SettingsContext.tsx` - Settings context
- `frontend/src/components/Player.tsx` - Uses settings
- `frontend/src/main.tsx` - Adds SettingsProvider
- `frontend/src/AppWithTheme.tsx` - Theme integration

## Next Steps

1. ✅ Apply migration
2. ✅ Rebuild frontend if needed
3. ✅ Test all persistence scenarios
4. ✅ Verify volume is mounted in docker-compose.yml

That's it! User settings now persist reliably across all scenarios.
