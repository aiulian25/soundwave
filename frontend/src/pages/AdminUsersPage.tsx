import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Switch,
  LinearProgress,
  Tooltip,
  Alert,
  Grid,
  Card,
  CardContent,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Info as InfoIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  PersonAdd as PersonAddIcon,
  Storage as StorageIcon,
  Group as GroupIcon,
  VideoLibrary as VideoLibraryIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import api from '../api/client';
import { localizePasswordError } from '../utils/passwordErrors';

interface User {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  storage_quota_gb: number;
  storage_used_gb: number;
  storage_percent_used: number;
  max_channels: number;
  max_playlists: number;
  date_joined: string;
  last_login: string;
  stats: {
    total_channels: number;
    total_playlists: number;
    total_audio_files: number;
  };
}

interface SystemStats {
  users: {
    total: number;
    active: number;
    admin: number;
  };
  content: {
    channels: number;
    playlists: number;
    audio_files: number;
  };
  storage: {
    used_gb: number;
    quota_gb: number;
  };
}

const AdminUsersPage = () => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userDetailsOpen, setUserDetailsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    password_confirm: '',
    is_admin: false,
    is_active: true,
    storage_quota_gb: 50,
    max_channels: 50,
    max_playlists: 100,
    user_notes: '',
  });

  useEffect(() => {
    loadUsers();
    loadSystemStats();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/user/admin/users/');
      // API returns paginated response with 'results' array
      setUsers(response.data.results || response.data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.loadUsersFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loadSystemStats = async () => {
    try {
      const response = await api.get('/user/admin/users/system_stats/');
      setSystemStats(response.data);
    } catch (err) {
      console.error('Failed to load system stats:', err);
    }
  };

  const handleCreateUser = async () => {
    try {
      await api.post('/user/admin/users/', formData);
      setSuccess(t('adminUsers.messages.userCreated'));
      setCreateDialogOpen(false);
      resetForm();
      loadUsers();
      loadSystemStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(localizePasswordError(err, t, 'adminUsers.errors.createUserFailed'));
    }
  };

  const handleUpdateUser = async () => {
    if (!selectedUser) return;
    
    try {
      await api.patch(`/user/admin/users/${selectedUser.id}/`, {
        is_admin: formData.is_admin,
        is_active: formData.is_active,
        storage_quota_gb: formData.storage_quota_gb,
        max_channels: formData.max_channels,
        max_playlists: formData.max_playlists,
        user_notes: formData.user_notes,
      });
      setSuccess(t('adminUsers.messages.userUpdated'));
      setEditDialogOpen(false);
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.updateUserFailed'));
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/toggle_active/`);
      setSuccess(t(user.is_active ? 'adminUsers.messages.userDeactivated' : 'adminUsers.messages.userActivated'));
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.toggleStatusFailed'));
    }
  };

  const handleResetStorage = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/reset_storage/`);
      setSuccess(t('adminUsers.messages.storageReset'));
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.resetStorageFailed'));
    }
  };

  const handleReset2FA = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/reset_2fa/`);
      setSuccess(t('adminUsers.messages.twoFaReset'));
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.resetTwoFaFailed'));
    }
  };

  const openDeleteConfirm = (user: User) => {
    setSelectedUser(user);
    setDeleteConfirmText('');
    setDeleteConfirmOpen(true);
  };

  const handleDeleteUser = async () => {
    if (!selectedUser || deleteConfirmText !== selectedUser.username) return;
    try {
      const response = await api.delete(`/user/admin/users/${selectedUser.id}/delete_user/`);
      setSuccess(response.data.message || t('adminUsers.messages.userDeleted'));
      setDeleteConfirmOpen(false);
      setSelectedUser(null);
      loadUsers();
      loadSystemStats();
      setTimeout(() => setSuccess(''), 5000);
    } catch (err: any) {
      setError(err.response?.data?.detail || t('adminUsers.errors.deleteUserFailed'));
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      password: '',
      password_confirm: '',
      is_admin: user.is_admin,
      is_active: user.is_active,
      storage_quota_gb: user.storage_quota_gb,
      max_channels: user.max_channels,
      max_playlists: user.max_playlists,
      user_notes: '',
    });
    setEditDialogOpen(true);
  };

  const openUserDetails = (user: User) => {
    setSelectedUser(user);
    setUserDetailsOpen(true);
  };

  const resetForm = () => {
    setFormData({
      username: '',
      email: '',
      password: '',
      password_confirm: '',
      is_admin: false,
      is_active: true,
      storage_quota_gb: 50,
      max_channels: 50,
      max_playlists: 100,
      user_notes: '',
    });
  };

  const getStorageColor = (percent: number) => {
    if (percent > 90) return 'error';
    if (percent > 75) return 'warning';
    return 'success';
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" fontWeight="bold">
          {t('adminUsers.title')}
        </Typography>
        <Box>
          <IconButton onClick={loadUsers} sx={{ mr: 1 }}>
            <RefreshIcon />
          </IconButton>
          <Button
            variant="contained"
            startIcon={<PersonAddIcon />}
            onClick={() => setCreateDialogOpen(true)}
          >
            {t('adminUsers.actions.createUser')}
          </Button>
        </Box>
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

      {/* System Statistics */}
      {systemStats && (
        <Grid container spacing={3} sx={{ mb: 3 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <GroupIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">{t('adminUsers.stats.users')}</Typography>
                </Box>
                <Typography variant="h4">{systemStats.users.total}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('adminUsers.stats.usersSummary', { active: systemStats.users.active, admins: systemStats.users.admin })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <VideoLibraryIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">{t('adminUsers.stats.content')}</Typography>
                </Box>
                <Typography variant="h4">{systemStats.content.channels}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('adminUsers.stats.contentSummary', { playlists: systemStats.content.playlists, audio: systemStats.content.audio_files })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <StorageIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">{t('adminUsers.stats.storage')}</Typography>
                </Box>
                <Typography variant="h4">{systemStats.storage.used_gb.toFixed(1)} GB</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('adminUsers.stats.storageAllocated', { quota: systemStats.storage.quota_gb })}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Users Table */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('adminUsers.table.username')}</TableCell>
              <TableCell>{t('adminUsers.table.email')}</TableCell>
              <TableCell>{t('adminUsers.table.status')}</TableCell>
              <TableCell>{t('adminUsers.table.storage')}</TableCell>
              <TableCell>{t('adminUsers.table.content')}</TableCell>
              <TableCell>{t('adminUsers.table.joined')}</TableCell>
              <TableCell>{t('adminUsers.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <LinearProgress />
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  {t('adminUsers.empty.noUsers')}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Box display="flex" alignItems="center">
                      {user.username}
                      {user.is_admin && (
                        <Chip label={t('adminUsers.role.admin')} size="small" color="primary" sx={{ ml: 1 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={user.is_active ? t('adminUsers.status.active') : t('adminUsers.status.inactive')}
                      color={user.is_active ? 'success' : 'default'}
                      size="small"
                      icon={user.is_active ? <CheckCircleIcon /> : <BlockIcon />}
                    />
                  </TableCell>
                  <TableCell>
                    <Box width={120}>
                      <Typography variant="caption">
                        {user.storage_used_gb.toFixed(1)} / {user.storage_quota_gb} GB
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(user.storage_percent_used, 100)}
                        color={getStorageColor(user.storage_percent_used)}
                      />
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {t('adminUsers.content.channelsCount', { count: user.stats.total_channels })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('adminUsers.content.summary', { playlists: user.stats.total_playlists, audio: user.stats.total_audio_files })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {new Date(user.date_joined).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={t('adminUsers.actions.userDetails')}>
                      <IconButton size="small" onClick={() => openUserDetails(user)}>
                        <InfoIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('adminUsers.actions.editUser')}>
                      <IconButton size="small" onClick={() => openEditDialog(user)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={user.is_active ? t('adminUsers.actions.deactivate') : t('adminUsers.actions.activate')}>
                      <IconButton size="small" onClick={() => handleToggleActive(user)}>
                        {user.is_active ? <BlockIcon /> : <CheckCircleIcon />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('adminUsers.actions.deleteUser')}>
                      <IconButton size="small" color="error" onClick={() => openDeleteConfirm(user)}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('adminUsers.dialogs.create.title')}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('adminUsers.fields.username')}
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('adminUsers.fields.email')}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('adminUsers.fields.password')}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('adminUsers.fields.confirmPassword')}
              type="password"
              value={formData.password_confirm}
              onChange={(e) => setFormData({ ...formData, password_confirm: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label={t('adminUsers.fields.storageQuotaGb')}
              type="number"
              value={formData.storage_quota_gb}
              onChange={(e) => setFormData({ ...formData, storage_quota_gb: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.maxChannels')}
              type="number"
              value={formData.max_channels}
              onChange={(e) => setFormData({ ...formData, max_channels: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.maxPlaylists')}
              type="number"
              value={formData.max_playlists}
              onChange={(e) => setFormData({ ...formData, max_playlists: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.notes')}
              multiline
              rows={3}
              value={formData.user_notes}
              onChange={(e) => setFormData({ ...formData, user_notes: e.target.value })}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                />
              }
              label={t('adminUsers.fields.adminUser')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label={t('adminUsers.fields.active')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleCreateUser} variant="contained">
            {t('adminUsers.actions.createUser')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('adminUsers.dialogs.edit.title', { username: selectedUser?.username || '' })}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('adminUsers.fields.storageQuotaGb')}
              type="number"
              value={formData.storage_quota_gb}
              onChange={(e) => setFormData({ ...formData, storage_quota_gb: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.maxChannels')}
              type="number"
              value={formData.max_channels}
              onChange={(e) => setFormData({ ...formData, max_channels: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.maxPlaylists')}
              type="number"
              value={formData.max_playlists}
              onChange={(e) => setFormData({ ...formData, max_playlists: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label={t('adminUsers.fields.notes')}
              multiline
              rows={3}
              value={formData.user_notes}
              onChange={(e) => setFormData({ ...formData, user_notes: e.target.value })}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                />
              }
              label={t('adminUsers.fields.adminUser')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label={t('adminUsers.fields.active')}
            />
            {selectedUser && (
              <Box display="flex" gap={1}>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => handleResetStorage(selectedUser)}
                  fullWidth
                >
                  {t('adminUsers.actions.resetStorage')}
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => handleReset2FA(selectedUser)}
                  fullWidth
                >
                  {t('adminUsers.actions.reset2fa')}
                </Button>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleUpdateUser} variant="contained">
            {t('adminUsers.actions.saveChanges')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* User Details Dialog */}
      <Dialog open={userDetailsOpen} onClose={() => setUserDetailsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('adminUsers.dialogs.details.title', { username: selectedUser?.username || '' })}</DialogTitle>
        <DialogContent>
          {selectedUser && (
            <Box sx={{ pt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.email')}
                  </Typography>
                  <Typography variant="body1">{selectedUser.email}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.status')}
                  </Typography>
                  <Chip
                    label={selectedUser.is_active ? t('adminUsers.status.active') : t('adminUsers.status.inactive')}
                    color={selectedUser.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.role')}
                  </Typography>
                  <Chip
                    label={selectedUser.is_admin ? t('adminUsers.role.admin') : t('adminUsers.role.user')}
                    color={selectedUser.is_admin ? 'primary' : 'default'}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.storageUsage')}
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.storage_used_gb.toFixed(2)} / {selectedUser.storage_quota_gb} GB
                    ({selectedUser.storage_percent_used.toFixed(1)}%)
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.channels')}
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.stats.total_channels} / {selectedUser.max_channels}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.playlists')}
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.stats.total_playlists} / {selectedUser.max_playlists}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.audioFiles')}
                  </Typography>
                  <Typography variant="body1">{selectedUser.stats.total_audio_files}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.dateJoined')}
                  </Typography>
                  <Typography variant="body1">
                    {new Date(selectedUser.date_joined).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    {t('adminUsers.fields.lastLogin')}
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.last_login
                      ? new Date(selectedUser.last_login).toLocaleString()
                      : t('adminUsers.values.never')}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUserDetailsOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete User Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <WarningIcon /> {t('adminUsers.dialogs.delete.title')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            {t('adminUsers.dialogs.delete.warning')}
          </Alert>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t('adminUsers.dialogs.delete.bullets.audio')}<br />
            {t('adminUsers.dialogs.delete.bullets.playlists')}<br />
            {t('adminUsers.dialogs.delete.bullets.channels')}<br />
            {t('adminUsers.dialogs.delete.bullets.downloads')}<br />
            {t('adminUsers.dialogs.delete.bullets.history')}<br />
            {t('adminUsers.dialogs.delete.bullets.account')}
          </Typography>
          <Typography variant="body1" sx={{ mt: 2, mb: 1 }}>
            {t('adminUsers.dialogs.delete.confirmPrompt', { username: selectedUser?.username || '' })}
          </Typography>
          <TextField
            fullWidth
            placeholder={selectedUser?.username}
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleDeleteUser}
            variant="contained"
            color="error"
            disabled={deleteConfirmText !== selectedUser?.username}
          >
            {t('adminUsers.actions.deletePermanently')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminUsersPage;
