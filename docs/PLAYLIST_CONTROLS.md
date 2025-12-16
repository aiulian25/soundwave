# Playlist Controls Feature

## Overview
Enhanced playlist detail page with comprehensive controls for playing, shuffling, and downloading tracks.

## Features

### Top-Level Controls
Located at the top of the playlist detail page:

1. **Play All Button**
   - Plays all downloaded tracks in order
   - Disabled if no tracks are downloaded
   - Sets the first track to play and queues the rest

2. **Shuffle Button**
   - Randomizes and plays all downloaded tracks
   - Uses Fisher-Yates algorithm for true random shuffle
   - Disabled if no tracks are downloaded
   - Visual feedback with snackbar notification

3. **Download All Button**
   - Triggers playlist sync to download all tracks
   - Disabled while sync is in progress
   - Uses existing playlist download API endpoint

### Individual Track Controls
In the tracks table, each row includes:

1. **Play Button**
   - Available for downloaded tracks only
   - Instantly starts playback
   - Disabled/grayed out for non-downloaded tracks

2. **Download Button** (NEW)
   - Appears only for non-downloaded tracks
   - Downloads individual tracks on demand
   - Shows loading spinner while downloading
   - Automatically refreshes playlist after download completes
   - Uses new individual audio download API endpoint

## Implementation Details

### Backend Changes

#### New API Endpoint
**POST** `/api/audio/<youtube_id>/`
- Action: `download`
- Creates DownloadQueue entry
- Triggers Celery task `download_audio_task`
- Returns:
  - `200 OK`: Already downloaded or download in progress
  - `202 Accepted`: Download started successfully
  - `400 Bad Request`: Invalid action
  - `404 Not Found`: Audio not found or not owned by user

**Security:**
- Owner filtering: `get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)`
- Checks for existing downloads before creating new queue entries
- Integrates with existing Celery task system

### Frontend Changes

#### New Components
- **Play All Button**: Material-UI Button with PlayIcon
- **Shuffle Button**: Material-UI Button with ShuffleIcon
- **Download All Button**: Material-UI Button with CloudDownloadIcon
- **Individual Download Button**: IconButton with DownloadIcon or CircularProgress

#### State Management
```typescript
const [downloadingTracks, setDownloadingTracks] = useState<Set<string>>(new Set());
const [snackbarOpen, setSnackbarOpen] = useState(false);
const [snackbarMessage, setSnackbarMessage] = useState('');
```

#### API Client Update
Added `download` method to `audioAPI`:
```typescript
download: (youtubeId: string) => api.post(`/audio/${youtubeId}/`, { action: 'download' })
```

### User Experience

#### Visual Feedback
- **Snackbar Notifications**: User-friendly messages for all actions
- **Loading States**: CircularProgress indicators during downloads
- **Disabled States**: Buttons properly disabled when actions aren't available
- **Mobile Responsive**: Touch-friendly 48px+ button sizes
- **Hide/Show Labels**: Text hidden on mobile, icons remain visible

#### PWA Optimization
- No page reloads - all actions use React state
- Touch-friendly button sizes (minimum 48px)
- Proper color contrast for accessibility
- Loading feedback for async operations

## Usage

### For Users
1. Navigate to any playlist from the Playlists page
2. Use top controls to:
   - **Play All**: Start playing the entire playlist
   - **Shuffle**: Play tracks in random order
   - **Download All**: Download the entire playlist

3. Use track-level controls to:
   - Click **Play** icon to play individual tracks
   - Click **Download** icon to download specific tracks

### For Developers

#### Testing Individual Downloads
```bash
# Test download endpoint
curl -X POST http://localhost:8889/api/audio/VIDEO_ID/ \
  -H "Authorization: Token YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "download"}'
```

#### Monitoring Downloads
- Check Celery logs for task execution
- Monitor DownloadQueue table for status
- View updated playlist after completion

## Security Considerations

✅ **Implemented Safeguards:**
- User authentication required for all endpoints
- Owner filtering on all queries
- Duplicate download prevention
- Rate limiting via Celery task queue
- Input validation on action parameter

## Files Modified

### Backend
- `/backend/audio/views.py`: Added POST method to AudioDetailView
- `/backend/config/urls.py`: Existing routes work with new endpoint

### Frontend
- `/frontend/src/api/client.ts`: Added `audioAPI.download()` method
- `/frontend/src/pages/PlaylistDetailPage.tsx`: Added all control buttons and handlers
- `/frontend/src/types/index.ts`: No changes needed (youtube_id already optional)

## Performance Notes

- **Shuffle Algorithm**: O(n) Fisher-Yates shuffle, efficient for any playlist size
- **State Management**: Uses Set for O(1) download tracking lookups
- **Auto-refresh**: 2-second delay after download to allow backend processing
- **Loading States**: Prevents duplicate download requests via disabled buttons

## Known Limitations

1. **Queue Visualization**: Download queue not visible in UI (backend only)
2. **Playlist Queue**: Play All/Shuffle only starts first track (no queue implementation yet)
3. **Progress Tracking**: No real-time download progress for individual tracks
4. **Batch Downloads**: Individual downloads don't batch (each triggers separate task)

## Future Enhancements

- [ ] Real-time download progress tracking (WebSockets/SSE)
- [ ] Play queue implementation for continuous playback
- [ ] Batch download optimization for multiple tracks
- [ ] Download queue visibility in UI
- [ ] Cancel download functionality
- [ ] Retry failed downloads from UI

## Related Documentation
- [Playlist Browsing Feature](./PLAYLIST_BROWSING_FEATURE.md)
- [Audio Seeking Fix](./AUDIO_SEEKING_FIX.md)
- [PWA Implementation](./PWA_IMPLEMENTATION.md)
