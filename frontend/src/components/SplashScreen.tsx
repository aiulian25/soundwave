import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

const SplashScreen: React.FC = () => {
  return (
    <Box
      className="splash-screen"
      sx={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
      }}
    >
      <Box
        component="img"
        src="/img/logo.png"
        alt="SoundWave Logo"
        className="splash-logo"
        sx={{
          width: 160,
          height: 160,
          mb: 3,
          borderRadius: '50%',
          filter: 'drop-shadow(0 8px 16px rgba(0,0,0,0.3))',
        }}
      />
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          mb: 1,
          color: 'primary.main',
        }}
      >
        SoundWave
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Music Streaming & YouTube Archive
      </Typography>
      <CircularProgress size={40} />
    </Box>
  );
};

export default SplashScreen;
