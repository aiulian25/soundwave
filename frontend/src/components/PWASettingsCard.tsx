import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Switch,
  FormControlLabel,
  Divider,
  Alert,
  LinearProgress,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
} from '@mui/material';
import {
  GetApp as InstallIcon,
  Update as UpdateIcon,
  DeleteSweep as ClearCacheIcon,
  Notifications as NotificationsIcon,
  CloudDownload as CloudDownloadIcon,
  CloudOff as OfflineIcon,
  CloudDone as OnlineIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { usePWA } from '../context/PWAContext';

const PWASettingsCard: React.FC = () => {
  const {
    isOnline,
    canInstall,
    isInstalled,
    isUpdateAvailable,
    cacheSize,
    showInstallPrompt,
    updateApp,
    clearCache,
    requestNotifications,
  } = usePWA();

  const [notificationsEnabled, setNotificationsEnabled] = React.useState(
    'Notification' in window && Notification.permission === 'granted'
  );
  const [clearing, setClearing] = React.useState(false);
  const [alert, setAlert] = React.useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  const handleInstall = async () => {
    const installed = await showInstallPrompt();
    if (installed) {
      setAlert({ message: 'App installed successfully!', severity: 'success' });
    } else {
      setAlert({ message: 'Installation cancelled or not available', severity: 'info' });
    }
  };

  const handleUpdate = async () => {
    await updateApp();
  };

  const handleClearCache = async () => {
    setClearing(true);
    try {
      const success = await clearCache();
      if (success) {
        setAlert({ message: 'Cache cleared successfully', severity: 'success' });
      } else {
        setAlert({ message: 'Failed to clear cache', severity: 'error' });
      }
    } catch (error) {
      setAlert({ message: 'Error clearing cache', severity: 'error' });
    } finally {
      setClearing(false);
    }
  };

  const handleNotifications = async () => {
    if (!notificationsEnabled) {
      const permission = await requestNotifications();
      setNotificationsEnabled(permission === 'granted');
      if (permission === 'granted') {
        setAlert({ message: 'Notifications enabled', severity: 'success' });
      } else {
        setAlert({ message: 'Notifications permission denied', severity: 'error' });
      }
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const cacheUsagePercent = cacheSize
    ? Math.round((cacheSize.usage / cacheSize.quota) * 100)
    : 0;

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <CloudDownloadIcon color="primary" sx={{ fontSize: '1.25rem' }} />
          <Typography variant="subtitle1" fontWeight={600}>Progressive Web App (PWA)</Typography>
        </Box>

        {alert && (
          <Alert severity={alert.severity} onClose={() => setAlert(null)} sx={{ mb: 1.5 }}>
            {alert.message}
          </Alert>
        )}

        {/* Online Status */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
            <Typography variant="subtitle2" color="textSecondary">
              Connection Status
            </Typography>
            <Chip
              icon={isOnline ? <OnlineIcon /> : <OfflineIcon />}
              label={isOnline ? 'Online' : 'Offline'}
              color={isOnline ? 'success' : 'warning'}
              size="small"
            />
          </Box>
          {!isOnline && (
            <Alert severity="info" icon={<InfoIcon />} sx={{ mt: 1 }}>
              You're working offline. Cached content is still available.
            </Alert>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Installation Status */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="textSecondary" gutterBottom display="block" fontWeight={600}>
            Installation
          </Typography>
          {isInstalled ? (
            <Alert severity="success" icon={<InstallIcon />}>
              App is installed and ready to use
            </Alert>
          ) : canInstall ? (
            <Box>
              <Typography variant="caption" color="textSecondary" sx={{ mb: 0.75, display: 'block' }}>
                Install SoundWave for:
              </Typography>
              <List dense sx={{ py: 0 }}>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">• Faster startup and better performance</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">• Offline access to cached content</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">• Native app-like experience</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">• Desktop shortcut access</Typography>} />
                </ListItem>
              </List>
              <Button
                variant="contained"
                size="small"
                startIcon={<InstallIcon />}
                onClick={handleInstall}
                fullWidth
              >
                Install App
              </Button>
            </Box>
          ) : (
            <Alert severity="info">
              Installation not available. You may already be using the installed app or your browser doesn't support PWA installation.
            </Alert>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Update Status */}
        {isUpdateAvailable && (
          <>
            <Box sx={{ mb: 3 }}>
              <Alert
                severity="info"
                icon={<UpdateIcon />}
                action={
                  <Button color="inherit" size="small" onClick={handleUpdate}>
                    Update
                  </Button>
                }
              >
                New version available! Update now to get the latest features.
              </Alert>
            </Box>
            <Divider sx={{ my: 2 }} />
          </>
        )}

        {/* Cache Management */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            Cache Storage
          </Typography>
          {cacheSize && (
            <>
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="textSecondary">
                    {formatBytes(cacheSize.usage)} / {formatBytes(cacheSize.quota)}
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    {cacheUsagePercent}%
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(cacheUsagePercent, 100)}
                  sx={{ height: 8, borderRadius: 1 }}
                />
              </Box>
              <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 2 }}>
                Cached data allows offline access to previously viewed content and improves loading times.
              </Typography>
            </>
          )}
          <Button
            variant="outlined"
            startIcon={<ClearCacheIcon />}
            onClick={handleClearCache}
            disabled={clearing}
            fullWidth
          >
            {clearing ? 'Clearing Cache...' : 'Clear Cache'}
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Notifications */}
        <Box>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            Notifications
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={notificationsEnabled}
                onChange={handleNotifications}
                disabled={notificationsEnabled}
              />
            }
            label={
              <Box>
                <Typography variant="body2">
                  Enable push notifications
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  Get notified about downloads, updates, and more
                </Typography>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* PWA Features Info */}
        <Box>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            PWA Features
          </Typography>
          <List dense>
            <ListItem>
              <ListItemText
                primary="Offline Mode"
                secondary="Access cached content without internet"
              />
              <ListItemSecondaryAction>
                <Chip label="Active" color="success" size="small" />
              </ListItemSecondaryAction>
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Background Sync"
                secondary="Sync data when connection is restored"
              />
              <ListItemSecondaryAction>
                <Chip label="Active" color="success" size="small" />
              </ListItemSecondaryAction>
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Audio Caching"
                secondary="Cache audio files for offline playback"
              />
              <ListItemSecondaryAction>
                <Chip label="Active" color="success" size="small" />
              </ListItemSecondaryAction>
            </ListItem>
          </List>
        </Box>
      </CardContent>
    </Card>
  );
};

export default PWASettingsCard;
