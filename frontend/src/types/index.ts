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
  is_favorite?: boolean;
  // Enhanced metadata fields
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  track_number?: number;
  cover_art_url?: string;
  musicbrainz_id?: string;
  metadata_source?: string;
  metadata_updated?: string;
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

export interface SmartPlaylistRule {
  id?: number;
  field: string;
  field_display?: string;
  operator: string;
  operator_display?: string;
  value: string;
  value_2?: string;
  order?: number;
}

export interface SmartPlaylist {
  id: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  match_mode: 'all' | 'any';
  match_mode_display?: string;
  order_by: string;
  order_by_display?: string;
  limit: number | null;
  is_system: boolean;
  preset_type?: string;
  rules: SmartPlaylistRule[];
  track_count: number;
  cached_count: number;
  cache_updated?: string;
  created_date: string;
  last_updated: string;
}

export interface SmartPlaylistChoices {
  fields: Array<{ value: string; label: string }>;
  operators: Array<{ value: string; label: string }>;
  order_by_options: Array<{ value: string; label: string }>;
  field_types: Record<string, string>;
  operator_groups: Record<string, string[]>;
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

// Achievement types
export interface Achievement {
  id: number;
  achievement_type: string;
  name: string;
  icon: string;
  description: string;
  unlocked_at: string;
  context?: Record<string, any>;
  seen: boolean;
}

export interface AchievementProgress {
  type: string;
  name: string;
  icon: string;
  description: string;
  threshold: number;
  current: number;
  progress: number;
  unlocked: boolean;
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  listened_today: boolean;
  streak_at_risk: boolean;
  next_milestone: number | null;
  days_to_milestone: number | null;
  recent_days: Array<{
    date: string;
    day_name: string;
    has_activity: boolean;
    tracks_played: number;
  }>;
}

export interface YearlyWrapped {
  year: number;
  total_minutes_listened: number;
  total_tracks_played: number;
  total_unique_tracks: number;
  total_unique_artists: number;
  total_unique_channels: number;
  longest_streak: number;
  total_listening_days: number;
  top_artist: {
    artist: string;
    play_count: number;
    total_minutes: number;
  } | null;
  top_channel: {
    channel_name: string;
    play_count: number;
    total_minutes: number;
  } | null;
  top_track: {
    title: string;
    artist: string;
    youtube_id: string;
    thumbnail_url: string;
    play_count: number;
  } | null;
  top_5_artists: Array<{
    artist: string;
    play_count: number;
    total_duration: number;
  }>;
  top_5_tracks: Array<{
    title: string;
    artist: string;
    youtube_id: string;
    thumbnail_url: string;
    play_count: number;
    total_duration: number;
  }>;
  listening_personality: string;
  peak_month: string;
  peak_day_of_week: string;
  peak_hour: number | null;
  monthly_minutes: Array<{
    month: string;
    month_num: number;
    minutes: number;
    plays: number;
  }>;
  achievements_unlocked: number;
}
