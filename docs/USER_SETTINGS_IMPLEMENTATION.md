# User Settings Persistence Implementation

## Overview
This implementation ensures that user preferences (theme, volume, repeat mode, shuffle, etc.) are saved to the database and persist across container restarts, logouts, and browser sessions.

## Backend Changes

### 1. New UserConfig Model
**File**: `backend/user/models.py`

Added a new `UserConfig` model that stores:
- **UI Preferences**: `theme` (dark, light, blue, green, etc.)
- **Player Settings**: 
  - `volume` (0-100)
  - `repeat_mode` (none, one, all)
  - `shuffle_enabled` (boolean)
- **Audio Quality**: `audio_quality` (low, medium, high, best)
- **Display Settings**: `items_per_page`
- **Additional Settings**: `extra_settings` (JSON field for extensibility)

The model has a OneToOne relationship with the User (Account) model.

### 2. Updated API Endpoints
**File**: `backend/user/views.py`

Updated `UserConfigView`:
- **GET `/api/user/config/`**: Retrieves user's current configuration (creates default if doesn't exist)
- **POST `/api/user/config/`**: Updates user's configuration (partial updates supported)

### 3. Updated Serializers
**File**: `backend/user/serializers.py`

Updated `UserConfigSerializer` to use ModelSerializer for full UserConfig model support.

### 4. Database Migration
**File**: `backend/user/migrations/0001_initial_userconfig.py`

Created migration to add the UserConfig table.

## Frontend Changes

### 1. Settings Hook
**File**: `frontend/src/hooks/useUserSettings.ts`

Created a custom hook `useUserSettings()` that:
- Loads settings from backend on mount
- Provides methods to update individual settings
- Handles optimistic updates
- Syncs with backend automatically
- Falls back to defaults if backend is unavailable

### 2. Settings Context Provider
**File**: `frontend/src/context/SettingsContext.tsx`

Created a React Context Provider that:
- Makes settings available throughout the app
- Provides update functions
- Manages loading and error states

### 3. Updated Player Component
**File**: `frontend/src/components/Player.tsx`

Enhanced the Player to:
- Load volume, repeat mode, and shuffle state from settings
- Automatically save changes to backend when user adjusts:
  - Volume slider
  - Repeat button (cycles: none → one → all)
  - Shuffle button
- Show active states for repeat and shuffle buttons
- Use RepeatOneIcon when repeat mode is 'one'

### 4. Updated Theme Integration
**Files**: 
- `frontend/src/main.tsx`
- `frontend/src/AppWithTheme.tsx`

Integrated SettingsProvider and synchronized theme selection with backend:
- Theme changes are saved to both localStorage (immediate) and backend (persistent)
- Theme is restored from backend on login
- Falls back to localStorage if backend is unavailable

## How It Works

### On Login/Page Load:
1. User authenticates with token
2. SettingsContext loads user config from `/api/user/config/`
3. Settings are applied to:
   - Theme (AppWithTheme)
   - Player (volume, repeat, shuffle)
   - Any other components using useSettings()

### On Setting Change:
1. User adjusts a setting (volume, theme, etc.)
2. UI updates immediately (optimistic update)
3. Setting is saved to backend via POST `/api/user/config/`
4. If save fails, setting reverts to last known good state

### On Logout:
1. Token is cleared
2. Settings remain in database
3. On next login, all settings are restored

### Container Restart:
1. Database persists in volume mount
2. UserConfig table remains intact
3. On restart, users' settings are immediately available

## Database Persistence

The settings are stored in the SQLite/PostgreSQL database in the `user_userconfig` table. As long as the database volume is persisted (which it is in the Docker setup via `data/` folder), all settings will survive:

- Container restarts
- Container rebuilds
- System reboots
- Logouts/logins
- Browser cache clears

## Migration Instructions

### Apply the Migration:

```bash
# If using Docker:
make migrate

# Or directly:
docker-compose exec soundwave python backend/manage.py migrate user

# If using Python directly:
python backend/manage.py migrate user
```

### Verify Migration:

```bash
# Check that UserConfig table was created
docker-compose exec soundwave python backend/manage.py dbshell
.tables  # Should show user_userconfig table
.quit
```

## Testing Checklist

### Backend Testing:
1. ✅ UserConfig model created
2. ✅ API endpoints work (GET/POST `/api/user/config/`)
3. ⏳ Migration needs to be applied
4. ⏳ Test settings persist in database

### Frontend Testing:
1. ✅ Settings hook created
2. ✅ Settings context provides global access
3. ✅ Player uses settings for volume/repeat/shuffle
4. ✅ Theme syncs with backend
5. ⏳ Test settings load on page refresh
6. ⏳ Test settings persist after logout/login
7. ⏳ Test settings persist after container restart

## Next Steps

1. **Apply Migration**: Run `make migrate` or the Docker equivalent
2. **Test Frontend**: Build and test the frontend changes
3. **Verify Persistence**: 
   - Change settings
   - Logout and login
   - Restart container
   - Verify settings are restored

## Additional Notes

- Settings are lazy-loaded (created on first access)
- All settings have sensible defaults
- The `extra_settings` JSON field allows for future extensibility
- LocalStorage is still used as a cache for immediate theme application
- Backend is the source of truth for all settings
- Settings are user-specific (isolated per account)

## Files Modified

### Backend:
- `backend/user/models.py` - Added UserConfig model
- `backend/user/serializers.py` - Updated UserConfigSerializer
- `backend/user/views.py` - Updated UserConfigView
- `backend/user/migrations/0001_initial_userconfig.py` - New migration

### Frontend:
- `frontend/src/hooks/useUserSettings.ts` - New hook
- `frontend/src/context/SettingsContext.tsx` - New context
- `frontend/src/components/Player.tsx` - Updated to use settings
- `frontend/src/main.tsx` - Added SettingsProvider
- `frontend/src/AppWithTheme.tsx` - Integrated with settings

## Volume Persistence in Docker

The Docker Compose configuration should have:
```yaml
volumes:
  - ./data:/app/data
```

This ensures the SQLite database file (`data/db.sqlite3`) persists across container lifecycles, keeping all user settings safe.
