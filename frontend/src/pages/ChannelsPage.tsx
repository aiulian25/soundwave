import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  YouTube as YouTubeIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxOutlineBlankIcon,
  DeleteSweep as DeleteSweepIcon,
  RestartAlt as ResetIcon,
} from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { channelAPI } from '../api/client';
import { fetchAllChannels } from '../utils/fetchAll';
import { useSettings } from '../context/SettingsContext';
import ScrollToTop from '../components/ScrollToTop';
import ChannelCard from '../components/ChannelCard';
import SortableItem from '../components/SortableItem';
import { useSortableItems } from '../hooks/useSortableItems';

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
  const navigate = useNavigate();
  const { getExtraSetting, updateExtraSetting } = useSettings();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [channelUrl, setChannelUrl] = useState('');
  const [error, setError] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingTasks, setPendingTasks] = useState<string[]>([]);

  // Drag and drop sorting with backend persistence
  const getChannelId = useCallback((channel: Channel) => channel.channel_id, []);
  const { sortedItems: sortedChannels, handleDragEnd, resetOrder, hasCustomOrder } = useSortableItems({
    items: channels,
    storageKey: 'soundwave-channel-order',
    getItemId: getChannelId,
    getExtraSetting,
    updateExtraSetting,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const loadChannels = async () => {
    try {
      const data = await fetchAllChannels();
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
    
    // Auto-refresh channels every 10 seconds if there are pending tasks
    const interval = setInterval(() => {
      if (pendingTasks.length > 0) {
        loadChannels();
      }
    }, 10000);
    
    return () => clearInterval(interval);
  }, [pendingTasks]);

  const handleSubscribe = async () => {
    setError('');
    setSubscribing(true);
    try {
      const response = await channelAPI.subscribe({ url: channelUrl });
      const taskId = response.data?.task_id;
      const message = response.data?.message || 'Channel subscription started';
      
      // Extract channel name from URL for better UX
      const urlMatch = channelUrl.match(/@([^/?]+)/);
      const channelName = urlMatch ? `@${urlMatch[1]}` : 'channel';
      
      setSuccessMessage(`✓ Subscribing to ${channelName}... Downloading channel info and videos in background.`);
      setChannelUrl('');
      setOpenDialog(false);
      
      // Add task to pending list
      if (taskId) {
        setPendingTasks(prev => [...prev, taskId]);
      }
      
      // Reload channels after a short delay to show the new channel
      setTimeout(() => {
        loadChannels();
      }, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.response?.data?.detail || 'Failed to subscribe to channel');
    } finally {
      setSubscribing(false);
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

  const handleBulkDelete = async () => {
    if (selectedChannels.size === 0) return;
    
    if (!confirm(`Are you sure you want to unsubscribe from ${selectedChannels.size} channel(s)?`)) return;
    
    try {
      // Delete all selected channels
      await Promise.all(
        Array.from(selectedChannels).map(channelId => channelAPI.unsubscribe(channelId))
      );
      setSelectedChannels(new Set());
      setSelectionMode(false);
      loadChannels();
    } catch (err) {
      console.error('Failed to bulk delete:', err);
    }
  };

  const toggleChannelSelection = (channelId: string) => {
    const newSelection = new Set(selectedChannels);
    if (newSelection.has(channelId)) {
      newSelection.delete(channelId);
    } else {
      newSelection.add(channelId);
    }
    setSelectedChannels(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedChannels.size === channels.length) {
      setSelectedChannels(new Set());
    } else {
      setSelectedChannels(new Set(channels.map(c => c.channel_id)));
    }
  };

  const toggleSelectionMode = () => {
    setSelectionMode(!selectionMode);
    setSelectedChannels(new Set());
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h4" fontWeight="bold">
            YouTube Channels
          </Typography>
          {hasCustomOrder && (
            <Tooltip title="Reset to default order">
              <IconButton size="small" onClick={resetOrder} sx={{ opacity: 0.7 }}>
                <ResetIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {channels.length > 0 && (
            <Button
              variant={selectionMode ? "contained" : "outlined"}
              size="small"
              startIcon={selectionMode ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
              onClick={toggleSelectionMode}
              color={selectionMode ? "primary" : "inherit"}
            >
              {selectionMode ? 'Cancel' : 'Select'}
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setOpenDialog(true)}
          >
            Subscribe to Channel
          </Button>
        </Box>
      </Box>

      {/* Active Tasks Status */}
      {pendingTasks.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2">
              📡 Processing {pendingTasks.length} channel subscription{pendingTasks.length > 1 ? 's' : ''}...
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Downloading channel info and videos in background
            </Typography>
          </Box>
        </Alert>
      )}

      {/* Bulk Actions Bar */}
      {selectionMode && (
        <Box sx={{ 
          mb: 2, 
          p: 2, 
          bgcolor: 'primary.main', 
          color: 'primary.contrastText',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={toggleSelectAll}
              sx={{ 
                color: 'inherit', 
                borderColor: 'currentColor',
                '&:hover': {
                  borderColor: 'currentColor',
                  bgcolor: 'rgba(255,255,255,0.1)',
                }
              }}
            >
              {selectedChannels.size === channels.length ? 'Deselect All' : 'Select All'}
            </Button>
            <Typography variant="body2">
              {selectedChannels.size} of {channels.length} selected
            </Typography>
          </Box>
          <Button
            variant="contained"
            color="error"
            size="small"
            startIcon={<DeleteSweepIcon />}
            onClick={handleBulkDelete}
            disabled={selectedChannels.size === 0}
          >
            Delete Selected
          </Button>
        </Box>
      )}

      {/* Channels Grid with Drag and Drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sortedChannels.map(c => c.channel_id)}
          strategy={rectSortingStrategy}
        >
          <Grid container spacing={3}>
            {sortedChannels.map((channel) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={channel.channel_id}>
                <SortableItem id={channel.channel_id} disabled={selectionMode}>
                  <ChannelCard
                    channel={channel}
                    selectionMode={selectionMode}
                    isSelected={selectedChannels.has(channel.channel_id)}
                    onDelete={() => handleUnsubscribe(channel.channel_id)}
                    onClick={() => navigate(`/channels/${channel.channel_id}`)}
                    onToggleSelect={() => toggleChannelSelection(channel.channel_id)}
                  />
                </SortableItem>
              </Grid>
            ))}
          </Grid>
        </SortableContext>
      </DndContext>

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
          <Button onClick={() => setOpenDialog(false)} disabled={subscribing}>Cancel</Button>
          <Button 
            onClick={handleSubscribe} 
            variant="contained" 
            disabled={!channelUrl || subscribing}
          >
            {subscribing ? 'Subscribing...' : 'Subscribe'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success Snackbar */}
      <Snackbar
        open={!!successMessage}
        autoHideDuration={6000}
        onClose={() => setSuccessMessage('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSuccessMessage('')} 
          severity="success" 
          sx={{ width: '100%' }}
        >
          {successMessage}
        </Alert>
      </Snackbar>
      
      <ScrollToTop />
    </Box>
  );
}
