import { useRef, useState } from 'react';
import {
  Card,
  CardContent,
  Box,
  Typography,
  Button,
  CircularProgress,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Backup';
import RestoreIcon from '@mui/icons-material/Restore';
import { useTranslation } from 'react-i18next';
import { settingsAPI } from '../api/client';

const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;
const BACKUP_FILENAME = 'soundwave_backup.json';

interface RestoreSummary {
  audio_total?: number;
  audio_new?: number;
  playlists_total?: number;
  playlists_new?: number;
  smart_playlists_total?: number;
  smart_playlists_new?: number;
  channels_total?: number;
  channels_new?: number;
  downloads_to_enqueue?: number;
}

export default function BackupRestoreCard() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [snackbar, setSnackbar] = useState('');
  const [error, setError] = useState('');
  const [pendingBackup, setPendingBackup] = useState<unknown>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);

  const readServerError = (err: any, fallbackKey: string) =>
    err?.response?.data?.error || t(fallbackKey);

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setError('');
      const response = await settingsAPI.createBackup();
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = BACKUP_FILENAME;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSnackbar(t('settings.backup.created'));
    } catch {
      setError(t('settings.backup.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.json') || file.size > MAX_BACKUP_FILE_BYTES) {
      setError(t('settings.backup.invalidFile'));
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError(t('settings.backup.invalidFile'));
      return;
    }

    try {
      setError('');
      setPreviewing(true);
      const response = await settingsAPI.restorePreview(parsed);
      setPendingBackup(parsed);
      setSummary(response.data.summary);
    } catch (err: any) {
      setError(readServerError(err, 'settings.backup.restoreFailed'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingBackup) {
      return;
    }
    try {
      setApplying(true);
      await settingsAPI.restore(pendingBackup);
      setSnackbar(t('settings.backup.restored'));
      setPendingBackup(null);
      setSummary(null);
    } catch (err: any) {
      setError(readServerError(err, 'settings.backup.restoreFailed'));
    } finally {
      setApplying(false);
    }
  };

  const closeDialog = () => {
    if (applying) {
      return;
    }
    setPendingBackup(null);
    setSummary(null);
  };

  return (
    <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <BackupIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            {t('settings.backup.title')}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('settings.backup.description')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={creating ? <CircularProgress size={18} /> : <BackupIcon />}
            onClick={handleCreateBackup}
            disabled={creating}
          >
            {t('settings.backup.create')}
          </Button>
          <Button
            variant="outlined"
            startIcon={previewing ? <CircularProgress size={18} /> : <RestoreIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={previewing}
          >
            {t('settings.backup.restore')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
      </CardContent>

      <Dialog open={summary !== null} onClose={closeDialog} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settings.backup.summary')}</DialogTitle>
        <DialogContent dividers>
          <List dense>
            <ListItem disableGutters>
              <ListItemText primary={t('settings.backup.counts.playlists', { count: summary?.playlists_new ?? 0, total: summary?.playlists_total ?? 0 })} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary={t('settings.backup.counts.smartPlaylists', { count: summary?.smart_playlists_new ?? 0, total: summary?.smart_playlists_total ?? 0 })} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary={t('settings.backup.counts.channels', { count: summary?.channels_new ?? 0, total: summary?.channels_total ?? 0 })} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary={t('settings.backup.counts.tracks', { count: summary?.audio_new ?? 0, total: summary?.audio_total ?? 0 })} />
            </ListItem>
            <ListItem disableGutters>
              <ListItemText primary={t('settings.backup.counts.downloads', { count: summary?.downloads_to_enqueue ?? 0 })} />
            </ListItem>
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={applying}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleConfirmRestore}
            disabled={applying}
            startIcon={applying ? <CircularProgress size={18} /> : <RestoreIcon />}
          >
            {t('settings.backup.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={4000}
        onClose={() => setSnackbar('')}
        message={snackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Card>
  );
}
