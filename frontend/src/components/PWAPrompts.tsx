import React from 'react';
import {
  Snackbar,
  Alert,
  Button,
  Box,
  IconButton,
  Typography,
  Chip,
} from '@mui/material';
import {
  Close as CloseIcon,
  CloudOff as OfflineIcon,
  CloudDone as OnlineIcon,
  GetApp as InstallIcon,
  Update as UpdateIcon,
} from '@mui/icons-material';
import { usePWA } from '../context/PWAContext';

const PWAPrompts: React.FC = () => {
  const {
    isOnline,
    canInstall,
    isUpdateAvailable,
    showInstallPrompt,
    updateApp,
  } = usePWA();

  const [showOfflineAlert, setShowOfflineAlert] = React.useState(false);
  const [showOnlineAlert, setShowOnlineAlert] = React.useState(false);
  const [showInstallAlert, setShowInstallAlert] = React.useState(false);
  const [showUpdateAlert, setShowUpdateAlert] = React.useState(false);
  const [wasOffline, setWasOffline] = React.useState(false);

  // Handle online/offline status
  React.useEffect(() => {
    if (!isOnline) {
      setShowOfflineAlert(true);
      setWasOffline(true);
      
      // Auto-hide offline alert after 5 seconds
      const timer = setTimeout(() => {
        setShowOfflineAlert(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    } else if (wasOffline) {
      setShowOfflineAlert(false);
      setShowOnlineAlert(true);
      setWasOffline(false);
    }
  }, [isOnline, wasOffline]);

  // Show install prompt after delay
  React.useEffect(() => {
    if (canInstall) {
      const timer = setTimeout(() => {
        setShowInstallAlert(true);
      }, 3000); // Wait 3 seconds before showing

      return () => clearTimeout(timer);
    }
  }, [canInstall]);

  // Show update prompt
  React.useEffect(() => {
    if (isUpdateAvailable) {
      setShowUpdateAlert(true);
    }
  }, [isUpdateAvailable]);

  const handleInstall = async () => {
    const installed = await showInstallPrompt();
    if (installed) {
      setShowInstallAlert(false);
    }
  };

  const handleUpdate = async () => {
    await updateApp();
    setShowUpdateAlert(false);
  };

  return (
    <>
      {/* Offline Alert - Auto-hides after 5 seconds, dismissible */}
      <Snackbar
        open={showOfflineAlert}
        autoHideDuration={5000}
        onClose={() => setShowOfflineAlert(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 80, sm: 24 } }}
      >
        <Alert
          severity="warning"
          icon={<OfflineIcon />}
          onClose={() => setShowOfflineAlert(false)}
          sx={{ width: '100%' }}
        >
          <Typography variant="body2" fontWeight={600}>
            You're offline
          </Typography>
          <Typography variant="caption">
            Cached content is still available
          </Typography>
        </Alert>
      </Snackbar>

      {/* Back Online Alert */}
      <Snackbar
        open={showOnlineAlert}
        autoHideDuration={4000}
        onClose={() => setShowOnlineAlert(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 80, sm: 24 } }}
      >
        <Alert
          severity="success"
          icon={<OnlineIcon />}
          onClose={() => setShowOnlineAlert(false)}
          sx={{ width: '100%' }}
        >
          You're back online!
        </Alert>
      </Snackbar>

      {/* Install App Prompt */}
      <Snackbar
        open={showInstallAlert}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 80, sm: 24 } }}
      >
        <Alert
          severity="info"
          icon={<InstallIcon />}
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                onClick={handleInstall}
                sx={{ fontWeight: 600 }}
              >
                Install
              </Button>
              <IconButton
                size="small"
                color="inherit"
                onClick={() => setShowInstallAlert(false)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          }
          sx={{ width: '100%', alignItems: 'center' }}
        >
          <Box>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Install SoundWave
            </Typography>
            <Typography variant="caption">
              Install the app for faster access and offline playback
            </Typography>
          </Box>
        </Alert>
      </Snackbar>

      {/* Update Available Prompt */}
      <Snackbar
        open={showUpdateAlert}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: 80, sm: 24 } }}
      >
        <Alert
          severity="info"
          icon={<UpdateIcon />}
          action={
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                color="inherit"
                size="small"
                variant="outlined"
                onClick={handleUpdate}
                sx={{ fontWeight: 600 }}
              >
                Update
              </Button>
              <IconButton
                size="small"
                color="inherit"
                onClick={() => setShowUpdateAlert(false)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          }
          sx={{ width: '100%', alignItems: 'center' }}
        >
          <Box>
            <Typography variant="body2" fontWeight={600} gutterBottom>
              Update Available
            </Typography>
            <Typography variant="caption">
              A new version of SoundWave is ready to install
            </Typography>
          </Box>
        </Alert>
      </Snackbar>

      {/* Online Status Indicator (Top Bar) */}
      {!isOnline && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bgcolor: 'warning.main',
            color: 'warning.contrastText',
            py: 0.5,
            px: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            zIndex: 9999,
          }}
        >
          <OfflineIcon fontSize="small" />
          <Typography variant="caption" fontWeight={600}>
            Offline Mode
          </Typography>
        </Box>
      )}
    </>
  );
};

export default PWAPrompts;
