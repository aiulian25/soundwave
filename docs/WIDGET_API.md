# SoundWave Widget API

SoundWave provides a TubeArchivist-compatible widget API for integration with dashboard applications like Homepage.

## Overview

The widget API allows external dashboards to display SoundWave statistics. It uses API key authentication identical to TubeArchivist, making it fully compatible with the Homepage TubeArchivist widget.

## TubeArchivist-Compatible Endpoints (for Homepage)

These endpoints are fully compatible with the Homepage dashboard's TubeArchivist widget:

| Endpoint | Response | Description |
|----------|----------|-------------|
| `GET /api/stats/download` | `{"pending": N}` | Pending downloads |
| `GET /api/stats/video` | `{"doc_count": N}` | Total audio files |
| `GET /api/stats/channel` | `{"doc_count": N}` | Subscribed channels |
| `GET /api/stats/playlist` | `{"doc_count": N}` | Total playlists |

### Authentication

The API uses `Authorization: Token <API_KEY>` header (same as TubeArchivist):

```
Authorization: Token YOUR_API_KEY
```

Also supports: 
- `Authorization: ApiKey YOUR_API_KEY`
- Query parameter: `?key=YOUR_API_KEY`

## Homepage Dashboard Configuration

Add SoundWave to your Homepage dashboard using the TubeArchivist widget type:

```yaml
- SoundWave:
    icon: http://your-soundwave-host:8889/img/logo.png
    href: http://your-soundwave-host:8889
    statusStyle: "dot"
    description: Self-Hosted Music
    widget:
      type: tubearchivist
      url: http://your-soundwave-host:8889
      key: YOUR_API_KEY_HERE
      fields: ["downloads", "videos", "channels", "playlists"]
```

### Widget Fields

Available fields (these map to the TubeArchivist widget fields):
- `downloads` - Pending downloads count
- `videos` - Total audio files (uses "videos" field name for compatibility)
- `channels` - Subscribed channels
- `playlists` - Total playlists

## Combined Stats Endpoint (Alternative)

For custom integrations, a combined endpoint is also available:

```
GET /api/stats/widget/?key=YOUR_API_KEY
```

Response:
```json
{
  "downloads": 150,
  "audio": 500,
  "channels": 10,
  "playlists": 25,
  "pending_downloads": 5,
  "total_duration": 3600000,
  "total_size_bytes": 5368709120,
  "storage_used_gb": 5.0
}

## Managing API Keys

### Via Web UI

Navigate to **Settings > API Keys** to create, view, and manage your API keys.

### Via API

**List API Keys:**
```bash
curl -H "Authorization: Token YOUR_AUTH_TOKEN" \
  https://soundwave.example.com/api/user/api-keys/
```

**Create API Key:**
```bash
curl -X POST \
  -H "Authorization: Token YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Homepage Widget", "permission": "read"}' \
  https://soundwave.example.com/api/user/api-keys/
```

Response:
```json
{
  "id": 1,
  "name": "Homepage Widget",
  "key": "8f6a3932a40685a6eae271d483aa7f4bfdbff60b",
  "key_prefix": "8f6a3932",
  "permission": "read",
  "created_at": "2026-02-23T12:00:00Z",
  "message": "Save this API key! It will only be shown once."
}
```

**Delete API Key:**
```bash
curl -X DELETE \
  -H "Authorization: Token YOUR_AUTH_TOKEN" \
  https://soundwave.example.com/api/user/api-keys/1/
```

## API Key Scopes

When creating an API key, you can configure the following scopes:

| Scope | Description |
|-------|-------------|
| `scope_stats` | Access to widget/stats API (default: enabled) |
| `scope_audio` | Access to audio files API |
| `scope_channels` | Access to channels API |
| `scope_playlists` | Access to playlists API |
| `scope_downloads` | Access to downloads API |

## Security Notes

1. **Key Storage**: API keys are stored as SHA-256 hashes. The full key is only shown once when created.
2. **Key Prefix**: Each key shows a prefix (first 8 characters) for identification.
3. **Expiration**: Keys can have optional expiration dates.
4. **Revocation**: Keys can be disabled or deleted at any time.
5. **Read-Only**: By default, widget keys are read-only with stats scope only.

## Example: Testing the API

Test your API key:

```bash
# Using query parameter
curl "https://soundwave.example.com/api/stats/widget/?key=YOUR_API_KEY"

# Using header
curl -H "Authorization: ApiKey YOUR_API_KEY" \
  "https://soundwave.example.com/api/stats/widget/"
```

Expected response:
```json
{
  "downloads": 0,
  "audio": 0,
  "channels": 0,
  "playlists": 0,
  "pending_downloads": 0,
  "total_duration": 0,
  "total_size_bytes": 0,
  "storage_used_gb": 0.0
}
```
