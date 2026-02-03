/**
 * Resume Playback Dialog
 * 
 * Shows when user logs in and has an active playback session from another device.
 * Offers to resume playback from 5 seconds before the last position.
 */

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Avatar,
  IconButton,
  LinearProgress,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CloseIcon from '@mui/icons-material/Close';
import DevicesIcon from '@mui/icons-material/Devices';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import type { PlaybackSession } from '../hooks/usePlaybackSync';

interface ResumePlaybackDialogProps {
  open: boolean;
  session: PlaybackSession | null;
  onResume: () => void;
  onDismiss: () => void;
}

// Format seconds to MM:SS
const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Format relative time
const formatRelativeTime = (seconds: number): string => {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
};

export default function ResumePlaybackDialog({
  open,
  session,
  onResume,
  onDismiss,
}: ResumePlaybackDialogProps) {
  if (!session?.audio_details) return null;

  const { audio_details, position, device_name, seconds_since_update } = session;
  const progress = (position / audio_details.duration) * 100;
  
  // Resume position: 5 seconds before last position (but not negative)
  const resumePosition = Math.max(0, position - 5);
  
  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          bgcolor: 'background.paper',
          backgroundImage: 'none',
        },
      }}
    >
      <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DevicesIcon color="primary" />
          <Typography variant="h6" component="span">
            Continue Listening?
          </Typography>
        </Box>
        <IconButton size="small" onClick={onDismiss} sx={{ color: 'text.secondary' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent sx={{ pt: 2 }}>
        {/* Track Info Card */}
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            p: 2,
            borderRadius: 2,
            bgcolor: 'action.hover',
            mb: 2,
          }}
        >
          <Avatar
            variant="rounded"
            src={audio_details.cover_art_url || audio_details.thumbnail_url}
            sx={{ width: 80, height: 80 }}
          >
            <MusicNoteIcon />
          </Avatar>
          
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={600} noWrap>
              {audio_details.title}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {audio_details.artist || audio_details.channel_name}
            </Typography>
            
            {/* Progress bar */}
            <Box sx={{ mt: 1.5 }}>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: 'rgba(255,255,255,0.1)',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 2,
                  },
                }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {formatTime(resumePosition)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatTime(audio_details.duration)}
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
        
        {/* Last played info */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <AccessTimeIcon fontSize="small" />
          <Typography variant="body2">
            Last played {formatRelativeTime(seconds_since_update)}
            {device_name && ` on ${device_name}`}
          </Typography>
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ p: 2, pt: 1 }}>
        <Button
          onClick={onDismiss}
          color="inherit"
          sx={{ color: 'text.secondary' }}
        >
          Not Now
        </Button>
        <Button
          onClick={onResume}
          variant="contained"
          startIcon={<PlayArrowIcon />}
          sx={{ px: 3 }}
        >
          Resume at {formatTime(resumePosition)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
