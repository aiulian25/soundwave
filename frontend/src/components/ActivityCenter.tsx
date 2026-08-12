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
  Tooltip,
  Button,
  Divider,
  Chip,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DownloadingIcon from '@mui/icons-material/Downloading';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import BlockIcon from '@mui/icons-material/Block';
import { useTranslation } from 'react-i18next';
import { useActivityCenter } from '../hooks/useActivityCenter';

type ActivityStatus = 'downloading' | 'pending' | 'failed' | 'completed';
const STATUS_ORDER: ActivityStatus[] = ['downloading', 'pending', 'failed', 'completed'];

export default function ActivityCenter() {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const { items, loading, error, retry, retryAll, ignore, ignoreAll, refresh } = useActivityCenter(open);

  const attentionCount = items.filter(
    (item) => item.status === 'pending' || item.status === 'downloading' || item.status === 'failed',
  ).length;
  const failedCount = items.filter((item) => item.status === 'failed').length;

  const groups = STATUS_ORDER.map((status) => ({
    status,
    rows: items.filter((item) => item.status === status),
  })).filter((group) => group.rows.length > 0);

  const statusIcon = (status: ActivityStatus) => {
    if (status === 'downloading') return <DownloadingIcon fontSize="small" color="primary" />;
    if (status === 'pending') return <ScheduleIcon fontSize="small" color="disabled" />;
    if (status === 'failed') return <ErrorOutlineIcon fontSize="small" color="error" />;
    return <CheckCircleIcon fontSize="small" color="success" />;
  };

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title={t('activity.tooltip')} arrow>
        <IconButton
          onClick={handleOpen}
          aria-label={t('activity.tooltip')}
          sx={{
            width: { xs: 44, md: 48 },
            height: { xs: 44, md: 48 },
            border: '1px solid',
            borderColor: 'rgba(255, 255, 255, 0.1)',
          }}
        >
          <Badge badgeContent={attentionCount} color={failedCount > 0 ? 'error' : 'primary'} max={99}>
            <AssignmentIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: { xs: 320, sm: 380 }, maxHeight: 480 } }}
      >
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>
            {t('activity.title')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {loading && <CircularProgress size={18} />}
            <Tooltip title={t('activity.refresh')} arrow>
              <IconButton size="small" onClick={refresh} aria-label={t('activity.refresh')}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Divider />

        {error && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="error">
              {t('activity.error')}
            </Typography>
          </Box>
        )}

        {groups.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('activity.empty')}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ overflowY: 'auto', maxHeight: 400 }}>
            {groups.map((group) => (
              <Box key={group.status}>
                <Box sx={{ px: 2, pt: 1.5, pb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
                  >
                    {t(`activity.status.${group.status}`)}
                  </Typography>
                  <Chip label={group.rows.length} size="small" sx={{ height: 18 }} />
                  {group.status === 'failed' && group.rows.length > 1 && (
                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Button size="small" onClick={retryAll} startIcon={<RefreshIcon />}>
                        {t('activity.retryAll')}
                      </Button>
                      <Tooltip title={t('activity.dismissAll')} arrow>
                        <IconButton size="small" onClick={ignoreAll} aria-label={t('activity.dismissAll')}>
                          <BlockIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  )}
                </Box>
                <List dense disablePadding>
                  {group.rows.map((item) => (
                    <ListItem
                      key={item.id}
                      sx={{ pr: item.status === 'failed' ? 10 : undefined }}
                      secondaryAction={
                        item.status === 'failed' ? (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Tooltip title={t('activity.retry')} arrow>
                              <IconButton size="small" onClick={() => retry(item.id)} aria-label={t('activity.retry')}>
                                <RefreshIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={t('activity.dismiss')} arrow>
                              <IconButton edge="end" size="small" onClick={() => ignore(item.id)} aria-label={t('activity.dismiss')}>
                                <BlockIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        ) : null
                      }
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>{statusIcon(group.status)}</ListItemIcon>
                      <ListItemText
                        primary={item.title || item.url}
                        primaryTypographyProps={{ noWrap: true, variant: 'body2' }}
                        secondary={
                          item.status === 'failed' && item.error_message
                            ? item.error_message
                            : item.channel_name || undefined
                        }
                        secondaryTypographyProps={{
                          variant: 'caption',
                          sx:
                            item.status === 'failed'
                              ? {
                                  color: 'error.main',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                }
                              : { color: 'text.secondary' },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
                <Divider />
              </Box>
            ))}
          </Box>
        )}
      </Popover>
    </>
  );
}
