import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  PlaylistPlay as PlaylistIcon,
  RestartAlt as ResetIcon,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { playlistAPI } from '../api/client';
import { fetchAllPlaylists } from '../utils/fetchAll';
import { usePWA } from '../context/PWAContext';
import { useSettings } from '../context/SettingsContext';
import { offlineStorage } from '../utils/offlineStorage';
import ScrollToTop from '../components/ScrollToTop';
import PlaylistCard from '../components/PlaylistCard';
import SortableItem from '../components/SortableItem';
import { useSortableItems } from '../hooks/useSortableItems';

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
  const { getExtraSetting, updateExtraSetting } = useSettings();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [error, setError] = useState('');
  const [offlinePlaylists, setOfflinePlaylists] = useState<Set<number>>(new Set());
  const [syncingPlaylists, setSyncingPlaylists] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({ open: false, message: '', severity: 'info' });

  // Drag and drop sorting with backend persistence
  const getPlaylistId = useCallback((playlist: Playlist) => playlist.playlist_id, []);
  const { sortedItems: sortedPlaylists, handleDragEnd, resetOrder, hasCustomOrder } = useSortableItems({
    items: playlists,
    storageKey: 'soundwave-playlist-order',
    getItemId: getPlaylistId,
    getExtraSetting,
    updateExtraSetting,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadPlaylists = async () => {
    try {
      // If offline, load from IndexedDB
      if (!isOnline) {
        console.log('[Offline] Loading playlists from cache');
        const cachedPlaylists = await offlineStorage.getOfflinePlaylists();
        if (cachedPlaylists.length > 0) {
          // Convert cached playlists to expected format
          const offlineData = cachedPlaylists.map(p => ({
            id: p.id,
            playlist_id: p.playlist_id,
            title: p.title,
            channel_name: p.channel_name || 'Offline',
            thumbnail_url: p.thumbnail_url,
            subscribed: true,
            item_count: p.item_count || p.items?.length || 0,
            downloaded_count: p.downloaded_count || p.items?.length || 0,
            last_refresh: null,
            sync_status: 'success' as const,
            status_display: 'Offline',
            error_message: '',
            active: true,
            progress_percent: 100,
          }));
          setPlaylists(offlineData);
          // Mark all as offline available
          setOfflinePlaylists(new Set(offlineData.map(p => p.id)));
        } else {
          setPlaylists([]);
        }
        setLoading(false);
        return;
      }
      
      // Online - fetch from API
      const data = await fetchAllPlaylists();
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
  }, [isOnline]);

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
    // Add to syncing set
    setSyncingPlaylists(prev => new Set(prev).add(playlistId));
    
    try {
      const response = await playlistAPI.download(playlistId);
      console.log('[Playlist] Download started:', response.data);
      
      setSnackbar({
        open: true,
        message: '🔄 Sync started! Checking for new tracks...',
        severity: 'info'
      });
      
      // Poll for updates every 2 seconds for the next 30 seconds
      let pollCount = 0;
      const maxPolls = 15;
      const pollInterval = setInterval(async () => {
        pollCount++;
        await loadPlaylists();
        
        // Check if sync is complete
        const playlist = playlists.find(p => p.playlist_id === playlistId);
        if (playlist && playlist.sync_status !== 'syncing') {
          clearInterval(pollInterval);
          setSyncingPlaylists(prev => {
            const newSet = new Set(prev);
            newSet.delete(playlistId);
            return newSet;
          });
          
          if (playlist.sync_status === 'success') {
            setSnackbar({
              open: true,
              message: `✅ Sync complete! ${playlist.downloaded_count}/${playlist.item_count} tracks available`,
              severity: 'success'
            });
          } else if (playlist.sync_status === 'failed') {
            setSnackbar({
              open: true,
              message: `❌ Sync failed: ${playlist.error_message || 'Unknown error'}`,
              severity: 'error'
            });
          }
        }
        
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setSyncingPlaylists(prev => {
            const newSet = new Set(prev);
            newSet.delete(playlistId);
            return newSet;
          });
        }
      }, 2000);
      
    } catch (err: any) {
      console.error('Failed to start download:', err);
      setSyncingPlaylists(prev => {
        const newSet = new Set(prev);
        newSet.delete(playlistId);
        return newSet;
      });
      setSnackbar({
        open: true,
        message: `❌ Failed to start sync: ${err.response?.data?.detail || err.message || 'Unknown error'}`,
        severity: 'error'
      });
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

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            YouTube Playlists
          </Typography>
          {hasCustomOrder && (
            <Tooltip title="Reset to default order">
              <IconButton size="small" onClick={resetOrder} sx={{ opacity: 0.7 }}>
                <ResetIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
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

      {/* Playlists Grid with Drag and Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedPlaylists.map(p => p.playlist_id)}
          strategy={rectSortingStrategy}
        >
          <Box 
            sx={{ 
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: { xs: 1.5, sm: 2, md: 3 },
              pb: 2,
              '@media (min-width: 900px)': {
                gridTemplateColumns: 'repeat(3, 1fr)',
              },
              '@media (min-width: 1200px)': {
                gridTemplateColumns: 'repeat(4, 1fr)',
              },
            }}
          >
            {sortedPlaylists.map((playlist) => (
              <SortableItem key={playlist.playlist_id} id={playlist.playlist_id}>
                <PlaylistCard
                  playlist={playlist}
                  isOffline={offlinePlaylists.has(playlist.id)}
                  isOnline={isOnline}
                  isSyncing={syncingPlaylists.has(playlist.playlist_id) || playlist.sync_status === 'syncing'}
                  onSync={() => handleDownload(playlist.playlist_id)}
                  onDelete={() => handleDelete(playlist.playlist_id)}
                  onClick={() => navigate(`/playlists/${playlist.playlist_id}`)}
                />
              </SortableItem>
            ))}
          </Box>
        </SortableContext>
      </DndContext>

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

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
      
      <ScrollToTop />
    </Box>
  );
}
