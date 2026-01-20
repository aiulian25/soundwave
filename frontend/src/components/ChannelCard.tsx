/**
 * Modern Channel Card Component
 * Beautiful card design with avatar, stats, and status indicators
 */

import { Box, Typography, Chip, IconButton, Avatar, LinearProgress, Tooltip, Alert } from '@mui/material';
import YouTubeIcon from '@mui/icons-material/YouTube';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank';
import SubscriptionsIcon from '@mui/icons-material/Subscriptions';
import VideoLibraryIcon from '@mui/icons-material/VideoLibrary';
import DownloadDoneIcon from '@mui/icons-material/DownloadDone';

interface ChannelCardProps {
  channel: {
    id: number;
    channel_id: string;
    channel_name: string;
    channel_thumbnail: string;
    subscribed: boolean;
    video_count: number;
    subscriber_count: number;
    downloaded_count: number;
    last_refreshed: string;
    sync_status: string;
    status_display: string;
    error_message: string;
    active: boolean;
    progress_percent: number;
  };
  selectionMode?: boolean;
  isSelected?: boolean;
  onSync?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
  onToggleSelect?: () => void;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
};

export default function ChannelCard({
  channel,
  selectionMode = false,
  isSelected = false,
  onSync,
  onDelete,
  onClick,
  onToggleSelect,
}: ChannelCardProps) {
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
    if (!lastRefresh) return 'Never synced';
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
    <Box
      onClick={() => {
        if (selectionMode) {
          onToggleSelect?.();
        } else {
          onClick?.();
        }
      }}
      sx={{
        width: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        border: isSelected ? '2px solid' : '2px solid transparent',
        borderColor: isSelected ? 'primary.main' : 'transparent',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: (theme) => `0 12px 24px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.12)'}`,
          '& .channel-overlay': {
            opacity: 1,
          },
          '& .channel-play-btn': {
            opacity: 1,
            transform: 'scale(1)',
          },
        },
      }}
    >
      {/* Header with gradient background */}
      <Box
        sx={{
          height: 100,
          background: channel.channel_thumbnail 
            ? `linear-gradient(135deg, rgba(102, 126, 234, 0.8), rgba(118, 75, 162, 0.8)), url(${channel.channel_thumbnail})`
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          position: 'relative',
        }}
      >
        {/* Hover Overlay */}
        <Box
          className="channel-overlay"
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            opacity: 0,
            transition: 'opacity 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Box
            className="channel-play-btn"
            sx={{
              transform: 'scale(0.8)',
              opacity: 0,
              transition: 'all 0.3s ease',
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                bgcolor: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 28, color: 'primary.main' }} />
            </Box>
          </Box>
        </Box>

        {/* Selection Checkbox */}
        {selectionMode && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 2,
              bgcolor: 'background.paper',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 2,
            }}
          >
            {isSelected ? (
              <CheckBoxIcon color="primary" />
            ) : (
              <CheckBoxOutlineBlankIcon color="action" />
            )}
          </Box>
        )}

        {/* Status Badge */}
        <Box sx={{ position: 'absolute', top: 8, left: 8 }}>
          <Chip
            label={channel.status_display}
            color={getStatusColor(channel.sync_status)}
            size="small"
            sx={{
              height: 24,
              fontSize: '0.7rem',
              fontWeight: 600,
              backdropFilter: 'blur(4px)',
            }}
          />
        </Box>
      </Box>

      {/* Avatar - positioned to overlap header and content */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          mt: -5,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <Avatar
          src={channel.channel_thumbnail}
          sx={{
            width: 80,
            height: 80,
            border: '4px solid',
            borderColor: 'background.paper',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            bgcolor: 'primary.main',
          }}
        >
          <YouTubeIcon sx={{ fontSize: 40 }} />
        </Avatar>
      </Box>

      {/* Content */}
      <Box sx={{ p: 2, pt: 1.5 }}>
        {/* Channel Name */}
        <Typography
          variant="subtitle1"
          fontWeight={700}
          textAlign="center"
          noWrap
          sx={{ mb: 0.5 }}
        >
          {channel.channel_name}
        </Typography>

        {/* Last Refresh */}
        <Typography
          variant="caption"
          color="text.secondary"
          textAlign="center"
          display="block"
          sx={{ mb: 2 }}
        >
          Updated {getLastRefreshText(channel.last_refreshed)}
        </Typography>

        {/* Error Message */}
        {channel.error_message && (
          <Alert severity="error" sx={{ mb: 2, py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
            {channel.error_message}
          </Alert>
        )}

        {/* Stats Grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1,
            mb: 2,
            p: 1.5,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            borderRadius: 2,
          }}
        >
          <Box sx={{ textAlign: 'center' }}>
            <SubscriptionsIcon sx={{ fontSize: 20, color: 'text.secondary', mb: 0.5 }} />
            <Typography variant="body2" fontWeight={700}>
              {formatNumber(channel.subscriber_count)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              Subs
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <VideoLibraryIcon sx={{ fontSize: 20, color: 'text.secondary', mb: 0.5 }} />
            <Typography variant="body2" fontWeight={700}>
              {formatNumber(channel.video_count)}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              Videos
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <DownloadDoneIcon sx={{ fontSize: 20, color: 'primary.main', mb: 0.5 }} />
            <Typography variant="body2" fontWeight={700} color="primary.main">
              {channel.downloaded_count}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              Downloaded
            </Typography>
          </Box>
        </Box>

        {/* Progress Bar */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Download progress
            </Typography>
            <Typography variant="caption" color="primary.main" fontWeight={600}>
              {channel.progress_percent}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={channel.progress_percent}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.1)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 3,
                background: channel.progress_percent === 100
                  ? 'linear-gradient(90deg, #00C853, #69F0AE)'
                  : 'linear-gradient(90deg, #667eea, #764ba2)',
              },
            }}
          />
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
          <Tooltip title="Sync channel">
            <IconButton
              size="small"
              color="primary"
              onClick={(e) => { e.stopPropagation(); onSync?.(); }}
              disabled={channel.sync_status === 'syncing'}
              sx={{
                bgcolor: 'rgba(102, 126, 234, 0.1)',
                '&:hover': { bgcolor: 'rgba(102, 126, 234, 0.2)' },
              }}
            >
              <SyncIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>

          <Tooltip title="Remove channel">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              sx={{
                bgcolor: 'rgba(244, 67, 54, 0.1)',
                '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.2)' },
              }}
            >
              <DeleteIcon sx={{ fontSize: 20 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Inactive Badge */}
        {!channel.active && (
          <Box sx={{ mt: 1.5, textAlign: 'center' }}>
            <Chip 
              label="Inactive" 
              color="error" 
              size="small" 
              variant="outlined"
              sx={{ fontSize: '0.7rem' }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
