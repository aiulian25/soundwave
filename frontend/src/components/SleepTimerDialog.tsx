/**
 * Sleep Timer Dialog
 * 
 * UI for setting sleep timer options:
 * - Timer mode: minutes, songs, or end of current track
 * - Duration/count selection
 * - Fade out toggle
 */

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Switch,
  FormControlLabel,
  Chip,
  IconButton,
} from '@mui/material';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import TimerIcon from '@mui/icons-material/Timer';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import LastPageIcon from '@mui/icons-material/LastPage';
import CloseIcon from '@mui/icons-material/Close';
import { useSleepTimer, type SleepTimerMode, type SleepTimerSettings } from '../context/SleepTimerContext';

interface SleepTimerDialogProps {
  open: boolean;
  onClose: () => void;
}

const PRESET_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120];
const PRESET_SONGS = [1, 3, 5, 10, 15, 20];

export default function SleepTimerDialog({ open, onClose }: SleepTimerDialogProps) {
  const { timerState, startTimer, stopTimer } = useSleepTimer();
  
  const [mode, setMode] = useState<SleepTimerMode>(timerState.mode || 'minutes');
  const [minutes, setMinutes] = useState(timerState.remainingMinutes || 30);
  const [songs, setSongs] = useState(timerState.remainingSongs || 5);
  const [fadeOut, setFadeOut] = useState(timerState.fadeOut ?? true);
  const [fadeDuration, setFadeDuration] = useState(timerState.fadeDuration || 30);
  
  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: SleepTimerMode | null) => {
    if (newMode) {
      setMode(newMode);
    }
  };
  
  const handleStart = () => {
    const settings: SleepTimerSettings = {
      mode,
      minutes,
      songs,
      fadeOut,
      fadeDuration,
    };
    startTimer(settings);
    onClose();
  };
  
  const handleStop = () => {
    stopTimer();
    onClose();
  };
  
  const formatTime = (mins: number): string => {
    if (mins < 60) {
      return `${Math.round(mins)} min`;
    }
    const hours = Math.floor(mins / 60);
    const remainingMins = Math.round(mins % 60);
    if (remainingMins === 0) {
      return `${hours} hr`;
    }
    return `${hours} hr ${remainingMins} min`;
  };
  
  const formatRemainingTime = (): string => {
    if (!timerState.isActive) return '';
    
    if (timerState.mode === 'minutes') {
      const mins = timerState.remainingMinutes;
      if (mins < 1) {
        return `${Math.round(mins * 60)} seconds remaining`;
      }
      return `${formatTime(mins)} remaining`;
    } else if (timerState.mode === 'songs') {
      return `${timerState.remainingSongs} song${timerState.remainingSongs !== 1 ? 's' : ''} remaining`;
    } else {
      return 'Stopping after this track';
    }
  };
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          bgcolor: 'background.paper',
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BedtimeIcon sx={{ color: 'primary.main' }} />
        Sleep Timer
        <IconButton
          onClick={onClose}
          sx={{ ml: 'auto' }}
          size="small"
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent>
        {/* Active Timer Status */}
        {timerState.isActive && (
          <Box
            sx={{
              mb: 3,
              p: 2,
              borderRadius: 2,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              textAlign: 'center',
            }}
          >
            <Typography variant="body2" sx={{ opacity: 0.9, mb: 0.5 }}>
              Timer Active
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {formatRemainingTime()}
            </Typography>
            {timerState.isFading && (
              <Chip
                label="Fading out..."
                size="small"
                sx={{ mt: 1, bgcolor: 'rgba(255,255,255,0.2)' }}
              />
            )}
          </Box>
        )}
        
        {/* Timer Mode Selection */}
        <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
          Stop playback after
        </Typography>
        
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          fullWidth
          sx={{ mb: 3 }}
        >
          <ToggleButton value="minutes" sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 0.5 }}>
              <TimerIcon sx={{ mb: 0.5 }} />
              <Typography variant="caption">Time</Typography>
            </Box>
          </ToggleButton>
          <ToggleButton value="songs" sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 0.5 }}>
              <MusicNoteIcon sx={{ mb: 0.5 }} />
              <Typography variant="caption">Songs</Typography>
            </Box>
          </ToggleButton>
          <ToggleButton value="endOfTrack" sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 0.5 }}>
              <LastPageIcon sx={{ mb: 0.5 }} />
              <Typography variant="caption">This Track</Typography>
            </Box>
          </ToggleButton>
        </ToggleButtonGroup>
        
        {/* Time Selection */}
        {mode === 'minutes' && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ mb: 1.5, textAlign: 'center', fontWeight: 500 }}>
              {formatTime(minutes)}
            </Typography>
            
            <Slider
              value={minutes}
              onChange={(_, value) => setMinutes(value as number)}
              min={5}
              max={120}
              step={5}
              marks={[
                { value: 5, label: '5m' },
                { value: 30, label: '30m' },
                { value: 60, label: '1h' },
                { value: 120, label: '2h' },
              ]}
              sx={{ mb: 2 }}
            />
            
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              {PRESET_MINUTES.map((preset) => (
                <Chip
                  key={preset}
                  label={formatTime(preset)}
                  size="small"
                  variant={minutes === preset ? 'filled' : 'outlined'}
                  color={minutes === preset ? 'primary' : 'default'}
                  onClick={() => setMinutes(preset)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </Box>
        )}
        
        {/* Song Count Selection */}
        {mode === 'songs' && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ mb: 1.5, textAlign: 'center', fontWeight: 500 }}>
              {songs} song{songs !== 1 ? 's' : ''}
            </Typography>
            
            <Slider
              value={songs}
              onChange={(_, value) => setSongs(value as number)}
              min={1}
              max={30}
              step={1}
              marks={[
                { value: 1, label: '1' },
                { value: 10, label: '10' },
                { value: 20, label: '20' },
                { value: 30, label: '30' },
              ]}
              sx={{ mb: 2 }}
            />
            
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              {PRESET_SONGS.map((preset) => (
                <Chip
                  key={preset}
                  label={`${preset} song${preset !== 1 ? 's' : ''}`}
                  size="small"
                  variant={songs === preset ? 'filled' : 'outlined'}
                  color={songs === preset ? 'primary' : 'default'}
                  onClick={() => setSongs(preset)}
                  sx={{ cursor: 'pointer' }}
                />
              ))}
            </Box>
          </Box>
        )}
        
        {/* End of Track Message */}
        {mode === 'endOfTrack' && (
          <Box sx={{ mb: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              Playback will stop when the current track ends.
            </Typography>
          </Box>
        )}
        
        {/* Fade Out Option */}
        <Box 
          sx={{ 
            p: 2, 
            borderRadius: 2, 
            bgcolor: 'rgba(255,255,255,0.03)',
            border: '1px solid',
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          <FormControlLabel
            control={
              <Switch
                checked={fadeOut}
                onChange={(e) => setFadeOut(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Box>
                <Typography variant="body2">Fade out before stopping</Typography>
                <Typography variant="caption" color="text.secondary">
                  Gradually reduce volume for a smoother ending
                </Typography>
              </Box>
            }
          />
          
          {fadeOut && mode === 'minutes' && (
            <Box sx={{ mt: 2, pl: 2 }}>
              <Typography variant="caption" color="text.secondary" gutterBottom>
                Fade duration: {fadeDuration} seconds
              </Typography>
              <Slider
                value={fadeDuration}
                onChange={(_, value) => setFadeDuration(value as number)}
                min={10}
                max={60}
                step={5}
                size="small"
                marks={[
                  { value: 10, label: '10s' },
                  { value: 30, label: '30s' },
                  { value: 60, label: '60s' },
                ]}
              />
            </Box>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        {timerState.isActive ? (
          <>
            <Button 
              onClick={handleStop} 
              variant="outlined" 
              color="error"
              fullWidth
            >
              Cancel Timer
            </Button>
            <Button 
              onClick={handleStart} 
              variant="contained"
              fullWidth
            >
              Update Timer
            </Button>
          </>
        ) : (
          <Button 
            onClick={handleStart} 
            variant="contained"
            fullWidth
            startIcon={<BedtimeIcon />}
          >
            Start Sleep Timer
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
