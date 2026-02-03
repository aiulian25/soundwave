/**
 * Track Actions Menu Component
 * 
 * Reusable menu with actions for audio tracks:
 * - Play Next
 * - Add to Queue
 * - Add to playlist
 * - Start Radio
 * - Toggle favorite
 * - Download
 * - Go to Channel
 * - Find in Playlists
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItem,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  Typography,
  CircularProgress,
  Box,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RadioIcon from '@mui/icons-material/Radio';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import DownloadIcon from '@mui/icons-material/Download';
import YouTubeIcon from '@mui/icons-material/YouTube';
import FolderIcon from '@mui/icons-material/Folder';
import StartRadioMenu from './StartRadioMenu';
import AddToPlaylistDialog from './AddToPlaylistDialog';
import { audioAPI, playlistAPI } from '../api/client';
import type { Audio } from '../types';

interface ContainingPlaylist {
  id: number;
  playlist_id: string;
  title: string;
  playlist_type: string;
  thumbnail_url: string;
  item_count: number;
  position: number;
}

interface TrackActionsMenuProps {
  track: Audio;
  onTrackUpdate?: (updatedTrack: Audio) => void;
  onDownload?: () => void;
  onPlayNext?: () => void;
  onAddToQueue?: () => void;
  size?: 'small' | 'medium';
  showQueueActions?: boolean;
}

export default function TrackActionsMenu({
  track,
  onTrackUpdate,
  onDownload,
  onPlayNext,
  onAddToQueue,
  size = 'small',
  showQueueActions = true,
}: TrackActionsMenuProps) {
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [radioMenuAnchor, setRadioMenuAnchor] = useState<HTMLElement | null>(null);
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false);
  const [showFindInPlaylistsDialog, setShowFindInPlaylistsDialog] = useState(false);
  const [containingPlaylists, setContainingPlaylists] = useState<ContainingPlaylist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [isFavorite, setIsFavorite] = useState(track.is_favorite);
  
  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
  };
  
  const handleCloseMenu = () => {
    setMenuAnchor(null);
  };
  
  const handleOpenRadioMenu = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setRadioMenuAnchor(event.currentTarget);
    handleCloseMenu();
  };
  
  const handleCloseRadioMenu = () => {
    setRadioMenuAnchor(null);
  };
  
  const handlePlayNext = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onPlayNext) {
      onPlayNext();
    }
    handleCloseMenu();
  };
  
  const handleAddToQueue = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onAddToQueue) {
      onAddToQueue();
    }
    handleCloseMenu();
  };
  
  const handleToggleFavorite = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!track.youtube_id) return;
    
    try {
      const response = await audioAPI.toggleFavorite(track.youtube_id);
      const newIsFavorite = response.data.is_favorite;
      setIsFavorite(newIsFavorite);
      
      // Notify parent of the update
      if (onTrackUpdate) {
        onTrackUpdate({ ...track, is_favorite: newIsFavorite });
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
    handleCloseMenu();
  };
  
  const handleAddToPlaylist = (event: React.MouseEvent) => {
    event.stopPropagation();
    setShowPlaylistDialog(true);
    handleCloseMenu();
  };
  
  const handleDownload = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (onDownload) {
      onDownload();
    }
    handleCloseMenu();
  };

  const handleGoToChannel = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (track.channel_id && track.youtube_id) {
      navigate(`/channels/${track.channel_id}?highlight=${track.youtube_id}`);
    }
    handleCloseMenu();
  };

  const handleFindInPlaylists = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!track.youtube_id) return;
    
    setShowFindInPlaylistsDialog(true);
    setLoadingPlaylists(true);
    handleCloseMenu();
    
    try {
      const response = await playlistAPI.findContaining(track.youtube_id);
      setContainingPlaylists(response.data.data || []);
    } catch (error) {
      console.error('Failed to find playlists:', error);
      setContainingPlaylists([]);
    } finally {
      setLoadingPlaylists(false);
    }
  };

  const handleGoToPlaylist = (playlistId: string) => {
    setShowFindInPlaylistsDialog(false);
    navigate(`/playlists/${playlistId}?highlight=${track.youtube_id}`);
  };
  
  return (
    <>
      <IconButton
        size={size}
        onClick={handleOpenMenu}
        sx={{
          color: 'text.secondary',
          '&:hover': {
            color: 'text.primary',
            bgcolor: 'rgba(255, 255, 255, 0.1)',
          },
        }}
      >
        <MoreVertIcon fontSize={size} />
      </IconButton>
      
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleCloseMenu}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Play Next */}
        {showQueueActions && onPlayNext && (
          <MenuItem onClick={handlePlayNext}>
            <ListItemIcon>
              <PlaylistPlayIcon fontSize="small" sx={{ color: 'primary.main' }} />
            </ListItemIcon>
            <ListItemText>Play Next</ListItemText>
          </MenuItem>
        )}
        
        {/* Add to Queue */}
        {showQueueActions && onAddToQueue && (
          <MenuItem onClick={handleAddToQueue}>
            <ListItemIcon>
              <QueueMusicIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Add to Queue</ListItemText>
          </MenuItem>
        )}
        
        {showQueueActions && (onPlayNext || onAddToQueue) && <Divider sx={{ my: 0.5 }} />}
        
        {/* Start Radio */}
        <MenuItem onClick={handleOpenRadioMenu}>
          <ListItemIcon>
            <RadioIcon fontSize="small" sx={{ color: 'primary.main' }} />
          </ListItemIcon>
          <ListItemText>Start Radio</ListItemText>
        </MenuItem>
        
        <Divider sx={{ my: 0.5 }} />
        
        {/* Toggle Favorite - Always shown */}
        <MenuItem onClick={handleToggleFavorite}>
          <ListItemIcon>
            {isFavorite ? (
              <FavoriteIcon fontSize="small" sx={{ color: 'error.main' }} />
            ) : (
              <FavoriteBorderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>
            {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          </ListItemText>
        </MenuItem>
        
        {/* Add to Playlist - Always shown */}
        <MenuItem onClick={handleAddToPlaylist}>
          <ListItemIcon>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add to Playlist</ListItemText>
        </MenuItem>
        
        {/* Download */}
        {onDownload && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download</ListItemText>
          </MenuItem>
        )}
        
        {/* Navigation options */}
        {track.channel_id && (
          <>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem onClick={handleGoToChannel}>
              <ListItemIcon>
                <YouTubeIcon fontSize="small" sx={{ color: 'error.main' }} />
              </ListItemIcon>
              <ListItemText>Go to Channel</ListItemText>
            </MenuItem>
          </>
        )}
        
        {/* Find in Playlists */}
        {track.youtube_id && (
          <MenuItem onClick={handleFindInPlaylists}>
            <ListItemIcon>
              <FolderIcon fontSize="small" sx={{ color: 'info.main' }} />
            </ListItemIcon>
            <ListItemText>Find in Playlists</ListItemText>
          </MenuItem>
        )}
      </Menu>
      
      {/* Radio Sub-menu */}
      <StartRadioMenu
        anchorEl={radioMenuAnchor}
        open={Boolean(radioMenuAnchor)}
        onClose={handleCloseRadioMenu}
        track={track}
      />

      {/* Add to Playlist Dialog */}
      <AddToPlaylistDialog
        open={showPlaylistDialog}
        onClose={() => setShowPlaylistDialog(false)}
        track={track}
      />

      {/* Find in Playlists Dialog */}
      <Dialog
        open={showFindInPlaylistsDialog}
        onClose={() => setShowFindInPlaylistsDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Playlists containing this track
        </DialogTitle>
        <DialogContent>
          {loadingPlaylists ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : containingPlaylists.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              This track is not in any playlist yet.
            </Typography>
          ) : (
            <List>
              {containingPlaylists.map((playlist) => (
                <ListItem key={playlist.playlist_id} disablePadding>
                  <ListItemButton onClick={() => handleGoToPlaylist(playlist.playlist_id)}>
                    <ListItemAvatar>
                      <Avatar
                        src={playlist.thumbnail_url}
                        variant="rounded"
                        sx={{ width: 48, height: 48 }}
                      >
                        <PlaylistPlayIcon />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={playlist.title}
                      secondary={`${playlist.item_count} tracks • Position #${playlist.position}`}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
