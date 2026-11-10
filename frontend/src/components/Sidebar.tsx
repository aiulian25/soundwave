import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Chip, Typography } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import FavoriteIcon from '@mui/icons-material/Favorite';
import SettingsIcon from '@mui/icons-material/Settings';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import YouTubeIcon from '@mui/icons-material/YouTube';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import InsightsIcon from '@mui/icons-material/Insights';
import AppVersionStatus from './AppVersionStatus';
import { STATS_HOME_PATH, isStatsPath } from './StatsTabs';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

// Shared nav-button styling. Vertical padding adapts to viewport height (clamp on vh) so
// the list stays compact on short screens and comfortable on tall ones — automatically,
// without width breakpoints. minHeight keeps an accessible touch/click target.
const navButtonSx = {
  borderRadius: '9999px',
  py: 'clamp(0.5rem, 1vh, 0.75rem)',
  px: 2,
  minHeight: 40,
  transition: 'all 0.3s ease',
  '&.Mui-selected': {
    bgcolor: 'rgba(19, 236, 106, 0.15)',
    color: 'primary.main',
    '&:hover': {
      bgcolor: 'rgba(19, 236, 106, 0.2)',
    },
  },
  '&:not(.Mui-selected)': {
    color: 'text.secondary',
    '&:hover': {
      bgcolor: 'rgba(255, 255, 255, 0.05)',
      color: 'text.primary',
    },
  },
} as const;

interface MenuItem {
  titleKey: string;
  path: string;
  icon: JSX.Element;
  isPWA?: boolean;
  /** For an entry that stands for several pages: is this address one of them? */
  covers?: (pathname: string) => boolean;
}

// Three short groups instead of one list of thirteen: fewer things to read before finding one.
const menuSections: { titleKey: string; items: MenuItem[] }[] = [
  {
    titleKey: 'sidebar.groups.listen',
    items: [
      { titleKey: 'sidebar.home', path: '/', icon: <HomeIcon /> },
      { titleKey: 'sidebar.search', path: '/search', icon: <SearchIcon /> },
      { titleKey: 'sidebar.library', path: '/library', icon: <LibraryMusicIcon /> },
      { titleKey: 'sidebar.favorites', path: '/favorites', icon: <FavoriteIcon /> },
      { titleKey: 'sidebar.playlists', path: '/playlists', icon: <PlaylistPlayIcon /> },
      { titleKey: 'sidebar.smartPlaylists', path: '/smart-playlists', icon: <AutoAwesomeIcon /> },
    ],
  },
  {
    titleKey: 'sidebar.groups.sources',
    items: [
      { titleKey: 'sidebar.channels', path: '/channels', icon: <YouTubeIcon /> },
      { titleKey: 'sidebar.localFiles', path: '/local-files', icon: <CloudUploadIcon /> },
    ],
  },
  {
    titleKey: 'sidebar.groups.more',
    items: [
      { titleKey: 'sidebar.stats', path: STATS_HOME_PATH, icon: <InsightsIcon />, covers: isStatsPath },
      { titleKey: 'sidebar.offline', path: '/offline', icon: <CloudDoneIcon />, isPWA: true },
    ],
  },
];

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const isCurrent = (item: MenuItem) => (item.covers ? item.covers(location.pathname) : location.pathname === item.path);

  const handleNavigate = (path: string) => {
    navigate(path);
    if (onMobileClose) {
      onMobileClose();
    }
  };

  const drawerContent = (
    <Box
      sx={{
        width: 240,
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Logo */}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          component="img"
          src="/img/logo.png"
          alt="SoundWave"
          sx={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            objectFit: 'cover',
          }}
        />
        <Box sx={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>SoundWave</Box>
      </Box>

      {/* Navigation */}
      <List
        sx={{
          flexGrow: 1,
          px: 1.5,
          py: 1,
          // Safety net: if the list is still taller than the available height on a very
          // short viewport, scroll it rather than clipping the bottom items.
          overflowY: 'auto',
          '&::-webkit-scrollbar': { width: 4 },
          '&::-webkit-scrollbar-thumb': {
            bgcolor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: 2,
          },
        }}
      >
        {menuSections.map((section) => (
          <Box key={section.titleKey} component="li" sx={{ listStyle: 'none', mb: 1 }}>
            <Typography
              variant="overline"
              sx={{ display: 'block', px: 2, pt: 0.5, color: 'text.disabled', letterSpacing: 1, lineHeight: 2 }}
            >
              {t(section.titleKey)}
            </Typography>
            <List disablePadding aria-label={t(section.titleKey)}>
        {section.items.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ mb: 'clamp(1px, 0.4vh, 6px)' }}>
            <ListItemButton
              selected={isCurrent(item)}
              onClick={() => handleNavigate(item.path)}
              sx={navButtonSx}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {t(item.titleKey)}
                    {item.isPWA && (
                      <Chip 
                        label={t('sidebar.pwaBadge')} 
                        size="small" 
                        sx={{ 
                          height: 16, 
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          bgcolor: 'success.main',
                          color: 'white',
                          '& .MuiChip-label': { px: 0.5 }
                        }} 
                      />
                    )}
                  </Box>
                }
                primaryTypographyProps={{ 
                  fontWeight: isCurrent(item) ? 600 : 500,
                  fontSize: '0.875rem'
                }} 
              />
            </ListItemButton>
          </ListItem>
        ))}
            </List>
          </Box>
        ))}
      </List>

      {/* App version + update notification, just above Settings */}
      <AppVersionStatus />

      {/* Settings at bottom */}
      <Box sx={{ p: 1.5, pb: 2 }}>
        <ListItemButton
          selected={location.pathname === '/settings'}
          onClick={() => handleNavigate('/settings')}
          sx={navButtonSx}
        >
          <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
            <SettingsIcon />
          </ListItemIcon>
          <ListItemText 
            primary={t('sidebar.settings')} 
            primaryTypographyProps={{ 
              fontWeight: location.pathname === '/settings' ? 600 : 500,
              fontSize: '0.875rem'
            }} 
          />
        </ListItemButton>
      </Box>
    </Box>
  );

  return (
    <>
      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={onMobileClose}
        ModalProps={{
          keepMounted: true, // Better mobile performance
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            boxSizing: 'border-box',
            width: 240,
            bgcolor: 'background.default',
            borderRight: '1px solid',
            borderColor: 'rgba(255, 255, 255, 0.05)',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Desktop Permanent Sidebar */}
      <Box
        sx={{
          width: 240,
          flexShrink: 0,
          display: { xs: 'none', md: 'block' },
          borderRight: '1px solid',
          borderColor: 'rgba(255, 255, 255, 0.05)',
        }}
      >
        {drawerContent}
      </Box>
    </>
  );
}
