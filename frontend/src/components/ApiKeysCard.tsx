import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { userAPI } from '../api/client';
import { formatDate } from '../utils/formatDate';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';

interface APIKey {
  id: number;
  name: string;
  key_prefix: string;
  permission: string;
  scope_stats: boolean;
  scope_audio: boolean;
  scope_channels: boolean;
  scope_playlists: boolean;
  scope_downloads: boolean;
  is_active: boolean;
  created_at: string;
  last_used: string | null;
  expires_at: string | null;
}

interface NewAPIKey extends APIKey {
  key: string; // Full key, only available when created
}

interface ApiKeysCardProps {
  /** Shows a confirmation in the page's shared notice for the given time. */
  onSuccess: (message: string, visibleMs: number) => void;
  /** Shows a failure in the page's shared notice; an empty string clears it. */
  onError: (message: string) => void;
}

const CREATED_NOTICE_MS = 10000;
const DELETED_NOTICE_MS = 3000;
const COPIED_NOTICE_MS = 2000;

/** Keys for dashboards and widgets that read this account: list, create once-visible, delete. */
export default function ApiKeysCard({ onSuccess, onError }: ApiKeysCardProps) {
  const { t } = useTranslation();
  // API Keys state
  const [apiKeys, setApiKeys] = useState<APIKey[]>([]);
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('Widget API Key');
  const [newApiKey, setNewApiKey] = useState<NewAPIKey | null>(null);
  const [deleteKeyId, setDeleteKeyId] = useState<number | null>(null);


  useEffect(() => {
    loadApiKeys();
  }, []);

  const loadApiKeys = async () => {
    try {
      const response = await userAPI.listApiKeys();
      setApiKeys(response.data);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    }
  };
  
  const handleCreateApiKey = async () => {
    try {
      onError('');
      const response = await userAPI.createApiKey({ 
        name: newApiKeyName,
        permission: 'read',
        scope_stats: true,
      });
      setNewApiKey(response.data);
      setApiKeyDialogOpen(false);
      loadApiKeys();
      onSuccess(t('settings.alerts.apiKeyCreated'), CREATED_NOTICE_MS);
    } catch (err) {
      onError(t('settings.alerts.apiKeyCreateFailed'));
    }
  };
  
  const handleDeleteApiKey = async (keyId: number) => {
    try {
      await userAPI.deleteApiKey(keyId);
      setDeleteKeyId(null);
      loadApiKeys();
      onSuccess(t('settings.alerts.apiKeyDeleted'), DELETED_NOTICE_MS);
    } catch (err) {
      onError(t('settings.alerts.apiKeyDeleteFailed'));
    }
  };
  
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onSuccess(t('settings.alerts.copiedToClipboard'), COPIED_NOTICE_MS);
  };
  

  return (
    <>
      {/* API Keys Section */}
      <Card sx={{ bgcolor: 'background.paper', mb: 1.5 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <VpnKeyIcon sx={{ mr: 1, color: 'primary.main', fontSize: '1.25rem' }} />
              <Typography variant="subtitle1" fontWeight={600}>
                {t('settings.apiKeys.title')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setApiKeyDialogOpen(true)}
            >
              {t('settings.apiKeys.createKeyButton')}
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
            {t('settings.apiKeys.description')}
          </Typography>

          {newApiKey && (
            <Alert 
              severity="warning" 
              sx={{ mb: 2 }}
              action={
                <IconButton aria-label={t('common.copy')} size="small" onClick={() => copyToClipboard(newApiKey.key)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              }
            >
              <Typography variant="body2" fontWeight={600}>{t('settings.apiKeys.saveKeyWarning')}</Typography>
              <Typography 
                variant="body2" 
                sx={{ 
                  fontFamily: 'monospace', 
                  bgcolor: 'action.hover', 
                  p: 0.5, 
                  borderRadius: 1,
                  mt: 0.5,
                  wordBreak: 'break-all'
                }}
              >
                {newApiKey.key}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('settings.apiKeys.saveKeyCaption')}
              </Typography>
            </Alert>
          )}

          {apiKeys.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
              {t('settings.apiKeys.noKeysYet')}
            </Typography>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settings.apiKeys.table.name')}</TableCell>
                    <TableCell>{t('settings.apiKeys.table.key')}</TableCell>
                    <TableCell>{t('settings.apiKeys.table.lastUsed')}</TableCell>
                    <TableCell align="right">{t('settings.apiKeys.table.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {apiKeys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2">{key.name}</Typography>
                          <Chip 
                            label={key.is_active ? t('adminUsers.status.active') : t('adminUsers.status.inactive')} 
                            size="small" 
                            color={key.is_active ? 'success' : 'default'}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {key.key_prefix}...
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {key.last_used 
                            ? formatDate(key.last_used)
                            : t('adminUsers.values.never')}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Tooltip title={t('settings.apiKeys.deleteKeyTooltip')}>
                          <IconButton 
                            size="small" 
                            color="error"
                            onClick={() => setDeleteKeyId(key.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
              {t('settings.apiKeys.widgetConfig')}
            </Typography>
            <Typography 
              variant="caption" 
              component="pre"
              sx={{ 
                fontFamily: 'monospace', 
                whiteSpace: 'pre-wrap',
                m: 0,
                fontSize: '0.7rem'
              }}
            >
{`widget:
  type: tubearchivist
  url: ${window.location.origin}
  key: YOUR_API_KEY_HERE
  fields: ["downloads", "videos", "channels", "playlists"]`}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Create API Key Dialog */}
      <Dialog 
        open={apiKeyDialogOpen} 
        onClose={() => {
          setApiKeyDialogOpen(false);
          setNewApiKeyName('Widget API Key');
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('settings.apiKeys.createDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.apiKeys.createDialog.description')}
          </Typography>
          <TextField
            autoFocus
            label={t('settings.apiKeys.createDialog.keyNameLabel')}
            fullWidth
            value={newApiKeyName}
            onChange={(e) => setNewApiKeyName(e.target.value)}
            placeholder={t('settings.apiKeys.createDialog.keyNamePlaceholder')}
            size="small"
            sx={{ mb: 2 }}
          />
          <Alert severity="info" sx={{ mb: 1 }}>
            {t('settings.apiKeys.createDialog.copyWarning')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApiKeyDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            onClick={handleCreateApiKey}
            disabled={!newApiKeyName.trim()}
          >
            {t('settings.apiKeys.createDialog.createButton')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete API Key Confirmation Dialog */}
      <Dialog
        open={deleteKeyId !== null}
        onClose={() => setDeleteKeyId(null)}
      >
        <DialogTitle>{t('settings.apiKeys.deleteDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('settings.apiKeys.deleteDialog.description')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteKeyId(null)}>{t('common.cancel')}</Button>
          <Button 
            variant="contained" 
            color="error"
            onClick={() => deleteKeyId && handleDeleteApiKey(deleteKeyId)}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>

    </>
  );
}
