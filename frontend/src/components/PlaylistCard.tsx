/**
 * Modern Playlist Card Component
 * Beautiful card design with hover effects, progress indicator, and status badges
 */

import { Box, Typography, Chip, IconButton, LinearProgress, CircularProgress, Tooltip } from '@mui/material';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MusicNoteIcon from '@mui/icons-material/MusicNote';

interface PlaylistCardProps {
  playlist: {
    id: number;
    playlist_id: string;
    title: string;
    channel_name: string;
    thumbnail_url: string;
    item_count: number;
    downloaded_count: number;
    sync_status: string;
    last_refresh: string | null;
  };
  isOffline?: boolean;
  isOnline?: boolean;
  isSyncing?: boolean;
  onSync?: () => void;
  onDelete?: () => void;
  onClick?: () => void;
}

export default function PlaylistCard({
  playlist,
  isOffline = false,
  isOnline = true,
  isSyncing = false,
  onSync,
  onDelete,
  onClick,
}: PlaylistCardProps) {
  const progress = playlist.item_count > 0 
    ? Math.round((playlist.downloaded_count / playlist.item_count) * 100) 
    : 0;

  const getLastRefreshText = (lastRefresh: string | null) => {
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
      onClick={onClick}
      sx={{
        width: '100%',
        minWidth: 0,
        maxWidth: 280,
        borderRadius: 3,
        overflow: 'hidden',
        bgcolor: 'background.paper',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        position: 'relative',
        '&:hover': {
          transform: 'translateY(-8px) scale(1.02)',
          boxShadow: (theme) => `0 20px 40px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.15)'}`,
          '& .playlist-overlay': {
            opacity: 1,
          },
          '& .playlist-play-btn': {
            opacity: 1,
            transform: 'scale(1)',
          },
        },
      }}
    >
      {/* Thumbnail */}
      <Box
        sx={{
          height: 0,
          paddingBottom: '100%', // 1:1 aspect ratio
          width: '100%',
          position: 'relative',
          backgroundImage: playlist.thumbnail_url ? `url(${playlist.thumbnail_url})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          bgcolor: 'grey.900',
        }}
      >
        {/* Fallback Icon */}
        {!playlist.thumbnail_url && (
          <Box sx={{ 
            position: 'absolute', 
            inset: 0, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          }}>
            <PlaylistPlayIcon sx={{ fontSize: 64, color: 'white', opacity: 0.8 }} />
          </Box>
        )}

        {/* Hover Overlay */}
        <Box
          className="playlist-overlay"
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.1) 100%)',
            opacity: 0,
            transition: 'opacity 0.3s ease',
          }}
        />

        {/* Play Button on Hover */}
        <Box
          className="playlist-play-btn"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) scale(0.8)',
            opacity: 0,
            transition: 'all 0.3s ease',
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              bgcolor: 'primary.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
            }}
          >
            <PlayArrowIcon sx={{ fontSize: 32, color: 'white' }} />
          </Box>
        </Box>

        {/* Track Count Badge */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(4px)',
            borderRadius: 1.5,
            px: 1,
            py: 0.5,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          <MusicNoteIcon sx={{ fontSize: 14, color: 'white' }} />
          <Typography variant="caption" sx={{ color: 'white', fontWeight: 600 }}>
            {playlist.downloaded_count}/{playlist.item_count}
          </Typography>
        </Box>

        {/* Offline Badge */}
        {isOffline && (
          <Chip
            icon={<CloudDoneIcon sx={{ fontSize: 14 }} />}
            label="Offline"
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              height: 24,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: 'success.main',
              color: 'white',
              '& .MuiChip-icon': { color: 'white' },
            }}
          />
        )}

        {/* Unavailable Badge (offline mode, not cached) */}
        {!isOnline && !isOffline && (
          <Chip
            icon={<WifiOffIcon sx={{ fontSize: 14 }} />}
            label="Unavailable"
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              height: 24,
              fontSize: '0.7rem',
              fontWeight: 600,
              bgcolor: 'rgba(0, 0, 0, 0.7)',
              color: 'warning.main',
              '& .MuiChip-icon': { color: 'warning.main' },
            }}
          />
        )}
      </Box>

      {/* Content */}
      <Box sx={{ p: 2 }}>
        {/* Title */}
        <Typography 
          variant="subtitle2" 
          fontWeight={600} 
          noWrap 
          sx={{ 
            mb: 0.5,
            lineHeight: 1.3,
          }}
        >
          {playlist.title}
        </Typography>

        {/* Channel Name */}
        <Typography 
          variant="caption" 
          color="text.secondary" 
          noWrap 
          sx={{ 
            display: 'block',
            mb: 1.5,
          }}
        >
          {playlist.channel_name}
        </Typography>

        {/* Progress Bar */}
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              {getLastRefreshText(playlist.last_refresh)}
            </Typography>
            <Typography variant="caption" color="primary.main" fontWeight={600} sx={{ fontSize: '0.7rem' }}>
              {progress}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progress}
            sx={{
              height: 4,
              borderRadius: 2,
              bgcolor: 'rgba(255,255,255,0.1)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 2,
                background: progress === 100 
                  ? 'linear-gradient(90deg, #00C853, #69F0AE)' 
                  : 'linear-gradient(90deg, #667eea, #764ba2)',
              },
            }}
          />
        </Box>

        {/* Actions */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Tooltip title={isSyncing ? 'Syncing...' : 'Sync playlist'}>
            <span>
              <IconButton
                size="small"
                color="primary"
                onClick={(e) => { e.stopPropagation(); onSync?.(); }}
                disabled={isSyncing}
                sx={{
                  bgcolor: 'rgba(102, 126, 234, 0.1)',
                  '&:hover': { bgcolor: 'rgba(102, 126, 234, 0.2)' },
                }}
              >
                {isSyncing ? (
                  <CircularProgress size={18} color="inherit" />
                ) : (
                  <SyncIcon sx={{ fontSize: 18 }} />
                )}
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title="Remove playlist">
            <IconButton
              size="small"
              color="error"
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              sx={{
                bgcolor: 'rgba(244, 67, 54, 0.1)',
                '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.2)' },
              }}
            >
              <DeleteIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );
}
