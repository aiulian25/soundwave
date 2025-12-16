# Avatar Upload Feature

## Overview
Users can now customize their profile avatar with either preset avatars or custom uploads. Avatars are stored persistently and survive container rebuilds.

## Features Implemented

### Backend
1. **User Model Update** (`backend/user/models.py`)
   - Added `avatar` field to Account model
   - Stores either `preset_X` (1-5) or path to custom uploaded file

2. **Avatar Upload Endpoint** (`backend/user/views.py`)
   - `POST /api/user/avatar/upload/` - Upload custom avatar
     - Max size: 20MB
     - Allowed types: JPEG, PNG, GIF, WebP
     - Automatically removes old custom avatar
     - Generates safe filename: `username_timestamp.ext`
   - `DELETE /api/user/avatar/upload/` - Remove avatar
   - Security: File validation, path sanitization, user isolation

3. **Avatar Preset Endpoint** (`backend/user/views.py`)
   - `POST /api/user/avatar/preset/` - Set preset avatar (1-5)
   - Validates preset number
   - Removes old custom avatar file if exists

4. **Avatar File Serving** (`backend/user/views.py`)
   - `GET /api/user/avatar/file/<filename>/` - Serve custom avatars
   - Security: Path traversal prevention, symlink protection
   - Proper content-type detection

5. **User Serializer Update** (`backend/user/serializers.py`)
   - Added `avatar` and `avatar_url` fields
   - `avatar_url` returns full URL for frontend:
     - Presets: `/avatars/preset_X.svg` (served from frontend public folder)
     - Custom: `/api/user/avatar/file/<filename>/` (served from backend)

### Frontend
1. **Preset Avatars** (`frontend/public/avatars/`)
   - 5 musical-themed SVG avatars:
     - `preset_1.svg` - Music note (Indigo)
     - `preset_2.svg` - Headphones (Pink)
     - `preset_3.svg` - Microphone (Green)
     - `preset_4.svg` - Vinyl record (Amber)
     - `preset_5.svg` - Waveform (Purple)

2. **AvatarDialog Component** (`frontend/src/components/AvatarDialog.tsx`)
   - Grid of 5 preset avatars
   - Custom upload with drag-and-drop style UI
   - File validation (size, type)
   - Remove avatar option
   - Success/error notifications
   - Visual feedback (checkmark on current avatar)

3. **TopBar Update** (`frontend/src/components/TopBar.tsx`)
   - Fetches user data on mount
   - Displays avatar or username initial
   - Click avatar to open selection dialog
   - Hover effect on avatar
   - Shows username instead of "Music Lover"

## Storage
- **Location**: `/app/data/avatars/`
- **Persistence**: Mounted via `./data:/app/data` volume in docker-compose
- **Survives**: Container rebuilds, restarts, code updates
- **Security**: Path validation prevents directory traversal

## User Experience
1. Click avatar in top-left corner
2. Dialog opens with:
   - 5 preset avatars in a grid
   - Upload button for custom image
   - Remove button to clear avatar
3. Select preset → Instantly updates
4. Upload custom → Validates, uploads, updates
5. Avatar persists across sessions

## Security Features
- File size limit (20MB)
- File type validation (JPEG, PNG, GIF, WebP)
- Filename sanitization (timestamp-based)
- Path traversal prevention
- Symlink protection
- User isolation (can only access own avatars)
- Authentication required for all endpoints

## Migration Required
Before running, execute in container:
```bash
docker exec -it soundwave python manage.py makemigrations user
docker exec -it soundwave python manage.py migrate user
```

Or rebuild container:
```bash
docker-compose down
docker-compose build
docker-compose up -d
```

## Testing Checklist
- [ ] Click avatar opens dialog
- [ ] All 5 presets visible and clickable
- [ ] Upload JPEG works
- [ ] Upload PNG works
- [ ] File size validation (try >20MB)
- [ ] File type validation (try PDF)
- [ ] Remove avatar works
- [ ] Avatar persists after container restart
- [ ] Avatar shows on mobile
- [ ] Username displays instead of "Music Lover"
- [ ] Both admin and managed users can set avatars
- [ ] Custom avatars survive rebuild

## API Endpoints
```
POST   /api/user/avatar/upload/      - Upload custom avatar (multipart/form-data)
DELETE /api/user/avatar/upload/      - Remove avatar
POST   /api/user/avatar/preset/      - Set preset avatar (body: {"preset": 1-5})
GET    /api/user/avatar/file/<name>/ - Serve custom avatar file
GET    /api/user/account/             - Includes avatar and avatar_url
```

## Files Modified
- `backend/user/models.py` - Added avatar field
- `backend/user/views.py` - Added avatar endpoints
- `backend/user/urls.py` - Added avatar routes
- `backend/user/serializers.py` - Added avatar_url field

## Files Created
- `frontend/src/components/AvatarDialog.tsx` - Avatar selection dialog
- `frontend/public/avatars/preset_1.svg` - Music note avatar
- `frontend/public/avatars/preset_2.svg` - Headphones avatar
- `frontend/public/avatars/preset_3.svg` - Microphone avatar
- `frontend/public/avatars/preset_4.svg` - Vinyl record avatar
- `frontend/public/avatars/preset_5.svg` - Waveform avatar
- `docs/AVATAR_FEATURE.md` - This documentation
