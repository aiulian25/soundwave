import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Chip,
  LinearProgress,
  IconButton,
  Tooltip,
  useTheme,
  alpha,
} from '@mui/material';
import {
  AccessTime as AccessTimeIcon,
  MusicNote as MusicNoteIcon,
  Person as PersonIcon,
  Album as AlbumIcon,
  TrendingUp as TrendingUpIcon,
  LocalFireDepartment as FireIcon,
  Schedule as ScheduleIcon,
  CalendarToday as CalendarIcon,
  PlayArrow as PlayIcon,
  YouTube as YouTubeIcon,
} from '@mui/icons-material';
import { statsAPI } from '../api/client';

interface TopArtist {
  artist: string;
  play_count: number;
  total_duration: number;
}

interface TopChannel {
  channel_name: string;
  play_count: number;
  total_duration: number;
}

interface TopTrack {
  title: string;
  artist: string;
  youtube_id: string;
  thumbnail_url: string;
  play_count: number;
  total_duration: number;
}

interface HourlyData {
  hour: number;
  play_count: number;
  total_duration: number;
}

interface DailyData {
  date: string;
  play_count: number;
  total_duration: number;
}

interface GenreData {
  genre: string;
  play_count: number;
  total_duration: number;
}

interface RecentTrack {
  id: number;
  audio_id: number;
  youtube_id: string;
  title: string;
  artist: string;
  channel_name: string;
  thumbnail_url: string;
  listened_at: string;
  duration_listened: number;
  completed: boolean;
}

interface InsightsData {
  total_listening_time: number;
  total_tracks_played: number;
  total_unique_tracks: number;
  total_unique_artists: number;
  avg_daily_listening: number;
  favorite_hour: number | null;
  favorite_day: string;
  longest_streak: number;
  current_streak: number;
  top_artists: TopArtist[];
  top_channels: TopChannel[];
  top_tracks: TopTrack[];
  listening_by_hour: HourlyData[];
  daily_listening: DailyData[];
  genre_distribution: GenreData[];
  recent_history: RecentTrack[];
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

const formatHour = (hour: number): string => {
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
};

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
}

const StatCard = ({ title, value, subtitle, icon, color = 'primary.main' }: StatCardProps) => {
  const theme = useTheme();
  return (
    <Card
      sx={{
        height: '100%',
        background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.9)} 0%, ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
        backdropFilter: 'blur(10px)',
        border: '1px solid',
        borderColor: alpha(theme.palette.divider, 0.1),
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, color }}>
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              color,
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

interface HourlyChartProps {
  data: HourlyData[];
}

const HourlyChart = ({ data }: HourlyChartProps) => {
  const theme = useTheme();
  const maxPlayCount = Math.max(...data.map(d => d.play_count), 1);

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', height: 120, gap: 0.5 }}>
        {data.map((item) => (
          <Tooltip
            key={item.hour}
            title={`${formatHour(item.hour)}: ${item.play_count} plays (${formatDuration(item.total_duration)})`}
          >
            <Box
              sx={{
                flex: 1,
                bgcolor: item.play_count > 0 ? 'primary.main' : alpha(theme.palette.text.disabled, 0.2),
                borderRadius: '4px 4px 0 0',
                minHeight: 4,
                height: `${(item.play_count / maxPlayCount) * 100}%`,
                transition: 'all 0.3s ease',
                cursor: 'pointer',
                '&:hover': {
                  bgcolor: 'primary.light',
                  transform: 'scaleY(1.05)',
                },
              }}
            />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="caption" color="text.secondary">12 AM</Typography>
        <Typography variant="caption" color="text.secondary">6 AM</Typography>
        <Typography variant="caption" color="text.secondary">12 PM</Typography>
        <Typography variant="caption" color="text.secondary">6 PM</Typography>
        <Typography variant="caption" color="text.secondary">12 AM</Typography>
      </Box>
    </Box>
  );
};

export default function AnalyticsPage() {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30);
  const theme = useTheme();

  useEffect(() => {
    loadInsights();
  }, [timeRange]);

  const loadInsights = async () => {
    try {
      setLoading(true);
      const response = await statsAPI.insights(timeRange);
      setInsights(response.data);
    } catch (error) {
      console.error('Failed to load insights:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!insights) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          Unable to load analytics data
        </Typography>
      </Box>
    );
  }

  const maxArtistPlays = Math.max(...insights.top_artists.map(a => a.play_count), 1);
  const maxChannelPlays = Math.max(...insights.top_channels.map(c => c.play_count), 1);

  return (
    <Box sx={{ pb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
            Listening Insights
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Your personal listening statistics and habits
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Time Range</InputLabel>
          <Select
            value={timeRange}
            label="Time Range"
            onChange={(e) => setTimeRange(Number(e.target.value))}
          >
            <MenuItem value={7}>Last 7 days</MenuItem>
            <MenuItem value={30}>Last 30 days</MenuItem>
            <MenuItem value={90}>Last 3 months</MenuItem>
            <MenuItem value={365}>Last year</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Summary Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Total Listening Time"
            value={formatDuration(insights.total_listening_time)}
            icon={<AccessTimeIcon />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Tracks Played"
            value={insights.total_tracks_played.toLocaleString()}
            subtitle={`${insights.total_unique_tracks} unique`}
            icon={<MusicNoteIcon />}
            color="secondary.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Unique Artists"
            value={insights.total_unique_artists}
            icon={<PersonIcon />}
            color="warning.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Daily Average"
            value={formatDuration(insights.avg_daily_listening)}
            icon={<TrendingUpIcon />}
            color="info.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Current Streak"
            value={`${insights.current_streak} days`}
            icon={<FireIcon />}
            color={insights.current_streak > 0 ? 'error.main' : 'text.disabled'}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Longest Streak"
            value={`${insights.longest_streak} days`}
            icon={<CalendarIcon />}
            color="success.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Peak Hour"
            value={insights.favorite_hour !== null ? formatHour(insights.favorite_hour) : 'N/A'}
            icon={<ScheduleIcon />}
            color="primary.main"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={3}>
          <StatCard
            title="Favorite Day"
            value={insights.favorite_day || 'N/A'}
            icon={<CalendarIcon />}
            color="secondary.main"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        {/* Listening Activity by Hour */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                Listening Activity by Hour
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                When you listen to music throughout the day
              </Typography>
              <HourlyChart data={insights.listening_by_hour} />
            </CardContent>
          </Card>
        </Grid>

        {/* Top Artists */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Top Artists
              </Typography>
              {insights.top_artists.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No listening data yet
                </Typography>
              ) : (
                <List dense disablePadding>
                  {insights.top_artists.slice(0, 5).map((artist, index) => (
                    <ListItem key={artist.artist} disableGutters sx={{ py: 1 }}>
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor: index === 0 ? 'primary.main' : alpha(theme.palette.primary.main, 0.2),
                            color: index === 0 ? 'primary.contrastText' : 'primary.main',
                            fontWeight: 700,
                          }}
                        >
                          {index + 1}
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={artist.artist}
                        secondary={`${artist.play_count} plays • ${formatDuration(artist.total_duration)}`}
                        primaryTypographyProps={{ fontWeight: 500 }}
                      />
                      <Box sx={{ width: 80 }}>
                        <LinearProgress
                          variant="determinate"
                          value={(artist.play_count / maxArtistPlays) * 100}
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Top Channels */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Top Channels
              </Typography>
              {insights.top_channels.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No listening data yet
                </Typography>
              ) : (
                <List dense disablePadding>
                  {insights.top_channels.slice(0, 5).map((channel, index) => (
                    <ListItem key={channel.channel_name} disableGutters sx={{ py: 1 }}>
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor: alpha(theme.palette.error.main, 0.1),
                            color: 'error.main',
                          }}
                        >
                          <YouTubeIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={channel.channel_name}
                        secondary={`${channel.play_count} plays • ${formatDuration(channel.total_duration)}`}
                        primaryTypographyProps={{ 
                          fontWeight: 500,
                          sx: { 
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }
                        }}
                      />
                      <Box sx={{ width: 80 }}>
                        <LinearProgress
                          variant="determinate"
                          value={(channel.play_count / maxChannelPlays) * 100}
                          color="error"
                          sx={{ height: 6, borderRadius: 3 }}
                        />
                      </Box>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Top Tracks */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Most Played Tracks
              </Typography>
              {insights.top_tracks.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No listening data yet
                </Typography>
              ) : (
                <List dense disablePadding>
                  {insights.top_tracks.slice(0, 5).map((track, index) => (
                    <ListItem key={`${track.youtube_id}-${index}`} disableGutters sx={{ py: 1 }}>
                      <ListItemAvatar>
                        <Avatar
                          variant="rounded"
                          src={track.thumbnail_url}
                          sx={{ width: 48, height: 48 }}
                        >
                          <MusicNoteIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={track.title}
                        secondary={track.artist}
                        primaryTypographyProps={{ 
                          fontWeight: 500,
                          sx: {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }
                        }}
                        secondaryTypographyProps={{
                          sx: {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }
                        }}
                      />
                      <Chip
                        label={`${track.play_count}×`}
                        size="small"
                        color="primary"
                        sx={{ ml: 1 }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Recent Listening History */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                Recent Listening History
              </Typography>
              {insights.recent_history.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                  No recent listening history
                </Typography>
              ) : (
                <List disablePadding>
                  {insights.recent_history.map((track) => (
                    <ListItem
                      key={track.id}
                      sx={{
                        borderRadius: 2,
                        mb: 1,
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.05),
                        },
                      }}
                    >
                      <ListItemAvatar>
                        <Avatar
                          variant="rounded"
                          src={track.thumbnail_url}
                          sx={{ width: 48, height: 48 }}
                        >
                          <MusicNoteIcon />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={track.title}
                        secondary={
                          <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <span>{track.artist || track.channel_name}</span>
                            <span>•</span>
                            <span>{formatDuration(track.duration_listened)}</span>
                            {track.completed && (
                              <Chip label="Completed" size="small" color="success" sx={{ height: 18, fontSize: '0.65rem' }} />
                            )}
                          </Box>
                        }
                        primaryTypographyProps={{
                          fontWeight: 500,
                          sx: {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }
                        }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {new Date(track.listened_at).toLocaleString()}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Genre Distribution */}
        {insights.genre_distribution.length > 0 && (
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  Genre Distribution
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {insights.genre_distribution.map((genre) => (
                    <Chip
                      key={genre.genre}
                      label={`${genre.genre} (${genre.play_count})`}
                      variant="outlined"
                      color="primary"
                    />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
