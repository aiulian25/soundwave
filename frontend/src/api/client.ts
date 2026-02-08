import axios from 'axios';

// Get CSRF token from cookie
function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with requests
});

// Add auth token and CSRF token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  
  // Add CSRF token for unsafe methods
  if (config.method && !['get', 'head', 'options'].includes(config.method.toLowerCase())) {
    const csrfToken = getCookie('csrftoken');
    if (csrfToken) {
      config.headers['X-CSRFToken'] = csrfToken;
    }
  }
  
  return config;
});

// Handle token expiry - redirect to login when token expires
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || '';
      
      // Check if token has expired
      if (errorMessage.includes('expired') || errorMessage.includes('Invalid token')) {
        // Clear token and redirect to login
        localStorage.removeItem('token');
        
        // Dispatch custom event for app to handle logout
        window.dispatchEvent(new CustomEvent('token-expired', { 
          detail: { message: 'Your session has expired. Please log in again.' }
        }));
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// Audio API
export const audioAPI = {
  list: (params?: any) => api.get('/audio/list/', { params }),
  get: (youtubeId: string) => api.get(`/audio/${youtubeId}/`),
  delete: (youtubeId: string) => api.delete(`/audio/${youtubeId}/`),
  download: (youtubeId: string) => api.post(`/audio/${youtubeId}/`, { action: 'download' }),
  toggleFavorite: (youtubeId: string) => api.post(`/audio/${youtubeId}/`, { action: 'toggle_favorite' }),
  downloadFile: async (youtubeId: string) => {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/audio/${youtubeId}/download/`, {
      headers: {
        'Authorization': `Token ${token}`,
      },
    });
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    return blob;
  },
  getPlayer: (youtubeId: string) => api.get(`/audio/${youtubeId}/player/`),
  updateProgress: (youtubeId: string, data: any) => api.post(`/audio/${youtubeId}/progress/`, data),
  // Lyrics endpoints
  getLyrics: (youtubeId: string) => api.get(`/audio/${youtubeId}/lyrics/`),
  fetchLyrics: (youtubeId: string, force?: boolean) => api.post(`/audio/${youtubeId}/lyrics/fetch/`, { force }),
  updateLyrics: (youtubeId: string, data: any) => api.put(`/audio/${youtubeId}/lyrics/`, data),
  deleteLyrics: (youtubeId: string) => api.delete(`/audio/${youtubeId}/lyrics/`),
  uploadLrcFile: (youtubeId: string, file: File) => {
    const formData = new FormData();
    formData.append('lrc_file', file);
    return api.post(`/audio/${youtubeId}/lyrics/upload/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  fetchBatchLyrics: (youtubeIds: string[]) => api.post('/audio/lyrics/fetch_batch/', { youtube_ids: youtubeIds }),
  fetchAllMissingLyrics: (limit?: number) => api.post('/audio/lyrics/fetch_all_missing/', { limit }),
  getLyricsStats: () => api.get('/audio/lyrics/stats/'),
  // Recommendations endpoints
  getRecommendations: (youtubeId: string) => api.get(`/audio/${youtubeId}/recommendations/`),
  getSimilarTracks: (youtubeId: string) => api.get(`/audio/${youtubeId}/similar/`),
  // Metadata endpoints
  searchMetadata: (youtubeId: string, params?: { title?: string; artist?: string }) => 
    api.get(`/audio/${youtubeId}/metadata/search/`, { params }),
  applyMetadata: (youtubeId: string, data: any) => 
    api.post(`/audio/${youtubeId}/metadata/apply/`, data),
  autoFetchMetadata: (youtubeId: string) => 
    api.post(`/audio/${youtubeId}/metadata/auto/`),
};

// Channel API
export const channelAPI = {
  list: (params?: any) => api.get('/channel/', { params }),
  get: (channelId: string) => api.get(`/channel/${channelId}/`),
  subscribe: (data: any) => api.post('/channel/', data),
  unsubscribe: (channelId: string) => api.delete(`/channel/${channelId}/`),
};

// Playlist API
export const playlistAPI = {
  list: (params?: any) => api.get('/playlist/', { params }),
  get: (playlistId: string) => api.get(`/playlist/${playlistId}/`),
  getWithItems: (playlistId: string) => api.get(`/playlist/${playlistId}/`, { params: { include_items: 'true' } }),
  create: (data: any) => api.post('/playlist/', data),
  delete: (playlistId: string) => api.delete(`/playlist/${playlistId}/`),
  download: (playlistId: string) => api.post(`/playlist/${playlistId}/`, { action: 'download' }),
  // Item management
  getItems: (playlistId: string) => api.get(`/playlist/${playlistId}/items/`),
  addItem: (playlistId: string, youtubeId: string) => api.post(`/playlist/${playlistId}/items/`, { youtube_id: youtubeId }),
  removeItem: (playlistId: string, youtubeId: string) => api.delete(`/playlist/${playlistId}/items/`, { data: { youtube_id: youtubeId } }),
  // Find playlists containing a track
  findContaining: (youtubeId: string) => api.get(`/playlist/containing/${youtubeId}/`),
};

// Smart Playlist API
export const smartPlaylistAPI = {
  // List all smart playlists
  list: () => api.get('/playlist/smart/'),
  
  // Get smart playlist details
  get: (playlistId: number) => api.get(`/playlist/smart/${playlistId}/`),
  getWithTracks: (playlistId: number) => api.get(`/playlist/smart/${playlistId}/`, { params: { include_tracks: 'true' } }),
  
  // Get tracks for a smart playlist (paginated)
  getTracks: (playlistId: number, params?: { page?: number; page_size?: number }) => 
    api.get(`/playlist/smart/${playlistId}/tracks/`, { params }),
  
  // Create a new smart playlist
  create: (data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    match_mode?: 'all' | 'any';
    order_by?: string;
    limit?: number | null;
    rules?: Array<{
      field: string;
      operator: string;
      value?: string;
      value_2?: string;
    }>;
  }) => api.post('/playlist/smart/', data),
  
  // Update a smart playlist
  update: (playlistId: number, data: any) => api.put(`/playlist/smart/${playlistId}/`, data),
  
  // Delete a smart playlist
  delete: (playlistId: number) => api.delete(`/playlist/smart/${playlistId}/`),
  
  // Get available choices for rules
  getChoices: () => api.get('/playlist/smart/choices/'),
  
  // Preview matching tracks without saving
  preview: (data: {
    rules: Array<{
      field: string;
      operator: string;
      value?: string;
      value_2?: string;
    }>;
    match_mode?: 'all' | 'any';
    order_by?: string;
    limit?: number | null;
  }) => api.post('/playlist/smart/preview/', data),
  
  // Manage rules for a smart playlist
  getRules: (playlistId: number) => api.get(`/playlist/smart/${playlistId}/rules/`),
  addRule: (playlistId: number, rule: { field: string; operator: string; value?: string; value_2?: string }) =>
    api.post(`/playlist/smart/${playlistId}/rules/`, rule),
  setRules: (playlistId: number, rules: Array<{ field: string; operator: string; value?: string; value_2?: string }>) =>
    api.put(`/playlist/smart/${playlistId}/rules/`, { rules }),
};

// Download API
export const downloadAPI = {
  list: (filter?: string) => api.get('/download/', { params: { filter } }),
  add: (data: any) => api.post('/download/', data),
  clear: (filter?: string) => api.delete('/download/', { params: { filter } }),
  status: () => api.get('/download/status/'),
  retry: (id?: number) => api.post('/download/retry/', id ? { id } : {}),
};

// Stats API
export const statsAPI = {
  audio: () => api.get('/stats/audio/'),
  channel: () => api.get('/stats/channel/'),
  download: () => api.get('/stats/download/'),
  // Analytics endpoints
  insights: (days?: number) => api.get('/stats/insights/', { params: days ? { days } : {} }),
  recordListening: (data: { youtube_id: string; duration_listened: number; completed: boolean }) => 
    api.post('/stats/record/', data),
  history: (params?: { page?: number; page_size?: number; date?: string }) => 
    api.get('/stats/history/', { params }),
  clearHistory: (days?: number) => 
    api.delete('/stats/history/', { params: days ? { days } : {} }),
  onThisDay: () => api.get('/stats/on-this-day/'),
  // Achievements
  achievements: (params?: { progress?: boolean; unseen?: boolean }) => 
    api.get('/stats/achievements/', { params }),
  checkAchievements: () => api.post('/stats/achievements/'),
  markAchievementsSeen: (ids?: number[]) => 
    api.patch('/stats/achievements/', ids ? { ids } : { all: true }),
  // Streaks
  streak: () => api.get('/stats/streak/'),
  // Yearly Wrapped
  yearlyWrapped: (year?: number) => 
    api.get('/stats/wrapped/', { params: year ? { year } : {} }),
  // Homepage data
  homepage: () => api.get('/stats/homepage/'),
  clearContinueListening: () => api.delete('/stats/homepage/'),
};

// User API
export const userAPI = {
  login: (data: any) => api.post('/user/login/', data),
  logout: () => api.post('/user/logout/'),
  account: () => api.get('/user/account/'),
  config: () => api.get('/user/config/'),
  updateConfig: (data: any) => api.post('/user/config/', data),
  // Two-Factor Authentication
  twoFactorStatus: () => api.get('/user/2fa/status/'),
  twoFactorSetup: () => api.post('/user/2fa/setup/'),
  twoFactorVerify: (data: { code: string }) => api.post('/user/2fa/verify/', data),
  twoFactorDisable: (data: { code: string }) => api.post('/user/2fa/disable/', data),
  twoFactorRegenerateCodes: () => api.post('/user/2fa/regenerate-codes/'),
  twoFactorDownloadCodes: () => api.get('/user/2fa/download-codes/', { responseType: 'blob' }),
};

// App Settings API
export const settingsAPI = {
  config: () => api.get('/appsettings/config/'),
  backup: () => api.get('/appsettings/backup/'),
  createBackup: () => api.post('/appsettings/backup/'),
};

// Playback Sync API - Cross-device playback continuity
export const playbackSyncAPI = {
  // Get the user's last playback session
  getSession: () => api.get('/playback-sync/'),
  
  // Check if user has an active session (lightweight)
  checkStatus: () => api.get('/playback-sync/status/'),
  
  // Update/save current playback state
  syncPlayback: (data: {
    youtube_id: string;
    position: number;
    duration?: number;
    is_playing?: boolean;
    volume?: number;
    queue_youtube_ids?: string[];
    queue_index?: number;
    device_id?: string;
    device_name?: string;
  }) => api.post('/playback-sync/', data),
  
  // Clear the playback session
  clearSession: () => api.delete('/playback-sync/'),
};

// Smart Radio / Auto-DJ API
export const radioAPI = {
  // Start a new radio session
  start: (data: {
    mode: 'track' | 'artist' | 'favorites' | 'discovery' | 'recent';
    seed_youtube_id?: string;
    seed_channel_id?: string;
    variety_level?: number;
  }) => api.post('/radio/start/', data),
  
  // Stop the current radio session
  stop: () => api.post('/radio/stop/'),
  
  // Get radio status
  status: () => api.get('/radio/status/'),
  
  // Get next track
  next: () => api.get('/radio/next/'),
  
  // Report a skip (for learning)
  skip: (data: {
    youtube_id: string;
    listen_duration?: number;
    track_duration?: number;
  }) => api.post('/radio/skip/', data),
  
  // Report positive feedback (played through, liked, repeated)
  like: (data: {
    youtube_id: string;
    feedback_type?: 'played' | 'liked' | 'repeated';
    listen_duration?: number;
    track_duration?: number;
  }) => api.post('/radio/like/', data),
  
  // Get/update radio settings
  getSettings: () => api.get('/radio/settings/'),
  updateSettings: (data: {
    variety_level?: number;
    max_history_size?: number;
    reset_learning?: boolean;
  }) => api.post('/radio/settings/', data),
};
