import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { keyframes } from '@emotion/react';
import { useTranslation } from 'react-i18next';
import { usePlaybackActive } from '../context/NowPlayingContext';

const BAR_PHASE_OFFSETS_SECONDS = [0, -0.45, -0.25];
const BAR_CYCLE_SECONDS = 1;
const RESTING_BAR_SCALE = 0.35;
const BAR_GAP_PX = 2;
const DEFAULT_SIZE_PX = 14;
const BADGE_INSET_PX = 4;
const BADGE_PADDING_PX = 5;
const BADGE_BACKDROP_OPACITY = 0.85;

// transform-only, so each frame is composited without layout or paint work.
const bounce = keyframes`
  0%, 100% { transform: scaleY(${RESTING_BAR_SCALE}); }
  50% { transform: scaleY(1); }
`;

interface NowPlayingIndicatorProps {
  size?: number;
}

/** Equalizer bars marking the playing track; they freeze while playback is paused. */
export default function NowPlayingIndicator({ size = DEFAULT_SIZE_PX }: NowPlayingIndicatorProps) {
  const { t } = useTranslation();
  const isPlaying = usePlaybackActive();

  return (
    <Box
      component="span"
      role="img"
      aria-label={t('nowPlaying.label')}
      sx={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        gap: `${BAR_GAP_PX}px`,
        width: size,
        height: size,
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      {BAR_PHASE_OFFSETS_SECONDS.map((phaseOffset) => (
        <Box
          key={phaseOffset}
          component="span"
          sx={{
            flex: 1,
            height: '100%',
            borderRadius: '1px',
            bgcolor: 'nowPlaying.main',
            transformOrigin: 'bottom',
            transform: `scaleY(${RESTING_BAR_SCALE})`,
            animation: `${bounce} ${BAR_CYCLE_SECONDS}s ease-in-out ${phaseOffset}s infinite`,
            animationPlayState: isPlaying ? 'running' : 'paused',
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      ))}
    </Box>
  );
}

/** The indicator pinned to a thumbnail corner; the thumbnail must be position: relative. */
export function NowPlayingBadge() {
  return (
    <Box
      sx={{
        position: 'absolute',
        left: BADGE_INSET_PX,
        bottom: BADGE_INSET_PX,
        display: 'flex',
        p: `${BADGE_PADDING_PX}px`,
        borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.paper, BADGE_BACKDROP_OPACITY),
        boxShadow: 1,
        pointerEvents: 'none',
      }}
    >
      <NowPlayingIndicator />
    </Box>
  );
}
