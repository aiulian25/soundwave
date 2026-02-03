/**
 * Add to Playlist Dialog Component
 * 
 * Shows a dialog to:
 * - Select an existing playlist to add a track
 * - Create a new playlist and add the track
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  CircularProgress,
  Divider,
  Box,
  Alert,
  Snackbar,
  Chip,
} from '@mui/material';
import {
  PlaylistAdd as PlaylistAddIcon,
  Add as AddIcon,
  QueueMusic as QueueMusicIcon,
  Check as CheckIcon,
} from '@mui/icons-material';
import { playlistAPI } from '../api/client';
import type { Audio } from '../types';

interface Playlist {
  id: number;
  playlist_id: string;
  title: string;
  item_count: number;
  playlist_type: string;
}

interface AddToPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  track: Audio | null;
  onSuccess?: (playlistTitle: string) => void;
}

export default function AddToPlaylistDialog({
  open,
  onClose,
  track,
  onSuccess,
}: AddToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      const response = await playlistAPI.list();
      // Filter to only show custom playlists (not YouTube playlists)
      const customPlaylists = (response.data.data || []).filter(
        (p: Playlist) => p.playlist_type === 'custom'
      );
      setPlaylists(customPlaylists);
    } catch (err) {
      console.error('Failed to load playlists:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadPlaylists();
      setShowCreateForm(false);
      setNewPlaylistName('');
    }
  }, [open, loadPlaylists]);

  const handleAddToPlaylist = async (playlist: Playlist) => {
    if (!track?.youtube_id) return;
    
    try {
      setAdding(playlist.playlist_id);
      await playlistAPI.addItem(playlist.playlist_id, track.youtube_id);
      setSnackbar({
        open: true,
        message: `Added to "${playlist.title}"`,
        severity: 'success',
      });
      if (onSuccess) {
        onSuccess(playlist.title);
      }
      onClose();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to add to playlist';
      setSnackbar({
        open: true,
        message: errorMsg,
        severity: 'error',
      });
    } finally {
      setAdding(null);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !track?.youtube_id) return;
    
    try {
      setCreating(true);
      // Create the playlist
      const response = await playlistAPI.create({
        name: newPlaylistName.trim(),
        playlist_type: 'custom',
      });
      
      const newPlaylist = response.data;
      
      // Add the track to the new playlist
      await playlistAPI.addItem(newPlaylist.playlist_id, track.youtube_id);
      
      setSnackbar({
        open: true,
        message: `Created "${newPlaylistName}" and added track`,
        severity: 'success',
      });
      
      if (onSuccess) {
        onSuccess(newPlaylistName);
      }
      onClose();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || 'Failed to create playlist';
      setSnackbar({
        open: true,
        message: errorMsg,
        severity: 'error',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setShowCreateForm(false);
    setNewPlaylistName('');
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PlaylistAddIcon color="primary" />
          Add to Playlist
        </DialogTitle>
        <DialogContent dividers>
          {track && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="body2" noWrap fontWeight="medium">
                {track.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {track.artist || track.channel_name}
              </Typography>
            </Box>
          )}
          
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : showCreateForm ? (
            <Box sx={{ py: 1 }}>
              <TextField
                autoFocus
                fullWidth
                label="Playlist Name"
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPlaylistName.trim()) {
                    handleCreatePlaylist();
                  }
                }}
                disabled={creating}
                sx={{ mb: 2 }}
              />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  onClick={() => setShowCreateForm(false)}
                  disabled={creating}
                >
                  Back
                </Button>
                <Button
                  variant="contained"
                  onClick={handleCreatePlaylist}
                  disabled={!newPlaylistName.trim() || creating}
                  startIcon={creating ? <CircularProgress size={16} /> : <CheckIcon />}
                >
                  {creating ? 'Creating...' : 'Create & Add'}
                </Button>
              </Box>
            </Box>
          ) : (
            <>
              {/* Create new playlist button */}
              <ListItem disablePadding>
                <ListItemButton onClick={() => setShowCreateForm(true)}>
                  <ListItemIcon>
                    <AddIcon color="primary" />
                  </ListItemIcon>
                  <ListItemText 
                    primary="Create New Playlist" 
                    primaryTypographyProps={{ color: 'primary', fontWeight: 'medium' }}
                  />
                </ListItemButton>
              </ListItem>
              
              {playlists.length > 0 && <Divider sx={{ my: 1 }} />}
              
              {/* Existing playlists */}
              {playlists.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                  No custom playlists yet. Create one!
                </Typography>
              ) : (
                <List disablePadding>
                  {playlists.map((playlist) => (
                    <ListItem key={playlist.playlist_id} disablePadding>
                      <ListItemButton
                        onClick={() => handleAddToPlaylist(playlist)}
                        disabled={adding !== null}
                      >
                        <ListItemIcon>
                          {adding === playlist.playlist_id ? (
                            <CircularProgress size={24} />
                          ) : (
                            <QueueMusicIcon />
                          )}
                        </ListItemIcon>
                        <ListItemText 
                          primary={playlist.title}
                          secondary={`${playlist.item_count} tracks`}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
        </DialogActions>
      </Dialog>
      
      {/* Success/Error Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          severity={snackbar.severity} 
          onClose={() => setSnackbar({ ...snackbar, open: false })}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
}
