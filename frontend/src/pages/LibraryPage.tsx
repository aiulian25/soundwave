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
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import { useEffect, useState } from 'react';
import { audioAPI } from '../api/client';
import type { Audio } from '../types';

interface LibraryPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function LibraryPage({ setCurrentAudio }: LibraryPageProps) {
  const [audioList, setAudioList] = useState<Audio[]>([]);
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    loadAudio();
  }, []);

  const loadAudio = async () => {
    try {
      const response = await audioAPI.list();
      const data = response.data?.data || response.data || [];
      setAudioList(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load audio:', error);
      setAudioList([]);
    }
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

  const handlePlayAll = () => {
    if (audioList.length === 0) {
      setSnackbarMessage('No tracks in library');
      setSnackbarOpen(true);
      return;
    }
    
    setCurrentAudio(audioList[0], audioList);
    setSnackbarMessage(`Playing ${audioList.length} tracks`);
    setSnackbarOpen(true);
  };

  const handleShuffle = () => {
    if (audioList.length === 0) {
      setSnackbarMessage('No tracks to shuffle');
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
    setSnackbarMessage(`Shuffled ${shuffled.length} tracks`);
    setSnackbarOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          Library
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
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Play All</Box>
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
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Shuffle</Box>
          </Button>
        </Box>
      </Box>

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
              <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Channel</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Duration</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Size</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600 }}>Plays</TableCell>
              <TableCell align="center" width={100} sx={{ fontWeight: 600 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {audioList.map((audio, index) => (
              <TableRow
                key={audio.id}
                sx={{ 
                  cursor: 'pointer',
                  transition: 'background-color 0.3s ease',
                  '&:hover': {
                    bgcolor: 'rgba(19, 236, 106, 0.05)',
                  },
                }}
                onClick={() => setCurrentAudio(audio)}
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
                  >
                    <PlayArrowIcon />
                  </IconButton>
                  <IconButton 
                    size="small"
                    sx={{
                      '&:hover': {
                        color: 'primary.main',
                        bgcolor: 'rgba(19, 236, 106, 0.1)',
                      },
                    }}
                  >
                    <FavoriteBorderIcon />
                  </IconButton>
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
    </Box>
  );
}
