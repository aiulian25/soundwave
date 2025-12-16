import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  CardActions,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Avatar,
  Chip,
  IconButton,
  Alert,
  LinearProgress,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  YouTube as YouTubeIcon,
} from '@mui/icons-material';
import { channelAPI } from '../api/client';

interface Channel {
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
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [channelUrl, setChannelUrl] = useState('');
  const [error, setError] = useState('');

  const loadChannels = async () => {
    try {
      const response = await channelAPI.list();
      // Handle both array response and paginated object response
      const data = Array.isArray(response.data) ? response.data : (response.data?.results || response.data?.data || []);
      setChannels(data);
    } catch (err) {
      console.error('Failed to load channels:', err);
      setChannels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
  }, []);

  const handleSubscribe = async () => {
    setError('');
    try {
      await channelAPI.subscribe({ url: channelUrl });
      setChannelUrl('');
      setOpenDialog(false);
      loadChannels();
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to subscribe to channel');
    }
  };

  const handleUnsubscribe = async (channelId: string) => {
    if (!confirm('Are you sure you want to unsubscribe from this channel?')) return;
    
    try {
      await channelAPI.unsubscribe(channelId);
      loadChannels();
    } catch (err) {
      console.error('Failed to unsubscribe:', err);
    }
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

  const getLastRefreshText = (lastRefresh: string) => {
    const date = new Date(lastRefresh);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" fontWeight="bold">
          YouTube Channels
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setOpenDialog(true)}
        >
          Subscribe to Channel
        </Button>
      </Box>

      {/* Channels Grid */}
      <Grid container spacing={2}>
        {channels.map((channel) => (
          <Grid item xs={12} sm={6} md={4} key={channel.id}>
            <Card>
              
              <CardContent>
                {/* Channel Avatar & Name */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, mt: channel.channel_thumbnail ? -3 : 0 }}>
                  <Avatar
                    src={channel.channel_thumbnail}
                    sx={{
                      width: 64,
                      height: 64,
                      border: '3px solid',
                      borderColor: 'background.paper',
                      boxShadow: 2,
                    }}
                  >
                    <YouTubeIcon />
                  </Avatar>
                  <Box sx={{ ml: 1.5, flex: 1 }}>
                    <Typography variant="subtitle1" fontWeight="bold" noWrap>
                      {channel.channel_name}
                    </Typography>
                  </Box>
                </Box>

                {/* Status Badges */}
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 0.5 }}>
                  <Chip
                    label={channel.status_display}
                    color={getStatusColor(channel.sync_status)}
                    size="small"
                  />
                  {!channel.active && (
                    <Chip label="Inactive" color="error" size="small" variant="outlined" />
                  )}
                </Box>

                {/* Last Refresh */}
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
                  {getLastRefreshText(channel.last_refreshed)}
                </Typography>

                {/* Error Message */}
                {channel.error_message && (
                  <Alert severity="error" sx={{ mt: 1, mb: 1, py: 0 }}>
                    <Typography variant="caption">{channel.error_message}</Typography>
                  </Alert>
                )}

                {/* Stats */}
                <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      Subscribers
                    </Typography>
                    <Typography variant="body2" fontWeight="bold" sx={{ fontSize: '0.8125rem' }}>
                      {formatNumber(channel.subscriber_count)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Videos
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {formatNumber(channel.video_count)}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Downloaded
                    </Typography>
                    <Typography variant="body2" fontWeight="bold">
                      {channel.downloaded_count} ({channel.progress_percent}%)
                    </Typography>
                  </Box>
                </Box>
              </CardContent>

              <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
                <IconButton size="small" title="Refresh channel">
                  <RefreshIcon />
                </IconButton>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleUnsubscribe(channel.channel_id)}
                  title="Unsubscribe"
                >
                  <DeleteIcon />
                </IconButton>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Empty State */}
      {!loading && channels.length === 0 && (
        <Box
          sx={{
            textAlign: 'center',
            py: 8,
            color: 'text.secondary',
          }}
        >
          <YouTubeIcon sx={{ fontSize: 64, mb: 2, opacity: 0.3 }} />
          <Typography variant="h6" gutterBottom>
            No channels subscribed
          </Typography>
          <Typography variant="body2" sx={{ mb: 3 }}>
            Subscribe to YouTube channels to automatically download their content
          </Typography>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setOpenDialog(true)}
          >
            Subscribe to Channel
          </Button>
        </Box>
      )}

      {/* Subscribe Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Subscribe to YouTube Channel</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="dense"
            label="Channel URL"
            placeholder="https://www.youtube.com/@channelname or channel ID"
            fullWidth
            value={channelUrl}
            onChange={(e) => setChannelUrl(e.target.value)}
            helperText="Enter a YouTube channel URL or channel ID"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>Cancel</Button>
          <Button onClick={handleSubscribe} variant="contained" disabled={!channelUrl}>
            Subscribe
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
