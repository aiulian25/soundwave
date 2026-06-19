import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  InputAdornment,
  IconButton,
  Alert,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import { userAPI } from '../api/client';
import { useTranslation } from 'react-i18next';

interface ForcePasswordChangePageProps {
  /** Called after the password is successfully changed. */
  onChanged: () => void;
  /** Called when the user chooses to sign out instead. */
  onLogout: () => void;
}

const MIN_LENGTH = 8;

const fieldSx = {
  marginBottom: 2,
  '& .MuiOutlinedInput-root': {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 3,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
    '& fieldset': { borderColor: 'rgba(34, 211, 238, 0.2)', borderWidth: 2 },
    '&:hover fieldset': { borderColor: 'rgba(34, 211, 238, 0.4)' },
    '&.Mui-focused fieldset': { borderColor: '#22d3ee', borderWidth: 2 },
  },
  '& .MuiOutlinedInput-input': {
    padding: { xs: '14px 16px', sm: '16px 18px' },
    fontSize: '0.95rem',
    color: '#f8fafc',
  },
} as const;

export default function ForcePasswordChangePage({ onChanged, onLogout }: ForcePasswordChangePageProps) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('forcePasswordChange.errors.fillAllFields'));
      return;
    }
    if (newPassword.length < MIN_LENGTH) {
      setError(t('forcePasswordChange.errors.tooShort', { count: MIN_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('forcePasswordChange.errors.mismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('forcePasswordChange.errors.sameAsCurrent'));
      return;
    }

    setSubmitting(true);
    try {
      await userAPI.changePassword({ current_password: currentPassword, new_password: newPassword });
      setSuccess(true);
      // Brief success state, then continue into the app.
      setTimeout(onChanged, 800);
    } catch (err: any) {
      setError(err?.response?.data?.error || t('forcePasswordChange.errors.failed'));
      setSubmitting(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        width: '100vw',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: { xs: 2, sm: 4 },
        overflow: 'auto',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: { xs: '100%', sm: 460 },
          backgroundColor: 'rgba(30, 41, 59, 0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: { xs: 4, sm: 5 },
          border: '1px solid rgba(34, 211, 238, 0.1)',
          padding: { xs: 3, sm: 4 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(34, 211, 238, 0.12)',
            border: '2px solid rgba(34, 211, 238, 0.25)',
            mb: 2.5,
          }}
        >
          <ShieldOutlinedIcon sx={{ color: '#22d3ee', fontSize: 36 }} />
        </Box>

        <Typography
          variant="h4"
          sx={{
            color: '#f8fafc',
            fontWeight: 700,
            fontSize: { xs: '1.4rem', sm: '1.6rem' },
            textAlign: 'center',
            mb: 1,
          }}
        >
          {t('forcePasswordChange.title')}
        </Typography>
        <Typography
          sx={{
            color: '#94a3b8',
            fontSize: '0.9rem',
            textAlign: 'center',
            mb: 3,
            maxWidth: 380,
          }}
        >
          {t('forcePasswordChange.subtitle')}
        </Typography>

        <Box sx={{ width: '100%' }}>
          <TextField
            fullWidth
            type={showPwd ? 'text' : 'password'}
            placeholder={t('forcePasswordChange.currentPassword')}
            aria-label={t('forcePasswordChange.currentPassword')}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            onKeyPress={handleKeyPress}
            autoFocus
            disabled={submitting || success}
            autoComplete="current-password"
            sx={fieldSx}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPwd((v) => !v)}
                    edge="end"
                    aria-label={showPwd ? t('forcePasswordChange.hidePassword') : t('forcePasswordChange.showPassword')}
                    sx={{ color: '#22d3ee' }}
                  >
                    {showPwd ? (
                      <VisibilityOffOutlinedIcon sx={{ fontSize: 20 }} />
                    ) : (
                      <VisibilityOutlinedIcon sx={{ fontSize: 20 }} />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <TextField
            fullWidth
            type={showPwd ? 'text' : 'password'}
            placeholder={t('forcePasswordChange.newPassword')}
            aria-label={t('forcePasswordChange.newPassword')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={submitting || success}
            autoComplete="new-password"
            sx={fieldSx}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
          />

          <TextField
            fullWidth
            type={showPwd ? 'text' : 'password'}
            placeholder={t('forcePasswordChange.confirmPassword')}
            aria-label={t('forcePasswordChange.confirmPassword')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            onKeyPress={handleKeyPress}
            disabled={submitting || success}
            autoComplete="new-password"
            sx={fieldSx}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
          />

          <Typography sx={{ color: '#64748b', fontSize: '0.78rem', mb: 2, px: 0.5 }}>
            {t('forcePasswordChange.hint', { count: MIN_LENGTH })}
          </Typography>

          <Button
            fullWidth
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || success}
            endIcon={<ArrowForwardIcon />}
            sx={{
              background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
              color: '#0f172a',
              padding: { xs: '13px', sm: '15px' },
              borderRadius: 3,
              fontSize: '0.95rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              boxShadow: '0 4px 20px rgba(34, 211, 238, 0.4)',
              '&:hover': {
                background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                transform: 'translateY(-2px)',
              },
              transition: 'all 0.3s ease',
              '&:disabled': { backgroundColor: 'rgba(100, 100, 100, 0.5)', color: 'rgba(255, 255, 255, 0.5)' },
            }}
          >
            {t('forcePasswordChange.submit')}
          </Button>

          <Button
            fullWidth
            variant="text"
            onClick={onLogout}
            disabled={submitting || success}
            startIcon={<LogoutIcon sx={{ fontSize: 18 }} />}
            sx={{ mt: 1.5, color: '#94a3b8', textTransform: 'none', fontSize: '0.85rem', '&:hover': { color: '#cbd5e1' } }}
          >
            {t('forcePasswordChange.signOut')}
          </Button>

          {success && (
            <Alert severity="success" sx={{ mt: 2, backgroundColor: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
              {t('forcePasswordChange.success')}
            </Alert>
          )}

          {error && !success && (
            <Typography
              role="alert"
              sx={{
                color: '#ef4444',
                fontSize: '0.875rem',
                marginTop: 2,
                textAlign: 'center',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                padding: '8px 12px',
                borderRadius: 2,
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}
            >
              {error}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
