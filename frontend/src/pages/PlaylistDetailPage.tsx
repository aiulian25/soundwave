import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Chip,
  LinearProgress,
  Button,
  Snackbar,
  Tooltip,
  Card,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  Shuffle as ShuffleIcon,
  CloudDownload as CloudDownloadIcon,
  CloudOff as CloudOffIcon,
  DeleteOutline as DeleteIcon,
  CloudDone as CloudDoneIcon,
  WifiOff as WifiOffIcon,
  Storage as StorageIcon,
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteBorderIcon,
  OfflinePin as OfflinePinIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { playlistAPI, audioAPI } from '../api/client';
import { usePWA, CacheProgress } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';
import { audioCache } from '../utils/audioCache';
import type { Audio } from '../types';

interface PlaylistItem {
  id: number;
  position: number;
  added_date: string;
  audio: Audio;
}

interface PlaylistDetail {
  id: number;
  playlist_id: string;
  title: string;
  description: string;
  channel_name: string;
  thumbnail_url: string;
  subscribed: boolean;
  item_count: number;
  downloaded_count: number;
  last_refresh: string | null;
  sync_status: 'pending' | 'syncing' | 'success' | 'failed' | 'stale';
  status_display: string;
  error_message: string;
  active: boolean;
  progress_percent: number;
  items?: PlaylistItem[];
}

interface PlaylistDetailPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function PlaylistDetailPage({ setCurrentAudio }: PlaylistDetailPageProps) {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { isOnline, cachePlaylist, removePlaylistCache, cacheSize } = usePWA();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<CacheProgress | null>(null);
  const [offlineTracks, setOfflineTracks] = useState<Set<string>>(new Set());

  // Check which tracks are available offline
  const checkOfflineTracks = useCallback(async () => {
    if (!playlist?.items) return;
    
    const offlineSet = new Set<string>();
    for (const item of playlist.items) {
      if (item.audio.youtube_id) {
        const isOffline = await audioCache.isAvailableOffline(item.audio.youtube_id);
        if (isOffline) {
          offlineSet.add(item.audio.youtube_id);
        }
      }
    }
    setOfflineTracks(offlineSet);
  }, [playlist?.items]);

  useEffect(() => {
    if (playlistId) {
      loadPlaylist();
      checkOfflineAvailability();
    }
  }, [playlistId]);

  // Check offline tracks when playlist loads or offline status changes
  useEffect(() => {
    if (playlist?.items) {
      checkOfflineTracks();
    }
  }, [playlist?.items, isOfflineAvailable, checkOfflineTracks]);

  const checkOfflineAvailability = async () => {
    if (!playlistId) return;
    try {
      const cachedPlaylist = await offlineStorage.getPlaylistByPlaylistId(playlistId);
      setIsOfflineAvailable(cachedPlaylist?.offline || false);
    } catch (err) {
      console.error('Failed to check offline status:', err);
    }
  };

  const loadPlaylist = async () => {
    try {
      setLoading(true);
      
      // If offline, try to load from IndexedDB first
      if (!isOnline) {
        // Use getPlaylistByPlaylistId to find by YouTube playlist ID
        const cachedPlaylist = await offlineStorage.getPlaylistByPlaylistId(playlistId!);
        if (cachedPlaylist && cachedPlaylist.items) {
          console.log('[Offline] Loading playlist from cache:', cachedPlaylist.title);
          setPlaylist({
            ...cachedPlaylist,
            sync_status: 'success',
            status_display: 'Offline',
            progress_percent: 100,
          } as PlaylistDetail);
          setIsOfflineAvailable(true);
          setError('');
          return;
        } else {
          setError('Playlist not available offline');
          return;
        }
      }
      
      // Online - fetch from API
      const response = await playlistAPI.getWithItems(playlistId!);
      setPlaylist(response.data);
      setError('');
    } catch (err: any) {
      console.error('Failed to load playlist:', err);
      
      // If online request fails, try offline cache as fallback
      try {
        const cachedPlaylist = await offlineStorage.getPlaylistByPlaylistId(playlistId!);
        if (cachedPlaylist && cachedPlaylist.items) {
          console.log('[Fallback] Loading playlist from cache:', cachedPlaylist.title);
          setPlaylist({
            ...cachedPlaylist,
            sync_status: 'success',
            status_display: 'Cached',
            progress_percent: 100,
          } as PlaylistDetail);
          setIsOfflineAvailable(true);
          setError('');
          return;
        }
      } catch (cacheErr) {
        console.error('Failed to load from cache:', cacheErr);
      }
      
      setError(err.response?.data?.detail || 'Failed to load playlist');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPlaylist = async () => {
    if (!playlist?.items) return;
    const downloadedTracks = playlist.items.filter(item => item.audio.file_path && item.audio.youtube_id);
    
    if (downloadedTracks.length === 0) {
      setSnackbarMessage('No downloaded tracks to save');
      setSnackbarOpen(true);
      return;
    }
    
    setSnackbarMessage(`Downloading ${downloadedTracks.length} tracks to your device`);
    setSnackbarOpen(true);
    
    // Download each track with authentication
    for (const item of downloadedTracks) {
      try {
        const blob = await audioAPI.downloadFile(item.audio.youtube_id!);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.audio.title || 'audio';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        // Stagger downloads to prevent browser blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Failed to download ${item.audio.title}:`, err);
      }
    }
  };

  const handleToggleFavorite = async (audio: Audio) => {
    if (!audio.youtube_id) return;
    
    try {
      const response = await audioAPI.toggleFavorite(audio.youtube_id);
      // Update the local state immediately for better UX
      setPlaylist(prev => {
        if (!prev?.items) return prev;
        return {
          ...prev,
          items: prev.items.map(item => 
            item.audio.id === audio.id 
              ? { ...item, audio: { ...item.audio, is_favorite: response.data.is_favorite }}
              : item
          )
        };
      });
      setSnackbarMessage(audio.is_favorite ? 'Removed from favorites' : 'Added to favorites');
      setSnackbarOpen(true);
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      setSnackbarMessage('Failed to update favorite status');
      setSnackbarOpen(true);
    }
  };

  const handleCacheForOffline = async () => {
    if (!playlist?.items || !isOnline) {
      setSnackbarMessage(isOnline ? 'No tracks to cache' : 'Must be online to download for offline use');
      setSnackbarOpen(true);
      return;
    }

    const downloadedTracks = playlist.items.filter(item => item.audio.file_path);
    if (downloadedTracks.length === 0) {
      setSnackbarMessage('No tracks downloaded yet. Download tracks first.');
      setSnackbarOpen(true);
      return;
    }

    setIsDownloadingOffline(true);
    setOfflineProgress({ current: 0, total: downloadedTracks.length + 1, percent: 0, currentItem: 'Starting...', status: 'downloading' });

    try {
      // Build audio URLs for caching
      const audioUrls = downloadedTracks.map(item => 
        `/api/audio/${item.audio.youtube_id}/download/`
      );

      // Cache playlist metadata and audio files via Service Worker with progress callback
      const result = await cachePlaylist(playlist.playlist_id, audioUrls, (progress) => {
        setOfflineProgress(progress);
      });
      
      if (result.success) {
        // Save playlist metadata to IndexedDB
        await offlineStorage.savePlaylist({
          id: playlist.id,
          playlist_id: playlist.playlist_id,
          title: playlist.title,
          description: playlist.description,
          channel_name: playlist.channel_name,
          thumbnail_url: playlist.thumbnail_url,
          item_count: playlist.item_count,
          downloaded_count: downloadedTracks.length,
          items: downloadedTracks.map(item => ({
            id: item.id,
            position: item.position,
            audio: item.audio,
          })),
          offline: true,
          lastSync: Date.now(),
        });

        // Cache lyrics for each track (in background, don't block)
        for (const item of downloadedTracks) {
          if (item.audio.youtube_id) {
            try {
              const token = localStorage.getItem('token');
              const lyricsResponse = await fetch(`/api/audio/${item.audio.youtube_id}/lyrics/`, {
                headers: { 'Authorization': `Token ${token}` }
              });
              if (lyricsResponse.ok) {
                const lyricsData = await lyricsResponse.json();
                await offlineStorage.saveLyrics(item.audio.youtube_id, lyricsData);
                console.log('[Offline] Cached lyrics for:', item.audio.title);
              }
            } catch (err) {
              // Lyrics caching is optional, don't fail the whole operation
              console.log('[Offline] Could not cache lyrics for:', item.audio.title);
            }
          }
        }

        setIsOfflineAvailable(true);
        // Refresh offline tracks display
        await checkOfflineTracks();
        
        if (result.failed > 0) {
          setSnackbarMessage(`✅ ${result.cached} tracks cached, ${result.failed} failed`);
        } else {
          setSnackbarMessage(`✅ ${result.cached} tracks available offline!`);
        }
      } else {
        setSnackbarMessage('Failed to cache playlist');
      }
    } catch (err) {
      console.error('Failed to cache offline:', err);
      setSnackbarMessage('Offline caching failed');
    } finally {
      setIsDownloadingOffline(false);
      setOfflineProgress(null);
      setSnackbarOpen(true);
    }
  };

  const handleRemoveOffline = async () => {
    if (!playlist?.items) return;

    try {
      const audioUrls = playlist.items
        .filter(item => item.audio.file_path)
        .map(item => `/api/audio/${item.audio.youtube_id}/download/`);

      // Remove from Service Worker cache
      await removePlaylistCache(playlist.playlist_id, audioUrls);
      
      // Remove from IndexedDB
      await offlineStorage.removePlaylist(playlist.id);

      setIsOfflineAvailable(false);
      // Clear offline tracks display
      setOfflineTracks(new Set());
      setSnackbarMessage('Offline data removed');
      setSnackbarOpen(true);
    } catch (err) {
      console.error('Failed to remove offline data:', err);
      setSnackbarMessage('Failed to remove offline data');
      setSnackbarOpen(true);
    }
  };
  
  const handleDownloadTrackToDevice = async (youtubeId: string, title: string) => {
    try {
      setSnackbarMessage(`Downloading "${title}" to your device`);
      setSnackbarOpen(true);
      
      const blob = await audioAPI.downloadFile(youtubeId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = title || 'audio';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
      setSnackbarMessage('Download failed');
      setSnackbarOpen(true);
    }
  };

  const handlePlayAll = () => {
    if (!playlist?.items) return;
    const downloadedTracks = playlist.items
      .filter(item => item.audio.file_path)
      .map(item => item.audio);
    
    if (downloadedTracks.length > 0) {
      setCurrentAudio(downloadedTracks[0], downloadedTracks);
      setSnackbarMessage(`Playing ${downloadedTracks.length} tracks`);
      setSnackbarOpen(true);
    } else {
      setSnackbarMessage('No downloaded tracks to play');
      setSnackbarOpen(true);
    }
  };

  const handleShuffle = () => {
    if (!playlist?.items) return;
    const downloadedTracks = playlist.items
      .filter(item => item.audio.file_path)
      .map(item => item.audio);
    
    if (downloadedTracks.length > 0) {
      // Shuffle array using Fisher-Yates algorithm
      const shuffled = [...downloadedTracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setCurrentAudio(shuffled[0], shuffled);
      setSnackbarMessage(`Shuffled ${shuffled.length} tracks`);
      setSnackbarOpen(true);
    } else {
      setSnackbarMessage('No downloaded tracks to shuffle');
      setSnackbarOpen(true);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getStatusColor = (status: string): 'default' | 'primary' | 'success' | 'error' | 'warning' => {
    switch (status) {
      case 'syncing': return 'primary';
      case 'success': return 'success';
      case 'failed': return 'error';
      case 'stale': return 'warning';
      default: return 'default';
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !playlist) {
    return (
      <Box>
        <IconButton onClick={() => navigate('/playlists')} sx={{ mb: 2 }}>
          <BackIcon />
        </IconButton>
        <Alert severity="error">{error || 'Playlist not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header with Back Button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <IconButton 
          onClick={() => navigate('/playlists')}
          sx={{ 
            bgcolor: 'rgba(255, 255, 255, 0.05)',
            '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.1)' }
          }}
        >
          <BackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: 0.5 }}>
            {playlist.title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {playlist.channel_name}
          </Typography>
        </Box>
        <Chip 
          label={playlist.status_display}
          color={getStatusColor(playlist.sync_status)}
          size="small"
        />
      </Box>

      {/* Offline Status Card - PWA Feature */}
      {!isOnline && (
        <Card sx={{ mb: 3, bgcolor: 'rgba(255, 193, 7, 0.1)', border: '1px solid rgba(255, 193, 7, 0.3)' }}>
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <WifiOffIcon sx={{ color: 'warning.main' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'warning.main' }}>
                Offline Mode
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isOfflineAvailable 
                  ? 'This playlist is available offline' 
                  : 'You are offline. Cache playlists when online for offline access.'}
              </Typography>
            </Box>
          </Box>
        </Card>
      )}

      {/* Control Buttons */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          startIcon={<PlayIcon />}
          onClick={handlePlayAll}
          disabled={!playlist.downloaded_count}
          sx={{
            minWidth: { xs: '48px', sm: '120px' },
            bgcolor: 'primary.main',
            color: 'background.dark',
            fontWeight: 600,
            '&:hover': { bgcolor: 'primary.dark' },
            '&:disabled': { bgcolor: 'rgba(255, 255, 255, 0.1)' },
          }}
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Play All</Box>
        </Button>
        <Button
          variant="outlined"
          startIcon={<ShuffleIcon />}
          onClick={handleShuffle}
          disabled={!playlist.downloaded_count}
          sx={{
            minWidth: { xs: '48px', sm: '120px' },
            borderColor: 'primary.main',
            color: 'primary.main',
            fontWeight: 600,
            '&:hover': { 
              borderColor: 'primary.dark',
              bgcolor: 'rgba(19, 236, 106, 0.05)'
            },
            '&:disabled': { 
              borderColor: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.3)'
            },
          }}
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Shuffle</Box>
        </Button>
        <Button
          variant="outlined"
          startIcon={<CloudDownloadIcon />}
          onClick={handleDownloadPlaylist}
          disabled={!playlist.downloaded_count}
          sx={{
            minWidth: { xs: '48px', sm: '150px' },
            borderColor: 'primary.main',
            color: 'primary.main',
            fontWeight: 600,
            '&:hover': { 
              borderColor: 'primary.dark',
              bgcolor: 'rgba(19, 236, 106, 0.05)'
            },
            '&:disabled': { 
              borderColor: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.3)'
            },
          }}
          title="Download all tracks to your device"
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Save All</Box>
        </Button>
      </Box>

      {/* Offline Caching Controls - PWA Feature */}
      <Card sx={{ 
        mb: 3, 
        bgcolor: isOfflineAvailable ? 'rgba(76, 175, 80, 0.1)' : 'rgba(33, 150, 243, 0.1)',
        border: `1px solid ${isOfflineAvailable ? 'rgba(76, 175, 80, 0.3)' : 'rgba(33, 150, 243, 0.3)'}`,
      }}>
        <Box sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            {isOfflineAvailable ? (
              <CloudDoneIcon sx={{ color: 'success.main' }} />
            ) : (
              <StorageIcon sx={{ color: 'info.main' }} />
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {isOfflineAvailable ? '📱 Offline Ready' : '💾 Cache for Offline'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isOfflineAvailable 
                  ? `${playlist.downloaded_count} tracks cached and available without internet`
                  : 'Download this playlist to listen without an internet connection'}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {!isOfflineAvailable ? (
              <Button
                variant="contained"
                startIcon={<CloudDownloadIcon />}
                onClick={handleCacheForOffline}
                disabled={!isOnline || isDownloadingOffline || !playlist.downloaded_count}
                size="small"
                sx={{
                  bgcolor: 'info.main',
                  color: 'white',
                  fontWeight: 600,
                  '&:hover': { bgcolor: 'info.dark' },
                  '&:disabled': { bgcolor: 'rgba(255, 255, 255, 0.1)' },
                }}
              >
                {isDownloadingOffline ? 'Caching...' : 'Make Available Offline'}
              </Button>
            ) : (
              <>
                <Tooltip title="Remove offline cache to free up storage space">
                  <Button
                    variant="outlined"
                    startIcon={<DeleteIcon />}
                    onClick={handleRemoveOffline}
                    size="small"
                    sx={{
                      borderColor: 'error.main',
                      color: 'error.main',
                      fontWeight: 600,
                      '&:hover': { 
                        borderColor: 'error.dark',
                        bgcolor: 'rgba(244, 67, 54, 0.05)'
                      },
                    }}
                  >
                    Remove Offline
                  </Button>
                </Tooltip>
                <Chip 
                  icon={<CloudDoneIcon />}
                  label="Cached"
                  color="success"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              </>
            )}
            {cacheSize && (
              <Box sx={{ ml: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Typography variant="caption" color="text.secondary">
                  Storage Used
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {(cacheSize.usage / 1024 / 1024).toFixed(1)} MB / {(cacheSize.quota / 1024 / 1024 / 1024).toFixed(1)} GB
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Card>

      {/* Progress Bar */}
      {playlist.downloaded_count < playlist.item_count && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Download Progress
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {playlist.downloaded_count} / {playlist.item_count} tracks
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={playlist.progress_percent}
            sx={{ height: 6, borderRadius: 1 }}
          />
        </Box>
      )}

      {/* Stats */}
      <Box sx={{ display: 'flex', gap: 3, mb: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Total Tracks
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {playlist.item_count}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            Downloaded
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {playlist.downloaded_count}
          </Typography>
        </Box>
        {playlist.last_refresh && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Last Updated
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {formatDate(playlist.last_refresh)}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Tracks Table */}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={60} sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' }, display: { xs: 'none', md: 'table-cell' } }}>Channel</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Duration</TableCell>
              <TableCell align="center" width={120} sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {playlist.items && playlist.items.length > 0 ? (
              playlist.items.map((item, index) => {
                // Create queue from all downloaded tracks
                const playlistQueue = (playlist.items || [])
                  .filter(i => i.audio.file_path)
                  .map(i => i.audio);
                return (
                <TableRow
                  key={item.id}
                  sx={{
                    cursor: 'pointer',
                    transition: 'background-color 0.3s ease',
                    '&:hover': {
                      bgcolor: 'rgba(19, 236, 106, 0.05)',
                    },
                    opacity: item.audio.file_path ? 1 : 0.5,
                  }}
                  onClick={() => item.audio.file_path && setCurrentAudio(item.audio, playlistQueue)}
                >
                  <TableCell sx={{ color: 'text.secondary', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography
                          variant="body2"
                          noWrap
                          sx={{
                            maxWidth: { xs: 180, sm: 280, md: 380 },
                            fontWeight: 500,
                            fontSize: { xs: '0.75rem', sm: '0.875rem' },
                          }}
                        >
                          {item.audio.title}
                        </Typography>
                        {item.audio.youtube_id && offlineTracks.has(item.audio.youtube_id) && (
                          <Tooltip title="Available offline">
                            <OfflinePinIcon sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
                          </Tooltip>
                        )}
                      </Box>
                      {!item.audio.file_path && (
                        <Chip 
                          label="Not Downloaded" 
                          size="small" 
                          color="warning"
                          sx={{ mt: 0.5, height: 18, fontSize: '0.65rem' }}
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      noWrap
                      sx={{
                        maxWidth: 150,
                        fontSize: '0.75rem',
                      }}
                    >
                      {item.audio.channel_name}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                    {formatDuration(item.audio.duration)}
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                      <IconButton
                        size="small"
                        onClick={() => item.audio.file_path && setCurrentAudio(item.audio, playlistQueue)}
                        disabled={!item.audio.file_path}
                        sx={{
                          color: 'primary.main',
                          '&:disabled': { color: 'rgba(255, 255, 255, 0.3)' },
                        }}
                        title="Play"
                      >
                        <PlayIcon />
                      </IconButton>
                      {item.audio.file_path && item.audio.youtube_id && (
                        <IconButton
                          size="small"
                          onClick={() => handleDownloadTrackToDevice(item.audio.youtube_id!, item.audio.title)}
                          sx={{
                            color: 'primary.main',
                          }}
                          title="Download to device"
                        >
                          <DownloadIcon />
                        </IconButton>
                      )}
                      <IconButton
                        size="small"
                        onClick={() => handleToggleFavorite(item.audio)}
                        sx={{
                          color: item.audio.is_favorite ? 'error.main' : 'text.disabled',
                          '&:hover': {
                            color: 'error.main',
                          },
                        }}
                        title={item.audio.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        {item.audio.is_favorite ? <FavoriteIcon /> : <FavoriteBorderIcon />}
                      </IconButton>
                    </Box>
                  </TableCell>
                </TableRow>
              );})
            ) : (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No tracks found in this playlist
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Offline Caching Progress Snackbar - Non-blocking, auto-dismisses */}
      <Snackbar
        open={isDownloadingOffline}
        autoHideDuration={2000}
        onClose={() => {}} // Don't close on click away, only auto-hide
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ mb: 8 }} // Above the main snackbar
      >
        <Alert 
          severity="info" 
          icon={<CloudDownloadIcon />}
          sx={{ 
            width: '100%',
            minWidth: 300,
            alignItems: 'center',
          }}
        >
          <Box>
            <Typography variant="body2" fontWeight={600}>
              Caching for Offline
            </Typography>
            {offlineProgress && (
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {offlineProgress.currentItem} ({offlineProgress.current}/{offlineProgress.total})
                </Typography>
                <LinearProgress 
                  variant="determinate" 
                  value={offlineProgress.percent} 
                  sx={{ 
                    height: 4, 
                    borderRadius: 1,
                    mt: 0.5,
                  }} 
                />
              </Box>
            )}
          </Box>
        </Alert>
      </Snackbar>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
}
