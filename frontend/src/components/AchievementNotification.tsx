import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  Box,
  Typography,
  Button,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  EmojiEvents as TrophyIcon,
} from '@mui/icons-material';
import Confetti from 'react-confetti';
import { useNavigate } from 'react-router-dom';
import type { Achievement } from '../types';

interface AchievementNotificationProps {
  achievements: Achievement[];
  onClose: () => void;
}

export default function AchievementNotification({ achievements, onClose }: AchievementNotificationProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showConfetti, setShowConfetti] = useState(true);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const navigate = useNavigate();

  useEffect(() => {
    // Get window dimensions for confetti
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    // Stop confetti after a few seconds
    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  const currentAchievement = achievements[currentIndex];

  const handleNext = useCallback(() => {
    if (currentIndex < achievements.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowConfetti(true);
    } else {
      onClose();
    }
  }, [currentIndex, achievements.length, onClose]);

  const handleViewAll = () => {
    onClose();
    navigate('/achievements');
  };

  if (!currentAchievement) return null;

  return (
    <>
      {showConfetti && (
        <Confetti
          width={dimensions.width}
          height={dimensions.height}
          recycle={false}
          numberOfPieces={200}
          gravity={0.3}
          colors={['#13ec6a', '#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1']}
          style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999, pointerEvents: 'none' }}
        />
      )}
      
      <Dialog
        open={true}
        onClose={onClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'linear-gradient(135deg, rgba(19, 236, 106, 0.1) 0%, rgba(103, 58, 183, 0.1) 100%)',
            border: '2px solid',
            borderColor: 'primary.main',
            borderRadius: 3,
          },
        }}
      >
        <IconButton
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: 8,
            top: 8,
            color: 'text.secondary',
          }}
        >
          <CloseIcon />
        </IconButton>
        
        <DialogContent sx={{ textAlign: 'center', py: 4 }}>
          {/* Achievement Counter */}
          {achievements.length > 1 && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
              Achievement {currentIndex + 1} of {achievements.length}
            </Typography>
          )}

          {/* Trophy Animation */}
          <Box
            sx={{
              fontSize: 80,
              mb: 2,
              animation: 'bounce 0.6s ease infinite',
              '@keyframes bounce': {
                '0%, 100%': { transform: 'translateY(0)' },
                '50%': { transform: 'translateY(-10px)' },
              },
            }}
          >
            {currentAchievement.icon}
          </Box>

          {/* Achievement Unlocked Badge */}
          <Box
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(19, 236, 106, 0.2)',
              color: 'primary.main',
              px: 2,
              py: 0.5,
              borderRadius: 2,
              mb: 2,
            }}
          >
            <TrophyIcon sx={{ fontSize: 18 }} />
            <Typography variant="caption" sx={{ fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
              Achievement Unlocked!
            </Typography>
          </Box>

          {/* Achievement Name */}
          <Typography variant="h4" sx={{ fontWeight: 700, mb: 1 }}>
            {currentAchievement.name}
          </Typography>

          {/* Description */}
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            {currentAchievement.description}
          </Typography>

          {/* Context (e.g., for Superfan achievement) */}
          {currentAchievement.context && Object.keys(currentAchievement.context).length > 0 && (
            <Typography variant="body2" color="primary.main" sx={{ mb: 3 }}>
              {currentAchievement.context.artist && `Artist: ${currentAchievement.context.artist}`}
            </Typography>
          )}

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="outlined" onClick={handleViewAll}>
              View All Achievements
            </Button>
            <Button variant="contained" onClick={handleNext}>
              {currentIndex < achievements.length - 1 ? 'Next' : 'Awesome!'}
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
}
