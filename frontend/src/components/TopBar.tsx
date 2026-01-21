import { useState, useEffect } from 'react';
import { AppBar, Toolbar, Avatar, IconButton, Typography, Box, Tooltip } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import LogoutIcon from '@mui/icons-material/Logout';
import AvatarDialog from './AvatarDialog';
import DownloadStatus from './DownloadStatus';

interface TopBarProps {
  onLogout: () => void;
  onMenuClick?: () => void;
}

interface UserData {
  username: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  avatar_url?: string;
}

export default function TopBar({ onLogout, onMenuClick }: TopBarProps) {
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchUserData();
    }
  }, []);

  const fetchUserData = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
      const response = await fetch('/api/user/account/', {
        headers: {
          'Authorization': `Token ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setUserData(data);
        setAvatarUrl(data.avatar_url);
      }
    } catch (error) {
      console.error('Failed to fetch user data:', error);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const handleAvatarChange = (newAvatarUrl: string | null) => {
    setAvatarUrl(newAvatarUrl);
  };

  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        bgcolor: 'transparent',
        borderBottom: 'none',
      }}
    >
      <Toolbar sx={{ minHeight: { xs: '64px', md: '80px' }, px: { xs: 2, md: 3 } }}>
        {/* Mobile Menu Button */}
        <IconButton
          color="inherit"
          aria-label="open drawer"
          edge="start"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { md: 'none' } }}
        >
          <MenuIcon />
        </IconButton>

        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 2.5 } }}>
          <Box sx={{ position: 'relative' }}>
            <Avatar 
              src={avatarUrl || undefined}
              onClick={() => setAvatarDialogOpen(true)}
              sx={{ 
                width: { xs: 40, md: 64 }, 
                height: { xs: 40, md: 64 },
                border: '2px solid',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                '&:hover': {
                  transform: 'scale(1.05)',
                  borderColor: 'primary.main',
                },
              }} 
            >
              {userData?.username?.charAt(0).toUpperCase()}
            </Avatar>
            <Box
              sx={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: { xs: 12, md: 20 },
                height: { xs: 12, md: 20 },
                bgcolor: 'primary.main',
                borderRadius: '50%',
                border: { xs: '2px solid', md: '4px solid' },
                borderColor: 'background.default',
              }}
            />
          </Box>
          <Box>
            <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.02em', mb: 0.5, fontSize: { xs: '1.1rem', md: '1.5rem' } }}>
              {getGreeting()}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, display: { xs: 'none', sm: 'block' } }}>
              {userData?.first_name || userData?.last_name 
                ? `${userData.first_name || ''} ${userData.last_name || ''}`.trim() 
                : userData?.username || 'Music Lover'}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {/* Download Status */}
          <DownloadStatus />
          
          <Tooltip title="Logout" arrow>
            <IconButton 
              onClick={onLogout}
              sx={{ 
                width: { xs: 44, md: 48 }, 
                height: { xs: 44, md: 48 },
                border: '1px solid',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                transition: 'all 0.3s ease',
                '&:hover': {
                  bgcolor: 'rgba(255, 82, 82, 0.1)',
                  borderColor: 'rgba(255, 82, 82, 0.5)',
                  color: '#ff5252',
                },
              }}
            >
              <LogoutIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Toolbar>

      {/* Avatar Dialog */}
      <AvatarDialog
        open={avatarDialogOpen}
        onClose={() => setAvatarDialogOpen(false)}
        currentAvatar={avatarUrl}
        onAvatarChange={handleAvatarChange}
      />
    </AppBar>
  );
}
