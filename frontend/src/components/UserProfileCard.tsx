import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Alert,
  Divider,
  Grid,
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LockIcon from '@mui/icons-material/Lock';
import { useTranslation } from 'react-i18next';
import api, { ensureCsrfCookie } from '../api/client';
import { localizePasswordError } from '../utils/passwordErrors';

interface UserData {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
  storage_quota_gb: number;
  storage_used_gb: number;
  max_channels: number;
  max_playlists: number;
}

export default function UserProfileCard() {
  const { t, i18n } = useTranslation();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form states
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      const response = await api.get('/user/account/');
      setUserData(response.data);
      setUsername(response.data.username);
      setFirstName(response.data.first_name || '');
      setLastName(response.data.last_name || '');
      setEmail(response.data.email);
    } catch (err: any) {
      setError(t('userProfile.errors.loadFailed'));
    }
  };

  const handleUpdateProfile = async () => {
    // Check if anything changed
    const usernameChanged = username !== userData?.username;
    const firstNameChanged = firstName !== (userData?.first_name || '');
    const lastNameChanged = lastName !== (userData?.last_name || '');
    const emailChanged = email !== userData?.email;
    
    if (!usernameChanged && !firstNameChanged && !lastNameChanged && !emailChanged) {
      setError(t('userProfile.errors.noChanges'));
      return;
    }

    // Password required for username or email change
    if ((usernameChanged || emailChanged) && !currentPassword) {
      setError(t('userProfile.errors.passwordRequiredForIdentity'));
      return;
    }

    // Validate username
    if (usernameChanged) {
      if (username.length < 3) {
        setError(t('userProfile.errors.usernameMinLength'));
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        setError(t('userProfile.errors.usernamePattern'));
        return;
      }
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await ensureCsrfCookie();
      const payload: any = {};
      if (usernameChanged) payload.username = username;
      if (firstNameChanged) payload.first_name = firstName;
      if (lastNameChanged) payload.last_name = lastName;
      if (emailChanged) payload.email = email;
      
      // Add password if username or email changed
      if ((usernameChanged || emailChanged) && currentPassword.trim()) {
        payload.current_password = currentPassword;
      }
      // Language for the (possible) confirmation email (APP-10).
      if (emailChanged) {
        payload.language = i18n.language;
      }

      const response = await api.patch('/user/profile/', payload);

      // Update local state with response data instead of reloading
      if (response.data.user) {
        setUserData(response.data.user);
        setUsername(response.data.user.username);
        setFirstName(response.data.user.first_name || '');
        setLastName(response.data.user.last_name || '');
        setEmail(response.data.user.email);
      }

      setCurrentPassword('');
      if (response.data.code === 'email_confirmation_sent') {
        // Email is pending confirmation — show that instead of "updated".
        setSuccess(t('emailVerification.pendingNotice', { email: response.data.pending_email }));
      } else {
        setSuccess(t('userProfile.success.profileUpdated'));
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || t('userProfile.errors.updateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('userProfile.errors.fillAllPasswordFields'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('userProfile.errors.passwordsDoNotMatch'));
      return;
    }

    if (newPassword.length < 8) {
      setError(t('userProfile.errors.passwordMinLength'));
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await ensureCsrfCookie();
      await api.post('/user/change-password/', {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setSuccess(t('userProfile.success.passwordChanged'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(localizePasswordError(err, t, 'userProfile.errors.changePasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" mb={3}>
        <AccountCircleIcon sx={{ mr: 1, fontSize: 32, color: 'primary.main' }} />
        <Typography variant="h6">{t('userProfile.title')}</Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      {userData && (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">{t('userProfile.info.username')}</Typography>
              <Typography variant="body1" fontWeight={600}>{userData.username}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">{t('userProfile.info.memberSince')}</Typography>
              <Typography variant="body1">{new Date(userData.date_joined).toLocaleDateString(i18n.language === 'ro' ? 'ro-RO' : 'en-US')}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">{t('userProfile.info.storage')}</Typography>
              <Typography variant="body1">
                {t('userProfile.info.storageUsage', { used: (userData.storage_used_gb || 0).toFixed(2), quota: userData.storage_quota_gb || 0 })}
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">{t('userProfile.info.limits')}</Typography>
              <Typography variant="body1">
                {t('userProfile.info.limitsValue', { channels: userData.max_channels || 0, playlists: userData.max_playlists || 0 })}
              </Typography>
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          {/* Update Profile Section */}
          <Box mb={3}>
            <Box display="flex" alignItems="center" mb={2}>
              <AccountCircleIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">{t('userProfile.sections.updateProfile')}</Typography>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  fullWidth
                  helperText={t('userProfile.helpers.username')}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('userProfile.fields.firstName')}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label={t('userProfile.fields.lastName')}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.email')}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.currentPassword')}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  fullWidth
                  helperText={t('userProfile.helpers.currentPasswordForIdentity')}
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  onClick={handleUpdateProfile}
                  disabled={loading}
                  fullWidth
                >
                  {t('userProfile.actions.updateProfile')}
                </Button>
              </Grid>
            </Grid>
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Change Password Section */}
          <Box>
            <Box display="flex" alignItems="center" mb={2}>
              <LockIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">{t('userProfile.sections.changePassword')}</Typography>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.currentPassword')}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.newPassword')}
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  fullWidth
                  helperText={t('userProfile.helpers.newPassword')}
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label={t('userProfile.fields.confirmNewPassword')}
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  onClick={handleChangePassword}
                  disabled={loading}
                  fullWidth
                >
                  {t('userProfile.actions.changePassword')}
                </Button>
              </Grid>
            </Grid>
          </Box>
        </>
      )}
    </Paper>
  );
}
