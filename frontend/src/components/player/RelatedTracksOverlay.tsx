import { lazy, Suspense } from 'react';
import type { Audio } from '../../types';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import { Box, CircularProgress, Fade, IconButton, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

const RelatedTracks = lazy(() => import('../RelatedTracks'));

interface RelatedTracksOverlayProps {
  audio: Audio;
  onClose: () => void;
  onTrackSelect: (track: Audio) => void;
  onFavoriteToggle?: (audioId: number, isFavorite: boolean) => void;
}

/** Tracks like the current one, shown over the player until one is chosen or it is closed. */
export default function RelatedTracksOverlay({ audio, onClose, onTrackSelect, onFavoriteToggle }: RelatedTracksOverlayProps) {
  const { t } = useTranslation();

  return (
    <Suspense fallback={
      <Box sx={{ 
        position: 'absolute', 
        inset: 0, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.95)',
        zIndex: 20,
      }}>
        <CircularProgress size={60} sx={{ color: 'primary.main' }} />
      </Box>
    }>
      <Fade in>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            // No backdropFilter: at this opacity the blur is invisible, but it would be
            // recomputed every frame because the visualizer behind it repaints continuously.
            bgcolor: (theme) => theme.palette.mode === 'dark' 
              ? 'rgba(0, 0, 0, 0.95)' 
              : 'rgba(255, 255, 255, 0.98)',
            zIndex: 20,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="h6" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              <AutoAwesomeIcon sx={{ color: 'primary.main' }} />
              {t('player.relatedTracks')}
            </Typography>
            <IconButton aria-label={t('common.close')} onClick={onClose} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
            <RelatedTracks
              currentAudio={audio}
              onTrackSelect={(track) => {
                onClose();
                onTrackSelect(track);
              }}
              onFavoriteToggle={onFavoriteToggle ? (track) => onFavoriteToggle(track.id, !track.is_favorite) : undefined}
              compact={true}
            />
          </Box>
        </Box>
      </Fade>
    </Suspense>
  );
}
