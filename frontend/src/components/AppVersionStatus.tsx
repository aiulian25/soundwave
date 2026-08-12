import { useCallback, useEffect, useRef, useState } from 'react';
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
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DoneIcon from '@mui/icons-material/Done';
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

// Plain default compose file — self-hosters run the standard docker-compose.yml, not the prod one.
const UPDATE_COMMAND = 'docker compose pull && docker compose up -d';

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
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);

  const loadInfo = useCallback(() => {
    versionAPI
      .getInfo()
      .then((res) => setInfo(res.data))
      .catch(() => {
        /* offline / not logged in — show nothing, never error */
      });
  }, []);

  // Fetch on mount, and re-check when the tab becomes visible again or reconnects — so a
  // redeployed container's new version is picked up without a manual reload (the response is
  // also sent no-store server-side, so it is never served from a stale cache).
  useEffect(() => {
    loadInfo();
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadInfo();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', loadInfo);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', loadInfo);
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    };
  }, [loadInfo]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(UPDATE_COMMAND);
      } else {
        // Fallback for non-secure contexts (some LAN HTTP setups): temp textarea + execCommand.
        const textarea = document.createElement('textarea');
        textarea.value = UPDATE_COMMAND;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
      copyResetRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the command stays visible for manual copy */
    }
  };

  if (!info) return null;

  const updateAvailable = info.update_available;
  const color = updateAvailable ? RED : BLUE;
  const statusLabel = updateAvailable ? t('appVersion.tooltip') : t('appVersion.upToDate');
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
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('appVersion.dialog.howToTitle')}
                </Typography>
                <Tooltip title={copied ? t('appVersion.dialog.copied') : t('appVersion.dialog.copy')}>
                  <IconButton
                    size="small"
                    onClick={handleCopy}
                    aria-label={t('appVersion.dialog.copy')}
                    color={copied ? 'success' : 'default'}
                    sx={{ mt: -0.5, mr: -0.5 }}
                  >
                    {copied ? <DoneIcon sx={{ fontSize: 16 }} /> : <ContentCopyIcon sx={{ fontSize: 16 }} />}
                  </IconButton>
                </Tooltip>
              </Box>
              <Box
                component="pre"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  m: 0,
                }}
              >
                {UPDATE_COMMAND}
              </Box>
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
