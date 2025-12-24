# ID3 Tags and Artwork Management

This document describes the ID3 tagging and artwork management features in SoundWave.

## Features

### ID3 Tag Support
- **Broad codec support** with read/write tags for multiple audio formats
- **Automatic tag extraction** from downloaded audio files
- **Manual tag editing** through API
- **Bulk tag updates** from metadata

**Supported Audio Formats:**

Lossy formats:
- MP3 (ID3v2)
- MP4/M4A/M4B (iTunes tags)
- OGG Vorbis
- Opus
- Musepack (MPC)

Lossless formats:
- FLAC
- WavPack (.wv)
- Monkey's Audio (.ape)
- AIFF/AIF
- WAV

High-resolution DSD formats:
- DSF (DSD Stream File)
- DFF (DSDIFF - Direct Stream Digital Interchange File Format)

Supported tags:
- Title
- Artist
- Album
- Album Artist
- Year
- Genre
- Track Number
- Disc Number
- Duration (read-only)
- Bitrate (read-only)
- Sample Rate (DSD formats)
- Channels (DSD formats)
- Bits per Sample (DSD formats)

### Artwork Management
- **Multiple artwork types**:
  - Audio thumbnail (YouTube)
  - Audio cover art
  - Album cover
  - Artist image
  - Artist banner
  - Artist logo

- **Multiple artwork sources**:
  - YouTube thumbnails (automatic)
  - Last.fm API
  - Fanart.tv API
  - Manual uploads

- **Automatic artwork fetching** from Last.fm and Fanart.tv
- **Artwork embedding** in audio files
- **Priority-based artwork selection**
- **Local artwork caching**

### Music Metadata
- **Extended metadata** for audio tracks:
  - Album information
  - Track and disc numbers
  - Genre and tags
  - Last.fm statistics (play count, listeners)
  - MusicBrainz IDs
  - Fanart.tv IDs

- **Artist information** for channels:
  - Biography
  - Last.fm statistics
  - Tags and genres
  - Similar artists
  - MusicBrainz ID
  - Fanart.tv ID

## Setup

### 1. Install Dependencies

The required packages are already in `requirements.txt`:
- `mutagen>=1.47.0` - ID3 tag reading/writing
- `pylast>=5.2.0` - Last.fm API client

Install with:
```bash
pip install -r requirements.txt
```

### 2. Configure API Keys

#### Last.fm API
1. Register at https://www.last.fm/api/account/create
2. Add to `.env`:
```bash
LASTFM_API_KEY=your_api_key_here
LASTFM_API_SECRET=your_api_secret_here
```

#### Fanart.tv API
1. Register at https://fanart.tv/get-an-api-key/
2. Add to `.env`:
```bash
FANART_API_KEY=your_api_key_here
```

### 3. Run Migrations

```bash
python manage.py makemigrations audio
python manage.py migrate
```

### 4. Configure Celery Tasks

The following periodic tasks are configured in `config/celery.py`:
- **Auto-fetch artwork**: Every 2 hours (50 tracks per batch)
- **Auto-fetch artist info**: Daily at 2 AM (20 channels per batch)

## Usage

### API Endpoints

#### Artwork Management
```
GET    /api/audio/api/artwork/                  # List all artwork
GET    /api/audio/api/artwork/{id}/              # Get artwork details
POST   /api/audio/api/artwork/                  # Create artwork
PUT    /api/audio/api/artwork/{id}/              # Update artwork
DELETE /api/audio/api/artwork/{id}/              # Delete artwork
POST   /api/audio/api/artwork/{id}/download/    # Download artwork from URL
POST   /api/audio/api/artwork/{id}/set_primary/ # Set as primary artwork
```

Query parameters:
- `audio_id` - Filter by audio ID
- `channel_id` - Filter by channel ID
- `type` - Filter by artwork type
- `source` - Filter by source

#### Music Metadata
```
GET    /api/audio/api/metadata/                           # List metadata
GET    /api/audio/api/metadata/{id}/                      # Get metadata
POST   /api/audio/api/metadata/                           # Create metadata
PUT    /api/audio/api/metadata/{id}/                      # Update metadata
DELETE /api/audio/api/metadata/{id}/                      # Delete metadata
POST   /api/audio/api/metadata/{id}/fetch_from_lastfm/   # Fetch from Last.fm
POST   /api/audio/api/metadata/{id}/update_id3_tags/     # Update file ID3 tags
```

#### Artist Information
```
GET    /api/audio/api/artist-info/                        # List artist info
GET    /api/audio/api/artist-info/{id}/                   # Get artist info
POST   /api/audio/api/artist-info/                        # Create artist info
PUT    /api/audio/api/artist-info/{id}/                   # Update artist info
DELETE /api/audio/api/artist-info/{id}/                   # Delete artist info
POST   /api/audio/api/artist-info/{id}/fetch_from_lastfm/ # Fetch from Last.fm
```

#### Audio Artwork Operations
```
GET    /api/audio/api/audio-artwork/{audio_id}/           # Get all artwork for audio
POST   /api/audio/api/audio-artwork/{audio_id}/fetch_artwork/  # Fetch artwork
POST   /api/audio/api/audio-artwork/{audio_id}/fetch_metadata/ # Fetch metadata
POST   /api/audio/api/audio-artwork/{audio_id}/embed_artwork/  # Embed artwork in file
```

Request body for embed_artwork (optional):
```json
{
  "artwork_id": 123  // Specific artwork to embed, or omit for best artwork
}
```

#### Channel Artwork Operations
```
GET    /api/audio/api/channel-artwork/{channel_id}/       # Get all artwork for channel
POST   /api/audio/api/channel-artwork/{channel_id}/fetch_artwork/  # Fetch artwork
POST   /api/audio/api/channel-artwork/{channel_id}/fetch_info/     # Fetch artist info
```

### Celery Tasks

#### Manual Task Execution

Fetch metadata for specific audio:
```python
from audio.tasks_artwork import fetch_metadata_for_audio
fetch_metadata_for_audio.delay(audio_id)
```

Fetch artwork for specific audio:
```python
from audio.tasks_artwork import fetch_artwork_for_audio
fetch_artwork_for_audio.delay(audio_id)
```

Fetch artist info:
```python
from audio.tasks_artwork import fetch_artist_info
fetch_artist_info.delay(channel_id)
```

Fetch artist artwork:
```python
from audio.tasks_artwork import fetch_artist_artwork
fetch_artist_artwork.delay(channel_id)
```

Embed artwork in audio file:
```python
from audio.tasks_artwork import embed_artwork_in_audio
embed_artwork_in_audio.delay(audio_id, artwork_id=None)  # None = use best artwork
```

Update ID3 tags from metadata:
```python
from audio.tasks_artwork import update_id3_tags_from_metadata
update_id3_tags_from_metadata.delay(audio_id)
```

#### Batch Operations

Auto-fetch artwork for 50 audio without artwork:
```python
from audio.tasks_artwork import auto_fetch_artwork_batch
auto_fetch_artwork_batch.delay(limit=50)
```

Auto-fetch artist info for 20 channels:
```python
from audio.tasks_artwork import auto_fetch_artist_info_batch
auto_fetch_artist_info_batch.delay(limit=20)
```

### ID3 Service

Direct tag manipulation for all supported formats:

```python
from audio.id3_service import ID3TagService

service = ID3TagService()

# Read tags (supports MP3, M4A, FLAC, OGG, Opus, WavPack, APE, DSF, DFF, AIFF, WAV, etc.)
tags = service.read_tags('/path/to/audio.dsf')
print(tags)
# {
#   'title': 'Song Title',
#   'artist': 'Artist Name',
#   'album': 'Album Name',
#   'year': '2024',
#   'genre': 'Rock',
#   'track_number': 5,
#   'duration': 240.5,
#   'bitrate': 256000,
#   'has_cover': True,
#   'format': 'DSF',
#   'sample_rate': 2822400,  # DSD64 (2.8224 MHz)
#   'channels': 2,
#   'bits_per_sample': 1
# }

# Write tags (works with all supported formats)
new_tags = {
    'title': 'New Title',
    'artist': 'New Artist',
    'album': 'New Album',
    'year': '2024',
    'genre': 'Jazz',
    'track_number': 3,
    'disc_number': 1,
}
service.write_tags('/path/to/audio.dsf', new_tags)  # Works with DSF, FLAC, MP3, etc.

# Embed cover art (supports all formats including DSD)
with open('/path/to/cover.jpg', 'rb') as f:
    image_data = f.read()
service.embed_cover_art('/path/to/audio.dsf', image_data, 'image/jpeg')

# Extract cover art (works with all formats)
cover_data = service.extract_cover_art('/path/to/audio.dsf')
if cover_data:
    with open('/path/to/extracted_cover.jpg', 'wb') as f:
        f.write(cover_data)

# Check supported formats
print(service.SUPPORTED_FORMATS)
# {'.mp3': 'MP3', '.m4a': 'MP4', '.flac': 'FLAC', '.dsf': 'DSF', '.dff': 'DSDIFF', ...}
```

### Last.fm Client

```python
from audio.lastfm_client import LastFMClient

client = LastFMClient()

# Search for track
track_info = client.search_track('Artist Name', 'Song Title')
print(track_info)
# {
#   'title': 'Song Title',
#   'artist': 'Artist Name',
#   'album': 'Album Name',
#   'url': 'https://www.last.fm/music/...',
#   'duration': 240,
#   'listeners': 50000,
#   'playcount': 1000000,
#   'tags': ['rock', 'alternative'],
#   'mbid': '...',
#   'images': [{'size': 'large', 'url': '...'}]
# }

# Get artist info
artist_info = client.get_artist_info('Artist Name')
print(artist_info)
# {
#   'name': 'Artist Name',
#   'url': 'https://www.last.fm/music/...',
#   'listeners': 1000000,
#   'playcount': 50000000,
#   'bio': '...',
#   'bio_summary': '...',
#   'tags': ['rock', 'alternative'],
#   'mbid': '...',
#   'similar_artists': [...]
# }

# Get album info
album_info = client.get_album_info('Artist Name', 'Album Name')

# Download image
client.download_image('https://...', '/path/to/save.jpg')
```

### Fanart.tv Client

```python
from audio.fanart_client import FanartClient

client = FanartClient()

# Get artist images (requires MusicBrainz ID)
images = client.get_artist_images('mbid-here')
print(images)
# {
#   'backgrounds': [{'id': '...', 'url': '...', 'likes': '100'}],
#   'thumbnails': [...],
#   'logos': [...],
#   'logos_hd': [...],
#   'banners': [...],
#   'album_covers': [...]
# }

# Get best thumbnail
thumbnail_url = client.get_best_artist_image('mbid-here', 'thumbnail')

# Get album images (requires MusicBrainz release ID)
album_images = client.get_album_images('release-mbid-here')

# Search for MusicBrainz ID by name
mbid = client.search_by_artist_name('Artist Name')
```

## Django Admin

The artwork models are registered in Django admin with useful actions:

### Artwork Admin
- Filter by type, source, primary flag
- Search by audio/channel name and URL
- Actions:
  - Download selected artwork
  - Set as primary

### Music Metadata Admin
- Filter by genre, year
- Search by audio, album, artist
- Actions:
  - Fetch from Last.fm
  - Update ID3 tags

### Artist Info Admin
- Search by channel name, bio, tags
- Actions:
  - Fetch from Last.fm

## Architecture

### Models

#### Artwork
```python
- audio: ForeignKey to Audio (optional)
- channel: ForeignKey to Channel (optional)
- artwork_type: audio_thumbnail, audio_cover, album_cover, artist_image, artist_banner, artist_logo
- source: youtube, lastfm, fanart, manual
- url: Remote URL
- local_path: Local file path
- width, height: Dimensions
- priority: Priority for selection (higher = better)
- is_primary: Primary artwork flag
```

#### MusicMetadata
```python
- audio: OneToOne with Audio
- album_name, album_artist, release_year
- track_number, disc_number
- genre, tags
- lastfm_url, lastfm_mbid, play_count, listeners
- fanart_artist_id, fanart_album_id
```

#### ArtistInfo
```python
- channel: OneToOne with Channel
- bio, bio_summary
- lastfm_url, lastfm_mbid, lastfm_listeners, lastfm_playcount
- tags, similar_artists
- fanart_id
```

### Services

#### ID3TagService
- Broad codec support: MP3, MP4/M4A, FLAC, OGG Vorbis, Opus, WavPack, APE, Musepack, DSF, DFF, AIFF, WAV
- Cover art embedding/extraction for all formats
- DSD format support (DSF, DSDIFF) with sample rate detection
- Uses mutagen library with format-specific handlers

#### LastFMClient
- Wrapper for pylast library
- Track, album, and artist search
- Image URL extraction
- MusicBrainz ID retrieval

#### FanartClient
- REST API client for Fanart.tv
- High-quality artwork retrieval
- Requires MusicBrainz IDs

### Celery Tasks

All tasks are designed to be:
- **Asynchronous** - Don't block request handling
- **Retryable** - Auto-retry on failure (max 3 times)
- **Idempotent** - Safe to run multiple times
- **Scheduled** - Run automatically via Celery Beat

## Best Practices

1. **Always use Celery tasks** for external API calls and file operations
2. **Check for existing artwork** before creating duplicates
3. **Set appropriate priorities** - Fanart (30) > Last.fm (20) > YouTube (10)
4. **Cache artwork locally** to reduce API calls
5. **Use MusicBrainz IDs** when available for better matching
6. **Handle missing API keys gracefully** - fallback to YouTube thumbnails

## Troubleshooting

### No artwork fetched
- Check API keys are configured correctly
- Verify artist/track names match Last.fm database
- Check Celery logs for errors

### Artwork not embedded in file
- Ensure audio file format is supported (all major formats including DSD)
- Check file permissions
- Verify artwork was downloaded locally first
- Note: Some formats (OGG, Opus) use base64-encoded pictures in metadata

### Last.fm API errors
- Rate limit: 5 requests per second
- Check API key validity
- Some tracks may not be in database

### Fanart.tv API errors
- Requires valid MusicBrainz ID
- Free tier has rate limits
- Not all artists have artwork

## Future Enhancements

- [ ] MusicBrainz API integration for better matching
- [ ] Spotify API for additional metadata
- [ ] iTunes API for artwork
- [ ] Manual artwork upload via frontend
- [ ] Artwork quality scoring
- [ ] Bulk metadata import/export
- [ ] Artwork generation for missing covers
