/**
 * Chapter tick marks overlaid on the seek bar (F2).
 *
 * Purely presentational and non-interactive (pointerEvents: none) so it never interferes
 * with the seek bar's drag-to-seek — clicking a tick still seeks (the bar handles the
 * click at that x-position), and precise, accessible chapter navigation lives in the
 * Player's chapter list. Renders a thin vertical divider at each chapter boundary.
 *
 * The parent must be `position: relative` (the WaveformSeekBar waveform container is).
 */

import { Box, useTheme } from '@mui/material';
import type { Chapter } from '../types';

interface ChapterMarkersProps {
  chapters?: Chapter[] | null;
  duration: number;
}

export default function ChapterMarkers({ chapters, duration }: ChapterMarkersProps) {
  const theme = useTheme();

  // Need at least two chapters (i.e. a real division) and a valid duration.
  if (!chapters || chapters.length < 2 || !duration || duration <= 0) return null;

  const lineColor =
    theme.palette.mode === 'dark' ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.4)';

  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}>
      {chapters.map((ch, i) => {
        const start = typeof ch.start === 'number' ? ch.start : null;
        // Skip the implicit first boundary at 0 and any invalid/out-of-range starts.
        if (start === null || start <= 0 || start >= duration) return null;
        const leftPct = (start / duration) * 100;
        return (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              top: 4,
              bottom: 4,
              left: `${leftPct}%`,
              width: '2px',
              transform: 'translateX(-1px)',
              bgcolor: lineColor,
              borderRadius: '1px',
            }}
          />
        );
      })}
    </Box>
  );
}
