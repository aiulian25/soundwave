import { Box, IconButton, Slider, Typography, LinearProgress, Fade } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import ShuffleIcon from '@mui/icons-material/Shuffle';
import RepeatIcon from '@mui/icons-material/Repeat';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useState, useRef, useEffect } from 'react';
import type { Audio } from '../types';
import LyricsPlayer from './LyricsPlayer';
import {
  setMediaMetadata,
  setMediaActionHandlers,
  setPlaybackState,
  setPositionState,
  clearMediaSession,
} from '../utils/mediaSession';

interface PlayerProps {
  audio: Audio;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onClose?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export default function Player({ audio, isPlaying, setIsPlaying, onClose, onNext, onPrevious, hasNext = false, hasPrevious = false }: PlayerProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [streamUrl, setStreamUrl] = useState<string>('');
  const [loadingStream, setLoadingStream] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeeking = useRef(false);
  const currentAudioId = useRef(audio.id);

  // Reset stream when audio changes
  if (currentAudioId.current !== audio.id) {
    currentAudioId.current = audio.id;
    setStreamUrl('');
    setLoadingStream(true);
  }

  // Fetch stream URL when audio changes
  useEffect(() => {
    const fetchStreamUrl = async () => {
      if (audio.media_url) {
        setStreamUrl(audio.media_url);
        setLoadingStream(false);
        return;
      }

      if (audio.youtube_id) {
        try {
          setLoadingStream(true);
          const response = await fetch(`/api/audio/${audio.youtube_id}/player/`, {
            headers: {
              'Authorization': `Token ${localStorage.getItem('token')}`,
            },
          });
          const data = await response.json();
          setStreamUrl(data.stream_url);
          setLoadingStream(false);
        } catch (error) {
          console.error('Failed to fetch stream URL:', error);
          setLoadingStream(false);
        }
      }
    };

    fetchStreamUrl();
    // Use audio.id as single dependency to prevent double fetching
  }, [audio.id]);

  // Initialize Media Session API
  useEffect(() => {
    // Set metadata
    setMediaMetadata({
      title: audio.title,
      artist: audio.artist || 'Unknown Artist',
      album: audio.album,
      artwork: audio.cover_art_url
        ? [
            { src: audio.cover_art_url, sizes: '96x96', type: 'image/png' },
            { src: audio.cover_art_url, sizes: '128x128', type: 'image/png' },
            { src: audio.cover_art_url, sizes: '192x192', type: 'image/png' },
            { src: audio.cover_art_url, sizes: '256x256', type: 'image/png' },
            { src: audio.cover_art_url, sizes: '384x384', type: 'image/png' },
            { src: audio.cover_art_url, sizes: '512x512', type: 'image/png' },
          ]
        : undefined,
    });

    // Set action handlers
    setMediaActionHandlers({
      play: () => {
        if (!isPlayingRef.current) {
          setIsPlaying(true);
        }
      },
      pause: () => {
        if (isPlayingRef.current) {
          setIsPlaying(false);
        }
      },
      previoustrack: () => {
        if (hasPrevious && onPrevious) {
          onPrevious();
        }
      },
      nexttrack: () => {
        if (hasNext && onNext) {
          onNext();
        }
      },
      seekbackward: () => {
        if (audioRef.current) {
          isSeeking.current = true;
          audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10);
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
      seekforward: () => {
        if (audioRef.current) {
          isSeeking.current = true;
          audioRef.current.currentTime = Math.min(
            audio.duration,
            audioRef.current.currentTime + 10
          );
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
      seekto: (details) => {
        if (audioRef.current && details.seekTime !== undefined) {
          isSeeking.current = true;
          audioRef.current.currentTime = details.seekTime;
          setTimeout(() => {
            isSeeking.current = false;
          }, 100);
        }
      },
    });

    // Cleanup on unmount
    return () => {
      clearMediaSession();
    };
  }, [audio, hasNext, hasPrevious, onNext, onPrevious, setIsPlaying]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
  }, [volume]);

  // Handle audio source changes
  useEffect(() => {
    if (audioRef.current && streamUrl) {
      // Pause current playback before loading new source
      audioRef.current.pause();
      // Reset current time when audio changes
      setCurrentTime(0);
      // Load new audio source
      audioRef.current.load();
      // Reset playing ref
      isPlayingRef.current = false;
    }
  }, [streamUrl]);

  // Handle play/pause state
  useEffect(() => {
    // Skip if we're currently seeking or loading
    if (isSeeking.current || loadingStream) {
      return;
    }

    if (audioRef.current && streamUrl) {
      // Check if the playing state actually changed
      if (isPlaying !== isPlayingRef.current) {
        isPlayingRef.current = isPlaying;
        
        if (isPlaying) {
          // Only play if audio is not already playing
          if (audioRef.current.paused) {
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
              playPromise
                .then(() => {
                  setPlaybackState('playing');
                })
                .catch(err => {
                  console.error('Playback failed:', err);
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                });
            }
          }
        } else {
          // Only pause if audio is actually playing
          if (!audioRef.current.paused) {
            audioRef.current.pause();
            setPlaybackState('paused');
          }
        }
      }
    }
  }, [isPlaying, setIsPlaying, loadingStream, streamUrl]);

  const handleTimeUpdate = () => {
    // Don't update time display while user is seeking
    if (audioRef.current && !isSeeking.current) {
      setCurrentTime(audioRef.current.currentTime);
      
      // Update Media Session position state
      setPositionState({
        duration: audio.duration,
        playbackRate: audioRef.current.playbackRate,
        position: audioRef.current.currentTime,
      });
    }
  };

  const handleSeekChange = (_: Event, value: number | number[]) => {
    // Block time updates during drag
    isSeeking.current = true;
    // Update visual position while dragging (no actual seek yet)
    const time = value as number;
    setCurrentTime(time);
  };

  const handleSeekCommitted = (_: Event | React.SyntheticEvent, value: number | number[]) => {
    // Actually seek when user releases slider
    const time = value as number;
    if (audioRef.current && !loadingStream) {
      // Ensure flag is still set
      isSeeking.current = true;
      
      // Pause before seeking to prevent race conditions
      const wasPlaying = !audioRef.current.paused;
      audioRef.current.pause();
      
      // Only seek if audio is ready (has duration)
      if (audioRef.current.readyState >= 2) { // HAVE_CURRENT_DATA or better
        audioRef.current.currentTime = time;
        
        // Resume playback after seek completes
        if (wasPlaying) {
          // The 'seeked' event will resume playback
          audioRef.current.play();
        }
        
        // Update Media Session position
        setPositionState({
          duration: audio.duration,
          playbackRate: audioRef.current.playbackRate,
          position: time,
        });
      } else {
        // If not ready, wait for it and then seek
        const handleCanPlay = () => {
          if (audioRef.current) {
            audioRef.current.currentTime = time;
            if (wasPlaying) {
              audioRef.current.play();
            }
            audioRef.current.removeEventListener('canplay', handleCanPlay);
          }
        };
        audioRef.current.addEventListener('canplay', handleCanPlay);
      }
    }
  };

  const handleSeeked = () => {
    // Called when the audio element completes seeking - now it's safe to update from time events
    isSeeking.current = false;
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
  };

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Blur Image */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: (theme) =>
              `linear-gradient(to bottom, ${theme.palette.background.paper} 0%, ${theme.palette.background.paper}e6 50%, ${theme.palette.background.default} 100%)`,
            zIndex: 10,
          }}
        />
        <Box
          sx={{
            width: '100%',
            height: '100%',
            backgroundImage: audio.cover_art_url || audio.thumbnail_url
              ? `url(${audio.cover_art_url || audio.thumbnail_url})`
              : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(60px)',
            opacity: 0.3,
            transform: 'scale(1.5)',
          }}
        />
      </Box>

      {/* Content */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          p: 3,
          justifyContent: 'space-between',
        }}
      >
        {streamUrl ? (
          <audio
            ref={audioRef}
            src={streamUrl}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleSeeked}
            onEnded={() => {
              if (hasNext && onNext) {
                onNext();
              } else {
                setIsPlaying(false);
              }
            }}
            onError={(e) => {
              console.error('Audio playback error:', e);
              console.error('Stream URL:', streamUrl);
              console.error('Audio element:', audioRef.current);
            }}
          />
        ) : (
          <audio ref={audioRef} />
        )}

        {/* Top: Visualizer */}
        <Box sx={{ height: 96, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0.75, width: '100%' }}>
          {[40, 60, 100, 100, 80, 50, 70, 100, 100, 60, 40, 20].map((height, i) => (
            <Box
              key={i}
              sx={{
                width: 6,
                bgcolor: i % 3 === 0 ? 'primary.main' : i % 2 === 0 ? 'rgba(19, 236, 106, 0.6)' : 'rgba(19, 236, 106, 0.4)',
                borderRadius: '9999px',
                animation: isPlaying ? 'visualizer-bounce 1.2s infinite ease-in-out' : 'none',
                animationDelay: `${i * 0.1}s`,
                height: isPlaying ? undefined : '20%',
                transition: 'height 0.3s ease',
                '@keyframes visualizer-bounce': {
                  '0%, 100%': { height: '20%' },
                  '50%': { height: `${height}%` },
                },
              }}
            />
          ))}
        </Box>

        {/* Middle: Album Art & Song Info */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 4 }}>
          {(audio.cover_art_url || audio.thumbnail_url) && (
            <Box
              onClick={() => audio.youtube_id && setShowLyrics(!showLyrics)}
              sx={{
                width: 200,
                height: 200,
                borderRadius: 3,
                backgroundImage: `url(${audio.cover_art_url || audio.thumbnail_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                mb: 3,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
                cursor: audio.youtube_id ? 'pointer' : 'default',
                transition: 'transform 0.2s ease',
                '&:hover': audio.youtube_id ? {
                  transform: 'scale(1.05)',
                } : {},
              }}
              title={audio.youtube_id ? 'Click to toggle lyrics' : 'Lyrics not available for local files'}
            />
          )}
          <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5, textAlign: 'center', px: 2 }}>
            {audio.title}
          </Typography>
          <Typography variant="body1" color="primary.main" sx={{ fontWeight: 500 }}>
            {audio.channel_name}
          </Typography>
        </Box>

        {/* Bottom: Player Controls */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Progress Bar */}
          <Box>
            <Slider
              value={currentTime}
              max={audio.duration}
              onChange={handleSeekChange}
              onChangeCommitted={handleSeekCommitted}
              sx={{
                color: 'primary.main',
                height: 6,
                padding: '13px 0',
                '& .MuiSlider-thumb': {
                  width: 12,
                  height: 12,
                  backgroundColor: '#fff',
                  boxShadow: '0 0 10px rgba(255, 255, 255, 0.5)',
                  '&:hover, &.Mui-focusVisible': {
                    boxShadow: '0 0 0 8px rgba(19, 236, 106, 0.16)',
                  },
                },
                '& .MuiSlider-track': {
                  border: 'none',
                  height: 6,
                },
                '& .MuiSlider-rail': {
                  opacity: 0.3,
                  backgroundColor: '#fff',
                  height: 6,
                },
              }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.4)', fontWeight: 500, fontSize: '0.75rem' }}>
                {formatTime(currentTime)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'rgba(255, 255, 255, 0.4)', fontWeight: 500, fontSize: '0.75rem' }}>
                {formatTime(audio.duration)}
              </Typography>
            </Box>
          </Box>

          {/* Buttons */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1 }}>
            <IconButton
              size="small"
              sx={{
                color: 'rgba(255, 255, 255, 0.4)',
                '&:hover': { color: 'white' },
              }}
            >
              <ShuffleIcon />
            </IconButton>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <IconButton
                onClick={onPrevious}
                disabled={!hasPrevious}
                sx={{
                  color: 'white',
                  '&:hover': { color: 'primary.main' },
                  '&:disabled': { color: 'rgba(255, 255, 255, 0.2)' },
                }}
              >
                <SkipPreviousIcon sx={{ fontSize: 30 }} />
              </IconButton>
              <IconButton
                onClick={() => setIsPlaying(!isPlaying)}
                sx={{
                  width: 64,
                  height: 64,
                  bgcolor: 'primary.main',
                  color: 'background.dark',
                  boxShadow: '0 0 20px rgba(19, 236, 106, 0.4)',
                  '&:hover': {
                    bgcolor: 'primary.main',
                    transform: 'scale(1.05)',
                  },
                  transition: 'all 0.3s ease',
                }}
              >
                {isPlaying ? <PauseIcon sx={{ fontSize: 36 }} /> : <PlayArrowIcon sx={{ fontSize: 36 }} />}
              </IconButton>
              <IconButton
                onClick={onNext}
                disabled={!hasNext}
                sx={{
                  color: 'white',
                  '&:hover': { color: 'primary.main' },
                  '&:disabled': { color: 'rgba(255, 255, 255, 0.2)' },
                }}
              >
                <SkipNextIcon sx={{ fontSize: 30 }} />
              </IconButton>
            </Box>

            <IconButton
              size="small"
              sx={{
                color: 'rgba(255, 255, 255, 0.4)',
                '&:hover': { color: 'white' },
              }}
            >
              <RepeatIcon />
            </IconButton>
          </Box>

          {/* Volume Mini */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 1 }}>
            <IconButton onClick={() => setIsMuted(!isMuted)} size="small" sx={{ color: 'rgba(255, 255, 255, 0.3)' }}>
              <VolumeUpIcon sx={{ fontSize: 14 }} />
            </IconButton>
            <Box sx={{ width: 96 }}>
              <Slider
                value={isMuted ? 0 : volume}
                onChange={(_, value) => {
                  const vol = value as number;
                  setVolume(vol);
                  if (vol > 0) setIsMuted(false);
                }}
                sx={{
                  color: 'rgba(255, 255, 255, 0.5)',
                  height: 4,
                  padding: '8px 0',
                  '& .MuiSlider-thumb': {
                    width: 8,
                    height: 8,
                    backgroundColor: '#fff',
                  },
                  '& .MuiSlider-track': {
                    border: 'none',
                    height: 4,
                  },
                  '& .MuiSlider-rail': {
                    opacity: 0.3,
                    backgroundColor: '#fff',
                    height: 4,
                  },
                }}
              />
            </Box>
            <IconButton onClick={() => setIsMuted(!isMuted)} size="small" sx={{ color: 'rgba(255, 255, 255, 0.3)' }}>
              <VolumeOffIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {/* Lyrics Overlay */}
      {showLyrics && audio.youtube_id && (
        <Fade in={showLyrics}>
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              bgcolor: 'rgba(0, 0, 0, 0.95)',
              backdropFilter: 'blur(10px)',
              zIndex: 20,
              overflow: 'auto',
            }}
          >
            <LyricsPlayer
              youtubeId={audio.youtube_id}
              currentTime={currentTime}
              onClose={() => setShowLyrics(false)}
              embedded={true}
            />
          </Box>
        </Fade>
      )}
    </Box>
  );
}
