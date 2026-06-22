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
import { useTranslation } from 'react-i18next';
import { usePWA } from '../context/PWAContext';

const PWASettingsCard: React.FC = () => {
  const { t } = useTranslation();
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
      setAlert({ message: t('pwaSettings.alerts.installed'), severity: 'success' });
    } else {
      setAlert({ message: t('pwaSettings.alerts.installCancelled'), severity: 'info' });
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
        setAlert({ message: t('pwaSettings.alerts.cacheCleared'), severity: 'success' });
      } else {
        setAlert({ message: t('pwaSettings.alerts.cacheClearFailed'), severity: 'error' });
      }
    } catch (error) {
      setAlert({ message: t('pwaSettings.alerts.cacheClearError'), severity: 'error' });
    } finally {
      setClearing(false);
    }
  };

  const handleNotifications = async () => {
    if (!notificationsEnabled) {
      const permission = await requestNotifications();
      setNotificationsEnabled(permission === 'granted');
      if (permission === 'granted') {
        setAlert({ message: t('pwaSettings.alerts.notificationsEnabled'), severity: 'success' });
      } else {
        setAlert({ message: t('pwaSettings.alerts.notificationsDenied'), severity: 'error' });
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
          <Typography variant="subtitle1" fontWeight={600}>{t('pwaSettings.title')}</Typography>
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
              {t('pwaSettings.connectionStatus')}
            </Typography>
            <Chip
              icon={isOnline ? <OnlineIcon /> : <OfflineIcon />}
              label={isOnline ? t('pwaSettings.status.online') : t('pwaSettings.status.offline')}
              color={isOnline ? 'success' : 'warning'}
              size="small"
            />
          </Box>
          {!isOnline && (
            <Alert severity="info" icon={<InfoIcon />} sx={{ mt: 1 }}>
              {t('pwa.offlineDescription')}
            </Alert>
          )}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Installation Status */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="textSecondary" gutterBottom display="block" fontWeight={600}>
            {t('pwaSettings.installation')}
          </Typography>
          {isInstalled ? (
            <Alert severity="success" icon={<InstallIcon />}>
              {t('pwaSettings.installedReady')}
            </Alert>
          ) : canInstall ? (
            <Box>
              <Typography variant="caption" color="textSecondary" sx={{ mb: 0.75, display: 'block' }}>
                {t('pwaSettings.installFor')}
              </Typography>
              <List dense sx={{ py: 0 }}>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">{t('pwaSettings.installBenefits.fasterStartup')}</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">{t('pwaSettings.installBenefits.offlineAccess')}</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">{t('pwaSettings.installBenefits.nativeExperience')}</Typography>} />
                </ListItem>
                <ListItem sx={{ py: 0.25 }}>
                  <ListItemText primary={<Typography variant="caption">{t('pwaSettings.installBenefits.desktopShortcut')}</Typography>} />
                </ListItem>
              </List>
              <Button
                variant="contained"
                size="small"
                startIcon={<InstallIcon />}
                onClick={handleInstall}
                fullWidth
              >
                {t('pwa.installAction')}
              </Button>
            </Box>
          ) : (
            <Box>
              {/* Detect iOS/Safari for specific instructions */}
              {(() => {
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
                
                if (isIOS) {
                  return (
                    <Alert severity="info" sx={{ mb: 2 }} icon={<InstallIcon />}>
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        <strong>{t('pwaSettings.installHelp.ios.title')}</strong>
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                        {t('pwaSettings.installHelp.ios.step1')}
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                        {t('pwaSettings.installHelp.ios.step2')}
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ mb: 0.5 }}>
                        {t('pwaSettings.installHelp.ios.step3')}
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ mt: 1, fontStyle: 'italic' }}>
                        {t('pwaSettings.installHelp.ios.hint')}
                      </Typography>
                    </Alert>
                  );
                }
                
                return (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      <strong>{t('pwaSettings.installHelp.generic.title')}</strong>
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('pwaSettings.installHelp.generic.chromeEdge')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('pwaSettings.installHelp.generic.safariMac')}
                    </Typography>
                    <Typography variant="caption" component="div">
                      {t('pwaSettings.installHelp.generic.firefox')}
                    </Typography>
                  </Alert>
                );
              })()}
              <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 1 }}>
                {t('pwaSettings.requirements')}
              </Typography>
              <Typography variant="caption" color="textSecondary" display="block">
                {t('pwaSettings.installHelp.status')}: {window.location.protocol === 'https:' || window.location.hostname === 'localhost' ? t('pwaSettings.installHelp.secureContext') : t('pwaSettings.installHelp.notHttps')} | 
                {'serviceWorker' in navigator ? t('pwaSettings.installHelp.swSupported') : t('pwaSettings.installHelp.noSwSupport')}
              </Typography>
            </Box>
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
                    {t('pwa.updateAction')}
                  </Button>
                }
              >
                {t('pwa.updateDescription')}
              </Alert>
            </Box>
            <Divider sx={{ my: 2 }} />
          </>
        )}

        {/* Cache Management */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            {t('pwaSettings.cacheStorage')}
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
                {t('pwaSettings.cacheDescription')}
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
            {clearing ? t('pwaSettings.actions.clearingCache') : t('pwaSettings.actions.clearCache')}
          </Button>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Notifications */}
        <Box>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            {t('pwaSettings.notifications.title')}
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
                  {t('pwaSettings.notifications.enable')}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  {t('pwaSettings.notifications.description')}
                </Typography>
              </Box>
            }
          />
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* PWA Features Info */}
        <Box>
          <Typography variant="subtitle2" color="textSecondary" gutterBottom>
            {t('pwaSettings.features.title')}
          </Typography>
          <List dense>
            <ListItem>
              <ListItemText
                primary={t('pwa.offlineModeBadge')}
                secondary={t('pwaSettings.features.offlineMode')}
              />
              <Box sx={{ flexShrink: 0, pl: 1 }}>
                <Chip label={t('pwaSettings.features.active')} color="success" size="small" />
              </Box>
            </ListItem>
            <ListItem>
              <ListItemText
                primary={t('pwaSettings.features.backgroundSyncTitle')}
                secondary={t('pwaSettings.features.backgroundSync')}
              />
              <Box sx={{ flexShrink: 0, pl: 1 }}>
                <Chip label={t('pwaSettings.features.active')} color="success" size="small" />
              </Box>
            </ListItem>
            <ListItem>
              <ListItemText
                primary={t('pwaSettings.features.audioCachingTitle')}
                secondary={t('pwaSettings.features.audioCaching')}
              />
              <Box sx={{ flexShrink: 0, pl: 1 }}>
                <Chip label={t('pwaSettings.features.active')} color="success" size="small" />
              </Box>
            </ListItem>
          </List>
        </Box>
      </CardContent>
    </Card>
  );
};

export default PWASettingsCard;
