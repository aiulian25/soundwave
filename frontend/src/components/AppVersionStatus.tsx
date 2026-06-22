import { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Tooltip,
  alpha,
} from '@mui/material';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
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

const BLUE = '#58a6ff';
const RED = '#ff5252';

/**
 * Sidebar version line + update status.
 *
 * A round, flashing status button always sits next to the version: blue when the
 * app is up to date, red when a newer GitHub Release exists. Clicking it opens a
 * dialog (release notes + GitHub link; the update command only when an update is
 * available). The newer-version check is server-side + cached (common.update_check),
 * so this only reads one cached endpoint and shows just the version line if offline.
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

  const updateAvailable = info.update_available;
  const color = updateAvailable ? RED : BLUE;
  const statusLabel = updateAvailable ? t('appVersion.tooltip') : t('appVersion.upToDate');
  const updateCmd =
    'docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d';
  const hasNotes = !!info.release_notes?.trim();

  return (
    <Box sx={{ px: 2, pt: 1, pb: 0.5 }}>
      <Typography
        sx={{ fontSize: 11, letterSpacing: 0.5, fontWeight: 700, color: 'text.secondary' }}
      >
        {t('appVersion.label')}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
        <Typography sx={{ fontSize: 18, fontWeight: 700, color: BLUE }}>
          V{info.current_version}
        </Typography>

        {/* Always-on round status button: blue = up to date, red = update available. */}
        <Tooltip title={statusLabel}>
          <IconButton
            onClick={() => setOpen(true)}
            aria-label={statusLabel}
            size="small"
            sx={{
              width: 30,
              height: 30,
              color,
              border: `1px solid ${color}`,
              bgcolor: alpha(color, 0.14),
              '&:hover': { bgcolor: alpha(color, 0.24) },
              animation: 'swStatusPulse 1.6s ease-in-out infinite',
              '@keyframes swStatusPulse': {
                '0%, 100%': { boxShadow: `0 0 0 0 ${alpha(color, 0.45)}` },
                '50%': { boxShadow: `0 0 9px 3px ${alpha(color, 0.55)}` },
              },
              // Accessibility: don't animate for users who prefer reduced motion.
              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
            }}
          >
            {updateAvailable ? (
              <SystemUpdateAltIcon sx={{ fontSize: 16 }} />
            ) : (
              <CloudDoneIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6 }}>
          {updateAvailable ? (
            <SystemUpdateAltIcon sx={{ color: RED }} />
          ) : (
            <CloudDoneIcon sx={{ color: BLUE }} />
          )}
          <Box sx={{ minWidth: 0 }}>
            <Typography component="span" sx={{ fontWeight: 700, fontSize: '1.1rem' }}>
              {updateAvailable
                ? t('appVersion.dialog.title')
                : t('appVersion.dialog.upToDateTitle')}
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
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {t('appVersion.dialog.whatsNew')}
          </Typography>
          {/* Rendered as plain pre-wrapped text (not HTML) so release notes can't inject markup. */}
          <Typography
            component="pre"
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', m: 0 }}
          >
            {hasNotes ? info.release_notes.trim() : t('appVersion.dialog.noNotes')}
          </Typography>

          {updateAvailable && (
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
          )}
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
