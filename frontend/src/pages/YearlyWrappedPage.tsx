import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  LinearProgress,
  Chip,
  Divider,
  Avatar,
} from '@mui/material';
import {
  MusicNote as MusicIcon,
  AccessTime as TimeIcon,
  LocalFireDepartment as FireIcon,
  Person as ArtistIcon,
  YouTube as ChannelIcon,
  CalendarMonth as CalendarIcon,
  EmojiEvents as TrophyIcon,
  WbSunny as SunIcon,
  NightsStay as MoonIcon,
} from '@mui/icons-material';
import { statsAPI } from '../api/client';
import type { YearlyWrapped } from '../types';

export default function YearlyWrappedPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [wrapped, setWrapped] = useState<YearlyWrapped | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Generate year options (current year and past 5 years)
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

  useEffect(() => {
    loadWrapped();
  }, [year]);

  const loadWrapped = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await statsAPI.yearlyWrapped(year);
      setWrapped(response.data);
    } catch (err: any) {
      console.error('Failed to load yearly wrapped:', err);
      if (err.response?.status === 404) {
        setError(`No listening data found for ${year}`);
      } else {
        setError('Failed to load yearly wrapped');
      }
      setWrapped(null);
    } finally {
      setLoading(false);
    }
  };

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hours`;
    const days = Math.floor(hours / 24);
    return `${days} days, ${hours % 24} hours`;
  };

  const formatHour = (hour: number | null) => {
    if (hour === null) return 'N/A';
    if (hour === 0) return '12 AM';
    if (hour === 12) return '12 PM';
    return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            🎁 Your {year} Wrapped
          </Typography>
          <Typography variant="body1" color="text.secondary">
            A look back at your listening journey
          </Typography>
        </Box>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Year</InputLabel>
          <Select
            value={year}
            label="Year"
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <MenuItem key={y} value={y}>{y}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {error ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          {error}. Start listening to build your wrapped!
        </Alert>
      ) : wrapped && (
        <>
          {/* Listening Personality */}
          <Card 
            sx={{ 
              mb: 4, 
              background: 'linear-gradient(135deg, rgba(19, 236, 106, 0.2) 0%, rgba(103, 58, 183, 0.2) 100%)',
              border: '2px solid',
              borderColor: 'primary.main',
            }}
          >
            <CardContent sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h5" sx={{ mb: 1 }}>
                Your Listening Personality
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 700, color: 'primary.main' }}>
                {wrapped.listening_personality}
              </Typography>
            </CardContent>
          </Card>

          {/* Main Stats */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            <Grid item xs={6} md={3}>
              <StatCard
                icon={<TimeIcon sx={{ fontSize: 32 }} />}
                label="Minutes Listened"
                value={wrapped.total_minutes_listened.toLocaleString()}
                subtitle={formatMinutes(wrapped.total_minutes_listened)}
                color="primary.main"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard
                icon={<MusicIcon sx={{ fontSize: 32 }} />}
                label="Tracks Played"
                value={wrapped.total_tracks_played.toLocaleString()}
                subtitle={`${wrapped.total_unique_tracks} unique`}
                color="secondary.main"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard
                icon={<ArtistIcon sx={{ fontSize: 32 }} />}
                label="Artists Discovered"
                value={wrapped.total_unique_artists.toString()}
                color="warning.main"
              />
            </Grid>
            <Grid item xs={6} md={3}>
              <StatCard
                icon={<FireIcon sx={{ fontSize: 32 }} />}
                label="Longest Streak"
                value={`${wrapped.longest_streak} days`}
                subtitle={`${wrapped.total_listening_days} days active`}
                color="error.main"
              />
            </Grid>
          </Grid>

          {/* Top Artist & Track */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            {wrapped.top_artist && (
              <Grid item xs={12} md={6}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      #1 Artist
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                      <Avatar sx={{ width: 64, height: 64, bgcolor: 'warning.main' }}>
                        <ArtistIcon sx={{ fontSize: 32 }} />
                      </Avatar>
                      <Box>
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                          {wrapped.top_artist.artist}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {wrapped.top_artist.play_count} plays • {wrapped.top_artist.total_minutes} minutes
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            )}
            {wrapped.top_track && (
              <Grid item xs={12} md={6}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <Typography variant="overline" color="text.secondary">
                      #1 Track
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1 }}>
                      {wrapped.top_track.thumbnail_url ? (
                        <Avatar 
                          src={wrapped.top_track.thumbnail_url} 
                          variant="rounded"
                          sx={{ width: 64, height: 64 }}
                        />
                      ) : (
                        <Avatar sx={{ width: 64, height: 64, bgcolor: 'primary.main' }} variant="rounded">
                          <MusicIcon sx={{ fontSize: 32 }} />
                        </Avatar>
                      )}
                      <Box sx={{ overflow: 'hidden' }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
                          {wrapped.top_track.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {wrapped.top_track.artist}
                        </Typography>
                        <Typography variant="caption" color="primary.main">
                          {wrapped.top_track.play_count} plays
                        </Typography>
                      </Box>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            )}
          </Grid>

          {/* Top 5 Lists */}
          <Grid container spacing={3} sx={{ mb: 4 }}>
            {/* Top 5 Artists */}
            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    🎤 Top 5 Artists
                  </Typography>
                  {wrapped.top_5_artists.map((artist, index) => (
                    <Box key={artist.artist} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography 
                          variant="h6" 
                          sx={{ 
                            width: 28, 
                            fontWeight: 700,
                            color: index === 0 ? 'warning.main' : 'text.secondary',
                          }}
                        >
                          {index + 1}
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
                            {artist.artist}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {artist.play_count} plays
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Grid>

            {/* Top 5 Tracks */}
            <Grid item xs={12} md={6}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                    🎵 Top 5 Tracks
                  </Typography>
                  {wrapped.top_5_tracks.map((track, index) => (
                    <Box key={track.youtube_id} sx={{ mb: 1.5 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography 
                          variant="h6" 
                          sx={{ 
                            width: 28, 
                            fontWeight: 700,
                            color: index === 0 ? 'warning.main' : 'text.secondary',
                          }}
                        >
                          {index + 1}
                        </Typography>
                        {track.thumbnail_url && (
                          <Avatar 
                            src={track.thumbnail_url} 
                            variant="rounded"
                            sx={{ width: 40, height: 40 }}
                          />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                            {track.title}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {track.artist} • {track.play_count} plays
                          </Typography>
                        </Box>
                      </Box>
                    </Box>
                  ))}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Monthly Breakdown */}
          <Card sx={{ mb: 4 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                📅 Monthly Listening
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 150 }}>
                {wrapped.monthly_minutes.map((month) => {
                  const maxMinutes = Math.max(...wrapped.monthly_minutes.map(m => m.minutes), 1);
                  const height = (month.minutes / maxMinutes) * 100;
                  return (
                    <Box 
                      key={month.month_num} 
                      sx={{ 
                        flex: 1, 
                        display: 'flex', 
                        flexDirection: 'column',
                        alignItems: 'center',
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          height: `${height}%`,
                          minHeight: 4,
                          bgcolor: month.month === wrapped.peak_month ? 'primary.main' : 'rgba(19, 236, 106, 0.3)',
                          borderRadius: '4px 4px 0 0',
                          transition: 'all 0.3s ease',
                          '&:hover': {
                            bgcolor: 'primary.main',
                          },
                        }}
                      />
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          mt: 0.5, 
                          fontSize: '0.65rem',
                          color: month.month === wrapped.peak_month ? 'primary.main' : 'text.secondary',
                          fontWeight: month.month === wrapped.peak_month ? 600 : 400,
                        }}
                      >
                        {month.month.substring(0, 3)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
              <Box sx={{ mt: 2, display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Chip 
                  icon={<CalendarIcon />}
                  label={`Peak Month: ${wrapped.peak_month}`}
                  color="primary"
                  variant="outlined"
                />
                <Chip 
                  icon={wrapped.peak_hour !== null && wrapped.peak_hour >= 18 ? <MoonIcon /> : <SunIcon />}
                  label={`Peak Time: ${formatHour(wrapped.peak_hour)}`}
                  variant="outlined"
                />
                <Chip 
                  label={`Favorite Day: ${wrapped.peak_day_of_week}`}
                  variant="outlined"
                />
              </Box>
            </CardContent>
          </Card>

          {/* Achievements */}
          <Card>
            <CardContent sx={{ textAlign: 'center' }}>
              <TrophyIcon sx={{ fontSize: 48, color: 'warning.main', mb: 1 }} />
              <Typography variant="h5" sx={{ fontWeight: 600 }}>
                {wrapped.achievements_unlocked} Achievements Unlocked
              </Typography>
              <Typography variant="body2" color="text.secondary">
                in {year}
              </Typography>
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}

// Stat Card Component
interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  color: string;
}

function StatCard({ icon, label, value, subtitle, color }: StatCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ color, mb: 1 }}>{icon}</Box>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          {label}
        </Typography>
        <Typography variant="h4" sx={{ fontWeight: 700, color }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
