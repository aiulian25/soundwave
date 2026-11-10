import { useState } from 'react';
import type { Audio } from '../../types';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface PlayerArtworkProps {
  audio: Audio;
  isPlaying: boolean;
  isBuffering: boolean;
  /** Tapping the artwork shows or hides the lyrics. */
  onToggleLyrics: () => void;
}

/**
 * The large artwork in the player, or a music note when the track has none or it will not load.
 * Mount it with the track's id as `key`, so a failed image does not carry over to the next track.
 */
export default function PlayerArtwork({ audio, isPlaying, isBuffering, onToggleLyrics }: PlayerArtworkProps) {
  const { t } = useTranslation();
  const [imageLoadError, setImageLoadError] = useState(false);

  return (audio.cover_art_url || audio.thumbnail_url) && !imageLoadError ? (
    <Box
      onClick={onToggleLyrics}
      sx={{
        width: 200,
        height: 200,
        borderRadius: 3,
        bgcolor: 'background.paper',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        mb: 3,
        boxShadow: isPlaying 
          ? '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)'
          : (theme) => theme.palette.mode === 'dark' 
            ? '0 8px 32px rgba(0, 0, 0, 0.4)'
            : '0 8px 24px rgba(0, 0, 0, 0.1)',
        cursor: audio.youtube_id ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        '&:hover': audio.youtube_id ? {
          transform: 'scale(1.05) rotate(2deg)',
          boxShadow: (theme) => theme.palette.mode === 'dark'
            ? '0 12px 40px rgba(19, 236, 106, 0.5)'
            : `0 12px 40px ${theme.palette.primary.main}40`,
        } : {},
        '&::after': isBuffering ? {
          content: '""',
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          borderRadius: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        } : {},
        // Compositor-only pulse: both shadows are painted once and only this layer's
        // opacity animates. Animating box-shadow itself repainted a large blurred
        // region every frame.
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          boxShadow: '0 8px 32px rgba(19, 236, 106, 0.6), 0 0 80px rgba(19, 236, 106, 0.4)',
          opacity: 0,
          animation: isPlaying ? 'album-glow 2s ease-in-out infinite' : 'none',
          pointerEvents: 'none',
        },
        '@keyframes album-glow': {
          '0%, 100%': { opacity: 0 },
          '50%': { opacity: 1 },
        },
      }}
      title={audio.youtube_id ? t('player.toggleLyrics') : t('player.lyricsNotAvailableLocal')}
    >
      {/* Hidden img to detect load errors */}
      <img 
        src={audio.cover_art_url || audio.thumbnail_url}
        alt=""
        style={{ 
          width: '100%', 
          height: '100%', 
          objectFit: 'cover',
          position: 'absolute',
          inset: 0,
          // The parent dropped overflow:hidden (it clipped the glow), so the artwork
          // rounds its own corners to match.
          borderRadius: 'inherit',
        }}
        onError={() => setImageLoadError(true)}
      />
      {isBuffering && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
          <CircularProgress size={48} sx={{ color: 'primary.main' }} />
        </Box>
      )}
    </Box>
  ) : (
    /* Fallback album art - show music icon */
    <Box
      onClick={onToggleLyrics}
      sx={{
        width: 200,
        height: 200,
        borderRadius: 3,
        mb: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(19, 236, 106, 0.1)',
        border: '2px solid',
        borderColor: 'primary.main',
        cursor: audio.youtube_id ? 'pointer' : 'default',
        boxShadow: isPlaying 
          ? '0 8px 32px rgba(19, 236, 106, 0.4), 0 0 60px rgba(19, 236, 106, 0.2)'
          : '0 8px 32px rgba(0, 0, 0, 0.4)',
        transition: 'all 0.3s ease',
        position: 'relative',
        '&:hover': audio.youtube_id ? {
          transform: 'scale(1.05)',
          bgcolor: 'rgba(19, 236, 106, 0.2)',
        } : {},
        // Compositor-only pulse: both shadows are painted once and only this layer's
        // opacity animates. Animating box-shadow itself repainted a large blurred
        // region every frame.
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          boxShadow: '0 8px 32px rgba(19, 236, 106, 0.6), 0 0 80px rgba(19, 236, 106, 0.4)',
          opacity: 0,
          animation: isPlaying ? 'album-glow 2s ease-in-out infinite' : 'none',
          pointerEvents: 'none',
        },
        '@keyframes album-glow': {
          '0%, 100%': { opacity: 0 },
          '50%': { opacity: 1 },
        },
      }}
      title={audio.youtube_id ? t('player.toggleLyrics') : t('player.lyricsNotAvailableLocal')}
    >
      <MusicNoteIcon sx={{ fontSize: 80, color: 'primary.main', opacity: 0.7 }} />
    </Box>
  );
}
