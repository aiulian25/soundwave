import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  IconButton,
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
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  Shuffle as ShuffleIcon,
  CloudDownload as CloudDownloadIcon,
  DeleteOutline as DeleteIcon,
  CloudDone as CloudDoneIcon,
  WifiOff as WifiOffIcon,
  Storage as StorageIcon,
  OfflinePin as OfflinePinIcon,
  Sync as SyncIcon,
  FolderZip as FolderZipIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router-dom';
import { playlistAPI, audioAPI } from '../api/client';
import PlaylistExportDialog from '../components/PlaylistExportDialog';
import { usePWA, CacheProgress } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';
import { offlineAudioUrl, removeOfflinePlaylist, saveOfflinePlaylist, verifiedOfflinePlaylist } from '../utils/offlineLibrary';
import { audioCache } from '../utils/audioCache';
import TrackActionsMenu from '../components/TrackActionsMenu';
import TrackTable from '../components/TrackTable';
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
  remote_total?: number | null;
  remote_unavailable_count?: number;
  pending?: number;
  failed?: number;
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
  const { t, i18n } = useTranslation();
  const { isOnline, cachePlaylist, cancelPlaylistCache, removePlaylistCache, cacheSize } = usePWA();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
  const [isDownloadingOffline, setIsDownloadingOffline] = useState(false);
  const [offlineProgress, setOfflineProgress] = useState<CacheProgress | null>(null);
  const [offlineTracks, setOfflineTracks] = useState<Set<string>>(new Set());
  const [offlineCounts, setOfflineCounts] = useState({ available: 0, missing: 0 });

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

  const showOfflineCounts = (verified: { downloaded_count: number; missing_count: number } | null) => {
    const available = verified?.downloaded_count ?? 0;
    setOfflineCounts({ available, missing: verified?.missing_count ?? 0 });
    setIsOfflineAvailable(available > 0);
  };

  const checkOfflineAvailability = async () => {
    if (!playlistId) return;
    try {
      const cachedPlaylist = await verifiedOfflinePlaylist(playlistId);
      showOfflineCounts(cachedPlaylist);
    } catch (err) {
      console.error('Failed to check offline status:', err);
    }
  };

  const loadPlaylist = async () => {
    try {
      setLoading(true);
      
      // If offline, try to load from IndexedDB first
      if (!isOnline) {
        const cachedPlaylist = await verifiedOfflinePlaylist(playlistId!);
        if (cachedPlaylist && cachedPlaylist.items) {
          console.log('[Offline] Loading playlist from cache:', cachedPlaylist.title);
          setPlaylist({
            ...cachedPlaylist,
            sync_status: 'success',
            status_display: t('playlistDetail.status.offline'),
            progress_percent: 100,
          } as PlaylistDetail);
          showOfflineCounts(cachedPlaylist);
          setError('');
          return;
        } else {
          setError(t('playlistDetail.errors.notAvailableOffline'));
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
        const cachedPlaylist = await verifiedOfflinePlaylist(playlistId!);
        if (cachedPlaylist && cachedPlaylist.items) {
          console.log('[Fallback] Loading playlist from cache:', cachedPlaylist.title);
          setPlaylist({
            ...cachedPlaylist,
            sync_status: 'success',
            status_display: t('playlistDetail.status.cached'),
            progress_percent: 100,
          } as PlaylistDetail);
          showOfflineCounts(cachedPlaylist);
          setError('');
          return;
        }
      } catch (cacheErr) {
        console.error('Failed to load from cache:', cacheErr);
      }
      
      setError(err.response?.data?.detail || t('playlistDetail.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPlaylist = async () => {
    if (!playlist?.items) return;
    const downloadedTracks = playlist.items.filter(item => item.audio.file_path && item.audio.youtube_id);
    
    if (downloadedTracks.length === 0) {
      setSnackbarMessage(t('playlistDetail.errors.noDownloadedTracksToSave'));
      setSnackbarOpen(true);
      return;
    }
    
    setSnackbarMessage(t('playlistDetail.messages.downloadingTracks', { count: downloadedTracks.length }));
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

  const handleForceRecheck = async () => {
    if (!playlistId) return;
    try {
      await playlistAPI.forceRecheck(playlistId);
      setSnackbarMessage(t('playlistDetail.messages.forceRecheckStarted'));
      setSnackbarOpen(true);
      // Reload after delay to pick up new status
      setTimeout(() => loadPlaylist(), 30000);
    } catch (err: any) {
      setSnackbarMessage(t('playlistDetail.messages.forceRecheckFailed', { error: err.response?.data?.detail || err.message || t('common.unknownError') }));
      setSnackbarOpen(true);
    }
  };

  const handleTrackUpdate = (updatedTrack: Audio) => {
    // Update the local state when a track is updated (e.g., favorite toggled)
    setPlaylist(prev => {
      if (!prev?.items) return prev;
      return {
        ...prev,
        items: prev.items.map(item => 
          item.audio.id === updatedTrack.id 
            ? { ...item, audio: updatedTrack }
            : item
        )
      };
    });
  };

  const handleCacheForOffline = async () => {
    if (!playlist?.items || !isOnline) {
      setSnackbarMessage(isOnline ? t('playlistDetail.errors.noTracksToCache') : t('playlistDetail.errors.mustBeOnline'));
      setSnackbarOpen(true);
      return;
    }

    const downloadedTracks = playlist.items.filter(item => item.audio.file_path);
    if (downloadedTracks.length === 0) {
      setSnackbarMessage(t('playlistDetail.errors.noTracksDownloadedYet'));
      setSnackbarOpen(true);
      return;
    }

    setIsDownloadingOffline(true);
    setOfflineProgress({ current: 0, total: downloadedTracks.length + 1, percent: 0, currentItem: t('playlistDetail.messages.starting'), status: 'downloading' });

    try {
      // Build audio URLs for caching
      const audioUrls = downloadedTracks.map(item => offlineAudioUrl(item.audio.youtube_id!));

      // Cache playlist metadata and audio files via Service Worker with progress callback
      const result = await cachePlaylist(playlist.playlist_id, audioUrls, (progress) => {
        setOfflineProgress(progress);
      });
      
      // What is saved and reported comes from the bytes that arrived, not from the attempt.
      const saved = await saveOfflinePlaylist({
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
      showOfflineCounts(saved.items.length > 0 ? saved : null);
      await checkOfflineTracks();

      if (saved.items.length === 0) {
        setSnackbarMessage(t(result.canceled ? 'playlistDetail.messages.cacheCanceled' : 'playlistDetail.errors.cacheFailed'));
        return;
      }

      if (!result.canceled) {
        // Lyrics are optional, so a track without them still counts as available.
        for (const item of saved.items) {
          try {
            const lyricsResponse = await fetch(`/api/audio/${item.audio.youtube_id}/lyrics/`, {
              credentials: 'include',
            });
            if (lyricsResponse.ok) {
              await offlineStorage.saveLyrics(item.audio.youtube_id, await lyricsResponse.json());
            }
          } catch (err) {
            console.log('[Offline] Could not cache lyrics for:', item.audio.title);
          }
        }
      }

      if (saved.missing_count > 0) {
        setSnackbarMessage(t('playlistDetail.messages.cachePartial', { cached: saved.downloaded_count, failed: saved.missing_count }));
      } else {
        setSnackbarMessage(t('playlistDetail.messages.cacheSuccess', { count: saved.downloaded_count }));
      }
    } catch (err) {
      console.error('Failed to cache offline:', err);
      setSnackbarMessage(t('playlistDetail.errors.offlineCachingFailed'));
    } finally {
      setIsDownloadingOffline(false);
      setOfflineProgress(null);
      setSnackbarOpen(true);
    }
  };

  const handleRemoveOffline = async () => {
    if (!playlist?.items) return;

    try {
      await removeOfflinePlaylist(playlist, removePlaylistCache);

      showOfflineCounts(null);
      // A track another saved playlist needs is still available, so ask rather than assume.
      await checkOfflineTracks();
      setSnackbarMessage(t('playlistDetail.messages.offlineDataRemoved'));
      setSnackbarOpen(true);
    } catch (err) {
      console.error('Failed to remove offline data:', err);
      setSnackbarMessage(t('playlistDetail.errors.removeOfflineFailed'));
      setSnackbarOpen(true);
    }
  };
  
  const handleDownloadTrackToDevice = async (youtubeId: string, title: string) => {
    try {
      setSnackbarMessage(t('playlistDetail.messages.downloadingTrack', { title }));
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
      setSnackbarMessage(t('playlistDetail.errors.downloadFailed'));
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
      setSnackbarMessage(t('playlistDetail.messages.playingTracks', { count: downloadedTracks.length }));
      setSnackbarOpen(true);
    } else {
      setSnackbarMessage(t('playlistDetail.errors.noDownloadedTracksToPlay'));
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
      setSnackbarMessage(t('playlistDetail.messages.shuffledTracks', { count: shuffled.length }));
      setSnackbarOpen(true);
    } else {
      setSnackbarMessage(t('playlistDetail.errors.noDownloadedTracksToShuffle'));
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
    return date.toLocaleDateString(i18n.language === 'ro' ? 'ro-RO' : 'en-US', {
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
        <IconButton aria-label={t('common.back')} onClick={() => navigate('/playlists')} sx={{ mb: 2 }}>
          <BackIcon />
        </IconButton>
        <Alert severity="error">{error || t('playlistDetail.errors.notFound')}</Alert>
      </Box>
    );
  }

  const offlineCardCopy = () => {
    if (!isOfflineAvailable) {
      return { title: t('playlistDetail.cacheCard.cacheTitle'), description: t('playlistDetail.cacheCard.cacheDescription') };
    }
    if (offlineCounts.missing > 0) {
      return {
        title: t('playlistDetail.cacheCard.partialTitle'),
        description: t('playlistDetail.cacheCard.partialDescription', offlineCounts),
      };
    }
    return {
      title: t('playlistDetail.cacheCard.readyTitle'),
      description: t('playlistDetail.cacheCard.readyDescription', { count: offlineCounts.available }),
    };
  };
  const { title: offlineCardTitle, description: offlineCardDescription } = offlineCardCopy();

  const trackTotal = playlist.remote_total ?? playlist.item_count;
  const outstandingStats = [
    { key: 'pending', count: playlist.pending ?? 0 },
    { key: 'failed', count: playlist.failed ?? 0 },
    { key: 'unavailable', count: playlist.remote_unavailable_count ?? 0 },
  ].filter(({ count }) => count > 0);

  const playlistItems = playlist.items ?? [];
  const playableQueue = playlistItems.filter((item) => item.audio.file_path).map((item) => item.audio);

  return (
    <Box>
      {/* Header with Back Button */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <IconButton aria-label={t('common.back')} 
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
                {t('playlistDetail.offlineMode.title')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {isOfflineAvailable 
                  ? t('playlistDetail.offlineMode.available') 
                  : t('playlistDetail.offlineMode.unavailableHint')}
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
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('playlistDetail.actions.playAll')}</Box>
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
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('playlistDetail.actions.shuffle')}</Box>
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
          title={t('playlistDetail.actions.downloadAllTitle')}
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('playlistDetail.actions.saveAll')}</Box>
        </Button>
        <Button
          variant="outlined"
          startIcon={<SyncIcon />}
          onClick={handleForceRecheck}
          sx={{
            minWidth: { xs: '48px', sm: '170px' },
            borderColor: 'warning.main',
            color: 'warning.main',
            fontWeight: 600,
            '&:hover': { 
              borderColor: 'warning.dark',
              bgcolor: 'rgba(255, 152, 0, 0.05)'
            },
          }}
          title={t('playlistDetail.actions.forceRecheckTitle')}
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('playlistDetail.actions.forceRecheck')}</Box>
        </Button>
        <Button
          variant="outlined"
          startIcon={<FolderZipIcon />}
          onClick={() => setExportDialogOpen(true)}
          disabled={!playlist.downloaded_count}
          sx={{
            minWidth: { xs: '48px', sm: '150px' },
            borderColor: 'primary.main',
            color: 'primary.main',
            fontWeight: 600,
            '&:hover': {
              borderColor: 'primary.dark',
              bgcolor: 'rgba(19, 236, 106, 0.05)',
            },
            '&:disabled': {
              borderColor: 'rgba(255, 255, 255, 0.1)',
              color: 'rgba(255, 255, 255, 0.3)',
            },
          }}
          title={t('playlistDetail.export.action')}
        >
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('playlistDetail.export.action')}</Box>
        </Button>
      </Box>

      <PlaylistExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
        playlistId={playlist.playlist_id}
        playlistTitle={playlist.title}
        trackCount={playlist.downloaded_count}
        onExported={() => {
          setSnackbarMessage(t('playlistDetail.export.done'));
          setSnackbarOpen(true);
        }}
      />

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
                {offlineCardTitle}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {offlineCardDescription}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {isDownloadingOffline && (
              <Button variant="outlined" size="small" onClick={() => cancelPlaylistCache(playlist.playlist_id)}>
                {t('playlistDetail.actions.cancelCaching')}
              </Button>
            )}
            {isOfflineAvailable && offlineCounts.missing > 0 && (
              <Button
                variant="contained"
                startIcon={<CloudDownloadIcon />}
                onClick={handleCacheForOffline}
                disabled={!isOnline || isDownloadingOffline}
                size="small"
              >
                {t('playlistDetail.actions.downloadMissing')}
              </Button>
            )}
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
                {isDownloadingOffline ? t('playlistDetail.actions.caching') : t('playlistDetail.actions.makeAvailableOffline')}
              </Button>
            ) : (
              <>
                <Tooltip title={t('playlistDetail.actions.removeOfflineTitle')}>
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
                    {t('playlistDetail.actions.removeOffline')}
                  </Button>
                </Tooltip>
                <Chip 
                  icon={<CloudDoneIcon />}
                  label={offlineCounts.missing > 0 ? t('playlistDetail.status.partiallyCached') : t('playlistDetail.status.cached')}
                  color={offlineCounts.missing > 0 ? 'warning' : 'success'}
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              </>
            )}
            {cacheSize && (
              <Box sx={{ ml: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <Typography variant="caption" color="text.secondary">
                  {t('playlistDetail.cacheCard.storageUsed')}
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
      {trackTotal > 0 && playlist.progress_percent < 100 && (
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('playlistDetail.progress.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('playlistDetail.progress.count', { downloaded: playlist.downloaded_count, total: trackTotal })}
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
            {t('playlistDetail.stats.totalTracks')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {trackTotal}
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t('playlistDetail.stats.downloaded')}
          </Typography>
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
            {playlist.downloaded_count}
          </Typography>
        </Box>
        {outstandingStats.map(({ key, count }) => (
          <Box key={key}>
            <Typography variant="caption" color="text.secondary">
              {t(`playlistDetail.stats.${key}`)}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {count}
            </Typography>
          </Box>
        ))}
        {playlist.last_refresh && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('playlistDetail.stats.lastUpdated')}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {formatDate(playlist.last_refresh)}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Tracks Table */}
      <TrackTable
        items={playlistItems}
        rowKey={(item) => item.id}
        describe={(item) => ({
          key: item.audio.youtube_id,
          title: item.audio.title,
          subtitle: item.audio.artist || item.audio.channel_name,
          artworkUrl: item.audio.thumbnail_url,
          playable: Boolean(item.audio.file_path),
        })}
        onPlay={(item) => setCurrentAudio(item.audio, playableQueue)}
        renderTitleExtras={(item) => (
          <>
            {item.audio.youtube_id && offlineTracks.has(item.audio.youtube_id) && (
              <Tooltip title={t('playlistDetail.status.availableOffline')}>
                <OfflinePinIcon sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
              </Tooltip>
            )}
            {!item.audio.file_path && (
              <Chip
                label={t('playlistDetail.status.notDownloaded')}
                size="small"
                color="warning"
                sx={{ height: 18, fontSize: '0.65rem', flexShrink: 0 }}
              />
            )}
          </>
        )}
        columns={[
          { id: 'duration', header: t('playlistDetail.columns.duration'), width: 80, align: 'right', showFrom: 'sm', render: (item) => formatDuration(item.audio.duration) },
        ]}
        actionsWidth={96}
        renderActions={(item) => (
          <>
            {item.audio.file_path && item.audio.youtube_id && (
              <IconButton
                size="small"
                aria-label={t('playlistDetail.actions.downloadToDevice')}
                title={t('playlistDetail.actions.downloadToDevice')}
                onClick={() => handleDownloadTrackToDevice(item.audio.youtube_id!, item.audio.title)}
                sx={{ color: 'primary.main' }}
              >
                <DownloadIcon />
              </IconButton>
            )}
            <TrackActionsMenu track={item.audio} onTrackUpdate={handleTrackUpdate} />
          </>
        )}
        emptyMessage={t('playlistDetail.empty.noTracks')}
      />

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
              {t('playlistDetail.progress.cachingForOffline')}
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
