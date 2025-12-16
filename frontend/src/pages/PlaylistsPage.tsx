import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Chip,
  IconButton,
  Alert,
  LinearProgress,
  Tooltip,
  Badge,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  PlaylistPlay as PlaylistIcon,
  Download as DownloadIcon,
  CloudDone as CloudDoneIcon,
  WifiOff as WifiOffIcon,
} from '@mui/icons-material';
import { playlistAPI } from '../api/client';
import { usePWA } from '../context/PWAContext';
import { offlineStorage } from '../utils/offlineStorage';

interface Playlist {
  id: number;
  playlist_id: string;
  title: string;
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
}

export default function PlaylistsPage() {
  const navigate = useNavigate();
  const { isOnline } = usePWA();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [error, setError] = useState('');
  const [offlinePlaylists, setOfflinePlaylists] = useState<Set<number>>(new Set());

  const loadPlaylists = async () => {
    try {
      const response = await playlistAPI.list();
      // Handle both array response and paginated object response
      const data = Array.isArray(response.data) ? response.data : (response.data?.results || response.data?.data || []);
      setPlaylists(data);
      
      // Load offline status
      await loadOfflineStatus();
    } catch (err) {
      console.error('Failed to load playlists:', err);
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  };

  const loadOfflineStatus = async () => {
    try {
      const cachedPlaylists = await offlineStorage.getOfflinePlaylists();
      const offlineIds = new Set(cachedPlaylists.map(p => p.id));
      setOfflinePlaylists(offlineIds);
    } catch (err) {
      console.error('Failed to load offline status:', err);
    }
  };

  useEffect(() => {
    loadPlaylists();
  }, []);

  const handleSubscribe = async () => {
    setError('');
    setLoading(true);
    try {
      await playlistAPI.create({ url: playlistUrl });
      setPlaylistUrl('');
      setOpenDialog(false);
      // Show success message
      alert('✅ Playlist subscription started! Fetching metadata and downloading audio...');
      // Immediately reload to show pending status
      await loadPlaylists();
      setLoading(false);
      // Poll for updates every 3 seconds for the next 30 seconds
      const pollInterval = setInterval(async () => {
        await loadPlaylists();
      }, 3000);
      setTimeout(() => clearInterval(pollInterval), 30000);
    } catch (err: any) {
      setLoading(false);
      setError(err.response?.data?.detail || 'Failed to subscribe to playlist');
    }
  };

  const handleDownload = async (playlistId: string) => {
    try {
      await playlistAPI.download(playlistId);
      // Reload playlists to show updated status
      setTimeout(loadPlaylists, 1000);
    } catch (err) {
      console.error('Failed to start download:', err);
    }
  };

  const handleDelete = async (playlistId: string) => {
    if (!confirm('Are you sure you want to remove this playlist?')) return;
    
    try {
      await playlistAPI.delete(playlistId);
      loadPlaylists();
    } catch (err) {
      console.error('Failed to delete playlist:', err);
    }
  };

  const getProgress = (playlist: Playlist) => {
    return playlist.progress_percent || 0;
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

  const getLastRefreshText = (lastRefresh: string | null) => {
    if (!lastRefresh) return 'Never synced';
    const date = new Date(lastRefresh);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          YouTube Playlists
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
          sx={{ borderRadius: '9999px', textTransform: 'none', fontWeight: 600 }}
        >
          Add Playlist
        </Button>
      </Box>

      {/* Playlists Grid */}
      <Box sx={{ display: 'flex', gap: 3, overflowX: 'auto', pb: 2, '&::-webkit-scrollbar': { height: 8 }, '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1 } }}>
        {playlists.map((playlist) => (
          <Card 
            key={playlist.id}
            onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
            sx={{ 
              minWidth: 160, 
              width: 160,
              cursor: 'pointer',
              transition: 'transform 0.2s',
              '&:hover': {
                transform: 'translateY(-4px)',
                bgcolor: 'rgba(255, 255, 255, 0.05)'
              }
            }}
          >
            {/* Playlist Thumbnail */}
            <Box
              sx={{
                height: 160,
                width: 160,
                backgroundImage: `url(${playlist.thumbnail_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: 'grey.900',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px 12px 0 0',
                position: 'relative',
              }}
            >
              {!playlist.thumbnail_url && (
                <PlaylistIcon sx={{ fontSize: 40, color: 'grey.600' }} />
              )}
              {/* Offline Badge */}
              {offlinePlaylists.has(playlist.id) && (
                <Chip
                  icon={<CloudDoneIcon sx={{ fontSize: 14 }} />}
                  label="Offline"
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    height: 20,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    bgcolor: 'success.main',
                    color: 'white',
                    '& .MuiChip-icon': { color: 'white' },
                  }}
                />
              )}
              {/* Offline Mode Indicator */}
              {!isOnline && !offlinePlaylists.has(playlist.id) && (
                <Chip
                  icon={<WifiOffIcon sx={{ fontSize: 14 }} />}
                  label="Unavailable"
                  size="small"
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    height: 20,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    bgcolor: 'rgba(0, 0, 0, 0.7)',
                    color: 'warning.main',
                    '& .MuiChip-icon': { color: 'warning.main' },
                  }}
                />
              )}
            </Box>
            
            <CardContent sx={{ p: 1.5, pb: 1 }}>
                {/* Playlist Name */}
                <Typography variant="body2" fontWeight={600} noWrap sx={{ mb: 0.5 }}>
                  {playlist.title}
                </Typography>
                
                {/* Channel */}
                <Typography variant="caption" color="text.secondary" noWrap>
                  {playlist.channel_name}
                </Typography>

                {/* Progress */}
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {playlist.downloaded_count}/{playlist.item_count}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={getProgress(playlist)}
                    sx={{ height: 3, borderRadius: 1, mt: 0.5 }}
                  />
                </Box>
              </CardContent>

              <CardActions sx={{ justifyContent: 'space-between', px: 1, py: 0.5, gap: 0.5 }}>
                <IconButton 
                  size="small" 
                  color="primary"
                  onClick={(e) => { e.stopPropagation(); handleDownload(playlist.playlist_id); }}
                  disabled={playlist.sync_status === 'syncing'}
                  title={playlist.sync_status === 'syncing' ? 'Downloading...' : 'Download'}
                  sx={{ width: 28, height: 28 }}
                >
                  <DownloadIcon sx={{ fontSize: 16 }} />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={(e) => { e.stopPropagation(); handleDelete(playlist.playlist_id); }}
                  title="Remove"
                  sx={{ width: 28, height: 28 }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </CardActions>
            </Card>
        ))}
      </Box>

      {/* Empty State */}
      {!loading && playlists.length === 0 && (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            color: 'text.secondary',
          }}
        >
          <PlaylistIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6" gutterBottom>
            No playlists added
          </Typography>
          <Typography variant="body2" sx={{ mb: 3 }}>
            Add YouTube playlists to automatically download all their videos
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpenDialog(true)}
          >
            Add Playlist
          </Button>
        </Box>
      )}

      {/* Add Playlist Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add YouTube Playlist</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="dense"
            label="Playlist URL"
            placeholder="https://www.youtube.com/playlist?list=..."
            fullWidth
            value={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            helperText="Enter a YouTube playlist URL"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button onClick={handleSubscribe} variant="contained" disabled={!playlistUrl}>
            Add Playlist
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
