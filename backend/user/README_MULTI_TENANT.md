# Multi-Tenant Admin System - Implementation Guide

## Overview

This system transforms SoundWave into a multi-tenant platform where:
- **Admins** can manage all users and their content
- **Users** have isolated YouTube accounts, channels, playlists, and audio files
- Each user operates as if they have their own Docker container
- Resource limits (storage, channels, playlists) are enforced per user

## Architecture

### User Isolation Model

```
Admin User (is_admin=True)
├── Can create/manage all users
├── Access all content across users
└── Set resource quotas

Regular User
├── Own YouTube accounts
├── Own channels (subscriptions)
├── Own playlists
├── Own audio files
└── Cannot see other users' data
```

### Database Schema Changes

**Account Model** (`user/models.py`):
```python
- storage_quota_gb: int (default 50 GB)
- storage_used_gb: float (tracked automatically)
- max_channels: int (default 50)
- max_playlists: int (default 100)
- user_notes: text (admin notes)
- created_by: ForeignKey to admin who created user
```

**UserYouTubeAccount Model** (NEW):
```python
- user: ForeignKey to Account
- account_name: str (friendly name)
- youtube_channel_id: str
- youtube_channel_name: str
- cookies_file: text (for authentication)
- auto_download: bool
- download_quality: choices
```

**Channel Model** (UPDATED):
```python
+ owner: ForeignKey to Account
+ youtube_account: ForeignKey to UserYouTubeAccount
+ auto_download: bool per channel
+ download_quality: choices per channel
```

**Audio Model** (UPDATED):
```python
+ owner: ForeignKey to Account
```

**Playlist Model** (UPDATED):
```python
+ owner: ForeignKey to Account
+ auto_download: bool per playlist
```

### Unique Constraints

- **Channel**: `(owner, channel_id)` - Each user can subscribe once per channel
- **Audio**: `(owner, youtube_id)` - Each user can have one copy of each video
- **Playlist**: `(owner, playlist_id)` - Each user can subscribe once per playlist

## Backend Implementation

### Middleware (`config/middleware.py`)

**UserIsolationMiddleware**:
- Adds `request.filter_by_user()` helper
- Automatically filters querysets by owner
- Admins bypass filtering

**StorageQuotaMiddleware**:
- Tracks storage usage
- Prevents uploads when quota exceeded

### Permissions (`common/permissions.py`)

**IsOwnerOrAdmin**:
- Users can only access their own objects
- Admins can access everything

**CanManageUsers**:
- Only admins can manage users

**WithinQuotaLimits**:
- Checks storage/channel/playlist quotas
- Admins bypass quota checks

### Admin API (`user/views_admin.py`)

**UserManagementViewSet**:
```python
GET    /api/user/admin/users/              # List users
POST   /api/user/admin/users/              # Create user
GET    /api/user/admin/users/{id}/         # User details
PATCH  /api/user/admin/users/{id}/         # Update user
GET    /api/user/admin/users/{id}/stats/   # User statistics
POST   /api/user/admin/users/{id}/reset_storage/
POST   /api/user/admin/users/{id}/reset_2fa/
POST   /api/user/admin/users/{id}/toggle_active/
GET    /api/user/admin/users/{id}/channels/
GET    /api/user/admin/users/{id}/playlists/
GET    /api/user/admin/users/system_stats/ # System-wide stats
```

**UserYouTubeAccountViewSet**:
```python
GET    /api/user/admin/youtube-accounts/              # List accounts
POST   /api/user/admin/youtube-accounts/              # Add account
GET    /api/user/admin/youtube-accounts/{id}/         # Account details
PATCH  /api/user/admin/youtube-accounts/{id}/         # Update account
DELETE /api/user/admin/youtube-accounts/{id}/         # Delete account
POST   /api/user/admin/youtube-accounts/{id}/verify/  # Verify credentials
POST   /api/user/admin/youtube-accounts/{id}/toggle_active/
```

### Django Admin (`user/admin_users.py`)

Enhanced admin interface with:
- User list with storage/channel/playlist counts
- Visual storage progress bars
- Bulk actions (reset storage, disable users, reset 2FA)
- YouTube account management
- Per-user notes

## Frontend Implementation

### AdminUsersPage Component

**Features**:
- System statistics dashboard (users, content, storage)
- Users table with status, storage, content counts
- Create user dialog with full settings
- Edit user dialog with quota management
- User details modal with comprehensive info
- Quick actions (activate/deactivate, reset storage, reset 2FA)

**UI Components**:
```tsx
- System stats cards (users, content, storage)
- Users table (sortable, filterable)
- Create user form (username, email, password, quotas)
- Edit user form (quotas, status, permissions)
- User details modal (all stats and metadata)
- Actions menu (edit, toggle, reset)
```

## Migration Strategy

### Step 1: Run Migrations

```bash
# Create migrations
python manage.py makemigrations user channel audio playlist

# Apply migrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser
```

### Step 2: Data Migration

For existing data, create a data migration to set owner fields:

```python
# Create empty migration
python manage.py makemigrations --empty user --name set_default_owner

# Edit migration file
def set_default_owner(apps, schema_editor):
    Account = apps.get_model('user', 'Account')
    Channel = apps.get_model('channel', 'Channel')
    Audio = apps.get_model('audio', 'Audio')
    Playlist = apps.get_model('playlist', 'Playlist')
    
    # Get or create default admin user
    admin = Account.objects.filter(is_superuser=True).first()
    if not admin:
        admin = Account.objects.create_superuser(
            username='admin',
            email='admin@example.com',
            password='changeme'
        )
    
    # Assign owner to existing records
    Channel.objects.filter(owner__isnull=True).update(owner=admin)
    Audio.objects.filter(owner__isnull=True).update(owner=admin)
    Playlist.objects.filter(owner__isnull=True).update(owner=admin)
```

### Step 3: Update Views

Update existing views to use owner filtering:

```python
# Before
Audio.objects.all()

# After
Audio.objects.filter(owner=request.user)
# or use middleware
request.filter_by_user(Audio.objects.all())
```

### Step 4: Update Serializers

Ensure owner is set on create:

```python
def perform_create(self, serializer):
    serializer.save(owner=self.request.user)
```

## Usage Examples

### Admin Creating User

```bash
POST /api/user/admin/users/
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "secure123",
  "password_confirm": "secure123",
  "storage_quota_gb": 100,
  "max_channels": 75,
  "max_playlists": 150,
  "is_admin": false,
  "is_active": true,
  "user_notes": "Premium user - increased quotas"
}
```

### User Adding YouTube Account

```bash
POST /api/user/admin/youtube-accounts/
{
  "account_name": "Personal YouTube",
  "youtube_channel_id": "UCxxxxxxxx",
  "youtube_channel_name": "John's Channel",
  "cookies_file": "# Netscape HTTP Cookie File...",
  "auto_download": true,
  "download_quality": "high"
}
```

### User Subscribing to Channel

```bash
POST /api/channels/
{
  "channel_id": "UCxxxxxxxx",
  "channel_name": "Tech Channel",
  "youtube_account": 1,  # User's YouTube account ID
  "subscribed": true,
  "auto_download": true,
  "download_quality": "auto"
}
```

## Resource Quota Enforcement

### Storage Quota

```python
# Checked before download
if user.storage_used_gb >= user.storage_quota_gb:
    raise PermissionDenied("Storage quota exceeded")

# Updated after download
file_size_gb = file_size_bytes / (1024**3)
user.storage_used_gb += file_size_gb
user.save()

# Updated after deletion
user.storage_used_gb -= file_size_gb
user.save()
```

### Channel Limit

```python
# Checked before subscribing
if not user.can_add_channel:
    raise PermissionDenied(f"Channel limit reached ({user.max_channels})")

# Property in Account model
@property
def can_add_channel(self):
    current_count = self.channels.count()
    return current_count < self.max_channels
```

### Playlist Limit

```python
# Checked before creating
if not user.can_add_playlist:
    raise PermissionDenied(f"Playlist limit reached ({user.max_playlists})")

# Property in Account model
@property
def can_add_playlist(self):
    current_count = self.playlists.count()
    return current_count < self.max_playlists
```

## Security Considerations

### Data Isolation

1. **Queryset Filtering**: All queries automatically filtered by owner
2. **Middleware**: UserIsolationMiddleware enforces filtering
3. **Permissions**: IsOwnerOrAdmin checks object-level permissions
4. **Admin Bypass**: Admins can access all data for management

### Authentication

1. **User Authentication**: Standard Django auth with 2FA support
2. **YouTube Authentication**: Cookie-based (stored per user)
3. **API Authentication**: Token-based with user context

### File Storage

User files should be stored in isolated directories:

```python
# File path structure
/media/
  └── users/
      ├── user_1/
      │   ├── audio/
      │   ├── thumbnails/
      │   └── cookies/
      ├── user_2/
      │   ├── audio/
      │   ├── thumbnails/
      │   └── cookies/
      └── ...
```

## Celery Tasks

Update tasks to respect user isolation:

```python
@shared_task
def download_audio(audio_id, user_id):
    audio = Audio.objects.get(id=audio_id, owner_id=user_id)
    user = audio.owner
    
    # Use user's YouTube account
    youtube_account = audio.channel.youtube_account
    cookies_file = youtube_account.cookies_file if youtube_account else None
    
    # Download to user's directory
    output_path = f'/media/users/user_{user_id}/audio/'
    
    # Check quota before download
    if user.storage_used_gb >= user.storage_quota_gb:
        raise Exception("Storage quota exceeded")
    
    # Download...
    
    # Update storage
    user.storage_used_gb += file_size_gb
    user.save()
```

## Testing

### Test User Isolation

```python
def test_user_cannot_access_other_user_data():
    user1 = Account.objects.create_user('user1', 'user1@test.com', 'pass')
    user2 = Account.objects.create_user('user2', 'user2@test.com', 'pass')
    
    audio1 = Audio.objects.create(owner=user1, youtube_id='xxx')
    audio2 = Audio.objects.create(owner=user2, youtube_id='yyy')
    
    # User1 should only see their audio
    assert Audio.objects.filter(owner=user1).count() == 1
    assert Audio.objects.filter(owner=user2).count() == 1
```

### Test Quota Enforcement

```python
def test_storage_quota_enforced():
    user = Account.objects.create_user(
        'user', 'user@test.com', 'pass',
        storage_quota_gb=10,
        storage_used_gb=10
    )
    
    # Should fail when quota exceeded
    with pytest.raises(PermissionDenied):
        download_audio(audio_id, user.id)
```

## Performance Optimization

### Database Indexes

```python
class Meta:
    indexes = [
        models.Index(fields=['owner', 'youtube_id']),
        models.Index(fields=['owner', 'channel_id']),
        models.Index(fields=['owner', '-published_date']),
    ]
```

### Query Optimization

```python
# Use select_related for foreign keys
Audio.objects.filter(owner=user).select_related('owner')

# Use prefetch_related for reverse relations
User.objects.prefetch_related('channels', 'playlists', 'audio_files')
```

### Caching

```python
# Cache user stats
cache_key = f'user_stats_{user.id}'
stats = cache.get(cache_key)
if not stats:
    stats = calculate_user_stats(user)
    cache.set(cache_key, stats, 300)  # 5 minutes
```

## Future Enhancements

- [ ] User groups and team accounts
- [ ] Shared playlists between users
- [ ] Storage pooling for organizations
- [ ] Usage analytics per user
- [ ] API rate limiting per user
- [ ] Custom branding per user
- [ ] Billing and subscription management
- [ ] OAuth integration for YouTube
- [ ] Automated quota adjustment based on usage
- [ ] User data export/import
