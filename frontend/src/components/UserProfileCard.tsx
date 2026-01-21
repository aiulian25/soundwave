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
import api from '../api/client';

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
      setError('Failed to load user data');
    }
  };

  const handleUpdateProfile = async () => {
    // Check if anything changed
    const usernameChanged = username !== userData?.username;
    const firstNameChanged = firstName !== (userData?.first_name || '');
    const lastNameChanged = lastName !== (userData?.last_name || '');
    const emailChanged = email !== userData?.email;
    
    if (!usernameChanged && !firstNameChanged && !lastNameChanged && !emailChanged) {
      setError('No changes detected');
      return;
    }

    // Password required for username or email change
    if ((usernameChanged || emailChanged) && !currentPassword) {
      setError('Current password required to change username or email');
      return;
    }

    // Validate username
    if (usernameChanged) {
      if (username.length < 3) {
        setError('Username must be at least 3 characters long');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        setError('Username can only contain letters, numbers, and underscores');
        return;
      }
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const payload: any = {};
      if (usernameChanged) payload.username = username;
      if (firstNameChanged) payload.first_name = firstName;
      if (lastNameChanged) payload.last_name = lastName;
      if (emailChanged) payload.email = email;
      
      // Add password if username or email changed
      if ((usernameChanged || emailChanged) && currentPassword.trim()) {
        payload.current_password = currentPassword;
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
      
      setSuccess('Profile updated successfully!');
      setCurrentPassword('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await api.post('/user/change-password/', { 
        current_password: currentPassword,
        new_password: newPassword 
      });
      setSuccess('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to change password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" mb={3}>
        <AccountCircleIcon sx={{ mr: 1, fontSize: 32, color: 'primary.main' }} />
        <Typography variant="h6">Profile Information</Typography>
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
              <Typography variant="subtitle2" color="text.secondary">Username</Typography>
              <Typography variant="body1" fontWeight={600}>{userData.username}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">Member Since</Typography>
              <Typography variant="body1">{new Date(userData.date_joined).toLocaleDateString()}</Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">Storage</Typography>
              <Typography variant="body1">
                {(userData.storage_used_gb || 0).toFixed(2)} / {userData.storage_quota_gb || 0} GB
              </Typography>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" color="text.secondary">Limits</Typography>
              <Typography variant="body1">
                {userData.max_channels || 0} channels, {userData.max_playlists || 0} playlists
              </Typography>
            </Grid>
          </Grid>

          <Divider sx={{ my: 3 }} />

          {/* Update Profile Section */}
          <Box mb={3}>
            <Box display="flex" alignItems="center" mb={2}>
              <AccountCircleIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">Update Profile</Typography>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Username (Login ID)"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  fullWidth
                  helperText="Used for login - requires password to change"
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="First Name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Last Name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  fullWidth
                  helperText="Required for username or email changes"
                />
              </Grid>
              <Grid item xs={12}>
                <Button
                  variant="contained"
                  onClick={handleUpdateProfile}
                  disabled={loading}
                  fullWidth
                >
                  Update Profile
                </Button>
              </Grid>
            </Grid>
          </Box>

          <Divider sx={{ my: 3 }} />

          {/* Change Password Section */}
          <Box>
            <Box display="flex" alignItems="center" mb={2}>
              <LockIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6">Change Password</Typography>
            </Box>
            <Grid container spacing={2}>
              <Grid item xs={12}>
                <TextField
                  label="Current Password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="New Password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  fullWidth
                  helperText="Minimum 8 characters"
                />
              </Grid>
              <Grid item xs={12}>
                <TextField
                  label="Confirm New Password"
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
                  Change Password
                </Button>
              </Grid>
            </Grid>
          </Box>
        </>
      )}
    </Paper>
  );
}
