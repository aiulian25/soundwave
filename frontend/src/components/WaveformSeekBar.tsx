/**
 * Waveform Seek Bar Component
 * Displays a waveform-style seek bar (like Lyrique).
 *
 * The bars are a deterministic pattern derived from the track duration, not the real audio:
 * decoding a track client-side to get its envelope costs a full PCM decode. A real waveform
 * belongs server-side, shipped as ~100 numbers alongside the rest of the player payload.
 */

import { Box, Typography, useTheme } from '@mui/material';
import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import type { Chapter } from '../types';
import ChapterMarkers from './ChapterMarkers';

interface WaveformSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  onSeekCommitted: (time: number) => void;
  streamUrl?: string;
  chapters?: Chapter[] | null;
}

// Cache waveform data by URL
const waveformCache = new Map<string, number[]>();

function WaveformSeekBar({
  currentTime,
  duration,
  onSeek,
  onSeekCommitted,
  streamUrl,
  chapters,
}: WaveformSeekBarProps) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });

  // Generate a simple deterministic waveform based on duration (fallback)
  const generateSimpleWaveform = useCallback((dur: number): number[] => {
    const bars = 100;
    const data: number[] = [];
    const seed = dur * 1000; // Use duration as seed for consistency
    
    for (let i = 0; i < bars; i++) {
      // Create natural-looking waveform pattern
      const base = 0.3 + Math.sin(i * 0.1 + seed * 0.001) * 0.2;
      const variation = Math.sin(i * 0.5 + seed * 0.002) * 0.15 + Math.sin(i * 0.3) * 0.1;
      const random = (Math.sin(i * 7.3 + seed * 0.003) * 0.5 + 0.5) * 0.25;
      data.push(Math.min(1, Math.max(0.15, base + variation + random)));
    }
    return data;
  }, []);

  // Generate waveform when stream URL changes
  useEffect(() => {
    if (!streamUrl || !duration) {
      setWaveformData(generateSimpleWaveform(duration || 180));
      return;
    }

    // Check cache first
    if (waveformCache.has(streamUrl)) {
      setWaveformData(waveformCache.get(streamUrl)!);
      return;
    }

    // Try to generate from audio, fall back to simple waveform
    // For now, use simple waveform immediately for performance
    // Real waveform could be pre-generated on backend
    const simpleWaveform = generateSimpleWaveform(duration);
    setWaveformData(simpleWaveform);
    waveformCache.set(streamUrl, simpleWaveform);
  }, [streamUrl, duration, generateSimpleWaveform]);

  // Draw waveform on canvas
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveformData.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const barCount = waveformData.length;
    const barWidth = width / barCount;
    const barGap = 1;

    ctx.clearRect(0, 0, width, height);

    // Calculate progress
    const progress = duration > 0 ? currentTime / duration : 0;
    const progressX = progress * width;

    // Get theme colors
    const primaryColor = theme.palette.primary.main;
    const isDark = theme.palette.mode === 'dark';

    // A canvas gradient is positioned in user space, so a single full-height gradient can be
    // shared by every bar. Per-bar gradients were ~100 allocations per draw.
    const playedGradient = ctx.createLinearGradient(0, 0, 0, height);
    playedGradient.addColorStop(0, primaryColor + 'E6'); // 90% opacity
    playedGradient.addColorStop(0.5, primaryColor);
    playedGradient.addColorStop(1, primaryColor + 'B3'); // 70% opacity
    const unplayedColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.15)';

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      const x = i * barWidth;
      const barHeight = waveformData[i] * height * 0.85;
      const y = (height - barHeight) / 2;

      ctx.fillStyle = x < progressX ? playedGradient : unplayedColor;

      // Draw rounded bar
      const radius = Math.min(barWidth / 2, 2);
      ctx.beginPath();
      ctx.roundRect(x + barGap / 2, y, barWidth - barGap, barHeight, radius);
      ctx.fill();
    }

    // Draw hover indicator
    if (hoverPosition !== null) {
      const hoverX = hoverPosition * width;
      ctx.strokeStyle = isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
    }
  }, [waveformData, currentTime, duration, theme, hoverPosition]);

  // The ResizeObserver below is created once, so it must not capture a draw from the first
  // render -- at that point waveformData is still empty and the draw is a no-op. Resizing
  // clears the bitmap, so a stale draw would leave the bar blank until some other input
  // changed (visible on rotation while paused).
  const drawWaveformRef = useRef(drawWaveform);
  drawWaveformRef.current = drawWaveform;

  // Own the canvas bitmap size. Runs on mount and whenever the element's box changes,
  // rather than on every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      // setTransform replaces rather than accumulates, and assigning canvas.width has just
      // reset the context, so this cannot compound across resizes.
      canvas.getContext('2d')?.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      drawWaveformRef.current();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Redraw only when an input changed (position, hover, data, theme) -- not every frame.
  // drawWaveform lists all of them in its own dependencies.
  useEffect(() => {
    drawWaveform();
  }, [drawWaveform]);

  // Handle mouse/touch interactions
  const getPositionFromEvent = useCallback((e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent): number => {
    const container = containerRef.current;
    if (!container) return 0;

    const rect = container.getBoundingClientRect();
    let clientX: number;
    
    if ('touches' in e) {
      clientX = e.touches[0]?.clientX || (e as TouchEvent).changedTouches?.[0]?.clientX || 0;
    } else {
      clientX = (e as MouseEvent).clientX;
    }

    const x = clientX - rect.left;
    return Math.max(0, Math.min(1, x / rect.width));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const position = getPositionFromEvent(e);
    const time = position * duration;
    onSeek(time);
  }, [duration, onSeek, getPositionFromEvent]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const position = getPositionFromEvent(e);
    setHoverPosition(position);
    
    if (isDragging) {
      const time = position * duration;
      onSeek(time);
    }
  }, [isDragging, duration, onSeek, getPositionFromEvent]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      const position = getPositionFromEvent(e);
      const time = position * duration;
      onSeekCommitted(time);
      setIsDragging(false);
    }
  }, [isDragging, duration, onSeekCommitted, getPositionFromEvent]);

  const handleMouseLeave = useCallback(() => {
    setHoverPosition(null);
    if (isDragging) {
      setIsDragging(false);
    }
  }, [isDragging]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    const position = getPositionFromEvent(e);
    const time = position * duration;
    onSeek(time);
  }, [duration, onSeek, getPositionFromEvent]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (isDragging) {
      const position = getPositionFromEvent(e);
      const time = position * duration;
      onSeek(time);
    }
  }, [isDragging, duration, onSeek, getPositionFromEvent]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (isDragging) {
      const position = getPositionFromEvent(e);
      const time = position * duration;
      onSeekCommitted(time);
      setIsDragging(false);
    }
  }, [isDragging, duration, onSeekCommitted, getPositionFromEvent]);

  // Format time for hover tooltip
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const hoverTime = useMemo(() => {
    if (hoverPosition === null) return null;
    return formatTime(hoverPosition * duration);
  }, [hoverPosition, duration]);

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      {/* Waveform container */}
      <Box
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        sx={{
          position: 'relative',
          height: 48,
          cursor: 'pointer',
          borderRadius: 1,
          overflow: 'hidden',
          '&:hover': {
            '& .waveform-handle': {
              opacity: 1,
            },
          },
        }}
      >
        {/* Canvas for waveform */}
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
          }}
        />

        {/* Chapter boundary ticks (F2) — non-interactive overlay */}
        <ChapterMarkers chapters={chapters} duration={duration} />

        {/* Seek handle/thumb */}
        <Box
          className="waveform-handle"
          sx={{
            position: 'absolute',
            top: '50%',
            left: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
            transform: 'translate(-50%, -50%)',
            width: 14,
            height: 14,
            bgcolor: theme.palette.mode === 'dark' ? '#fff' : theme.palette.primary.main,
            borderRadius: '50%',
            boxShadow: theme.palette.mode === 'dark' 
              ? '0 0 10px rgba(255, 255, 255, 0.5)'
              : `0 0 10px ${theme.palette.primary.main}40`,
            opacity: isDragging ? 1 : 0,
            transition: 'opacity 0.2s',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />

        {/* Hover time tooltip */}
        {hoverPosition !== null && hoverTime && (
          <Box
            sx={{
              position: 'absolute',
              top: -28,
              left: `${hoverPosition * 100}%`,
              transform: 'translateX(-50%)',
              bgcolor: 'rgba(0, 0, 0, 0.8)',
              color: '#fff',
              px: 1,
              py: 0.5,
              borderRadius: 1,
              fontSize: '0.7rem',
              fontWeight: 500,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 3,
            }}
          >
            {hoverTime}
          </Box>
        )}
      </Box>

      {/* Time labels */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography 
          variant="caption" 
          sx={{ 
            color: 'text.secondary', 
            fontWeight: 500, 
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(currentTime)}
        </Typography>
        <Typography 
          variant="caption" 
          sx={{ 
            color: 'text.secondary', 
            fontWeight: 500, 
            fontSize: '0.75rem',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatTime(duration)}
        </Typography>
      </Box>
    </Box>
  );
}

/* Memoized: Player re-renders on every timeupdate while music plays. The props below
   are stabilised at the call site, so this bails out on renders that do not concern it. */
export default memo(WaveformSeekBar);
