import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { browserSupportsWebAuthn, startRegistration } from '@simplewebauthn/browser';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../utils/formatDate';
import { userAPI } from '../api/client';
import { isDismissedPasskeyPrompt, passkeyErrorKey } from '../utils/passkeys';

const NAME_MAX_LENGTH = 100;

interface Passkey {
  id: number;
  name: string;
  rp_id: string;
  created_at: string;
  last_used_at: string | null;
}

interface PasskeySettingsProps {
  twoFactorEnabled: boolean;
}


export default function PasskeySettings({ twoFactorEnabled }: PasskeySettingsProps) {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [usableHere, setUsableHere] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [name, setName] = useState('');
  const [dialogError, setDialogError] = useState('');
  const [adding, setAdding] = useState(false);
  const [passkeyToRemove, setPasskeyToRemove] = useState<Passkey | null>(null);

  const browserSupported = browserSupportsWebAuthn();

  const loadPasskeys = async () => {
    const response = await userAPI.passkeys();
    setPasskeys(response.data);
  };

  useEffect(() => {
    loadPasskeys().catch(() => setError(t('passkeys.errors.generic')));
    userAPI
      .passkeyAvailability()
      .then((response) => setUsableHere(response.data.usable))
      .catch(() => setUsableHere(false));
  }, []);

  const closeAddDialog = () => {
    setAddDialogOpen(false);
    setPassword('');
    setTwoFactorCode('');
    setName('');
    setDialogError('');
  };

  const handleAdd = async () => {
    setAdding(true);
    setDialogError('');
    try {
      const options = await userAPI.passkeyEnrolOptions({ password, two_factor_code: twoFactorCode });
      const credential = await startRegistration({ optionsJSON: options.data });
      await userAPI.passkeyEnrol({ credential, name });
      await loadPasskeys();
      closeAddDialog();
      setSuccess(t('passkeys.added'));
    } catch (requestError) {
      if (!isDismissedPasskeyPrompt(requestError)) {
        setDialogError(t(passkeyErrorKey(requestError)));
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!passkeyToRemove) return;
    try {
      await userAPI.passkeyRemove(passkeyToRemove.id);
      await loadPasskeys();
      setSuccess(t('passkeys.removed'));
    } catch {
      setError(t('passkeys.errors.generic'));
    }
    setPasskeyToRemove(null);
  };

  const unavailableReason = browserSupported ? t('passkeys.unavailableHere') : t('passkeys.unavailableBrowser');
  const canAdd = browserSupported && usableHere;
  const canSubmit = password !== '' && (!twoFactorEnabled || twoFactorCode !== '') && !adding;

  return (
    <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }} data-testid="passkey-settings">
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
          <FingerprintIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
          <Typography variant="subtitle1" fontWeight={600}>
            {t('passkeys.title')}
          </Typography>
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
          {t('passkeys.description')}
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setSuccess('')}>{success}</Alert>}

        {passkeys.map((passkey) => (
          <Box
            key={passkey.id}
            data-testid="passkey-row"
            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}
          >
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>{passkey.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {t('passkeys.addedOn', { date: formatDate(passkey.created_at) })}
                {' · '}
                {passkey.last_used_at
                  ? t('passkeys.lastUsed', { date: formatDate(passkey.last_used_at) })
                  : t('passkeys.neverUsed')}
              </Typography>
              {passkey.rp_id !== window.location.hostname && (
                <Chip size="small" sx={{ mt: 0.5 }} label={t('passkeys.otherAddress', { address: passkey.rp_id })} />
              )}
            </Box>
            <IconButton
              size="small"
              aria-label={t('passkeys.removeLabel', { name: passkey.name })}
              onClick={() => setPasskeyToRemove(passkey)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}

        {canAdd ? (
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 1 }}
            data-testid="passkey-add"
            onClick={() => setAddDialogOpen(true)}
          >
            {t('passkeys.add')}
          </Button>
        ) : (
          <Alert severity="info" sx={{ mt: 1 }}>{unavailableReason}</Alert>
        )}
      </CardContent>

      <Dialog open={addDialogOpen} onClose={closeAddDialog} fullWidth maxWidth="xs">
        <DialogTitle>{t('passkeys.addDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('passkeys.addDialog.description')}
          </Typography>
          {dialogError && <Alert severity="error" sx={{ mb: 2 }}>{dialogError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="password"
            autoComplete="current-password"
            label={t('passkeys.addDialog.password')}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            inputProps={{ 'data-testid': 'passkey-password' }}
            sx={{ mb: 2 }}
          />
          {twoFactorEnabled && (
            <TextField
              fullWidth
              size="small"
              autoComplete="one-time-code"
              label={t('passkeys.addDialog.twoFactorCode')}
              value={twoFactorCode}
              onChange={(event) => setTwoFactorCode(event.target.value)}
              sx={{ mb: 2 }}
            />
          )}
          <TextField
            fullWidth
            size="small"
            label={t('passkeys.addDialog.name')}
            placeholder={t('passkeys.addDialog.namePlaceholder')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            inputProps={{ maxLength: NAME_MAX_LENGTH, 'data-testid': 'passkey-name' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddDialog}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={!canSubmit} onClick={handleAdd} data-testid="passkey-add-submit">
            {t('passkeys.addDialog.continue')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={passkeyToRemove !== null} onClose={() => setPasskeyToRemove(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('passkeys.removeDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('passkeys.removeDialog.message', { name: passkeyToRemove?.name })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPasskeyToRemove(null)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" onClick={handleRemove} data-testid="passkey-remove-confirm">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
