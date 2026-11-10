import { useState } from 'react';
import { useEqualizer } from '../../context/EqualizerContext';
import { useRadio } from '../../context/RadioContext';
import { useSleepTimer } from '../../context/SleepTimerContext';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BedtimeIcon from '@mui/icons-material/Bedtime';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FavoriteBorderIcon from '@mui/icons-material/FavoriteBorder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import QueueMusicIcon from '@mui/icons-material/QueueMusic';
import RadioIcon from '@mui/icons-material/Radio';
import { Box, Chip, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { Audio } from '../../types';

interface PlayerActionButtonsProps {
  audio: Audio;
  isFavorite: boolean;
  /** The page can play another track when one is picked from the related list. */
  relatedTracksAvailable: boolean;
  showRelatedTracks: boolean;
  queueLength: number;
  onMinimize?: () => void;
  onFavoriteToggle: () => void;
  onToggleRelatedTracks: () => void;
  onAddToPlaylist: () => void;
  onExport: () => void;
  onEditMetadata: () => void;
  onOpenRadioMenu: (anchor: HTMLElement) => void;
  onOpenSleepTimer: () => void;
  onOpenQueue: () => void;
  onOpenEqualizer: () => void;
}

/** The row of secondary buttons under the track title: options menu, related, radio, timer, queue, equalizer. */
export default function PlayerActionButtons({
  audio, isFavorite, relatedTracksAvailable, showRelatedTracks, queueLength, onMinimize, onFavoriteToggle,
  onToggleRelatedTracks, onAddToPlaylist, onExport, onEditMetadata, onOpenRadioMenu, onOpenSleepTimer, onOpenQueue,
  onOpenEqualizer,
}: PlayerActionButtonsProps) {
  const { t } = useTranslation();
  const { isRadioMode: radioActive, stopRadio } = useRadio();
  const { timerState: sleepTimerState } = useSleepTimer();
  const { enabled: eqEnabled } = useEqualizer();
  const [trackActionsMenuAnchor, setTrackActionsMenuAnchor] = useState<HTMLElement | null>(null);

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
      {onMinimize && (
        <Tooltip title={t('player.a11y.minimize')}>
          <IconButton onClick={onMinimize} data-testid="player-minimize" aria-label={t('player.a11y.minimize')} sx={{ color: 'text.secondary' }}>
            <ExpandMoreIcon />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={t('player.trackOptions')}>
        <IconButton
          onClick={(e) => setTrackActionsMenuAnchor(e.currentTarget)}
          sx={{
            color: 'text.secondary',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'scale(1.1)',
              color: 'primary.main',
            },
          }}
        >
          <MoreVertIcon />
        </IconButton>
      </Tooltip>
      {/* Track Actions Menu */}
      <Menu
        anchorEl={trackActionsMenuAnchor}
        open={Boolean(trackActionsMenuAnchor)}
        onClose={() => setTrackActionsMenuAnchor(null)}
      >
        <MenuItem onClick={() => { onAddToPlaylist(); setTrackActionsMenuAnchor(null); }}>
          <ListItemIcon>
            <PlaylistAddIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('player.addToPlaylist')}</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => { onFavoriteToggle(); setTrackActionsMenuAnchor(null); }}>
          <ListItemIcon>
            {isFavorite ? <FavoriteIcon fontSize="small" sx={{ color: 'error.main' }} /> : <FavoriteBorderIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{isFavorite ? t('player.removeFromFavorites') : t('player.addToFavorites')}</ListItemText>
        </MenuItem>
        {audio.youtube_id && (
          <>
            <Divider />
            <MenuItem onClick={() => { onExport(); setTrackActionsMenuAnchor(null); }}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('player.exportTrack')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { onEditMetadata(); setTrackActionsMenuAnchor(null); }}>
              <ListItemIcon>
                <EditIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t('player.editMetadata')}</ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>
      {audio.youtube_id && relatedTracksAvailable && (
        <Tooltip title={t('player.relatedTracks')}>
          <IconButton
            onClick={() => onToggleRelatedTracks()}
            sx={{
              color: showRelatedTracks ? 'primary.main' : 'text.secondary',
              transition: 'all 0.2s ease',
              '&:hover': {
                transform: 'scale(1.1)',
                color: 'primary.main',
              },
            }}
          >
            <AutoAwesomeIcon />
          </IconButton>
        </Tooltip>
      )}
      {audio.youtube_id && !radioActive && (
        <Tooltip title={t('player.startRadio')}>
          <IconButton
            data-testid="player-start-radio"
            onClick={(e) => onOpenRadioMenu(e.currentTarget)}
            sx={{
              color: 'text.secondary',
              transition: 'all 0.2s ease',
              '&:hover': {
                transform: 'scale(1.1)',
                color: 'secondary.main',
              },
            }}
          >
            <RadioIcon />
          </IconButton>
        </Tooltip>
      )}
      {radioActive && (
        <Tooltip title={t('player.stopRadio')}>
          <Chip
            icon={<RadioIcon sx={{ fontSize: 16 }} />}
            label={t('player.radio')}
            size="small"
            color="secondary"
            onClick={() => stopRadio()}
            sx={{
              cursor: 'pointer',
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%': { opacity: 0.7 },
              },
              '&:hover': {
                opacity: 0.8,
              },
            }}
          />
        </Tooltip>
      )}
      {/* Sleep Timer Button */}
      <Tooltip title={sleepTimerState.isActive ? t('player.sleepTimerActive') : t('player.sleepTimer')}>
        <IconButton
          onClick={() => onOpenSleepTimer()}
          sx={{
            color: sleepTimerState.isActive ? 'warning.main' : 'text.secondary',
            transition: 'all 0.2s ease',
            position: 'relative',
            '&:hover': {
              transform: 'scale(1.1)',
              color: 'warning.main',
            },
          }}
        >
          <BedtimeIcon />
          {sleepTimerState.isActive && (
            <Box
              sx={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: 'warning.main',
                animation: 'pulse 2s ease-in-out infinite',
              }}
            />
          )}
        </IconButton>
      </Tooltip>
      {/* Queue Button */}
      <Tooltip title={t('player.queueCount', { count: queueLength })}>
        <IconButton
          onClick={() => onOpenQueue()}
          sx={{
            color: queueLength > 1 ? 'primary.main' : 'text.secondary',
            transition: 'all 0.2s ease',
            position: 'relative',
            '&:hover': {
              transform: 'scale(1.1)',
              color: 'primary.main',
            },
          }}
        >
          <QueueMusicIcon />
          {queueLength > 1 && (
            <Box
              sx={{
                position: 'absolute',
                top: 2,
                right: 2,
                minWidth: 16,
                height: 16,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontSize: 10,
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {queueLength > 99 ? '99+' : queueLength}
            </Box>
          )}
        </IconButton>
      </Tooltip>
      {/* Equalizer Button */}
      <Tooltip title={eqEnabled ? t('player.equalizerOn') : t('player.equalizer')}>
        <IconButton
          onClick={() => onOpenEqualizer()}
          sx={{
            color: eqEnabled ? 'secondary.main' : 'text.secondary',
            transition: 'all 0.2s ease',
            '&:hover': {
              transform: 'scale(1.1)',
              color: 'secondary.main',
            },
          }}
        >
          <EqualizerIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
