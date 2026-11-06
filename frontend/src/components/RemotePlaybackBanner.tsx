import { Box, Button, Paper, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTranslation } from 'react-i18next';
import ScrollingText from './ScrollingText';
import TrackThumbnail from './TrackThumbnail';
import NowPlayingIndicator from './NowPlayingIndicator';
import type { PlaybackSession } from '../hooks/usePlaybackSync';

const ARTWORK_SIZE = 40;

interface RemotePlaybackBannerProps {
  session: PlaybackSession;
  onPlayHere: () => void;
}

/** What another of this account's devices is playing, with a way to carry on here. */
export default function RemotePlaybackBanner({ session, onPlayHere }: RemotePlaybackBannerProps) {
  const { t } = useTranslation();
  const track = session.audio_details;

  return (
    <Paper
      data-testid="remote-playback"
      role="status"
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mb: 3, borderRadius: 3, border: 1, borderColor: 'divider' }}
    >
      <TrackThumbnail src={track?.thumbnail_url} alt={track?.title} size={ARTWORK_SIZE} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <NowPlayingIndicator />
          <Typography variant="caption" color="text.secondary" noWrap>
            {t('remotePlayback.playingOn', { device: session.device_name })}
          </Typography>
        </Box>
        <ScrollingText variant="body2" sx={{ fontWeight: 500 }}>
          {track?.title}
        </ScrollingText>
      </Box>
      <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={onPlayHere} sx={{ flexShrink: 0 }}>
        {t('remotePlayback.playHere')}
      </Button>
    </Paper>
  );
}
