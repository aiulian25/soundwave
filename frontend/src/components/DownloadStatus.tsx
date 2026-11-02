import { useState } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Badge,
  Popover,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  CircularProgress,
  LinearProgress,
  Chip,
  Tooltip,
  Button,
  Divider,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CloudDownload as DownloadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Schedule as PendingIcon,
  Sync as SyncIcon,
  CloudOff as OfflineIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useBackgroundDownload } from '../hooks/useBackgroundDownload';
import { describeDownloadError } from '../utils/downloadErrors';

interface DownloadStatusProps {
  variant?: 'icon' | 'button';
}

export default function DownloadStatus({ variant = 'icon' }: DownloadStatusProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const {
    isOnline,
    activeDownloads,
    isLoading,
    refreshStatus,
    startPolling,
    stopPolling,
  } = useBackgroundDownload();

  const open = Boolean(anchorEl);
  
  // Calculate total active downloads
  const totalDownloading = activeDownloads.filter(d => d.status === 'downloading').length;
  const totalActive = totalDownloading + activeDownloads.filter(d => d.status === 'pending').length;
  
  const hasActivity = totalActive > 0;

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
    // Start polling when popup opens - lazy loading
    startPolling();
    refreshStatus();
  };

  const handleClose = () => {
    setAnchorEl(null);
    // Stop polling when popup closes - save resources
    stopPolling();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <PendingIcon color="action" />;
      case 'downloading':
        return <CircularProgress size={20} />;
      case 'completed':
        return <CheckCircleIcon color="success" />;
      case 'failed':
        return <ErrorIcon color="error" />;
      case 'submitted':
        return <SyncIcon color="info" />;
      default:
        return <DownloadIcon />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'default';
      case 'downloading':
        return 'primary';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      case 'submitted':
        return 'info';
      default:
        return 'default';
    }
  };

  return (
    <>
      {variant === 'icon' ? (
        <Tooltip title={isOnline ? t('downloadStatus.tooltip.online') : t('downloadStatus.tooltip.offline')}>
          <IconButton
            onClick={handleClick}
            sx={{
              color: hasActivity ? 'primary.main' : 'text.secondary',
              position: 'relative',
            }}
          >
            <Badge
              badgeContent={totalActive}
              color="primary"
              max={99}
              invisible={totalActive === 0}
            >
              {isOnline ? <DownloadIcon /> : <OfflineIcon />}
            </Badge>
            {totalDownloading > 0 && (
              <CircularProgress
                size={36}
                sx={{
                  position: 'absolute',
                  color: alpha(theme.palette.primary.main, 0.3),
                }}
              />
            )}
          </IconButton>
        </Tooltip>
      ) : (
        <Button
          variant="outlined"
          startIcon={isOnline ? <DownloadIcon /> : <OfflineIcon />}
          onClick={handleClick}
          sx={{ position: 'relative' }}
        >
          {t('downloadStatus.title')}
          {totalActive > 0 && (
            <Chip
              label={totalActive}
              size="small"
              color="primary"
              sx={{ ml: 1, height: 20 }}
            />
          )}
        </Button>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            width: 360,
            maxHeight: 480,
          },
        }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('downloadStatus.title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {!isOnline && (
              <Chip
                icon={<OfflineIcon />}
                label={t('downloadStatus.offline')}
                size="small"
                color="warning"
              />
            )}
            <Tooltip title={t('downloadStatus.actions.refresh')}>
              <IconButton size="small" onClick={refreshStatus} disabled={isLoading}>
                <RefreshIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        
        <Divider />

        {isLoading && <LinearProgress />}

        {/* Active Server Downloads */}
        {activeDownloads.length > 0 && (
          <>
            <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary">
                {t('downloadStatus.sections.activeDownloads', { count: activeDownloads.length })}
              </Typography>
            </Box>
            <List dense disablePadding>
              {activeDownloads.map((download) => (
                <ListItem key={`server-${download.id}`}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStatusIcon(download.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={download.title || `Download #${download.id}`}
                    secondary={
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={download.status}
                          size="small"
                          color={getStatusColor(download.status) as any}
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                        {download.error_message && (
                          <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                            {describeDownloadError(download.error_message, t)}
                          </Typography>
                        )}
                      </Box>
                    }
                    sx={{ minWidth: 0 }}
                    primaryTypographyProps={{ noWrap: true }}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

        {/* Empty State */}
        {activeDownloads.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <DownloadIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              {t('downloadStatus.empty.title')}
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {isOnline 
                ? t('downloadStatus.empty.online')
                : t('downloadStatus.empty.offline')
              }
            </Typography>
          </Box>
        )}

      </Popover>
    </>
  );
}
