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
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
  Checkbox,
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
import SyncIcon from '@mui/icons-material/Sync';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
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
import { useTranslation } from 'react-i18next';

interface TwoFactorStatus {
  enabled: boolean;
  backup_codes_count: number;
}

interface TwoFactorSetup {
  secret: string;
  qr_code: string;
  backup_codes: string[];
}

interface APIKey {
  id: number;
  name: string;
  key_prefix: string;
  permission: string;
  scope_stats: boolean;
  scope_audio: boolean;
  scope_channels: boolean;
  scope_playlists: boolean;
  scope_downloads: boolean;
  is_active: boolean;
  created_at: string;
  last_used: string | null;
  expires_at: string | null;
}

interface NewAPIKey extends APIKey {
  key: string; // Full key, only available when created
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
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
  
  // API Keys state
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('Widget API Key');
  const [newApiKey, setNewApiKey] = useState<NewAPIKey | null>(null);
  const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);

  useEffect(() => {
    loadTwoFactorStatus();
    checkAdminStatus();
    loadCacheStats();
    loadApiKeys();
  }, []);
  
  const loadApiKeys = async () => {
    try {
      const response = await userAPI.listApiKeys();
      setApiKeys(response.data);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  };
  
  const handleCreateApiKey = async () => {
    try {
      setError('');
      const response = await userAPI.createApiKey({ 
        name: newApiKeyName,
        permission: 'read',
        scope_stats: true,
      });
      setNewApiKey(response.data);
      setApiKeyDialogOpen(false);
      loadApiKeys();
      setSuccess(t('settings.alerts.apiKeyCreated'));
      setTimeout(() => setSuccess(''), 10000);
    } catch (err) {
      setError(t('settings.alerts.apiKeyCreateFailed'));
    }
  };
  
  const handleDeleteApiKey = async (keyId: number) => {
    try {
      await userAPI.deleteApiKey(keyId);
      setDeleteKeyId(null);
      loadApiKeys();
      setSuccess(t('settings.alerts.apiKeyDeleted'));
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(t('settings.alerts.apiKeyDeleteFailed'));
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccess(t('settings.alerts.copiedToClipboard'));
    setTimeout(() => setSuccess(''), 2000);
  };
  
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
      setSuccess(t('settings.alerts.audioCacheCleared'));
    } catch (err) {
      setError(t('settings.alerts.audioCacheClearFailed'));
    } finally {
      setClearingCache(false);
    }
  };
  
  const checkAdminStatus = async () => {
    try {
      const response = await userAPI.account();
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
      setError(t('settings.alerts.setup2faFailed'));
    }
  };

  const handleVerify2FA = async () => {
    try {
      setError('');
      await userAPI.twoFactorVerify({ code: verificationCode });
      setSuccess(t('settings.alerts.twoFactorEnabled'));
      setSetupDialogOpen(false);
      setVerificationCode('');
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(t('settings.alerts.invalidVerificationCode'));
    }
  };

  const handleDisable2FA = async () => {
    try {
      setError('');
      await userAPI.twoFactorDisable({ code: disableCode });
      setSuccess(t('settings.alerts.twoFactorDisabled'));
      setDisableDialogOpen(false);
      setDisableCode('');
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(t('settings.alerts.invalidVerificationCode'));
    }
  };

  const handleRegenerateCodes = async () => {
    try {
      setError('');
      const response = await userAPI.twoFactorRegenerateCodes();
      setSetupData({ ...setupData!, backup_codes: response.data.backup_codes });
      setShowBackupCodes(true);
      setSuccess(t('settings.alerts.backupCodesRegenerated'));
      loadTwoFactorStatus();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(t('settings.alerts.regenerateBackupCodesFailed'));
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
      setError(t('settings.alerts.downloadBackupCodesFailed'));
    }
  };

  const handleLanguageChange = async (language: string) => {
    await i18n.changeLanguage(language);
  };

  return (
    <Box sx={{ pb: 4 }}>
      <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
        {t('settings.title')}
      </Typography>

      {success && (
        <Alert severity="success" sx={{ mb: 1.5 }}>
          {success}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}

      {/* Appearance Settings */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <PaletteIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settings.appearance.title')}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('settings.appearance.description')}
          </Typography>

          <FormControl fullWidth sx={{ mb: 1.5 }} size="small">
            <InputLabel>{t('settings.appearance.themeLabel')}</InputLabel>
            <Select
              value={themeMode}
              label={t('settings.appearance.themeLabel')}
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

      {/* Language Settings */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <PaletteIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settings.language.title')}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('settings.language.description')}
          </Typography>

          <FormControl fullWidth size="small">
            <InputLabel>{t('settings.language.label')}</InputLabel>
            <Select
              value={i18n.resolvedLanguage?.startsWith('ro') ? 'ro' : 'en'}
              label={t('settings.language.label')}
              onChange={(e) => handleLanguageChange(e.target.value)}
            >
              <MenuItem value="en">{t('settings.language.options.en')}</MenuItem>
              <MenuItem value="ro">{t('settings.language.options.ro')}</MenuItem>
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      {/* Visualizer Settings */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <EqualizerIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settings.visualizer.title')}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('settings.visualizer.description')}
          </Typography>

          <FormControlLabel
            control={
              <Switch 
                size="small" 
                checked={settings.visualizer_enabled}
                onChange={(e) => updateSetting('visualizer_enabled', e.target.checked)}
              />
            }
            label={<Typography variant="body2">{t('settings.visualizer.enableLabel')}</Typography>}
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
                label={<Typography variant="body2">{t('settings.visualizer.glowLabel')}</Typography>}
                sx={{ mb: 2, display: 'block' }}
              />

              <Typography variant="body2" fontWeight={500} sx={{ mb: 1.5 }}>
                {t('settings.visualizer.themeSection')}
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
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <SecurityIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settings.twoFactor.title')}
            </Typography>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            {t('settings.twoFactor.description')}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Chip
              label={twoFactorStatus.enabled ? t('settings.twoFactor.enabled') : t('settings.twoFactor.disabled')}
              color={twoFactorStatus.enabled ? 'success' : 'default'}
              size="small"
            />
            {twoFactorStatus.enabled && (
              <Typography variant="caption" color="text.secondary">
                {t('settings.twoFactor.backupCodesRemaining', { count: twoFactorStatus.backup_codes_count })}
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
                {t('settings.twoFactor.enableButton')}
              </Button>
            ) : (
              <>
                <Button
                  variant="outlined"
                  color="error"
                  onClick={() => setDisableDialogOpen(true)}
                >
                  {t('settings.twoFactor.disableButton')}
                </Button>
                <Divider />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('settings.twoFactor.backupCodesTitle')}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<DownloadIcon />}
                      onClick={handleDownloadCodes}
                    >
                      {t('settings.twoFactor.downloadCodesButton')}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<RefreshIcon />}
                      onClick={handleRegenerateCodes}
                    >
                      {t('settings.twoFactor.regenerateCodesButton')}
                    </Button>
                  </Stack>
                </Box>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* API Keys Section */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <VpnKeyIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('settings.apiKeys.title')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setApiKeyDialogOpen(true)}
            >
              {t('settings.apiKeys.createKeyButton')}
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('settings.apiKeys.description')}
          </Typography>

          {newApiKey && (
            <Alert 
              severity="warning" 
              sx={{ mb: 2 }}
              action={
                <IconButton size="small" onClick={() => copyToClipboard(newApiKey.key)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              }
            >
              <Typography variant="body2" fontWeight={600}>{t('settings.apiKeys.saveKeyWarning')}</Typography>
              <Typography 
                variant="body2" 
                sx={{ 
                  fontFamily: 'monospace', 
                  bgcolor: 'action.hover', 
                  p: 0.5, 
                  borderRadius: 1,
                  mt: 0.5,
                  wordBreak: 'break-all'
                }}
              >
                {newApiKey.key}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('settings.apiKeys.saveKeyCaption')}
              </Typography>
            </Alert>
          )}

          {apiKeys.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              {t('settings.apiKeys.noKeysYet')}
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settings.apiKeys.table.name')}</TableCell>
                    <TableCell>{t('settings.apiKeys.table.key')}</TableCell>
                    <TableCell>{t('settings.apiKeys.table.lastUsed')}</TableCell>
                    <TableCell align="right">{t('settings.apiKeys.table.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{key.name}</Typography>
                          <Chip 
                            label={key.is_active ? t('adminUsers.status.active') : t('adminUsers.status.inactive')} 
                            size="small" 
                            color={key.is_active ? 'success' : 'default'}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {key.key_prefix}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {key.last_used 
                            ? new Date(key.last_used).toLocaleDateString() 
                            : t('adminUsers.values.never')}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title={t('settings.apiKeys.deleteKeyTooltip')}>
                          <IconButton 
                            size="small" 
                            color="error"
                            onClick={() => setDeleteKeyId(key.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
              {t('settings.apiKeys.widgetConfig')}
            </Typography>
            <Typography 
              variant="caption" 
              component="pre"
              sx={{ 
                fontFamily: 'monospace', 
                whiteSpace: 'pre-wrap',
                m: 0,
                fontSize: '0.7rem'
              }}
            >
{`widget:
  type: tubearchivist
  url: ${window.location.origin}
  key: YOUR_API_KEY_HERE
  fields: ["downloads", "videos", "channels", "playlists"]`}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Playback Settings */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
            <SpeedIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('settings.playback.title')}
            </Typography>
          </Box>

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">{t('settings.playback.autoplayLabel')}</Typography>}
            sx={{ mb: 2, display: 'block' }}
          />

          {/* Smart Shuffle Section */}
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <ShuffleIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                {t('settings.playback.smartShuffle.title')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {t('settings.playback.smartShuffle.description')}
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  size="small" 
                  checked={settings.smart_shuffle_enabled}
                  onChange={(e) => updateSetting('smart_shuffle_enabled', e.target.checked)}
                />
              }
              label={<Typography variant="body2">{t('settings.playback.smartShuffle.enableLabel')}</Typography>}
              sx={{ mb: 1, display: 'block' }}
            />
            {settings.smart_shuffle_enabled && (
              <Box sx={{ pl: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  {t('settings.playback.smartShuffle.historySize', { count: settings.smart_shuffle_history_size })}
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
                  {t('settings.playback.smartShuffle.historySizeHelp')}
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
                {t('settings.playback.seekDuration.title')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {t('settings.playback.seekDuration.description')}
            </Typography>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select
                value={settings.seek_duration || 3}
                onChange={(e) => updateSetting('seek_duration', Number(e.target.value) as 3 | 5 | 10)}
              >
                <MenuItem value={3}>{t('settings.playback.seekDuration.seconds', { count: 3 })}</MenuItem>
                <MenuItem value={5}>{t('settings.playback.seekDuration.seconds', { count: 5 })}</MenuItem>
                <MenuItem value={10}>{t('settings.playback.seekDuration.seconds', { count: 10 })}</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Intelligent Prefetch Section */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <CachedIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                {t('settings.playback.prefetch.title')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {t('settings.playback.prefetch.description')}
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  size="small" 
                  checked={settings.prefetch_enabled !== false}
                  onChange={(e) => updateSetting('prefetch_enabled', e.target.checked)}
                />
              }
              label={<Typography variant="body2">{t('settings.playback.prefetch.enableLabel')}</Typography>}
              sx={{ mb: 1, display: 'block' }}
            />
            
            {/* Cross-device sync setting */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, mt: 2 }}>
              <SyncIcon sx={{ mr: 1, color: 'text.secondary', fontSize: '1.1rem' }} />
              <Typography variant="body2" fontWeight={500}>
                {t('settings.playback.sync.title')}
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {t('settings.playback.sync.description')}
            </Typography>
            <FormControlLabel
              control={
                <Switch 
                  size="small" 
                  checked={settings.playback_sync_enabled !== false}
                  onChange={(e) => updateSetting('playback_sync_enabled', e.target.checked)}
                />
              }
              label={<Typography variant="body2">{t('settings.playback.sync.enableLabel')}</Typography>}
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
                  {t('settings.playback.cacheStats.title')}
                </Typography>
                <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="primary.main">
                      {cacheStats.count}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.playback.cacheStats.cachedTracks')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="primary.main">
                      {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.playback.cacheStats.cacheSize')}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="h6" fontWeight={600} color="text.secondary">
                      {(AUDIO_CACHE_CONFIG.maxCacheSize / 1024 / 1024).toFixed(0)} MB
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('settings.playback.cacheStats.maxSize')}
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
                  {clearingCache ? t('settings.playback.cacheStats.clearing') : t('settings.playback.cacheStats.clearButton')}
                </Button>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">{t('settings.playback.normalizeLabel')}</Typography>}
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Download Quality */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            {t('settings.downloadQuality.title')}
          </Typography>

          <FormControlLabel
            control={<Switch defaultChecked size="small" />}
            label={<Typography variant="body2">{t('settings.downloadQuality.bestQualityLabel')}</Typography>}
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Lyrics Settings */}
      <Card sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            {t('settings.lyrics.title')}
          </Typography>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            {t('settings.lyrics.description')}
          </Typography>

          <FormControlLabel
            control={<Switch defaultChecked />}
            label={t('settings.lyrics.autoFetchLabel')}
            sx={{ mb: 2, display: 'block' }}
          />

          <FormControlLabel
            control={<Switch defaultChecked />}
            label={t('settings.lyrics.showInPlayerLabel')}
            sx={{ display: 'block' }}
          />
        </CardContent>
      </Card>

      {/* Setup 2FA Dialog */}
      <Dialog open={setupDialogOpen} onClose={() => setSetupDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('settings.twoFactor.setupDialog.title')}</DialogTitle>
        <DialogContent>
          {setupData && (
            <Box>
              {!showBackupCodes ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('settings.twoFactor.setupDialog.scanQrCode')}
                  </Typography>

                  <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                    <img src={setupData.qr_code} alt="QR Code" style={{ width: 200, height: 200 }} />
                  </Box>

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('settings.twoFactor.setupDialog.orEnterManually')}
                  </Typography>
                  <TextField
                    fullWidth
                    value={setupData.secret}
                    InputProps={{ readOnly: true }}
                    sx={{ mb: 2 }}
                  />

                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('settings.twoFactor.setupDialog.enterCodeToVerify')}
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
                    {t('settings.twoFactor.setupDialog.viewBackupCodes')}
                  </Button>
                </>
              ) : (
                <>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    {t('settings.twoFactor.setupDialog.saveBackupCodesWarning')}
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
                    {t('settings.twoFactor.downloadCodesButton')}
                  </Button>

                  <Button
                    fullWidth
                    variant="text"
                    onClick={() => setShowBackupCodes(false)}
                  >
                    {t('settings.twoFactor.setupDialog.backToSetup')}
                  </Button>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSetupDialogOpen(false)}>{t('common.cancel')}</Button>
          {!showBackupCodes && (
            <Button onClick={handleVerify2FA} variant="contained" disabled={verificationCode.length !== 6}>
              {t('settings.twoFactor.setupDialog.verifyAndEnable')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Disable 2FA Dialog */}
      <Dialog open={disableDialogOpen} onClose={() => setDisableDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('settings.twoFactor.disableDialog.title')}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('settings.twoFactor.disableDialog.warning')}
          </Alert>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.twoFactor.disableDialog.enterCode')}
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
          <Button onClick={() => setDisableDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleDisable2FA}
            variant="contained"
            color="error"
            disabled={disableCode.length !== 6}
          >
            {t('settings.twoFactor.disableDialog.disableButton')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create API Key Dialog */}
      <Dialog 
        open={apiKeyDialogOpen} 
        onClose={() => {
          setApiKeyDialogOpen(false);
          setNewApiKeyName('Widget API Key');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('settings.apiKeys.createDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.apiKeys.createDialog.description')}
          </Typography>
          <TextField
            autoFocus
            label={t('settings.apiKeys.createDialog.keyNameLabel')}
            fullWidth
            value={newApiKeyName}
            onChange={(e) => setNewApiKeyName(e.target.value)}
            placeholder={t('settings.apiKeys.createDialog.keyNamePlaceholder')}
            size="small"
            sx={{ mb: 2 }}
          />
          <Alert severity="info" sx={{ mb: 1 }}>
            {t('settings.apiKeys.createDialog.copyWarning')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApiKeyDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            onClick={handleCreateApiKey}
            disabled={!newApiKeyName.trim()}
          >
            {t('settings.apiKeys.createDialog.createButton')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete API Key Confirmation Dialog */}
      <Dialog
        open={deleteKeyId !== null}
        onClose={() => setDeleteKeyId(null)}
      >
        <DialogTitle>{t('settings.apiKeys.deleteDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('settings.apiKeys.deleteDialog.description')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteKeyId(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={() => deleteKeyId && handleDeleteApiKey(deleteKeyId)}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quick Sync Settings */}
      <Card sx={{ bgcolor: 'background.paper', mb: 2 }}>
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <SpeedIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">
                {t('settings.quickSync.title')}
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
        <Card sx={{ bgcolor: 'background.paper', mb: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <GroupIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">
                {t('adminUsers.title')}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('settings.userManagement.description')}
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
              {t('settings.userManagement.openButton')}
            </Button>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
