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
  history: (params?: { page?: number; page_size?: number }) => 
    api.get('/stats/history/', { params }),
  clearHistory: (days?: number) => 
    api.delete('/stats/history/', { params: days ? { days } : {} }),
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
