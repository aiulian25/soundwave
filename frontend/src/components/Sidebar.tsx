import { Box, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Drawer, Chip } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import FavoriteIcon from '@mui/icons-material/Favorite';
import SettingsIcon from '@mui/icons-material/Settings';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import YouTubeIcon from '@mui/icons-material/YouTube';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import CloudDoneIcon from '@mui/icons-material/CloudDone';

interface SidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const menuItems = [
  { title: 'Home', path: '/', icon: <HomeIcon /> },
  { title: 'Search', path: '/search', icon: <SearchIcon /> },
  { title: 'Library', path: '/library', icon: <LibraryMusicIcon /> },
  { title: 'Favorites', path: '/favorites', icon: <FavoriteIcon /> },
  { title: 'Channels', path: '/channels', icon: <YouTubeIcon /> },
  { title: 'Playlists', path: '/playlists', icon: <PlaylistPlayIcon /> },
  { title: 'Local Files', path: '/local-files', icon: <CloudUploadIcon /> },
  { title: 'Offline', path: '/offline', icon: <CloudDoneIcon />, isPWA: true },
];

export default function Sidebar({ mobileOpen = false, onMobileClose }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

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
      <List sx={{ flexGrow: 1, px: 1.5, py: 2 }}>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ mb: 1 }}>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => handleNavigate(item.path)}
              sx={{
                borderRadius: '9999px',
                py: 1.5,
                px: 2,
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
              }}
            >
              <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText 
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {item.title}
                    {(item as any).isPWA && (
                      <Chip 
                        label="PWA" 
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
                  fontWeight: location.pathname === item.path ? 600 : 500,
                  fontSize: '0.875rem'
                }} 
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      {/* Settings at bottom */}
      <Box sx={{ p: 1.5, pb: 2 }}>
        <ListItemButton
          selected={location.pathname === '/settings'}
          onClick={() => handleNavigate('/settings')}
          sx={{
            borderRadius: '9999px',
            py: 1.5,
            px: 2,
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
          }}
        >
          <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>
            <SettingsIcon />
          </ListItemIcon>
          <ListItemText 
            primary="Settings" 
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
