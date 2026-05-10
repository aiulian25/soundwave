import { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormControlLabel,
  Switch,
  Button,
  CircularProgress,
  Alert,
  Chip,
  Grid,
  LinearProgress,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  Speed as SpeedIcon,
  Memory as MemoryIcon,
  Storage as StorageIcon,
  Refresh as RefreshIcon,
  Info as InfoIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useQuickSync } from '../context/QuickSyncContext';

const QuickSyncSettings = () => {
  const { t } = useTranslation();
  const { status, preferences, loading, updatePreferences, runSpeedTest, refreshStatus } = useQuickSync();
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleModeChange = async (mode: string) => {
    try {
      await updatePreferences({ mode: mode as any });
      setMessage({ type: 'success', text: t('quickSync.messages.qualityModeUpdated') });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: t('quickSync.errors.updateQualityModeFailed') });
    }
  };

  const handlePreferenceChange = async (key: string, value: boolean) => {
    try {
      await updatePreferences({ [key]: value });
      setMessage({ type: 'success', text: t('quickSync.messages.preferencesUpdated') });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: t('quickSync.errors.updatePreferencesFailed') });
    }
  };

  const handleSpeedTest = async () => {
    setTesting(true);
    try {
      await runSpeedTest();
      setMessage({ type: 'success', text: t('quickSync.messages.speedTestCompleted') });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: t('quickSync.errors.speedTestFailed') });
    } finally {
      setTesting(false);
    }
  };

  const getNetworkStatusIcon = (status: string) => {
    switch (status) {
      case 'excellent':
        return <CheckCircleIcon color="success" />;
      case 'good':
        return <CheckCircleIcon color="primary" />;
      case 'fair':
        return <WarningIcon color="warning" />;
      case 'poor':
        return <ErrorIcon color="error" />;
      default:
        return <InfoIcon />;
    }
  };

  const getSystemStatusColor = (status: string) => {
    switch (status) {
      case 'low_load':
        return 'success';
      case 'moderate_load':
        return 'warning';
      case 'high_load':
        return 'error';
      default:
        return 'default';
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="subtitle1" fontWeight={600}>{t('quickSync.title')}</Typography>
        <IconButton size="small" onClick={refreshStatus} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Current Status */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2" gutterBottom fontWeight="bold" mb={1.5}>
          {t('quickSync.currentStatus')}
        </Typography>

        {status && (
          <Grid container spacing={2}>
            {/* Network Status */}
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" mb={1}>
                <SpeedIcon sx={{ mr: 0.5, fontSize: '1.1rem' }} />
                <Typography variant="caption" fontWeight="bold">
                  {t('quickSync.networkSpeed')}
                </Typography>
                <Box ml="auto">
                  {getNetworkStatusIcon(status.network.status)}
                </Box>
              </Box>
              <Typography variant="h6" color="primary" mb={0.75}>
                {status.network.speed_mbps.toFixed(2)} Mbps
              </Typography>
              <Chip
                label={status.network.status.toUpperCase()}
                size="small"
                color={
                  status.network.status === 'excellent' || status.network.status === 'good'
                    ? 'success'
                    : status.network.status === 'fair'
                    ? 'warning'
                    : 'error'
                }
              />
            </Grid>

            {/* System Resources */}
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" mb={1}>
                <MemoryIcon sx={{ mr: 0.5, fontSize: '1.1rem' }} />
                <Typography variant="caption" fontWeight="bold">
                  {t('quickSync.systemResources')}
                </Typography>
              </Box>
              <Box mb={1.5}>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption">{t('quickSync.cpuUsage')}</Typography>
                  <Typography variant="caption">{status.system.cpu_percent.toFixed(0)}%</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={status.system.cpu_percent}
                  color={status.system.cpu_percent > 80 ? 'error' : 'primary'}
                />
              </Box>
              <Box>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption">{t('quickSync.memoryUsage')}</Typography>
                  <Typography variant="caption">{status.system.memory_percent.toFixed(0)}%</Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={status.system.memory_percent}
                  color={status.system.memory_percent > 85 ? 'error' : 'primary'}
                />
              </Box>
            </Grid>

            {/* Quality Status */}
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" mb={1}>
                <StorageIcon sx={{ mr: 0.5, fontSize: '1.1rem' }} />
                <Typography variant="caption" fontWeight="bold">
                  {t('quickSync.activeQuality')}
                </Typography>
              </Box>
              <Typography variant="h6" color="primary" mb={0.75}>
                {status.quality.level.toUpperCase()}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                {status.quality.bitrate} kbps
              </Typography>
              {status.quality.auto_selected && (
                <Chip label={t('quickSync.autoSelected')} size="small" color="info" />
              )}
            </Grid>
          </Grid>
        )}

        <Box mt={3}>
          <Button
            variant="outlined"
            startIcon={testing ? <CircularProgress size={20} /> : <SpeedIcon />}
            onClick={handleSpeedTest}
            disabled={testing}
            fullWidth
          >
            {testing ? t('quickSync.actions.testingConnection') : t('quickSync.actions.runSpeedTest')}
          </Button>
        </Box>
      </Paper>

      {/* Quality Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom fontWeight="bold">
          {t('quickSync.qualitySettings')}
        </Typography>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>{t('quickSync.qualityMode')}</InputLabel>
          <Select
            value={preferences?.mode || 'auto'}
            onChange={(e) => handleModeChange(e.target.value)}
            label={t('quickSync.qualityMode')}
          >
            <MenuItem value="auto">
              <Box>
                <Typography>{t('quickSync.modes.auto')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('quickSync.modes.autoDescription')}
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="ultra">
              <Box>
                <Typography>{t('quickSync.modes.ultra')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('quickSync.modes.ultraDescription')}
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="high">
              <Box>
                <Typography>{t('quickSync.modes.high')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('quickSync.modes.highDescription')}
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="medium">
              <Box>
                <Typography>{t('quickSync.modes.medium')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('quickSync.modes.mediumDescription')}
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="low">
              <Box>
                <Typography>{t('quickSync.modes.low')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('quickSync.modes.lowDescription')}
                </Typography>
              </Box>
            </MenuItem>
          </Select>
        </FormControl>

        <FormControlLabel
          control={
            <Switch
              checked={preferences?.prefer_quality || false}
              onChange={(e) => handlePreferenceChange('prefer_quality', e.target.checked)}
            />
          }
          label={
            <Box display="flex" alignItems="center">
              <Typography>Prefer Higher Quality</Typography>
              <Tooltip title={t('quickSync.tooltips.preferHigherQuality')}>
                <InfoIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
              </Tooltip>
            </Box>
          }
        />

        <FormControlLabel
          control={
            <Switch
              checked={preferences?.adapt_to_system || false}
              onChange={(e) => handlePreferenceChange('adapt_to_system', e.target.checked)}
            />
          }
          label={
            <Box display="flex" alignItems="center">
              <Typography>Adapt to System Load</Typography>
              <Tooltip title={t('quickSync.tooltips.adaptToSystemLoad')}>
                <InfoIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
              </Tooltip>
            </Box>
          }
        />

        <FormControlLabel
          control={
            <Switch
              checked={preferences?.auto_download_quality || false}
              onChange={(e) => handlePreferenceChange('auto_download_quality', e.target.checked)}
            />
          }
          label={
            <Box display="flex" alignItems="center">
              <Typography>Apply to Downloads</Typography>
              <Tooltip title={t('quickSync.tooltips.applyToDownloads')}>
                <InfoIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
              </Tooltip>
            </Box>
          }
        />
      </Paper>

      {/* Buffer Settings Info */}
      {status && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" gutterBottom fontWeight="bold">
            {t('quickSync.bufferSettings')}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                {t('quickSync.bufferSize')}
              </Typography>
              <Typography variant="h6">{status.buffer.buffer_size}s</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                {t('quickSync.maxBuffer')}
              </Typography>
              <Typography variant="h6">{status.buffer.max_buffer_size}s</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                {t('quickSync.preload')}
              </Typography>
              <Typography variant="h6">{status.buffer.preload}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                {t('quickSync.rebufferThreshold')}
              </Typography>
              <Typography variant="h6">{status.buffer.rebuffer_threshold.toFixed(1)}s</Typography>
            </Grid>
          </Grid>
        </Paper>
      )}
    </Box>
  );
};

export default QuickSyncSettings;
