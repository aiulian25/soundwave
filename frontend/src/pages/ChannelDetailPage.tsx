import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Alert,
  Chip,
  Button,
  Snackbar,
  Tooltip,
  Card,
  Avatar,
  Paper,
} from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  ArrowBack as BackIcon,
  Download as DownloadIcon,
  Shuffle as ShuffleIcon,
  YouTube as YouTubeIcon,
  PlaylistPlay as PlayAllIcon,
  Favorite as FavoriteIcon,
  FavoriteBorder as FavoriteBorderIcon,
} from '@mui/icons-material';
import { useParams, useNavigate } from 'react-router-dom';
import { channelAPI, audioAPI } from '../api/client';
import type { Audio } from '../types';

interface ChannelDetail {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_thumbnail: string;
  subscribed: boolean;
  video_count: number;
  subscriber_count: number;
  downloaded_count: number;
  last_refreshed: string;
  sync_status: 'pending' | 'syncing' | 'success' | 'failed' | 'stale';
  status_display: string;
  error_message: string;
  active: boolean;
  progress_percent: number;
  audio_files?: Audio[];
  audio_count?: number;
}

interface ChannelDetailPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function ChannelDetailPage({ setCurrentAudio }: ChannelDetailPageProps) {
  const { channelId } = useParams<{ channelId: string }>();
  const navigate = useNavigate();
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState('');

  useEffect(() => {
    if (channelId) {
      loadChannel();
    }
  }, [channelId]);

  const loadChannel = async () => {
    try {
      setLoading(true);
      const response = await channelAPI.get(channelId!);
      setChannel(response.data);
      setError('');
    } catch (err: any) {
      console.error('Failed to load channel:', err);
      setError(err.response?.data?.detail || 'Failed to load channel');
    } finally {
      setLoading(false);
    }
  };

  const handlePlayTrack = (audio: Audio) => {
    if (channel?.audio_files) {
      // Set up the entire channel as the play queue
      setCurrentAudio(audio, channel.audio_files);
    } else {
      setCurrentAudio(audio);
    }
  };

  const handlePlayAll = () => {
    if (channel?.audio_files && channel.audio_files.length > 0) {
      setCurrentAudio(channel.audio_files[0], channel.audio_files);
      setSnackbarMessage(`Playing all ${channel.audio_files.length} tracks from ${channel.channel_name}`);
      setSnackbarOpen(true);
    }
  };

  const handlePlayShuffled = () => {
    if (channel?.audio_files && channel.audio_files.length > 0) {
      // Create shuffled copy of the audio files
      const shuffled = [...channel.audio_files].sort(() => Math.random() - 0.5);
      setCurrentAudio(shuffled[0], shuffled);
      setSnackbarMessage(`Shuffling ${channel.audio_files.length} tracks from ${channel.channel_name}`);
      setSnackbarOpen(true);
    }
  };

  const handleDownloadAll = async () => {
    if (!channel?.audio_files) return;
    const downloadableTracks = channel.audio_files.filter(audio => audio.file_path && audio.youtube_id);
    
    if (downloadableTracks.length === 0) {
      setSnackbarMessage('No downloaded tracks to save');
      setSnackbarOpen(true);
      return;
    }
    
    setSnackbarMessage(`Downloading ${downloadableTracks.length} tracks to your device`);
    setSnackbarOpen(true);
    
    // Download each track with authentication
    for (const audio of downloadableTracks) {
      try {
        const blob = await audioAPI.downloadFile(audio.youtube_id!);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = audio.title || 'audio';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        
        // Stagger downloads to prevent browser blocking
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Failed to download ${audio.title}:`, err);
      }
    }
  };

  const handleToggleFavorite = async (audio: Audio) => {
    if (!audio.youtube_id) return;
    
    try {
      const response = await audioAPI.toggleFavorite(audio.youtube_id);
      // Update the local state immediately for better UX
      setChannel(prev => {
        if (!prev?.audio_files) return prev;
        return {
          ...prev,
          audio_files: prev.audio_files.map(item => 
            item.id === audio.id 
              ? { ...item, is_favorite: response.data.is_favorite }
              : item
          )
        };
      });
      setSnackbarMessage(audio.is_favorite ? 'Removed from favorites' : 'Added to favorites');
      setSnackbarOpen(true);
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      setSnackbarMessage('Failed to update favorite status');
      setSnackbarOpen(true);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
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

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="50vh">
        <CircularProgress />
      </Box>
    );
  }

  if (error || !channel) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <IconButton onClick={() => navigate('/channels')}>
            <BackIcon />
          </IconButton>
          <Typography variant="h5">Channel Details</Typography>
        </Box>
        <Alert severity="error">{error || 'Channel not found'}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <IconButton onClick={() => navigate('/channels')} sx={{ mr: 1 }}>
          <BackIcon />
        </IconButton>
        <Typography variant="h4" fontWeight="bold">
          Channel Details
        </Typography>
      </Box>

      {/* Channel Info Card */}
      <Card sx={{ mb: 3, p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            src={channel.channel_thumbnail}
            sx={{ width: 80, height: 80 }}
          >
            <YouTubeIcon sx={{ fontSize: 40 }} />
          </Avatar>
          
          <Box sx={{ flex: 1 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>
              {channel.channel_name}
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <Chip
                label={channel.status_display}
                color={getStatusColor(channel.sync_status)}
                size="small"
              />
              <Chip 
                label={`${formatNumber(channel.subscriber_count)} subscribers`} 
                variant="outlined" 
                size="small" 
              />
              <Chip 
                label={`${channel.audio_count || 0} tracks`} 
                variant="outlined" 
                size="small" 
              />
              <Chip 
                label={`${channel.downloaded_count} downloaded`} 
                variant="outlined" 
                size="small" 
              />
            </Box>

            {/* Action Buttons */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {channel.audio_files && channel.audio_files.length > 0 && (
                <>
                  <Button
                    variant="contained"
                    startIcon={<PlayAllIcon />}
                    onClick={handlePlayAll}
                  >
                    Play All
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<ShuffleIcon />}
                    onClick={handlePlayShuffled}
                  >
                    Shuffle
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={handleDownloadAll}
                  >
                    Download All
                  </Button>
                </>
              )}
            </Box>
          </Box>
        </Box>
      </Card>

      {/* Audio Files Table */}
      {channel.audio_files && channel.audio_files.length > 0 ? (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell width={60}>#</TableCell>
                <TableCell>Title</TableCell>
                <TableCell width={120}>Duration</TableCell>
                <TableCell width={120}>Published</TableCell>
                <TableCell width={100}>Plays</TableCell>
                <TableCell width={100}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channel.audio_files.map((audio, index) => (
                <TableRow 
                  key={audio.id}
                  hover
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                  onClick={() => handlePlayTrack(audio)}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
                        {index + 1}
                      </Typography>
                      <IconButton 
                        size="small" 
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayTrack(audio);
                        }}
                      >
                        <PlayIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box
                        component="img"
                        src={audio.thumbnail_url}
                        alt={audio.title}
                        sx={{
                          width: 40,
                          height: 30,
                          objectFit: 'cover',
                          borderRadius: 1,
                        }}
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                      <Box>
                        <Typography variant="body2" fontWeight="medium" noWrap>
                          {audio.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatNumber(audio.view_count || 0)} views
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDuration(audio.duration)}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {audio.published_date ? new Date(audio.published_date).toLocaleDateString() : 'N/A'}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {audio.play_count}
                    </Typography>
                  </TableCell>
                  
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Tooltip title="Download">
                        <IconButton 
                          size="small"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const blob = await audioAPI.downloadFile(audio.youtube_id!);
                              const url = window.URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = audio.title || 'audio';
                              link.click();
                              window.URL.revokeObjectURL(url);
                            } catch (err) {
                              console.error('Download failed:', err);
                            }
                          }}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={audio.is_favorite ? 'Remove from favorites' : 'Add to favorites'}>
                        <IconButton 
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleFavorite(audio);
                          }}
                          sx={{
                            color: audio.is_favorite ? 'error.main' : 'text.disabled',
                            '&:hover': {
                              color: 'error.main',
                            },
                          }}
                        >
                          {audio.is_favorite ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <YouTubeIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No audio files found
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Audio files will appear here once they are downloaded from this channel.
          </Typography>
        </Paper>
      )}

      {/* Success Snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={4000}
        onClose={() => setSnackbarOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbarOpen(false)} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          {snackbarMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
}