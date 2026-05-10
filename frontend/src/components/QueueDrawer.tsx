/**
 * Queue Drawer Component
 * 
 * A slide-out drawer showing the current play queue with:
 * - View of all upcoming tracks
 * - Drag-and-drop reordering
 * - Remove individual tracks
 * - Clear queue option
 * - Currently playing highlight
 */

import React, { useState } from 'react';
import {
  Box,
  Drawer,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Divider,
  Button,
  Tooltip,
  Chip,
  useTheme,
  useMediaQuery,
  alpha,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  DragIndicator as DragIcon,
  PlayArrow as PlayIcon,
  QueueMusic as QueueIcon,
  ClearAll as ClearAllIcon,
  MusicNote as MusicNoteIcon,
  Equalizer as EqualizerIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Audio } from '../types';

interface QueueDrawerProps {
  open: boolean;
  onClose: () => void;
  queue: Audio[];
  currentIndex: number;
  onPlayTrack: (index: number) => void;
  onRemoveTrack: (index: number) => void;
  onReorderTrack: (fromIndex: number, toIndex: number) => void;
  onClearQueue: () => void;
}

// Format duration in MM:SS
const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function QueueDrawer({
  open,
  onClose,
  queue,
  currentIndex,
  onPlayTrack,
  onRemoveTrack,
  onReorderTrack,
  onClearQueue,
}: QueueDrawerProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  
  const upcomingTracks = queue.slice(currentIndex + 1);
  const playedTracks = queue.slice(0, currentIndex);
  const currentTrack = queue[currentIndex];
  
  const handleDragStart = (e: React.DragEvent, index: number) => {
    // Don't allow dragging the current track
    if (index === currentIndex) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };
  
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (index === currentIndex) return;  // Can't drop on current track
    setDragOverIndex(index);
  };
  
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };
  
  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);
    
    if (fromIndex === null || fromIndex === toIndex || toIndex === currentIndex) return;
    
    onReorderTrack(fromIndex, toIndex);
  };
  
  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };
  
  const renderTrackItem = (track: Audio, index: number, isPlayed: boolean = false) => {
    const isCurrentTrack = index === currentIndex;
    const isDragging = index === draggedIndex;
    const isDragOver = index === dragOverIndex;
    const canDrag = !isCurrentTrack;
    
    return (
      <ListItem
        key={`${track.id}-${index}`}
        draggable={canDrag}
        onDragStart={(e) => handleDragStart(e, index)}
        onDragOver={(e) => handleDragOver(e, index)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, index)}
        onDragEnd={handleDragEnd}
        sx={{
          borderRadius: 2,
          mb: 0.5,
          transition: 'all 0.2s ease',
          opacity: isDragging ? 0.5 : (isPlayed ? 0.6 : 1),
          bgcolor: isCurrentTrack
            ? alpha(theme.palette.primary.main, 0.15)
            : isDragOver
              ? alpha(theme.palette.primary.main, 0.1)
              : 'transparent',
          borderLeft: isCurrentTrack
            ? `3px solid ${theme.palette.primary.main}`
            : isDragOver
              ? `3px solid ${alpha(theme.palette.primary.main, 0.5)}`
              : '3px solid transparent',
          cursor: canDrag ? 'grab' : 'default',
          '&:hover': {
            bgcolor: isCurrentTrack
              ? alpha(theme.palette.primary.main, 0.2)
              : alpha(theme.palette.action.hover, 0.1),
          },
          '&:active': canDrag ? { cursor: 'grabbing' } : {},
        }}
        secondaryAction={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {!isCurrentTrack && (
              <>
                <Tooltip title={t('queueDrawer.tooltips.play')}>
                  <IconButton
                    size="small"
                    onClick={() => onPlayTrack(index)}
                    sx={{ opacity: 0.7, '&:hover': { opacity: 1 } }}
                  >
                    <PlayIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t('queueDrawer.tooltips.removeFromQueue')}>
                  <IconButton
                    size="small"
                    onClick={() => onRemoveTrack(index)}
                    sx={{ opacity: 0.7, '&:hover': { opacity: 1, color: 'error.main' } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </>
            )}
            {isCurrentTrack && (
              <EqualizerIcon 
                fontSize="small" 
                sx={{ 
                  color: 'primary.main',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.5 },
                  },
                }} 
              />
            )}
          </Box>
        }
      >
        {canDrag && (
          <DragIcon 
            sx={{ 
              mr: 1, 
              color: 'text.disabled',
              cursor: 'grab',
              '&:hover': { color: 'text.secondary' },
            }} 
          />
        )}
        <ListItemAvatar>
          <Avatar
            variant="rounded"
            src={track.cover_art_url || track.thumbnail_url}
            sx={{
              width: 48,
              height: 48,
              bgcolor: 'background.paper',
            }}
          >
            <MusicNoteIcon />
          </Avatar>
        </ListItemAvatar>
        <ListItemText
          primary={
            <Typography
              variant="body2"
              noWrap
              sx={{
                fontWeight: isCurrentTrack ? 600 : 400,
                color: isCurrentTrack ? 'primary.main' : 'text.primary',
              }}
            >
              {track.title}
            </Typography>
          }
          secondary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {track.channel_name || track.artist || t('player.unknownArtist')}
              </Typography>
              <Typography variant="caption" color="text.disabled">
                {formatDuration(track.duration)}
              </Typography>
            </Box>
          }
          sx={{ mr: 8 }}
        />
      </ListItem>
    );
  };
  
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: isMobile ? '100%' : 400,
          maxWidth: '100%',
          bgcolor: 'background.default',
          backgroundImage: 'none',
        },
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <QueueIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              {t('queueDrawer.title')}
            </Typography>
            <Chip
              label={queue.length}
              size="small"
              sx={{ ml: 1, height: 22 }}
            />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {queue.length > 1 && (
              <Tooltip title={t('queueDrawer.tooltips.clearQueueExceptCurrent')}>
                <IconButton
                  size="small"
                  onClick={onClearQueue}
                  sx={{ color: 'text.secondary' }}
                >
                  <ClearAllIcon />
                </IconButton>
              </Tooltip>
            )}
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
        
        {/* Queue Content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
          {queue.length === 0 ? (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                opacity: 0.6,
              }}
            >
              <QueueIcon sx={{ fontSize: 64, mb: 2, color: 'text.disabled' }} />
              <Typography color="text.secondary">
                {t('queueDrawer.empty.title')}
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ mt: 1 }}>
                {t('queueDrawer.empty.description')}
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {/* Now Playing Section */}
              {currentTrack && (
                <>
                  <Typography
                    variant="overline"
                    sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}
                  >
                    {t('queueDrawer.sections.nowPlaying')}
                  </Typography>
                  {renderTrackItem(currentTrack, currentIndex)}
                </>
              )}
              
              {/* Up Next Section */}
              {upcomingTracks.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography
                    variant="overline"
                    sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}
                  >
                    {t('queueDrawer.sections.upNext', { count: upcomingTracks.length })}
                  </Typography>
                  {upcomingTracks.map((track, idx) => 
                    renderTrackItem(track, currentIndex + 1 + idx)
                  )}
                </>
              )}
              
              {/* Previously Played Section (collapsed by default) */}
              {playedTracks.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography
                    variant="overline"
                    sx={{ px: 2, py: 1, display: 'block', color: 'text.disabled' }}
                  >
                    {t('queueDrawer.sections.previouslyPlayed', { count: playedTracks.length })}
                  </Typography>
                  {playedTracks.map((track, idx) => 
                    renderTrackItem(track, idx, true)
                  )}
                </>
              )}
            </List>
          )}
        </Box>
        
        {/* Footer with queue info */}
        {queue.length > 0 && (
          <Box
            sx={{
              p: 2,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t('queueDrawer.footer.remainingTracks', { count: upcomingTracks.length })}
              {' • '}
              {formatTotalDuration(upcomingTracks, t)}
            </Typography>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}

// Helper to format total duration
function formatTotalDuration(tracks: Audio[], t: (key: string, options?: any) => string): string {
  const totalSeconds = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  if (totalSeconds <= 0) return t('queueDrawer.footer.unknownDuration');

  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) {
    return t('queueDrawer.footer.durationHoursMinutes', { hours, minutes: mins });
  }
  return t('queueDrawer.footer.durationMinutes', { minutes: mins });
}
