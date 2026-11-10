import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export const BOTTOM_NAV_HEIGHT_PX = 56;
/** Where things fixed to the bottom of a small screen must stop, so they sit above this bar. */
export const BOTTOM_NAV_OFFSET = `calc(${BOTTOM_NAV_HEIGHT_PX}px + env(safe-area-inset-bottom, 0px))`;

const DESTINATIONS = [
  { path: '/', labelKey: 'sidebar.home', icon: <HomeIcon /> },
  { path: '/search', labelKey: 'sidebar.search', icon: <SearchIcon /> },
  { path: '/library', labelKey: 'sidebar.library', icon: <LibraryMusicIcon /> },
  { path: '/playlists', labelKey: 'sidebar.playlists', icon: <PlaylistPlayIcon /> },
];

/** The four places people go most, one tap away on a phone; everything else stays in the menu. */
export default function BottomNav() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const isDestination = DESTINATIONS.some((destination) => destination.path === location.pathname);

  return (
    <Paper
      component="nav"
      square
      elevation={8}
      data-testid="bottom-nav"
      sx={{
        display: { xs: 'block', md: 'none' },
        flexShrink: 0,
        pb: 'env(safe-area-inset-bottom, 0px)',
        borderTop: '1px solid',
        borderColor: 'rgba(255, 255, 255, 0.08)',
      }}
    >
      <BottomNavigation
        showLabels
        value={isDestination ? location.pathname : false}
        onChange={(_event, path: string) => navigate(path)}
        sx={{ height: BOTTOM_NAV_HEIGHT_PX, bgcolor: 'transparent' }}
      >
        {DESTINATIONS.map((destination) => (
          <BottomNavigationAction
            key={destination.path}
            value={destination.path}
            label={t(destination.labelKey)}
            icon={destination.icon}
            sx={{ minWidth: 0 }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
