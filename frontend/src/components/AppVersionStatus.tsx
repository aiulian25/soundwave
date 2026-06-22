import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  ButtonBase,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import GitHubIcon from '@mui/icons-material/GitHub';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { versionAPI } from '../api/client';

interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  release_notes: string;
  repo_url: string;
}

/**
 * Sidebar version line + "update available" notification.
 *
 * The newer-version check is performed and cached server-side (see backend
 * common.update_check), so this only reads one cached endpoint. When no update
 * exists (or the user is offline) it simply shows the version line.
 */
export default function AppVersionStatus() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    versionAPI
      .getInfo()
      .then((res) => {
        if (active) setInfo(res.data);
      })
      .catch(() => {
        /* offline / not logged in — show nothing, never error */
      });
    return () => {
      active = false;
    };
  }, []);

  if (!info) return null;

  const updateCmd =
    'docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d';

  return (
    <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
      <Typography
        sx={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 700, color: 'text.secondary' }}
      >
        {t('appVersion.label')}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: '#58a6ff' }}>
          v{info.current_version}
        </Typography>

        {info.update_available && (
          <Tooltip title={t('appVersion.tooltip')}>
            <ButtonBase
              onClick={() => setOpen(true)}
              aria-label={t('appVersion.tooltip')}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.4,
                borderRadius: 9999,
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: 0.5,
                color: '#58a6ff',
                border: '1px solid #58a6ff',
                bgcolor: 'rgba(88,166,255,0.14)',
                animation: 'swUpdatePulse 1.4s ease-in-out infinite',
                '@keyframes swUpdatePulse': {
                  '0%,100%': { boxShadow: '0 0 0 0 rgba(88,166,255,0.45)' },
                  '50%': { boxShadow: '0 0 10px 3px rgba(88,166,255,0.55)' },
                },
                // Accessibility: don't animate for users who prefer reduced motion.
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }}
            >
              <FiberManualRecordIcon sx={{ fontSize: 8 }} />
              {t('appVersion.updateButton')}
            </ButtonBase>
          </Tooltip>
        )}
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
          <SystemUpdateAltIcon sx={{ color: '#58a6ff' }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography component="span" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {t('appVersion.dialog.title')}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {t('appVersion.dialog.running', { version: info.current_version })}
              {' · '}
              {t('appVersion.dialog.latest', { version: info.latest_version })}
            </Typography>
          </Box>
          <IconButton
            onClick={() => setOpen(false)}
            aria-label={t('common.close')}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers>
          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ display: 'block', mb: 1 }}
          >
            {t('appVersion.dialog.whatsNew')}
          </Typography>
          {/* Rendered as plain pre-wrapped text (not HTML) so release notes can't inject markup. */}
          <Typography
            component="pre"
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', m: 0 }}
          >
            {info.release_notes?.trim() || t('appVersion.dialog.noNotes')}
          </Typography>

          <Box
            sx={{
              mt: 2,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {t('appVersion.dialog.howToTitle')}
            </Typography>
            <Typography
              component="code"
              sx={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' }}
            >
              {updateCmd}
            </Typography>
          </Box>
        </DialogContent>

        <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
          <Button
            component="a"
            href={info.release_url || info.repo_url}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            startIcon={<GitHubIcon />}
            endIcon={<OpenInNewIcon sx={{ fontSize: 16 }} />}
          >
            {t('appVersion.dialog.viewOnGithub')}
          </Button>
          <Button onClick={() => setOpen(false)} color="inherit">
            {t('appVersion.dialog.dismiss')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
