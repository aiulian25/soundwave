/**
 * Start Radio Menu Component
 * 
 * Dropdown menu that appears when clicking "Start Radio" on a track.
 * Allows choosing the radio mode: Track Radio, Artist Radio, etc.
 */

import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import PersonIcon from '@mui/icons-material/Person';
import FavoriteIcon from '@mui/icons-material/Favorite';
import ExploreIcon from '@mui/icons-material/Explore';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import { useRadio, type RadioMode } from '../context/RadioContext';
import { useTranslation } from 'react-i18next';
import type { Audio } from '../types';

interface StartRadioMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  track?: Audio;
}

const radioModes: Array<{
  mode: RadioMode;
  labelKey: string;
  descriptionKey: string;
  icon: React.ReactNode;
  requiresTrack: boolean;
}> = [
  {
    mode: 'track',
    labelKey: 'startRadioMenu.modes.track.label',
    descriptionKey: 'startRadioMenu.modes.track.description',
    icon: <RadioIcon />,
    requiresTrack: true,
  },
  {
    mode: 'artist',
    labelKey: 'startRadioMenu.modes.artist.label',
    descriptionKey: 'startRadioMenu.modes.artist.description',
    icon: <PersonIcon />,
    requiresTrack: true,
  },
  {
    mode: 'favorites',
    labelKey: 'startRadioMenu.modes.favorites.label',
    descriptionKey: 'startRadioMenu.modes.favorites.description',
    icon: <FavoriteIcon />,
    requiresTrack: false,
  },
  {
    mode: 'discovery',
    labelKey: 'startRadioMenu.modes.discovery.label',
    descriptionKey: 'startRadioMenu.modes.discovery.description',
    icon: <ExploreIcon />,
    requiresTrack: false,
  },
  {
    mode: 'recent',
    labelKey: 'startRadioMenu.modes.recent.label',
    descriptionKey: 'startRadioMenu.modes.recent.description',
    icon: <NewReleasesIcon />,
    requiresTrack: false,
  },
];

export default function StartRadioMenu({ anchorEl, open, onClose, track }: StartRadioMenuProps) {
  const { t } = useTranslation();
  const { startRadio, isLoading } = useRadio();
  
  const handleStartRadio = async (mode: RadioMode) => {
    let seedYoutubeId: string | undefined;
    let seedChannelId: string | undefined;
    
    if (track && (mode === 'track' || mode === 'artist')) {
      seedYoutubeId = track.youtube_id;
      seedChannelId = track.channel_id;
    }
    
    await startRadio(mode, seedYoutubeId, seedChannelId);
    onClose();
  };
  
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: { width: 280 }
      }}
    >
      <Typography variant="overline" sx={{ px: 2, color: 'text.secondary' }}>
        {t('startRadioMenu.title')}
      </Typography>
      
      {track && (
        <>
          {radioModes
            .filter(m => m.requiresTrack)
            .map((item) => (
              <MenuItem
                key={item.mode}
                onClick={() => handleStartRadio(item.mode)}
                disabled={isLoading}
              >
                <ListItemIcon sx={{ color: 'primary.main' }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={t(item.labelKey)}
                  secondary={`${t(item.descriptionKey)}: ${track.title}`}
                  secondaryTypographyProps={{ noWrap: true, sx: { maxWidth: 180 } }}
                />
              </MenuItem>
            ))}
          
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="overline" sx={{ px: 2, color: 'text.secondary' }}>
            {t('startRadioMenu.orStartMix')}
          </Typography>
        </>
      )}
      
      {radioModes
        .filter(m => !m.requiresTrack)
        .map((item) => (
          <MenuItem
            key={item.mode}
            onClick={() => handleStartRadio(item.mode)}
            disabled={isLoading}
          >
            <ListItemIcon sx={{ color: 'secondary.main' }}>
              {item.icon}
            </ListItemIcon>
            <ListItemText
              primary={t(item.labelKey)}
              secondary={t(item.descriptionKey)}
            />
          </MenuItem>
        ))}
    </Menu>
  );
}
