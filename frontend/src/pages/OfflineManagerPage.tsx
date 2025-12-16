import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  Alert,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  CloudDone as CloudDoneIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  CloudOff as CloudOffIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import { usePWA } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';
import { useNavigate } from 'react-router-dom';

interface CachedPlaylist {
  id: number;
  playlist_id: string;
  title: string;
  channel_name: string;
  item_count: number;
  downloaded_count: number;
  offline: boolean;
  lastSync: number;
}

export default function OfflineManagerPage() {
  const navigate = useNavigate();
  const { isOnline, cacheSize, clearCache, removePlaylistCache } = usePWA();
  const [cachedPlaylists, setCachedPlaylists] = useState<CachedPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; playlistId?: string; title?: string }>({
    open: false,
  });
  const [clearAllDialog, setClearAllDialog] = useState(false);

  useEffect(() => {
    loadCachedPlaylists();
  }, []);

  const loadCachedPlaylists = async () => {
    try {
      const playlists = await offlineStorage.getOfflinePlaylists();
      setCachedPlaylists(playlists);
    } catch (err) {
      console.error('Failed to load cached playlists:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePlaylist = async (playlist: CachedPlaylist) => {
    try {
      // Build audio URLs
      const audioUrls = (playlist as any).items?.map((item: any) => 
        `/api/audio/${item.audio.youtube_id}/download/`
      ) || [];

      // Remove from cache
      await removePlaylistCache(playlist.playlist_id, audioUrls);
      
      // Remove from IndexedDB
      await offlineStorage.removePlaylist(playlist.id);

      // Reload list
      await loadCachedPlaylists();

      setConfirmDialog({ open: false });
    } catch (err) {
      console.error('Failed to remove playlist:', err);
      alert('Failed to remove offline data');
    }
  };

  const handleClearAll = async () => {
    try {
      // Clear all caches
      await clearCache();
      
      // Clear IndexedDB playlists
      await offlineStorage.clearAllData();

      // Reload list
      await loadCachedPlaylists();

      setClearAllDialog(false);
    } catch (err) {
      console.error('Failed to clear all:', err);
      alert('Failed to clear all offline data');
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', px: 2 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: 1 }}>
          Offline Storage
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage playlists cached for offline playback
        </Typography>
      </Box>

      {/* Online Status */}
      {!isOnline && (
        <Alert severity="warning" icon={<CloudOffIcon />} sx={{ mb: 3 }}>
          You are currently offline. You can only play cached content.
        </Alert>
      )}

      {/* Storage Info */}
      {cacheSize && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <StorageIcon color="primary" sx={{ fontSize: 32 }} />
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Storage Used
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 700, color: 'primary.main' }}>
                  {formatBytes(cacheSize.usage)}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary">
                  Available
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatBytes(cacheSize.quota - cacheSize.usage)}
                </Typography>
              </Box>
            </Box>
            <LinearProgress
              variant="determinate"
              value={(cacheSize.usage / cacheSize.quota) * 100}
              sx={{ height: 8, borderRadius: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {((cacheSize.usage / cacheSize.quota) * 100).toFixed(1)}% of {formatBytes(cacheSize.quota)} used
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Cached Playlists */}
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CloudDoneIcon color="success" />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Offline Playlists
              </Typography>
              <Chip label={cachedPlaylists.length} size="small" color="success" />
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                startIcon={<RefreshIcon />}
                onClick={loadCachedPlaylists}
              >
                Refresh
              </Button>
              {cachedPlaylists.length > 0 && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setClearAllDialog(true)}
                >
                  Clear All
                </Button>
              )}
            </Box>
          </Box>

          <Divider sx={{ mb: 2 }} />

          {cachedPlaylists.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <CloudOffIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2, opacity: 0.3 }} />
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No playlists cached for offline use
              </Typography>
              <Button variant="contained" onClick={() => navigate('/playlists')}>
                Browse Playlists
              </Button>
            </Box>
          ) : (
            <List disablePadding>
              {cachedPlaylists.map((playlist, index) => (
                <Box key={playlist.id}>
                  {index > 0 && <Divider />}
                  <ListItem
                    sx={{
                      py: 2,
                      cursor: 'pointer',
                      '&:hover': {
                        bgcolor: 'rgba(255, 255, 255, 0.05)',
                      },
                    }}
                    onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                          <Typography variant="body1" sx={{ fontWeight: 600 }}>
                            {playlist.title}
                          </Typography>
                          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                        </Box>
                      }
                      secondary={
                        <Box>
                          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                            {playlist.channel_name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                            <Chip
                              label={`${playlist.downloaded_count} tracks`}
                              size="small"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                            />
                            <Chip
                              label={`Cached ${formatDate(playlist.lastSync)}`}
                              size="small"
                              sx={{ height: 20, fontSize: '0.7rem' }}
                              variant="outlined"
                            />
                          </Box>
                        </Box>
                      }
                    />
                    <ListItemSecondaryAction>
                      <IconButton
                        edge="end"
                        color="error"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDialog({
                            open: true,
                            playlistId: playlist.playlist_id,
                            title: playlist.title,
                          });
                        }}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </ListItemSecondaryAction>
                  </ListItem>
                </Box>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      {/* Remove Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ open: false })}
      >
        <DialogTitle>Remove Offline Playlist?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to remove "{confirmDialog.title}" from offline storage? 
            You'll need to re-download it to play offline.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ open: false })}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const playlist = cachedPlaylists.find(
                (p) => p.playlist_id === confirmDialog.playlistId
              );
              if (playlist) handleRemovePlaylist(playlist);
            }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={clearAllDialog} onClose={() => setClearAllDialog(false)}>
        <DialogTitle>Clear All Offline Data?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            This will remove all cached playlists and free up storage space.
            You'll need to re-download playlists to use them offline.
          </Typography>
          <Alert severity="warning">
            This action cannot be undone.
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearAllDialog(false)}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={handleClearAll}>
            Clear All
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
