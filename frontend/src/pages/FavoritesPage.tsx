import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Snackbar,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../utils/formatDuration';
import { fetchAllAudio } from '../utils/fetchAll';
import ScrollToTop from '../components/ScrollToTop';
import TrackActionsMenu from '../components/TrackActionsMenu';
import TrackTable from '../components/TrackTable';
import type { Audio } from '../types';

interface FavoritesPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function FavoritesPage({ setCurrentAudio }: FavoritesPageProps) {
  const { t } = useTranslation();
  const [favorites, setFavorites] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(true);
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
      setSnackbarMessage(t('favorites.messages.removed'));
      setSnackbarOpen(true);
    } else {
      // Update the track in place
      setFavorites(prev => prev.map(fav => fav.id === updatedTrack.id ? updatedTrack : fav));
    }
  };

  const handlePlayAll = () => {
    if (favorites.length === 0) {
      setSnackbarMessage(t('favorites.errors.noFavoritesToPlay'));
      setSnackbarOpen(true);
      return;
    }
    
    setCurrentAudio(favorites[0], favorites);
    setSnackbarMessage(t('favorites.messages.playingTracks', { count: favorites.length }));
    setSnackbarOpen(true);
  };

  const handleShuffle = () => {
    if (favorites.length === 0) {
      setSnackbarMessage(t('favorites.errors.noFavoritesToShuffle'));
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
    setSnackbarMessage(t('favorites.messages.shuffledTracks', { count: shuffled.length }));
    setSnackbarOpen(true);
  };


  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <Box>
        <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
          {t('favorites.title')}
        </Typography>
        <Typography>{t('favorites.loading')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          {t('favorites.title')}
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
              {t('favorites.actions.playAll')}
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
              {t('favorites.actions.shuffle')}
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
            {t('favorites.empty.title')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('favorites.empty.description')}
          </Typography>
        </Box>
      ) : (
        <TrackTable
          items={favorites}
          rowKey={(audio) => audio.id}
          describe={(audio) => ({
            key: audio.youtube_id,
            title: audio.title,
            subtitle: audio.artist || audio.channel_name,
            artworkUrl: audio.thumbnail_url,
            duration: formatDuration(audio.duration),
          })}
          onPlay={(audio) => setCurrentAudio(audio, favorites)}
          columns={[
            { id: 'duration', header: t('favorites.columns.duration'), width: 80, align: 'right', showFrom: 'sm', render: (audio) => formatDuration(audio.duration) },
            { id: 'size', header: t('favorites.columns.size'), width: 96, align: 'right', showFrom: 'lg', render: (audio) => formatFileSize(audio.file_size) },
            { id: 'plays', header: t('favorites.columns.plays'), width: 72, align: 'right', showFrom: 'md', render: (audio) => audio.play_count },
          ]}
          actionsWidth={56}
          renderActions={(audio) => (
            <TrackActionsMenu
              track={audio}
              onTrackUpdate={handleTrackUpdate}
              onTrackDeleted={(deletedTrack) => setFavorites(prev => prev.filter(fav => fav.id !== deletedTrack.id))}
            />
          )}
        />
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
