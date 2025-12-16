export interface Audio {
  id: number;
  youtube_id?: string;  // Optional for local files
  title: string;
  description?: string;
  channel_id?: string;
  channel_name?: string;
  duration: number;
  file_path?: string;
  file_size: number;
  thumbnail_url?: string;
  published_date?: string;
  downloaded_date?: string;
  view_count?: number;
  like_count?: number;
  audio_format?: string;
  bitrate?: number;
  play_count: number;
  last_played?: string;
  artist?: string;
  album?: string;
  cover_art_url?: string;
  media_url?: string;  // For local file playback (blob URLs)
}

export interface Channel {
  id: number;
  channel_id: string;
  channel_name: string;
  channel_description: string;
  channel_thumbnail: string;
  subscribed: boolean;
  subscriber_count: number;
  video_count: number;
  last_refreshed: string;
  created_date: string;
}

export interface Playlist {
  id: number;
  playlist_id: string;
  title: string;
  description: string;
  playlist_type: 'youtube' | 'custom';
  channel_id?: string;
  channel_name?: string;
  subscribed: boolean;
  thumbnail_url: string;
  created_date: string;
  last_updated: string;
  item_count: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  date_joined: string;
  last_login: string;
}

export interface AudioProgress {
  position: number;
  completed: boolean;
}
