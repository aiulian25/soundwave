import { useState, useEffect } from 'react';
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
  ListItemSecondaryAction,
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
  Delete as DeleteIcon,
  CloudOff as OfflineIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useBackgroundDownload } from '../hooks/useBackgroundDownload';

interface DownloadStatusProps {
  variant?: 'icon' | 'button';
}

export default function DownloadStatus({ variant = 'icon' }: DownloadStatusProps) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const {
    isSupported,
    isOnline,
    pendingDownloads,
    activeDownloads,
    isLoading,
    removePendingDownload,
    triggerSync,
    refreshStatus,
    startPolling,
    stopPolling,
  } = useBackgroundDownload();

  const open = Boolean(anchorEl);
  
  // Calculate total active downloads
  const totalPending = pendingDownloads.filter(d => d.status === 'pending').length;
  const totalDownloading = activeDownloads.filter(d => d.status === 'downloading').length;
  const totalActive = totalPending + totalDownloading + activeDownloads.filter(d => d.status === 'pending').length;
  
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

  const handleSync = async () => {
    await triggerSync();
    await refreshStatus();
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
        <Tooltip title={isOnline ? 'Download Status' : 'Offline - Downloads will sync when online'}>
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
          Downloads
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
            Downloads
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {!isOnline && (
              <Chip
                icon={<OfflineIcon />}
                label="Offline"
                size="small"
                color="warning"
              />
            )}
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={refreshStatus} disabled={isLoading}>
                <RefreshIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
            {!isOnline && pendingDownloads.length > 0 && (
              <Tooltip title="Sync when online">
                <IconButton size="small" onClick={handleSync} disabled={isLoading || !isOnline}>
                  <SyncIcon sx={{ fontSize: 20 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
        
        <Divider />

        {/* Background Sync Support Info */}
        {isSupported && (
          <Box sx={{ px: 2, py: 1, bgcolor: alpha(theme.palette.success.main, 0.1) }}>
            <Typography variant="caption" color="success.main">
              ✓ Background downloads enabled - Downloads continue when app is closed
            </Typography>
          </Box>
        )}

        {isLoading && <LinearProgress />}

        {/* Active Server Downloads */}
        {activeDownloads.length > 0 && (
          <>
            <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary">
                Active Downloads ({activeDownloads.length})
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
                            {download.error_message}
                          </Typography>
                        )}
                      </Box>
                    }
                    primaryTypographyProps={{
                      noWrap: true,
                      sx: { maxWidth: 220 },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}

        {/* Pending Local Downloads (queued offline) */}
        {pendingDownloads.length > 0 && (
          <>
            <Box sx={{ px: 2, py: 1, bgcolor: 'action.hover' }}>
              <Typography variant="overline" color="text.secondary">
                Queued for Sync ({pendingDownloads.length})
              </Typography>
            </Box>
            <List dense disablePadding>
              {pendingDownloads.map((download) => (
                <ListItem key={`local-${download.id}`}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    {getStatusIcon(download.status)}
                  </ListItemIcon>
                  <ListItemText
                    primary={download.title || download.url}
                    secondary={
                      <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={download.status}
                          size="small"
                          color={getStatusColor(download.status) as any}
                          sx={{ height: 18, fontSize: '0.65rem' }}
                        />
                        {download.error && (
                          <Typography variant="caption" color="error">
                            {download.error}
                          </Typography>
                        )}
                      </Box>
                    }
                    primaryTypographyProps={{
                      noWrap: true,
                      sx: { maxWidth: 200 },
                    }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => removePendingDownload(download.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </>
        )}

        {/* Empty State */}
        {activeDownloads.length === 0 && pendingDownloads.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <DownloadIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No active downloads
            </Typography>
            <Typography variant="caption" color="text.disabled">
              {isOnline 
                ? 'Downloads you start will appear here'
                : 'Queue downloads offline and they will sync when online'
              }
            </Typography>
          </Box>
        )}

        {/* Sync Button for Offline Queue */}
        {!isOnline && pendingDownloads.filter(d => d.status === 'pending').length > 0 && (
          <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider' }}>
            <Button
              fullWidth
              variant="contained"
              startIcon={<SyncIcon />}
              disabled
            >
              Will sync when online ({pendingDownloads.filter(d => d.status === 'pending').length} pending)
            </Button>
          </Box>
        )}
      </Popover>
    </>
  );
}
