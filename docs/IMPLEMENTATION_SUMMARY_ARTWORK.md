# SoundWave - ID3 Tags and Artwork Feature Implementation Summary

## Overview
Implemented comprehensive ID3 tagging and artwork management system with support for Last.fm and Fanart.tv APIs.

## What Was Implemented

### 1. Dependencies Added
**File**: `requirements.txt`
- `mutagen>=1.47.0` - ID3 tag reading/writing for MP4/M4A, MP3, FLAC
- `pylast>=5.2.0` - Last.fm API client

### 2. Database Models
**File**: `audio/models_artwork.py`

#### Artwork Model
- Stores artwork with multiple types (thumbnail, cover, album, artist image/banner/logo)
- Supports multiple sources (YouTube, Last.fm, Fanart.tv, manual)
- Tracks URL, local path, dimensions, priority
- Can be linked to Audio or Channel

#### MusicMetadata Model
- OneToOne relationship with Audio
- Stores album info, track/disc numbers, genre, tags
- Includes Last.fm data (URL, MBID, play count, listeners)
- Fanart.tv IDs for artwork lookup

#### ArtistInfo Model
- OneToOne relationship with Channel
- Stores artist bio, Last.fm statistics
- Tags, similar artists
- MusicBrainz and Fanart.tv IDs

### 3. ID3 Service
**File**: `audio/id3_service.py`

#### ID3TagService Class
Methods:
- `read_tags(file_path)` - Read tags from audio files
- `write_tags(file_path, tags)` - Write tags to audio files
- `embed_cover_art(file_path, image_data, mime_type)` - Embed cover art
- `extract_cover_art(file_path)` - Extract embedded cover art

**Supported formats (broad codec support):**

Lossy formats:
- MP3 (ID3v2)
- MP4/M4A/M4B/M4P (iTunes)
- OGG Vorbis
- Opus
- Musepack (.mpc)

Lossless formats:
- FLAC
- WavPack (.wv)
- Monkey's Audio (.ape)
- AIFF/AIF/AIFC
- WAV

High-resolution DSD:
- DSF (DSD Stream File)
- DFF (DSDIFF)

Supported tags:
- title, artist, album, album_artist
- year, genre
- track_number, disc_number
- duration, bitrate (read-only)
- sample_rate, channels, bits_per_sample (DSD formats)

### 4. Last.fm API Client
**File**: `audio/lastfm_client.py`

#### LastFMClient Class
Methods:
- `search_track(artist, title)` - Search for track with metadata and artwork
- `get_artist_info(artist_name)` - Get artist bio, stats, tags, similar artists
- `get_album_info(artist, album)` - Get album metadata and cover art
- `download_image(url, output_path)` - Download artwork to local file

Features:
- Automatic MusicBrainz ID retrieval
- Multiple image size support
- Play count and listener statistics
- Tag and genre extraction

### 5. Fanart.tv API Client
**File**: `audio/fanart_client.py`

#### FanartClient Class
Methods:
- `get_artist_images(musicbrainz_id)` - Get all artist artwork by type
- `get_album_images(musicbrainz_release_id)` - Get album covers and disc art
- `get_best_artist_image(musicbrainz_id, image_type)` - Get highest-rated image
- `get_best_album_cover(musicbrainz_release_id)` - Get highest-rated cover
- `search_by_artist_name(artist_name)` - Find MusicBrainz ID
- `download_image(url, output_path)` - Download artwork

Artwork types:
- Artist: backgrounds, thumbnails, logos, HD logos, banners
- Album: covers, disc art

Features:
- Like-based sorting
- Multiple image sizes
- MusicBrainz integration

### 6. Celery Tasks
**File**: `audio/tasks_artwork.py`

#### Background Tasks
1. `fetch_metadata_for_audio(audio_id)` - Fetch Last.fm metadata
2. `fetch_artwork_for_audio(audio_id)` - Fetch artwork from all sources
3. `fetch_artist_info(channel_id)` - Fetch artist bio and stats
4. `fetch_artist_artwork(channel_id)` - Fetch artist images/banners/logos
5. `download_artwork(artwork_id)` - Download artwork from URL to local storage
6. `embed_artwork_in_audio(audio_id, artwork_id)` - Embed cover art in audio file
7. `update_id3_tags_from_metadata(audio_id)` - Write metadata to audio file tags

#### Batch Tasks
8. `auto_fetch_artwork_batch(limit)` - Auto-fetch for audio without artwork
9. `auto_fetch_artist_info_batch(limit)` - Auto-fetch for channels without info

All tasks:
- Max 3 retries with 5-minute delays
- Proper error handling and logging
- Idempotent (safe to run multiple times)

### 7. API Endpoints
**Files**: `audio/views_artwork.py`, `audio/serializers_artwork.py`, `audio/urls_artwork.py`

#### ViewSets
1. **ArtworkViewSet** - CRUD operations for artwork
   - List, create, update, delete
   - Filter by audio_id, channel_id, type, source
   - Actions: `download`, `set_primary`

2. **MusicMetadataViewSet** - Metadata management
   - CRUD operations
   - Actions: `fetch_from_lastfm`, `update_id3_tags`

3. **ArtistInfoViewSet** - Artist information management
   - CRUD operations
   - Action: `fetch_from_lastfm`

4. **AudioArtworkViewSet** - Audio artwork operations
   - `retrieve` - Get all artwork for audio
   - Actions: `fetch_artwork`, `fetch_metadata`, `embed_artwork`

5. **ChannelArtworkViewSet** - Channel artwork operations
   - `retrieve` - Get all artwork for channel
   - Actions: `fetch_artwork`, `fetch_info`

#### URL Patterns
```
/api/audio/api/artwork/
/api/audio/api/metadata/
/api/audio/api/artist-info/
/api/audio/api/audio-artwork/{id}/
/api/audio/api/channel-artwork/{id}/
```

### 8. Django Admin
**File**: `audio/admin_artwork.py`

#### Admin Classes
1. **ArtworkAdmin**
   - List display: audio, channel, type, source, priority, primary flag
   - Filters: type, source, primary, date
   - Actions: download_artwork, set_as_primary

2. **MusicMetadataAdmin**
   - List display: audio, album, artist, genre, year, stats
   - Actions: fetch_from_lastfm, update_id3_tags

3. **ArtistInfoAdmin**
   - List display: channel, listeners, playcount, bio status, tags count
   - Action: fetch_from_lastfm

### 9. Configuration
**Files**: `config/settings.py`, `.env.example`, `config/celery.py`

#### Settings Added
```python
LASTFM_API_KEY = os.environ.get('LASTFM_API_KEY', '')
LASTFM_API_SECRET = os.environ.get('LASTFM_API_SECRET', '')
FANART_API_KEY = os.environ.get('FANART_API_KEY', '')
```

#### Celery Beat Schedule
- `auto-fetch-artwork` - Every 2 hours (50 tracks)
- `auto-fetch-artist-info` - Daily at 2 AM (20 channels)

### 10. Documentation
**File**: `audio/README_ARTWORK.md`
- Complete feature documentation
- API reference
- Usage examples
- Setup instructions
- Troubleshooting guide

## File Structure
```
backend/
├── requirements.txt (updated)
├── config/
│   ├── settings.py (updated)
│   └── celery.py (updated)
└── audio/
    ├── models_artwork.py (new)
    ├── id3_service.py (new)
    ├── lastfm_client.py (new)
    ├── fanart_client.py (new)
    ├── tasks_artwork.py (new)
    ├── views_artwork.py (new)
    ├── serializers_artwork.py (new)
    ├── urls_artwork.py (new)
    ├── admin_artwork.py (new)
    ├── urls.py (updated)
    └── README_ARTWORK.md (new)
```

## API Key Setup Required

### Last.fm API
1. Register at: https://www.last.fm/api/account/create
2. Add to `.env`:
   ```
   LASTFM_API_KEY=your_api_key
   LASTFM_API_SECRET=your_api_secret
   ```

### Fanart.tv API
1. Register at: https://fanart.tv/get-an-api-key/
2. Add to `.env`:
   ```
   FANART_API_KEY=your_api_key
   ```

## Next Steps

### To Deploy:
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Run migrations:
   ```bash
   python manage.py makemigrations audio
   python manage.py migrate
   ```

3. Configure API keys in `.env`

4. Restart services:
   ```bash
   docker-compose restart soundwave soundwave-worker
   ```

### To Test:
1. Upload audio track
2. Trigger artwork fetch:
   ```bash
   POST /api/audio/api/audio-artwork/{audio_id}/fetch_artwork/
   ```
3. Check artwork in Django admin
4. View embedded artwork in audio file

## Features Summary

✅ **Broad Codec Support** - Read/write tags for 15+ audio formats including DSD (DSF, DFF)
✅ **ID3 Tag Support** - MP3, MP4, FLAC, OGG, Opus, WavPack, APE, Musepack, AIFF, WAV
✅ **High-Resolution Audio** - Full DSD support (DSF, DSDIFF) with sample rate detection
✅ **Last.fm Integration** - Metadata, artwork, artist info, similar artists
✅ **Fanart.tv Integration** - High-quality artwork (images, banners, logos)
✅ **Automatic Artwork Fetching** - Background tasks with Celery
✅ **Multiple Artwork Sources** - YouTube, Last.fm, Fanart.tv, manual
✅ **Priority-Based Selection** - Best artwork chosen automatically
✅ **Cover Art Embedding** - Embed artwork in all supported audio formats
✅ **Local Artwork Caching** - Reduce API calls
✅ **RESTful API** - Complete CRUD operations
✅ **Django Admin Interface** - Easy management
✅ **Comprehensive Documentation** - README with examples

## Technical Highlights

- **Asynchronous Processing** - All API calls via Celery tasks
- **Broad Format Support** - 15+ audio formats: MP3, MP4, FLAC, OGG, Opus, WavPack, APE, Musepack, DSF, DFF, AIFF, WAV
- **DSD Audio Support** - Native support for high-resolution DSD formats (DSF, DSDIFF)
- **External API Integration** - Last.fm and Fanart.tv
- **Automatic Scheduling** - Periodic background tasks
- **Robust Error Handling** - Retry logic and logging
- **Extensible Architecture** - Easy to add more sources
- **Database Optimization** - Efficient queries with prefetch
- **REST API Design** - Standard patterns with DRF
- **Format-Specific Handlers** - ID3v2 for MP3/DSF/DFF, MP4 tags, Vorbis comments, APEv2

## Notes

- API keys are optional - system works without them (uses YouTube thumbnails only)
- Last.fm provides good metadata and basic artwork
- Fanart.tv requires MusicBrainz IDs but provides highest quality artwork
- All artwork is cached locally to reduce API usage
- Priority system ensures best artwork is always used
- ID3 tags can be updated manually or automatically from metadata
