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
import { useQuickSync } from '../context/QuickSyncContext';

const QuickSyncSettings = () => {
  const { status, preferences, loading, updatePreferences, runSpeedTest, refreshStatus } = useQuickSync();
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleModeChange = async (mode: string) => {
    try {
      await updatePreferences({ mode: mode as any });
      setMessage({ type: 'success', text: 'Quality mode updated successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update quality mode' });
    }
  };

  const handlePreferenceChange = async (key: string, value: boolean) => {
    try {
      await updatePreferences({ [key]: value });
      setMessage({ type: 'success', text: 'Preferences updated successfully' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update preferences' });
    }
  };

  const handleSpeedTest = async () => {
    setTesting(true);
    try {
      await runSpeedTest();
      setMessage({ type: 'success', text: 'Speed test completed' });
      setTimeout(() => setMessage(null), 3000);
    } catch (error) {
      setMessage({ type: 'error', text: 'Speed test failed' });
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
        <Typography variant="subtitle1" fontWeight={600}>Quick Sync - Adaptive Streaming</Typography>
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
          Current Status
        </Typography>

        {status && (
          <Grid container spacing={2}>
            {/* Network Status */}
            <Grid item xs={12} md={4}>
              <Box display="flex" alignItems="center" mb={1}>
                <SpeedIcon sx={{ mr: 0.5, fontSize: '1.1rem' }} />
                <Typography variant="caption" fontWeight="bold">
                  Network Speed
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
                  System Resources
                </Typography>
              </Box>
              <Box mb={1.5}>
                <Box display="flex" justifyContent="space-between" mb={0.5}>
                  <Typography variant="caption">CPU Usage</Typography>
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
                  <Typography variant="caption">Memory Usage</Typography>
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
                  Active Quality
                </Typography>
              </Box>
              <Typography variant="h6" color="primary" mb={0.75}>
                {status.quality.level.toUpperCase()}
              </Typography>
              <Typography variant="body2" color="text.secondary" mb={1}>
                {status.quality.bitrate} kbps
              </Typography>
              {status.quality.auto_selected && (
                <Chip label="Auto-Selected" size="small" color="info" />
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
            {testing ? 'Testing Connection...' : 'Run Speed Test'}
          </Button>
        </Box>
      </Paper>

      {/* Quality Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="subtitle1" gutterBottom fontWeight="bold">
          Quality Settings
        </Typography>

        <FormControl fullWidth sx={{ mb: 3 }}>
          <InputLabel>Quality Mode</InputLabel>
          <Select
            value={preferences?.mode || 'auto'}
            onChange={(e) => handleModeChange(e.target.value)}
            label="Quality Mode"
          >
            <MenuItem value="auto">
              <Box>
                <Typography>Auto (Recommended)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Adapts to your connection and system
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="ultra">
              <Box>
                <Typography>Ultra (320 kbps)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Maximum fidelity - requires 5+ Mbps
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="high">
              <Box>
                <Typography>High (256 kbps)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Best experience - requires 2+ Mbps
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="medium">
              <Box>
                <Typography>Medium (128 kbps)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Balanced - requires 1+ Mbps
                </Typography>
              </Box>
            </MenuItem>
            <MenuItem value="low">
              <Box>
                <Typography>Low (64 kbps)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Saves bandwidth - requires 0.5+ Mbps
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
              <Tooltip title="When system resources allow, automatically upgrade to higher quality">
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
              <Tooltip title="Automatically adjust quality based on CPU and memory usage">
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
              <Tooltip title="Use Quick Sync quality settings when downloading audio">
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
            Buffer Settings
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Buffer Size
              </Typography>
              <Typography variant="h6">{status.buffer.buffer_size}s</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Max Buffer
              </Typography>
              <Typography variant="h6">{status.buffer.max_buffer_size}s</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Preload
              </Typography>
              <Typography variant="h6">{status.buffer.preload}</Typography>
            </Grid>
            <Grid item xs={6}>
              <Typography variant="body2" color="text.secondary">
                Rebuffer Threshold
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
