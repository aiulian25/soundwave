import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RepeatIcon from '@mui/icons-material/Repeat';
import RepeatOneIcon from '@mui/icons-material/RepeatOne';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { Box, CircularProgress, IconButton, Slider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
interface PlayerTransportControlsProps {
  isPlaying: boolean;
  loadingStream: boolean;
  hasNext: boolean;
  hasPrevious: boolean;
  shuffleEnabled: boolean;
  repeatMode: 'none' | 'one' | 'all';
  isMuted: boolean;
  /** 0 to 100. */
  volume: number;
  onPlayPause: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onShuffleToggle: () => void;
  onRepeatToggle: () => void;
  onToggleMute: () => void;
  onVolumeChange: (event: Event, value: number | number[]) => void;
}

/** Shuffle, previous, play or pause, next and repeat, with the volume slider beneath them. */
export default function PlayerTransportControls({
  isPlaying, loadingStream, hasNext, hasPrevious, shuffleEnabled, repeatMode, isMuted, volume, onPlayPause, onNext,
  onPrevious, onShuffleToggle, onRepeatToggle, onToggleMute, onVolumeChange,
}: PlayerTransportControlsProps) {
  const { t } = useTranslation();

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
        <Box sx={{ position: 'relative' }}>
          <IconButton
            size="small"
            onClick={onShuffleToggle}
            aria-label={t('player.a11y.shuffle')}
            aria-pressed={shuffleEnabled}
            sx={{
              color: shuffleEnabled ? 'primary.main' : 'text.secondary',
              transition: 'all 0.2s ease',
              '&:hover': { 
                color: 'primary.main',
                transform: 'scale(1.1)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
          >
            <ShuffleIcon />
          </IconButton>
          {shuffleEnabled && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 4,
                height: 4,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                boxShadow: '0 0 4px rgba(19, 236, 106, 0.8)',
              }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <IconButton
            onClick={onPrevious}
            aria-label={t('player.a11y.previous')}
            disabled={!hasPrevious}
            sx={{
              color: 'text.primary',
              transition: 'all 0.2s ease',
              '&:hover': { 
                color: 'primary.main',
                transform: 'scale(1.1)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
              '&:disabled': { color: 'text.disabled' },
            }}
          >
            <SkipPreviousIcon sx={{ fontSize: 30 }} />
          </IconButton>
          <IconButton
            onClick={onPlayPause}
            aria-label={isPlaying ? t('player.a11y.pause') : t('player.a11y.play')}
            disabled={loadingStream}
            data-testid="player-playpause"
            data-playing={isPlaying ? 'true' : 'false'}
            sx={{
              width: 64,
              height: 64,
              bgcolor: 'primary.main',
              color: 'background.dark',
              boxShadow: '0 0 20px rgba(19, 236, 106, 0.4)',
              '&:hover': {
                bgcolor: 'primary.main',
                transform: 'scale(1.05)',
                boxShadow: '0 0 30px rgba(19, 236, 106, 0.6)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
              '&:disabled': {
                bgcolor: 'rgba(19, 236, 106, 0.3)',
                color: 'rgba(0, 0, 0, 0.3)',
              },
              transition: 'all 0.2s ease',
            }}
          >
            {loadingStream ? (
              <CircularProgress size={28} sx={{ color: 'background.dark' }} />
            ) : isPlaying ? (
              <PauseIcon sx={{ fontSize: 36 }} />
            ) : (
              <PlayArrowIcon sx={{ fontSize: 36 }} />
            )}
          </IconButton>
          <IconButton
            data-testid="player-next"
            onClick={onNext}
            aria-label={t('player.a11y.next')}
            disabled={!hasNext}
            sx={{
              color: 'text.primary',
              transition: 'all 0.2s ease',
              '&:hover': { 
                color: 'primary.main',
                transform: 'scale(1.1)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
              '&:disabled': { color: 'text.disabled' },
            }}
          >
            <SkipNextIcon sx={{ fontSize: 30 }} />
          </IconButton>
        </Box>

        <Box sx={{ position: 'relative' }}>
          <IconButton
            size="small"
            onClick={onRepeatToggle}
            aria-label={t(`player.a11y.repeat.${repeatMode}`)}
            sx={{
              color: repeatMode !== 'none' ? 'primary.main' : 'text.secondary',
              transition: 'all 0.2s ease',
              '&:hover': { 
                color: 'primary.main',
                transform: 'scale(1.1)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
          >
            {repeatMode === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
          </IconButton>
          {repeatMode !== 'none' && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 8,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 4,
                height: 4,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                boxShadow: '0 0 4px rgba(19, 236, 106, 0.8)',
              }}
            />
          )}
        </Box>
      </Box>

      {/* Volume Mini */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 1 }}>
        <IconButton 
          onClick={onToggleMute} 
          aria-label={isMuted ? t('player.a11y.unmute') : t('player.a11y.mute')}
          aria-pressed={isMuted}
          size="small" 
          sx={{ 
            color: isMuted ? 'text.disabled' : 'primary.main',
            transition: 'color 0.2s ease',
            '&:hover': {
              color: 'primary.main',
            }
          }}
        >
          {isMuted || volume === 0 ? <VolumeOffIcon sx={{ fontSize: 20 }} /> : <VolumeUpIcon sx={{ fontSize: 20 }} />}
        </IconButton>
        <Box sx={{ width: 120 }}>
          <Slider
            value={isMuted ? 0 : volume}
            onChange={onVolumeChange}
            aria-label={t('player.a11y.volume')}
            min={0}
            max={100}
            size="small"
            sx={{
              color: 'primary.main',
              '& .MuiSlider-thumb': { 
                width: 10, 
                height: 10,
                transition: 'all 0.2s ease',
                '&:hover': {
                  boxShadow: '0 0 0 8px rgba(19, 236, 106, 0.16)',
                }
              },
              '& .MuiSlider-track': { border: 'none', height: 3 },
              '& .MuiSlider-rail': { 
                opacity: 0.3,
                height: 3,
              },
            }}
          />
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 32, textAlign: 'right', fontWeight: 500 }}>
          {Math.round(isMuted ? 0 : volume)}%
        </Typography>
      </Box>
    </>
  );
}
