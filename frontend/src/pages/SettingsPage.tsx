import {
  Box,
  Typography,
  Card,
  CardContent,
  Switch,
  FormControlLabel,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Chip,
  Stack,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Slider,
} from '@mui/material';
import SecurityIcon from '@mui/icons-material/Security';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import PaletteIcon from '@mui/icons-material/Palette';
import SpeedIcon from '@mui/icons-material/Speed';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import GroupIcon from '@mui/icons-material/Group';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import FastForwardIcon from '@mui/icons-material/FastForward';
import CachedIcon from '@mui/icons-material/Cached';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { userAPI } from '../api/client';
import { audioCache, AUDIO_CACHE_CONFIG } from '../utils/audioCache';
import { useThemeContext } from '../AppWithTheme';
import { ThemeMode, themeNames } from '../theme/theme';
import ThemePreview from '../components/ThemePreview';
import VisualizerThemePreview from '../components/VisualizerThemePreview';
import QuickSyncSettings from '../components/QuickSyncSettings';
import PWASettingsCard from '../components/PWASettingsCard';
import UserProfileCard from '../components/UserProfileCard';
import { useSettings } from '../context/SettingsContext';
import { visualizerThemes } from '../config/visualizerThemes';
import axios from 'axios';

interface TwoFactorStatus {
  enabled: boolean;
  backup_codes_count: number;
}

interface TwoFactorSetup {
  secret: string;
  qr_code: string;
  backup_codes: string[];
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { themeMode, setThemeMode } = useThemeContext();
  const { settings, updateSetting } = useSettings();
  const [twoFactorStatus, setTwoFactorStatus] = useState<TwoFactorStatus>({ enabled: false, backup_codes_count: 0 });
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [setupData, setSetupData] = useState<TwoFactorSetup | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Cache stats state
  const [cacheStats, setCacheStats] = useState<{ count: number; totalSize: number } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    loadTwoFactorStatus();
    checkAdminStatus();
    loadCacheStats();
  }, []);
  
  const loadCacheStats = async () => {
    try {
      const stats = await audioCache.getCacheStats();
      setCacheStats(stats);
    } catch (err) {
      console.error('Failed to load cache stats:', err);
    }
  };
  
  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await audioCache.clearCache();
      await loadCacheStats();
      setSuccess('Audio cache cleared successfully');
    } catch (err) {
      setError('Failed to clear cache');
    } finally {
      setClearingCache(false);
    }
  };
  
  const checkAdminStatus = async () => {
    try {
      const response = await axios.get('/api/user/account/', {
        headers: {
          'Authorization': `Token ${localStorage.getItem('token')}`,
        },
      });
      setIsAdmin(response.data.is_admin || response.data.is_superuser);
    } catch (err) {
      console.error('Failed to check admin status:', err);
    }
  };

  const loadTwoFactorStatus = async () => {
    try {
      const response = await userAPI.twoFactorStatus();
      setTwoFactorStatus(response.data);
    } catch (err) {
      console.error('Failed to load 2FA status:', err);
    }
  };

  const handleSetup2FA = async () => {
    try {
      setError('');
      const response = await userAPI.twoFactorSetup();
      setSetupData(response.data);
      setSetupDialogOpen(true);
      setShowBackupCodes(false);
    } catch (err) {
      setError('Failed to setup 2FA');
    }
  };

  const handleVerify2FA = async () => {
    try {
      setError('');
      await userAPI.twoFactorVerify({ code: verificationCode });
      setSuccess('Two-factor authentication enabled successfully!');
      setSetupDialogOpen(false);
      setVerificationCode('');
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Invalid verification code');
    }
  };

  const handleDisable2FA = async () => {
    try {
      setError('');
      await userAPI.twoFactorDisable({ code: disableCode });
      setSuccess('Two-factor authentication disabled');
      setDisableDialogOpen(false);
      setDisableCode('');
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Invalid verification code');
    }
  };

  const handleRegenerateCodes = async () => {
    try {
      setError('');
      const response = await userAPI.twoFactorRegenerateCodes();
      setSetupData({ ...setupData!, backup_codes: response.data.backup_codes });
      setShowBackupCodes(true);
      setSuccess('Backup codes regenerated successfully!');
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to regenerate backup codes');
    }
  };

  const handleDownloadCodes = async () => {
    try {
      const response = await userAPI.twoFactorDownloadCodes();
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      // Get filename from Content-Disposition header or create default
      const contentDisposition = response.headers['content-disposition'];
      let filename = 'backup_codes.pdf';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match) filename = match[1];
      }
      
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError('Failed to download backup codes');
    }
  };

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
        Settings
      </Typography>

      {success && (
        <Alert severity="success" sx={{ mb: 1.5, maxWidth: 600 }}>
          {success}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1.5, maxWidth: 600 }}>
          {error}
        </Alert>
      )}

      {/* Appearance Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <PaletteIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              Appearance
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Customize the look and feel of SoundWave with different color themes.
          </Typography>

          <FormControl fullWidth sx={{ mb: 1.5 }} size="small">
            <InputLabel>Theme</InputLabel>
            <Select
              value={themeMode}
              label="Theme"
              onChange={(e) => setThemeMode(e.target.value as ThemeMode)}
            >
              {Object.entries(themeNames).map(([mode, name]) => (
                <MenuItem key={mode} value={mode}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Grid container spacing={1.5}>
            {Object.entries(themeNames).map(([mode, name]) => (
              <Grid item xs={6} sm={3} key={mode}>
                <ThemePreview
                  name={name}
                  mode={mode as ThemeMode}
                  isSelected={themeMode === mode}
                  onClick={() => setThemeMode(mode as ThemeMode)}
                />
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>

      {/* Visualizer Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <EqualizerIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              Audio Visualizer
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            Choose a visualization style for the audio player. Different themes offer unique animations and color schemes.
          </Typography>

          <FormControlLabel
            control={
              <Switch 
                size="small" 
                checked={settings.visualizer_enabled}
                onChange={(e) => updateSetting('visualizer_enabled', e.target.checked)}
              />
            }
            label={<Typography variant="body2">Enable visualizer</Typography>}
            sx={{ mb: 2, display: 'block' }}
          />

          {settings.visualizer_enabled && (
            <>
              <FormControlLabel
                control={
                  <Switch 
                    size="small" 
                    checked={settings.visualizer_glow}
                    onChange={(e) => updateSetting('visualizer_glow', e.target.checked)}
                  />
                }
                label={<Typography variant="body2">Enable glow effect</Typography>}
                sx={{ mb: 2, display: 'block' }}
              />

              <Typography variant="body2" fontWeight={500} sx={{ mb: 1.5 }}>
                Visualizer Theme
              </Typography>

              <Grid container spacing={1.5}>
                {visualizerThemes.map((theme) => (
                  <Grid item xs={4} sm={3} key={theme.id}>
                    <VisualizerThemePreview
                      theme={theme}
                      isSelected={settings.visualizer_theme === theme.id}
                      onClick={() => updateSetting('visualizer_theme', theme.id)}
                    />
                  </Grid>
                ))}
              </Grid>
            </>
          )}
        </CardContent>
      </Card>

      {/* PWA Settings */}
      <PWASettingsCard />

      {/* Security Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <SecurityIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              Two-Factor Authentication
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            Add an extra layer of security to your account. You'll need to enter a code from your
            authenticator app when you sign in.
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Chip
              label={twoFactorStatus.enabled ? 'Enabled' : 'Disabled'}
              color={twoFactorStatus.enabled ? 'success' : 'default'}
              size="small"
            />
            {twoFactorStatus.enabled && (
              <Typography variant="caption" color="text.secondary">
                {twoFactorStatus.backup_codes_count} backup codes remaining
              </Typography>
            )}
          </Box>

          <Stack spacing={1.5}>
            {!twoFactorStatus.enabled ? (
              <Button
                variant="contained"
                size="small"
                onClick={handleSetup2FA}
                startIcon={<SecurityIcon />}
              >
                Enable Two-Factor Authentication
              </Button>
            ) : (
              <>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => setDisableDialogOpen(true)}
                >
                  Disable Two-Factor Authentication
                </Button>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Backup Codes
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownloadCodes}
                    >
                      Download Backup Codes
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RefreshIcon />}
                      onClick={handleRegenerateCodes}
                    >
                      Regenerate Codes
                    </Button>
                  </Stack>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* Playback Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <SpeedIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              Playback
            </Typography>
          </Box>

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">Autoplay</Typography>}
            sx={{ mb: 2, display: 'block' }}
          />

          {/* Smart Shuffle Section */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <ShuffleIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                Smart Shuffle
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              When enabled, shuffle mode will avoid playing recently heard songs, creating a more varied listening experience.
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  size="small" 
                  checked={settings.smart_shuffle_enabled}
                  onChange={(e) => updateSetting('smart_shuffle_enabled', e.target.checked)}
                />
              }
              label={<Typography variant="body2">Enable smart shuffle</Typography>}
              sx={{ mb: 1, display: 'block' }}
            />
            {settings.smart_shuffle_enabled && (
              <Box sx={{ pl: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  History size: {settings.smart_shuffle_history_size} tracks
                </Typography>
                <Slider
                  value={settings.smart_shuffle_history_size}
                  onChange={(_, value) => updateSetting('smart_shuffle_history_size', value as number)}
                  min={5}
                  max={50}
                  step={5}
                  marks={[
                    { value: 5, label: '5' },
                    { value: 25, label: '25' },
                    { value: 50, label: '50' },
                  ]}
                  size="small"
                  sx={{ maxWidth: 300 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Number of recently played songs to avoid when shuffling
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Seek Duration Section */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <FastForwardIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                Seek Duration
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              Choose how many seconds to skip forward or backward when using seek controls (media keys, headphones, etc.).
            </Typography>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select
                value={settings.seek_duration || 3}
                onChange={(e) => updateSetting('seek_duration', Number(e.target.value) as 3 | 5 | 10)}
              >
                <MenuItem value={3}>3 seconds</MenuItem>
                <MenuItem value={5}>5 seconds</MenuItem>
                <MenuItem value={10}>10 seconds</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Intelligent Prefetch Section */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <CachedIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                Intelligent Prefetch & Caching
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              Automatically download upcoming tracks for instant playback. Cached tracks play without network delay.
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  size="small" 
                  checked={settings.prefetch_enabled !== false}
                  onChange={(e) => updateSetting('prefetch_enabled', e.target.checked)}
                />
              }
              label={<Typography variant="body2">Enable intelligent prefetching</Typography>}
              sx={{ mb: 1, display: 'block' }}
            />
            
            {/* Cache Statistics */}
            {cacheStats && (
              <Box sx={{ 
                mt: 2, 
                p: 2, 
                bgcolor: 'rgba(255,255,255,0.03)', 
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider'
              }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Cache Statistics
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="primary.main">
                      {cacheStats.count}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Cached tracks
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="primary.main">
                      {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Cache size
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="text.secondary">
                      {(AUDIO_CACHE_CONFIG.maxCacheSize / 1024 / 1024).toFixed(0)} MB
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Max size
                    </Typography>
                  </Box>
                </Box>
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  startIcon={<DeleteSweepIcon />}
                  onClick={handleClearCache}
                  disabled={clearingCache || cacheStats.count === 0}
                  sx={{ mt: 1 }}
                >
                  {clearingCache ? 'Clearing...' : 'Clear Cache'}
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">Normalize audio</Typography>}
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Download Quality */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            Download Quality
          </Typography>

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">Download in best quality</Typography>}
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Lyrics Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            Lyrics
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            Automatically fetch and cache synchronized lyrics for your audio files using LRCLIB API.
          </Typography>

          <FormControlLabel
            control={<Switch defaultChecked />}
            label="Auto-fetch lyrics for new downloads"
            sx={{ mb: 2, display: 'block' }}
          />

          <FormControlLabel
            control={<Switch defaultChecked />}
            label="Show synchronized lyrics in player"
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Setup 2FA Dialog */}
      <Dialog open={setupDialogOpen} onClose={() => setSetupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Enable Two-Factor Authentication</DialogTitle>
        <DialogContent>
          {setupData && (
            <Box>
              {!showBackupCodes ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
                  </Typography>

                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <img src={setupData.qr_code} alt="QR Code" style={{ width: 200, height: 200 }} />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Or enter this code manually:
                  </Typography>
                  <TextField
                    fullWidth
                    value={setupData.secret}
                    InputProps={{ readOnly: true }}
                    sx={{ mb: 2 }}
                  />

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Enter the 6-digit code from your app to verify:
                  </Typography>
                  <TextField
                    fullWidth
                    placeholder="000000"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    inputProps={{ maxLength: 6 }}
                  />

                  {error && (
                    <Alert severity="error" sx={{ mt: 2 }}>
                      {error}
                    </Alert>
                  )}

                  <Button
                    fullWidth
                    variant="text"
                    onClick={() => setShowBackupCodes(true)}
                    sx={{ mt: 2 }}
                  >
                    View Backup Codes
                  </Button>
                </>
              ) : (
                <>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Save these backup codes in a safe place. Each code can only be used once.
                  </Alert>

                  <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1, mb: 2 }}>
                    {setupData.backup_codes.map((code, index) => (
                      <Typography key={index} sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                        {index + 1}. {code}
                      </Typography>
                    ))}
                  </Box>

                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<DownloadIcon />}
                    onClick={() => {
                      const blob = new Blob([setupData.backup_codes.join('\n')], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'soundwave-backup-codes.txt';
                      a.click();
                    }}
                    sx={{ mb: 2 }}
                  >
                    Download Backup Codes
                  </Button>

                  <Button
                    fullWidth
                    variant="text"
                    onClick={() => setShowBackupCodes(false)}
                  >
                    Back to Setup
                  </Button>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetupDialogOpen(false)}>Cancel</Button>
          {!showBackupCodes && (
            <Button onClick={handleVerify2FA} variant="contained" disabled={verificationCode.length !== 6}>
              Verify and Enable
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={disableDialogOpen} onClose={() => setDisableDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Disable Two-Factor Authentication</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Disabling two-factor authentication will make your account less secure.
          </Alert>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter a verification code from your authenticator app or use a backup code:
          </Typography>

          <TextField
            fullWidth
            placeholder="000000"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value)}
            inputProps={{ maxLength: 6 }}
          />

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisableDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDisable2FA}
            variant="contained"
            color="error"
            disabled={disableCode.length !== 6}
          >
            Disable 2FA
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quick Sync Settings */}
      <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 2 }}>
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <SpeedIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">
                Quick Sync - Adaptive Streaming
              </Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <QuickSyncSettings />
          </AccordionDetails>
        </Accordion>
      </Card>

      {/* User Profile Management */}
      <UserProfileCard />

      {/* Admin User Management */}
      {isAdmin && (
        <Card sx={{ maxWidth: 600, bgcolor: 'background.paper', mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <GroupIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">
                User Management
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Manage all users in the system. Create, edit, or delete user accounts and monitor system statistics.
            </Typography>
            <Button
              variant="contained"
              startIcon={<GroupIcon />}
              onClick={() => navigate('/admin/users')}
              fullWidth
              sx={{
                minHeight: { xs: '44px', sm: '48px' },
              }}
            >
              Open User Management
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
