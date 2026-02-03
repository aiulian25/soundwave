/**
 * Radio Indicator Component
 * 
 * Shows when radio mode is active with the current seed info
 * and provides controls to stop radio.
 */

import {
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  LinearProgress,
  Menu,
  MenuItem,
  Slider,
  Divider,
} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import CloseIcon from '@mui/icons-material/Close';
import TuneIcon from '@mui/icons-material/Tune';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useState } from 'react';
import { useRadio, type RadioMode } from '../context/RadioContext';
import { radioAPI } from '../api/client';

const modeLabels: Record<RadioMode, string> = {
  track: 'Track Radio',
  artist: 'Artist Radio',
  favorites: 'Favorites Mix',
  discovery: 'Discovery Mode',
  recent: 'New Additions',
};

const modeIcons: Record<RadioMode, string> = {
  track: '🎵',
  artist: '🎤',
  favorites: '❤️',
  discovery: '🔍',
  recent: '✨',
};

interface RadioIndicatorProps {
  compact?: boolean;
}

export default function RadioIndicator({ compact = false }: RadioIndicatorProps) {
  const { isRadioMode, radioSession, stopRadio, currentReason, isLoading } = useRadio();
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);
  const [varietyLevel, setVarietyLevel] = useState(radioSession?.variety_level ?? 50);
  
  if (!isRadioMode || !radioSession) return null;
  
  const handleOpenSettings = (event: React.MouseEvent<HTMLElement>) => {
    setVarietyLevel(radioSession.variety_level);
    setSettingsAnchor(event.currentTarget);
  };
  
  const handleCloseSettings = () => {
    setSettingsAnchor(null);
  };
  
  const handleVarietyChange = async (_: Event, value: number | number[]) => {
    const newValue = value as number;
    setVarietyLevel(newValue);
    try {
      await radioAPI.updateSettings({ variety_level: newValue });
    } catch (error) {
      console.error('Failed to update variety level:', error);
    }
  };
  
  const handleResetLearning = async () => {
    try {
      await radioAPI.updateSettings({ reset_learning: true });
      handleCloseSettings();
    } catch (error) {
      console.error('Failed to reset learning:', error);
    }
  };
  
  if (compact) {
    return (
      <Tooltip title={`${modeLabels[radioSession.mode]}: ${radioSession.seed_title}`}>
        <Chip
          icon={<RadioIcon sx={{ fontSize: 16 }} />}
          label="RADIO"
          size="small"
          color="primary"
          onDelete={stopRadio}
          deleteIcon={<CloseIcon sx={{ fontSize: 14 }} />}
          sx={{
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.7 },
            },
          }}
        />
      </Tooltip>
    );
  }
  
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1,
        borderRadius: 2,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      }}
    >
      <RadioIcon 
        sx={{ 
          fontSize: 20,
          animation: 'pulse 2s ease-in-out infinite',
          '@keyframes pulse': {
            '0%, 100%': { transform: 'scale(1)' },
            '50%': { transform: 'scale(1.1)' },
          },
        }} 
      />
      
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
            {modeIcons[radioSession.mode]} {modeLabels[radioSession.mode]}
          </Typography>
        </Box>
        
        <Typography variant="body2" noWrap sx={{ opacity: 0.9 }}>
          {radioSession.seed_title}
        </Typography>
        
        {currentReason && (
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 12 }} />
            {currentReason}
          </Typography>
        )}
        
        <Typography variant="caption" sx={{ opacity: 0.7 }}>
          {radioSession.tracks_played} played • {radioSession.tracks_skipped} skipped
        </Typography>
      </Box>
      
      <Tooltip title="Radio Settings">
        <IconButton size="small" onClick={handleOpenSettings} sx={{ color: 'inherit' }}>
          <TuneIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      
      <Tooltip title="Stop Radio">
        <IconButton size="small" onClick={stopRadio} sx={{ color: 'inherit' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      
      {isLoading && (
        <LinearProgress
          sx={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            borderBottomLeftRadius: 8,
            borderBottomRightRadius: 8,
          }}
        />
      )}
      
      {/* Settings Menu */}
      <Menu
        anchorEl={settingsAnchor}
        open={Boolean(settingsAnchor)}
        onClose={handleCloseSettings}
        PaperProps={{
          sx: { width: 280, p: 1 }
        }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="subtitle2" gutterBottom>
            Variety Level
          </Typography>
          <Typography variant="caption" color="text.secondary" gutterBottom sx={{ display: 'block', mb: 1 }}>
            Lower = stick to similar tracks, Higher = more variety
          </Typography>
          <Slider
            value={varietyLevel}
            onChange={handleVarietyChange}
            min={0}
            max={100}
            valueLabelDisplay="auto"
            marks={[
              { value: 0, label: 'Similar' },
              { value: 50, label: 'Balanced' },
              { value: 100, label: 'Varied' },
            ]}
          />
        </Box>
        
        <Divider sx={{ my: 1 }} />
        
        <MenuItem onClick={handleResetLearning}>
          Reset Learning Data
        </MenuItem>
      </Menu>
    </Box>
  );
}
