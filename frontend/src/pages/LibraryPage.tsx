import {
  Box,
  Typography,
  IconButton,
  Button,
  Snackbar,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../utils/formatDuration';
import { fetchAllAudio } from '../utils/fetchAll';
import ScrollToTop from '../components/ScrollToTop';
import TrackActionsMenu from '../components/TrackActionsMenu';
import TrackTable from '../components/TrackTable';
import type { Audio } from '../types';

interface LibraryPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function LibraryPage({ setCurrentAudio }: LibraryPageProps) {
  const { t } = useTranslation();
  const [audioList, setAudioList] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  const loadAudio = useCallback(async () => {
    setLoading(true);
    try {
      const allAudioData = await fetchAllAudio();
      setAudioList(allAudioData);
    } catch (error) {
      console.error('Failed to load audio:', error);
      setAudioList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload audio when navigating to this page
  useEffect(() => {
    loadAudio();
  }, [location.key, loadAudio]);


  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const handlePlayAll = () => {
    if (audioList.length === 0) {
      setSnackbarMessage(t('library.errors.noTracks'));
      setSnackbarOpen(true);
      return;
    }
    
    setCurrentAudio(audioList[0], audioList);
    setSnackbarMessage(t('library.messages.playingTracks', { count: audioList.length }));
    setSnackbarOpen(true);
  };

  const handleShuffle = () => {
    if (audioList.length === 0) {
      setSnackbarMessage(t('library.errors.noTracksToShuffle'));
      setSnackbarOpen(true);
      return;
    }
    
    // Shuffle array using Fisher-Yates algorithm
    const shuffled = [...audioList];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    setCurrentAudio(shuffled[0], shuffled);
    setSnackbarMessage(t('library.messages.shuffledTracks', { count: shuffled.length }));
    setSnackbarOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          {t('library.title')}
        </Typography>
        
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={handlePlayAll}
            disabled={audioList.length === 0}
            sx={{
              minWidth: { xs: '48px', sm: '120px' },
              bgcolor: 'primary.main',
              color: 'background.dark',
              fontWeight: 600,
              '&:hover': { bgcolor: 'primary.dark' },
              '&:disabled': { bgcolor: 'rgba(255, 255, 255, 0.1)' },
            }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('library.actions.playAll')}</Box>
          </Button>
          <Button
            variant="outlined"
            startIcon={<ShuffleIcon />}
            onClick={handleShuffle}
            disabled={audioList.length === 0}
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
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{t('library.actions.shuffle')}</Box>
          </Button>
          <IconButton
            onClick={loadAudio}
            disabled={loading}
            sx={{
              color: 'text.secondary',
              '&:hover': { color: 'primary.main' },
            }}
            title={t('library.actions.refresh')}
          >
            <RefreshIcon sx={{ animation: loading ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />
          </IconButton>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('library.trackCount', { count: audioList.length })}
      </Typography>

      <TrackTable
        items={audioList}
        rowKey={(audio) => audio.id}
        describe={(audio) => ({
          key: audio.youtube_id,
          title: audio.title,
          subtitle: audio.artist || audio.channel_name,
          artworkUrl: audio.thumbnail_url,
          duration: formatDuration(audio.duration),
        })}
        onPlay={(audio) => setCurrentAudio(audio, audioList)}
        columns={[
          { id: 'duration', header: t('library.columns.duration'), width: 80, align: 'right', showFrom: 'sm', render: (audio) => formatDuration(audio.duration) },
          { id: 'size', header: t('library.columns.size'), width: 96, align: 'right', showFrom: 'lg', render: (audio) => formatFileSize(audio.file_size) },
          { id: 'plays', header: t('library.columns.plays'), width: 72, align: 'right', showFrom: 'md', render: (audio) => audio.play_count },
        ]}
        actionsWidth={56}
        renderActions={(audio) => (
          <TrackActionsMenu
            track={audio}
            onTrackUpdate={(updatedTrack) => {
              setAudioList(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
            }}
          />
        )}
      />

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
