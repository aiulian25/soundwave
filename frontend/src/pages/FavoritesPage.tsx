import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Paper,
  Button,
  Snackbar,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import { audioAPI } from '../api/client';
import { fetchAllAudio } from '../utils/fetchAll';
import ScrollToTop from '../components/ScrollToTop';
import TrackActionsMenu from '../components/TrackActionsMenu';
import { useHighlightTrack } from '../hooks/useHighlightTrack';
import type { Audio } from '../types';

interface FavoritesPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function FavoritesPage({ setCurrentAudio }: FavoritesPageProps) {
  const [favorites, setFavorites] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(true);
  const { getTrackRef, shouldHighlight } = useHighlightTrack();
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      setLoading(true);
      const allAudio = await fetchAllAudio({ favorites: true });
      // Filter for favorites on the frontend as backup
      const favoriteFiles = allAudio.filter((audio: Audio) => audio.is_favorite);
      setFavorites(favoriteFiles);
    } catch (error) {
      console.error('Failed to load favorites:', error);
      setFavorites([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle track update from TrackActionsMenu (including favorite toggle)
  const handleTrackUpdate = (updatedTrack: Audio) => {
    if (!updatedTrack.is_favorite) {
      // If track is unfavorited, remove it from the list
      setFavorites(prev => prev.filter(fav => fav.id !== updatedTrack.id));
      setSnackbarMessage('Removed from favorites');
      setSnackbarOpen(true);
    } else {
      // Update the track in place
      setFavorites(prev => prev.map(fav => fav.id === updatedTrack.id ? updatedTrack : fav));
    }
  };

  const handlePlayAll = () => {
    if (favorites.length === 0) {
      setSnackbarMessage('No favorites to play');
      setSnackbarOpen(true);
      return;
    }
    
    setCurrentAudio(favorites[0], favorites);
    setSnackbarMessage(`Playing ${favorites.length} favorite tracks`);
    setSnackbarOpen(true);
  };

  const handleShuffle = () => {
    if (favorites.length === 0) {
      setSnackbarMessage('No favorites to shuffle');
      setSnackbarOpen(true);
      return;
    }
    
    // Shuffle array using Fisher-Yates algorithm
    const shuffled = [...favorites];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    setCurrentAudio(shuffled[0], shuffled);
    setSnackbarMessage(`Shuffled ${shuffled.length} favorite tracks`);
    setSnackbarOpen(true);
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          Favorites
        </Typography>
        <Typography>Loading favorites...</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          Favorites
        </Typography>
        
        {favorites.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button
              variant="contained"
              startIcon={<PlayArrowIcon />}
              onClick={handlePlayAll}
              sx={{ 
                borderRadius: 2.5,
                px: 3,
                py: 1.25,
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
            >
              Play All
            </Button>
            <Button
              variant="outlined"
              startIcon={<ShuffleIcon />}
              onClick={handleShuffle}
              sx={{ 
                borderRadius: 2.5,
                px: 3,
                py: 1.25,
                fontSize: '0.95rem',
                fontWeight: 600,
              }}
            >
              Shuffle
            </Button>
          </Box>
        )}
      </Box>

      {favorites.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 300,
            gap: 1.5,
          }}
        >
          <FavoriteIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Typography variant="subtitle1" color="text.secondary">
            No favorites yet
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Start adding songs to your favorites
          </Typography>
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width={50} sx={{ fontWeight: 600 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Duration</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Size</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>Plays</TableCell>
                <TableCell align="center" width={100} sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {favorites.map((audio, index) => (
                <TableRow
                  key={audio.id}
                  ref={getTrackRef(audio.youtube_id)}
                  sx={{ 
                    cursor: 'pointer',
                    transition: 'background-color 0.3s ease',
                    '&:hover': {
                      bgcolor: 'rgba(19, 236, 106, 0.05)',
                    },
                    ...(shouldHighlight(audio.youtube_id) && {
                      bgcolor: 'rgba(19, 236, 106, 0.1)',
                    }),
                  }}
                  onClick={() => setCurrentAudio(audio, favorites)}
                >
                  <TableCell sx={{ color: 'text.secondary' }}>{index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" noWrap sx={{ maxWidth: 300, fontWeight: 500 }}>
                      {audio.title}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {audio.channel_name}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {formatDuration(audio.duration)}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {formatFileSize(audio.file_size)}
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary' }}>
                    {audio.play_count}
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <IconButton 
                      size="small" 
                      sx={{
                        color: 'primary.main',
                        '&:hover': {
                          bgcolor: 'rgba(19, 236, 106, 0.1)',
                        },
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCurrentAudio(audio, favorites);
                      }}
                    >
                      <PlayArrowIcon />
                    </IconButton>
                    <TrackActionsMenu 
                      track={audio}
                      onTrackUpdate={handleTrackUpdate}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={3000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMessage}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
      
      <ScrollToTop />
    </Box>
  );
}
