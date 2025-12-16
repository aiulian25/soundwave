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
} from '@mui/icons-material';
import api from '../api/client';

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
  const [users, setUsers] = useState<User[]>([]);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userDetailsOpen, setUserDetailsOpen] = useState(false);

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
      setError(err.response?.data?.detail || 'Failed to load users');
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
      setSuccess('User created successfully');
      setCreateDialogOpen(false);
      resetForm();
      loadUsers();
      loadSystemStats();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create user');
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
      setSuccess('User updated successfully');
      setEditDialogOpen(false);
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to update user');
    }
  };

  const handleToggleActive = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/toggle_active/`);
      setSuccess(`User ${user.is_active ? 'deactivated' : 'activated'}`);
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to toggle user status');
    }
  };

  const handleResetStorage = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/reset_storage/`);
      setSuccess('Storage reset successfully');
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reset storage');
    }
  };

  const handleReset2FA = async (user: User) => {
    try {
      await api.post(`/user/admin/users/${user.id}/reset_2fa/`);
      setSuccess('2FA reset successfully');
      loadUsers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to reset 2FA');
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
          User Management
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
            Create User
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
                  <Typography variant="h6">Users</Typography>
                </Box>
                <Typography variant="h4">{systemStats.users.total}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {systemStats.users.active} active, {systemStats.users.admin} admins
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <VideoLibraryIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">Content</Typography>
                </Box>
                <Typography variant="h4">{systemStats.content.channels}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {systemStats.content.playlists} playlists, {systemStats.content.audio_files} audio
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" mb={1}>
                  <StorageIcon color="primary" sx={{ mr: 1 }} />
                  <Typography variant="h6">Storage</Typography>
                </Box>
                <Typography variant="h4">{systemStats.storage.used_gb.toFixed(1)} GB</Typography>
                <Typography variant="body2" color="text.secondary">
                  / {systemStats.storage.quota_gb} GB allocated
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
              <TableCell>Username</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Storage</TableCell>
              <TableCell>Content</TableCell>
              <TableCell>Joined</TableCell>
              <TableCell>Actions</TableCell>
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
                  No users found
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <Box display="flex" alignItems="center">
                      {user.username}
                      {user.is_admin && (
                        <Chip label="Admin" size="small" color="primary" sx={{ ml: 1 }} />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Chip
                      label={user.is_active ? 'Active' : 'Inactive'}
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
                      {user.stats.total_channels} channels
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {user.stats.total_playlists} playlists, {user.stats.total_audio_files} audio
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {new Date(user.date_joined).toLocaleDateString()}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title="User Details">
                      <IconButton size="small" onClick={() => openUserDetails(user)}>
                        <InfoIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit User">
                      <IconButton size="small" onClick={() => openEditDialog(user)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={user.is_active ? 'Deactivate' : 'Activate'}>
                      <IconButton size="small" onClick={() => handleToggleActive(user)}>
                        {user.is_active ? <BlockIcon /> : <CheckCircleIcon />}
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
        <DialogTitle>Create New User</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Confirm Password"
              type="password"
              value={formData.password_confirm}
              onChange={(e) => setFormData({ ...formData, password_confirm: e.target.value })}
              fullWidth
              required
            />
            <TextField
              label="Storage Quota (GB)"
              type="number"
              value={formData.storage_quota_gb}
              onChange={(e) => setFormData({ ...formData, storage_quota_gb: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Max Channels"
              type="number"
              value={formData.max_channels}
              onChange={(e) => setFormData({ ...formData, max_channels: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Max Playlists"
              type="number"
              value={formData.max_playlists}
              onChange={(e) => setFormData({ ...formData, max_playlists: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Notes"
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
              label="Admin User"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label="Active"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateUser} variant="contained">
            Create User
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit User: {selectedUser?.username}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Storage Quota (GB)"
              type="number"
              value={formData.storage_quota_gb}
              onChange={(e) => setFormData({ ...formData, storage_quota_gb: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Max Channels"
              type="number"
              value={formData.max_channels}
              onChange={(e) => setFormData({ ...formData, max_channels: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Max Playlists"
              type="number"
              value={formData.max_playlists}
              onChange={(e) => setFormData({ ...formData, max_playlists: parseInt(e.target.value) })}
              fullWidth
            />
            <TextField
              label="Notes"
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
              label="Admin User"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label="Active"
            />
            {selectedUser && (
              <Box display="flex" gap={1}>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => handleResetStorage(selectedUser)}
                  fullWidth
                >
                  Reset Storage
                </Button>
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={() => handleReset2FA(selectedUser)}
                  fullWidth
                >
                  Reset 2FA
                </Button>
              </Box>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleUpdateUser} variant="contained">
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* User Details Dialog */}
      <Dialog open={userDetailsOpen} onClose={() => setUserDetailsOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>User Details: {selectedUser?.username}</DialogTitle>
        <DialogContent>
          {selectedUser && (
            <Box sx={{ pt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Email
                  </Typography>
                  <Typography variant="body1">{selectedUser.email}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Status
                  </Typography>
                  <Chip
                    label={selectedUser.is_active ? 'Active' : 'Inactive'}
                    color={selectedUser.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Role
                  </Typography>
                  <Chip
                    label={selectedUser.is_admin ? 'Admin' : 'User'}
                    color={selectedUser.is_admin ? 'primary' : 'default'}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Storage Usage
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.storage_used_gb.toFixed(2)} / {selectedUser.storage_quota_gb} GB
                    ({selectedUser.storage_percent_used.toFixed(1)}%)
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Channels
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.stats.total_channels} / {selectedUser.max_channels}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Playlists
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.stats.total_playlists} / {selectedUser.max_playlists}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Audio Files
                  </Typography>
                  <Typography variant="body1">{selectedUser.stats.total_audio_files}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Date Joined
                  </Typography>
                  <Typography variant="body1">
                    {new Date(selectedUser.date_joined).toLocaleString()}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="subtitle2" color="text.secondary">
                    Last Login
                  </Typography>
                  <Typography variant="body1">
                    {selectedUser.last_login
                      ? new Date(selectedUser.last_login).toLocaleString()
                      : 'Never'}
                  </Typography>
                </Grid>
              </Grid>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUserDetailsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AdminUsersPage;
