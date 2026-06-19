import { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import MarkEmailReadOutlinedIcon from '@mui/icons-material/MarkEmailReadOutlined';
import { useTranslation } from 'react-i18next';
import { userAPI } from '../api/client';

type Status = 'confirming' | 'success' | 'error';

const ERROR_CODE_KEYS: Record<string, string> = {
  expired: 'emailVerification.errors.expired',
  invalid: 'emailVerification.errors.invalid',
  email_taken: 'emailVerification.errors.emailTaken',
};

/**
 * Standalone page reached from the emailed confirmation link (works while logged
 * out / on another device). Confirms a pending email change via the signed token.
 */
export default function ConfirmEmailPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('confirming');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setStatus('error');
      setErrorMsg(t('emailVerification.errors.invalid'));
      return;
    }
    let cancelled = false;
    userAPI
      .confirmEmail(token)
      .then(() => {
        if (!cancelled) setStatus('success');
      })
      .catch((err) => {
        if (cancelled) return;
        const code = err?.response?.data?.code as string | undefined;
        const key = code && ERROR_CODE_KEYS[code];
        setErrorMsg(key ? t(key) : t('emailVerification.errors.generic'));
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, sm: 4 },
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 440,
          backgroundColor: 'rgba(30, 41, 59, 0.8)',
          backdropFilter: 'blur(20px)',
          borderRadius: { xs: 4, sm: 5 },
          border: '1px solid rgba(34, 211, 238, 0.1)',
          p: { xs: 3, sm: 4 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
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
            mb: 2.5,
            backgroundColor:
              status === 'success'
                ? 'rgba(34, 197, 94, 0.12)'
                : status === 'error'
                ? 'rgba(239, 68, 68, 0.12)'
                : 'rgba(34, 211, 238, 0.12)',
            border: `2px solid ${
              status === 'success'
                ? 'rgba(34, 197, 94, 0.3)'
                : status === 'error'
                ? 'rgba(239, 68, 68, 0.3)'
                : 'rgba(34, 211, 238, 0.25)'
            }`,
          }}
        >
          {status === 'confirming' && <CircularProgress size={32} sx={{ color: '#22d3ee' }} />}
          {status === 'success' && <CheckCircleOutlineIcon sx={{ color: '#22c55e', fontSize: 38 }} />}
          {status === 'error' && <ErrorOutlineIcon sx={{ color: '#ef4444', fontSize: 38 }} />}
        </Box>

        <Typography variant="h5" sx={{ color: '#f8fafc', fontWeight: 700, mb: 1, fontSize: { xs: '1.3rem', sm: '1.5rem' } }}>
          {t('emailVerification.confirmTitle')}
        </Typography>

        <Typography sx={{ color: '#94a3b8', fontSize: '0.95rem', mb: 3 }}>
          {status === 'confirming' && t('emailVerification.confirming')}
          {status === 'success' && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <MarkEmailReadOutlinedIcon sx={{ fontSize: 18, color: '#22c55e' }} />
              {t('emailVerification.success')}
            </Box>
          )}
          {status === 'error' && errorMsg}
        </Typography>

        {status !== 'confirming' && (
          <Button
            href="/"
            variant="contained"
            sx={{
              background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
              color: '#0f172a',
              px: 4,
              py: 1.25,
              borderRadius: 3,
              fontWeight: 700,
              textTransform: 'none',
              '&:hover': { background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)' },
            }}
          >
            {t('emailVerification.goToApp')}
          </Button>
        )}
      </Box>
    </Box>
  );
}
