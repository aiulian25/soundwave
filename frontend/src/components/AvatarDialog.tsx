import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Avatar,
  Typography,
  IconButton,
  Grid,
  Alert,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useTranslation } from 'react-i18next';
import { ensureCsrfCookie, getCsrfToken } from '../api/client';

interface AvatarDialogProps {
  open: boolean;
  onClose: () => void;
  currentAvatar: string | null;
  onAvatarChange: (avatarUrl: string | null) => void;
}

export default function AvatarDialog({ open, onClose, currentAvatar, onAvatarChange }: AvatarDialogProps) {
  const { t } = useTranslation();
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const presets = [1, 2, 3, 4, 5];

  const handlePresetSelect = async (preset: number) => {
    setError(null);
    setSuccess(null);
    setSelectedPreset(preset);

    try {
      await ensureCsrfCookie();
      const response = await fetch('/api/user/avatar/preset/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken() || '',
        },
        credentials: 'include',
        body: JSON.stringify({ preset }),
      });

      if (!response.ok) {
        throw new Error(t('avatarDialog.errors.setPresetFailed'));
      }

      const data = await response.json();
      setSuccess(t('avatarDialog.success.updated'));
      onAvatarChange(`/avatars/preset_${preset}.svg`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('avatarDialog.errors.setPresetFailed'));
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file size (20MB)
    if (file.size > 20 * 1024 * 1024) {
      setError(t('avatarDialog.errors.fileTooLarge'));
      return;
    }

    // Validate file type
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) {
      setError(t('avatarDialog.errors.invalidFileType'));
      return;
    }

    setError(null);
    setSuccess(null);
    setUploading(true);
    setSelectedPreset(null);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      await ensureCsrfCookie();
      const response = await fetch('/api/user/avatar/upload/', {
        method: 'POST',
        headers: {
          'X-CSRFToken': getCsrfToken() || '',
        },
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('avatarDialog.errors.uploadFailed'));
      }

      const data = await response.json();
      setSuccess(t('avatarDialog.success.uploaded'));
      
      // Construct the avatar URL
      const filename = data.avatar.split('/').pop();
      onAvatarChange(`/api/user/avatar/file/${filename}/`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('avatarDialog.errors.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setError(null);
    setSuccess(null);

    try {
      await ensureCsrfCookie();
      const response = await fetch('/api/user/avatar/upload/', {
        method: 'DELETE',
        headers: {
          'X-CSRFToken': getCsrfToken() || '',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('avatarDialog.errors.removeFailed'));
      }

      setSuccess(t('avatarDialog.success.removed'));
      setSelectedPreset(null);
      onAvatarChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('avatarDialog.errors.removeFailed'));
    }
  };

  const isCurrentPreset = (preset: number) => {
    return currentAvatar?.includes(`preset_${preset}`);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">{t('avatarDialog.title')}</Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {/* Preset Avatars */}
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
          {t('avatarDialog.sections.presets')}
        </Typography>
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {presets.map((preset) => (
            <Grid item xs={4} sm={2.4} key={preset}>
              <Box
                sx={{
                  position: 'relative',
                  cursor: 'pointer',
                  '&:hover': {
                    opacity: 0.8,
                  },
                }}
                onClick={() => handlePresetSelect(preset)}
              >
                <Avatar
                  src={`/avatars/preset_${preset}.svg`}
                  sx={{
                    width: 80,
                    height: 80,
                    border: isCurrentPreset(preset) ? '3px solid' : '2px solid',
                    borderColor: isCurrentPreset(preset) ? 'primary.main' : 'rgba(255, 255, 255, 0.1)',
                  }}
                />
                {isCurrentPreset(preset) && (
                  <CheckCircleIcon
                    sx={{
                      position: 'absolute',
                      top: -8,
                      right: -8,
                      color: 'primary.main',
                      bgcolor: 'background.paper',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </Box>
            </Grid>
          ))}
        </Grid>

        {/* Upload Custom Avatar */}
        <Typography variant="subtitle2" gutterBottom>
          {t('avatarDialog.sections.custom')}
        </Typography>
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderRadius: 2,
            p: 3,
            textAlign: 'center',
            bgcolor: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          {uploading ? (
            <CircularProgress size={40} />
          ) : (
            <>
              <input
                accept="image/jpeg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
                id="avatar-upload"
                type="file"
                onChange={handleFileUpload}
              />
              <label htmlFor="avatar-upload">
                <Button
                  variant="outlined"
                  component="span"
                  startIcon={<CloudUploadIcon />}
                  sx={{ mb: 1 }}
                >
                  {t('avatarDialog.actions.uploadImage')}
                </Button>
              </label>
              <Typography variant="caption" display="block" color="text.secondary">
                {t('avatarDialog.helpers.fileTypes')}
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        {currentAvatar && (
          <Button
            onClick={handleRemoveAvatar}
            startIcon={<DeleteIcon />}
            color="error"
            sx={{ mr: 'auto' }}
          >
            {t('avatarDialog.actions.removeAvatar')}
          </Button>
        )}
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
