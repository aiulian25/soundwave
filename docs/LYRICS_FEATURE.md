# Lyrics Feature - SoundWave

## Overview

SoundWave now includes automatic lyrics fetching and synchronized display powered by the [LRCLIB API](https://lrclib.net/). This feature provides:

- **Automatic lyrics fetching** for newly downloaded audio
- **Synchronized lyrics** display with real-time highlighting
- **Caching system** to minimize API requests
- **Background polling** to gradually build lyrics library
- **Manual controls** for fetching, updating, and managing lyrics

## How It Works

### 1. Automatic Fetching

When you download an audio file, SoundWave automatically:
1. Extracts metadata (title, artist, duration)
2. Queries LRCLIB API for lyrics
3. Stores synchronized (.lrc) or plain text lyrics
4. Caches results to avoid duplicate requests

### 2. Background Polling

A Celery beat schedule runs periodic tasks:

- **Every hour**: Auto-fetch lyrics for up to 50 tracks without lyrics
- **Weekly (Sunday 3 AM)**: Clean up old cache entries (30+ days)
- **Weekly (Sunday 4 AM)**: Retry failed lyrics fetches (7+ days old)

### 3. Smart Caching

Two-level caching system:

1. **Django Cache**: In-memory cache for API responses (7 days)
2. **Database Cache**: `LyricsCache` table stores lyrics by title/artist/duration

This ensures:
- Minimal API requests (respecting rate limits)
- Fast lyrics retrieval
- Shared cache across tracks with same metadata

## API Endpoints

### Get Lyrics for Audio
```http
GET /api/audio/{youtube_id}/lyrics/
```

Returns lyrics data or triggers async fetch if not attempted.

### Manually Fetch Lyrics
```http
POST /api/audio/{youtube_id}/lyrics/fetch/
Body: { "force": true }
```

Forces immediate lyrics fetch from LRCLIB API.

### Update Lyrics Manually
```http
PUT /api/audio/{youtube_id}/lyrics/
Body: {
  "synced_lyrics": "[00:12.00]Lyrics text...",
  "plain_lyrics": "Plain text lyrics...",
  "is_instrumental": false,
  "language": "en"
}
```

### Delete Lyrics
```http
DELETE /api/audio/{youtube_id}/lyrics/
```

### Batch Fetch
```http
POST /api/audio/lyrics/fetch_batch/
Body: { "youtube_ids": ["abc123", "def456"] }
```

### Fetch All Missing
```http
POST /api/audio/lyrics/fetch_all_missing/
Body: { "limit": 50 }
```

### Statistics
```http
GET /api/audio/lyrics/stats/
```

Returns:
```json
{
  "total_audio": 1250,
  "total_lyrics_attempted": 980,
  "with_synced_lyrics": 720,
  "with_plain_lyrics": 150,
  "instrumental": 30,
  "failed": 80,
  "coverage_percentage": 72.0
}
```

## Frontend Components

### LyricsPlayer Component

```tsx
import LyricsPlayer from '@/components/LyricsPlayer';

<LyricsPlayer
  youtubeId="abc123"
  currentTime={45.2}
  onClose={() => setShowLyrics(false)}
  embedded={false}
/>
```

**Features:**
- Real-time synchronized highlighting
- Auto-scroll with toggle
- Synced/Plain text tabs
- Retry fetch button
- Instrumental detection

### Props
- `youtubeId`: YouTube video ID
- `currentTime`: Current playback time in seconds
- `onClose`: Callback when closed (optional)
- `embedded`: Compact mode flag (optional)

## Database Models

### Lyrics Model
```python
class Lyrics(models.Model):
    audio = OneToOneField(Audio)
    synced_lyrics = TextField()
    plain_lyrics = TextField()
    is_instrumental = BooleanField()
    source = CharField()  # 'lrclib', 'genius', 'manual'
    language = CharField()
    fetched_date = DateTimeField()
    fetch_attempted = BooleanField()
    fetch_attempts = IntegerField()
    last_error = TextField()
```

### LyricsCache Model
```python
class LyricsCache(models.Model):
    title = CharField()
    artist_name = CharField()
    album_name = CharField()
    duration = IntegerField()
    synced_lyrics = TextField()
    plain_lyrics = TextField()
    is_instrumental = BooleanField()
    language = CharField()
    source = CharField()
    cached_date = DateTimeField()
    last_accessed = DateTimeField()
    access_count = IntegerField()
    not_found = BooleanField()
```

## Celery Tasks

### fetch_lyrics_for_audio
```python
from audio.tasks_lyrics import fetch_lyrics_for_audio

fetch_lyrics_for_audio.delay('youtube_id', force=False)
```

### fetch_lyrics_batch
```python
from audio.tasks_lyrics import fetch_lyrics_batch

fetch_lyrics_batch.delay(['id1', 'id2', 'id3'], delay_seconds=2)
```

### auto_fetch_lyrics
```python
from audio.tasks_lyrics import auto_fetch_lyrics

auto_fetch_lyrics.delay(limit=50, max_attempts=3)
```

### cleanup_lyrics_cache
```python
from audio.tasks_lyrics import cleanup_lyrics_cache

cleanup_lyrics_cache.delay(days_old=30)
```

### refetch_failed_lyrics
```python
from audio.tasks_lyrics import refetch_failed_lyrics

refetch_failed_lyrics.delay(days_old=7, limit=20)
```

## Configuration

### Celery Beat Schedule
Located in `backend/config/celery.py`:

```python
app.conf.beat_schedule = {
    'auto-fetch-lyrics': {
        'task': 'audio.auto_fetch_lyrics',
        'schedule': crontab(minute=0),  # Every hour
        'kwargs': {'limit': 50, 'max_attempts': 3},
    },
    # ... more tasks
}
```

### LRCLIB Instance
Default: `https://lrclib.net`

To use custom instance:
```python
from audio.lyrics_service import LyricsService

service = LyricsService(lrclib_instance='https://custom.lrclib.net')
```

## LRC Format

Synchronized lyrics use the LRC format:

```
[ar: Artist Name]
[ti: Song Title]
[al: Album Name]
[00:12.00]First line of lyrics
[00:15.50]Second line of lyrics
[00:18.20]Third line of lyrics
```

Timestamps format: `[mm:ss.xx]`
- `mm`: Minutes (2 digits)
- `ss`: Seconds (2 digits)
- `xx`: Centiseconds (2 digits)

## Admin Interface

Django Admin provides:

### Lyrics Admin
- List view with filters (source, language, fetch status)
- Search by audio title/channel/youtube_id
- Edit synced/plain lyrics
- View fetch attempts and errors

### LyricsCache Admin
- List view with filters (source, not_found, date)
- Search by title/artist
- View access count statistics
- Bulk action: Clear not_found entries

## Rate Limiting

To avoid overwhelming LRCLIB API:

1. **Request delays**: 1-2 second delays between batch requests
2. **Caching**: 7-day cache for successful fetches, 1-day for not_found
3. **Max attempts**: Stop after 3-5 failed attempts
4. **Retry backoff**: Wait 7+ days before retrying failed fetches

## Troubleshooting

### No lyrics found
- Check if track metadata (title, artist) is accurate
- Try manual fetch with force=true
- Check LRCLIB database has lyrics for this track
- Verify track isn't instrumental

### Sync issues
- Ensure audio duration matches lyrics timing
- Check LRC format is valid (use validator)
- Verify current_time prop is updated correctly

### Performance
- Monitor cache hit rate: `/api/audio/lyrics-cache/stats/`
- Clear old not_found entries regularly
- Adjust Celery beat schedule if needed

## Credits

- **LRCLIB API**: https://lrclib.net/
- **LRC Format**: https://en.wikipedia.org/wiki/LRC_(file_format)
- **Inspiration**: lrcget project by tranxuanthang

## License

This feature is part of SoundWave and follows the same MIT license.
