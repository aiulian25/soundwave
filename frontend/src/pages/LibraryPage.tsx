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
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { audioAPI } from '../api/client';
import { fetchAllAudio } from '../utils/fetchAll';
import ScrollToTop from '../components/ScrollToTop';
import TrackActionsMenu from '../components/TrackActionsMenu';
import TrackThumbnail from '../components/TrackThumbnail';
import { useHighlightTrack } from '../hooks/useHighlightTrack';
import type { Audio } from '../types';

interface LibraryPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function LibraryPage({ setCurrentAudio }: LibraryPageProps) {
  const { t } = useTranslation();
  const [audioList, setAudioList] = useState<Audio[]>([]);
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const { getTrackRef, shouldHighlight } = useHighlightTrack();
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

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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

      <TableContainer 
        component={Paper} 
        sx={{ 
          bgcolor: 'background.paper',
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'rgba(255, 255, 255, 0.05)',
          '& .MuiTableCell-root': {
            borderColor: 'rgba(255, 255, 255, 0.05)',
          },
        }}
      >
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={50} sx={{ fontWeight: 600 }}>#</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('library.columns.title')}</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>{t('library.columns.channel')}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{t('library.columns.duration')}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{t('library.columns.size')}</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>{t('library.columns.plays')}</TableCell>
              <TableCell align="center" width={100} sx={{ fontWeight: 600 }}>{t('library.columns.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {audioList.map((audio, index) => (
              <TableRow
                key={audio.id}
                ref={getTrackRef(audio.youtube_id)}
                sx={{
                  cursor: 'pointer',
                  // Skip layout/paint for off-screen rows (DOM stays, so refs,
                  // highlight-scroll and the scroll-to-top FAB keep working).
                  contentVisibility: 'auto',
                  containIntrinsicSize: 'auto 64px',
                  transition: 'background-color 0.3s ease',
                  '&:hover': {
                    bgcolor: 'rgba(19, 236, 106, 0.05)',
                  },
                  ...(shouldHighlight(audio.youtube_id) && {
                    bgcolor: 'rgba(19, 236, 106, 0.1)',
                  }),
                }}
                onClick={() => setCurrentAudio(audio, audioList)}
              >
                <TableCell sx={{ color: 'text.secondary' }}>{index + 1}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <TrackThumbnail src={audio.thumbnail_url} alt={audio.title} size={40} />
                    <Typography variant="body2" noWrap sx={{ maxWidth: 300, fontWeight: 500 }}>
                      {audio.title}
                    </Typography>
                  </Box>
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
                  >
                    <PlayArrowIcon />
                  </IconButton>
                  <TrackActionsMenu 
                    track={audio}
                    onTrackUpdate={(updatedTrack) => {
                      setAudioList(prev => prev.map(a => a.id === updatedTrack.id ? updatedTrack : a));
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

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
