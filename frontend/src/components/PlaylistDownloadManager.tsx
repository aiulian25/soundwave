import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Button,
  LinearProgress,
  Chip,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Divider,
  Collapse,
} from '@mui/material';
import {
  Download as DownloadIcon,
  Pause as PauseIcon,
  PlayArrow as ResumeIcon,
  Cancel as CancelIcon,
  Refresh as RetryIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  CloudDownload as CloudDownloadIcon,
} from '@mui/icons-material';
import api from '../api/client';

interface PlaylistDownload {
  id: number;
  playlist: number;
  playlist_data: {
    id: number;
    title: string;
    thumbnail_url: string;
  };
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'paused';
  total_items: number;
  downloaded_items: number;
  failed_items: number;
  progress_percent: number;
  quality: string;
  created_at: string;
  started_at: string;
  completed_at: string;
  error_message: string;
  is_complete: boolean;
  can_resume: boolean;
}

interface PlaylistDownloadProps {
  playlistId?: number;
}

const PlaylistDownloadManager = ({ playlistId }: PlaylistDownloadProps) => {
  const [downloads, setDownloads] = useState<PlaylistDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState('medium');
  const [expandedItems, setExpandedItems] = useState<{ [key: number]: boolean }>({});

  useEffect(() => {
    loadDownloads();
    // Refresh every 5 seconds for active downloads
    const interval = setInterval(() => {
      loadDownloads(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [playlistId]);

  const loadDownloads = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      
      let url = '/playlist/downloads/';
      if (playlistId) {
        url += `?playlist_id=${playlistId}`;
      }
      
      const response = await api.get(url);
      setDownloads(response.data);
      setError('');
    } catch (err: any) {
      if (!silent) {
        setError(err.response?.data?.detail || 'Failed to load downloads');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const handleStartDownload = async () => {
    if (!playlistId) return;
    
    try {
      const response = await api.post('/playlist/downloads/download_playlist/', {
        playlist_id: playlistId,
        quality: selectedQuality,
      });
      
      setSuccess('Playlist download started');
      setDownloadDialogOpen(false);
      loadDownloads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to start download');
    }
  };

  const handlePause = async (downloadId: number) => {
    try {
      await api.post(`/playlist/downloads/${downloadId}/pause/`);
      setSuccess('Download paused');
      loadDownloads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to pause download');
    }
  };

  const handleResume = async (downloadId: number) => {
    try {
      await api.post(`/playlist/downloads/${downloadId}/resume/`);
      setSuccess('Download resumed');
      loadDownloads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to resume download');
    }
  };

  const handleCancel = async (downloadId: number) => {
    try {
      await api.post(`/playlist/downloads/${downloadId}/cancel/`);
      setSuccess('Download cancelled');
      loadDownloads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to cancel download');
    }
  };

  const handleRetryFailed = async (downloadId: number) => {
    try {
      await api.post(`/playlist/downloads/${downloadId}/retry_failed/`);
      setSuccess('Retrying failed items');
      loadDownloads();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to retry');
    }
  };

  const toggleExpand = (downloadId: number) => {
    setExpandedItems({
      ...expandedItems,
      [downloadId]: !expandedItems[downloadId],
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'downloading':
        return 'primary';
      case 'failed':
        return 'error';
      case 'paused':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusIcon = (status: string): React.ReactElement | undefined => {
    switch (status) {
      case 'completed':
        return <CheckCircleIcon />;
      case 'failed':
        return <ErrorIcon />;
      case 'downloading':
        return <CloudDownloadIcon />;
      default:
        return undefined;
    }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h6">Offline Downloads</Typography>
        {playlistId && (
          <Button
            variant="contained"
            startIcon={<DownloadIcon />}
            onClick={() => setDownloadDialogOpen(true)}
          >
            Download Playlist
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" p={4}>
          <LinearProgress sx={{ width: '100%' }} />
        </Box>
      ) : downloads.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <CloudDownloadIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary">
            No downloads yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Download playlists for offline playback
          </Typography>
        </Paper>
      ) : (
        <List>
          {downloads.map((download) => (
            <Paper key={download.id} sx={{ mb: 2 }}>
              <ListItem>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="subtitle1" fontWeight="bold">
                        {download.playlist_data.title}
                      </Typography>
                      <Chip
                        label={download.status.toUpperCase()}
                        color={getStatusColor(download.status)}
                        size="small"
                        icon={getStatusIcon(download.status)}
                      />
                      <Chip
                        label={download.quality.toUpperCase()}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                  }
                  secondary={
                    <Box mt={1}>
                      <Box display="flex" justifyContent="space-between" mb={0.5}>
                        <Typography variant="body2">
                          {download.downloaded_items} / {download.total_items} items
                          {download.failed_items > 0 && (
                            <span style={{ color: '#f44336' }}>
                              {' '}
                              ({download.failed_items} failed)
                            </span>
                          )}
                        </Typography>
                        <Typography variant="body2">
                          {download.progress_percent.toFixed(1)}%
                        </Typography>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={download.progress_percent}
                        color={download.status === 'failed' ? 'error' : 'primary'}
                      />
                      {download.error_message && (
                        <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                          Error: {download.error_message}
                        </Typography>
                      )}
                    </Box>
                  }
                />
                <Box display="flex" gap={1}>
                  {download.status === 'downloading' && (
                    <IconButton onClick={() => handlePause(download.id)} color="warning">
                      <PauseIcon />
                    </IconButton>
                  )}
                  {download.can_resume && (
                    <IconButton onClick={() => handleResume(download.id)} color="primary">
                      <ResumeIcon />
                    </IconButton>
                  )}
                  {download.failed_items > 0 && (
                    <IconButton onClick={() => handleRetryFailed(download.id)} color="primary">
                      <RetryIcon />
                    </IconButton>
                  )}
                  {!download.is_complete && download.status !== 'failed' && (
                    <IconButton onClick={() => handleCancel(download.id)} color="error">
                      <CancelIcon />
                    </IconButton>
                  )}
                  <IconButton onClick={() => toggleExpand(download.id)}>
                    <ExpandMoreIcon
                      sx={{
                        transform: expandedItems[download.id] ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: '0.3s',
                      }}
                    />
                  </IconButton>
                </Box>
              </ListItem>
              <Collapse in={expandedItems[download.id]}>
                <Divider />
                <Box p={2}>
                  <Typography variant="body2" color="text.secondary">
                    Started: {download.started_at ? new Date(download.started_at).toLocaleString() : 'Not started'}
                  </Typography>
                  {download.completed_at && (
                    <Typography variant="body2" color="text.secondary">
                      Completed: {new Date(download.completed_at).toLocaleString()}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    Quality: {download.quality}
                  </Typography>
                </Box>
              </Collapse>
            </Paper>
          ))}
        </List>
      )}

      {/* Download Dialog */}
      <Dialog open={downloadDialogOpen} onClose={() => setDownloadDialogOpen(false)}>
        <DialogTitle>Download Playlist for Offline Playback</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, minWidth: 300 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select the quality for downloaded audio files. Higher quality requires more storage.
            </Typography>
            <FormControl fullWidth>
              <InputLabel>Quality</InputLabel>
              <Select
                value={selectedQuality}
                onChange={(e) => setSelectedQuality(e.target.value)}
                label="Quality"
              >
                <MenuItem value="low">
                  <Box>
                    <Typography>Low (64 kbps)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Saves storage, lower quality
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="medium">
                  <Box>
                    <Typography>Medium (128 kbps)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Balanced quality and size
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="high">
                  <Box>
                    <Typography>High (256 kbps)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      High quality, larger files
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="ultra">
                  <Box>
                    <Typography>Ultra (320 kbps)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Maximum quality, largest files
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDownloadDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleStartDownload} variant="contained" startIcon={<DownloadIcon />}>
            Start Download
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PlaylistDownloadManager;
