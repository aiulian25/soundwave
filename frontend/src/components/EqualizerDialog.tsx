/**
 * Equalizer Dialog Component
 * 
 * Full-featured equalizer with:
 * - 10-band graphic EQ with sliders
 * - Preset selection (built-in and custom)
 * - Custom preset saving
 * - Visual frequency response curve
 * - Enable/disable toggle
 */

import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Slider,
  Typography,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  TextField,
  Tooltip,
  Divider,
  Chip,
  useTheme,
  useMediaQuery,
  alpha,
} from '@mui/material';
import EqualizerIcon from '@mui/icons-material/Equalizer';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import TuneIcon from '@mui/icons-material/Tune';
import {
  useEqualizer,
  EQ_LABELS,
  MIN_GAIN,
  MAX_GAIN,
  BUILTIN_PRESETS,
} from '../context/EqualizerContext';

interface EqualizerDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function EqualizerDialog({ open, onClose }: EqualizerDialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const {
    enabled,
    activePresetId,
    gains,
    presets,
    customPresets,
    setEnabled,
    setGain,
    selectPreset,
    saveCustomPreset,
    deleteCustomPreset,
    resetToFlat,
  } = useEqualizer();

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  // Get active preset name
  const activePreset = presets.find(p => p.id === activePresetId);
  const isCustom = activePresetId === 'custom' || activePreset?.isCustom;

  // Handle preset change
  const handlePresetChange = (event: any) => {
    selectPreset(event.target.value);
  };

  // Handle slider change
  const handleSliderChange = (index: number) => (_event: Event, value: number | number[]) => {
    setGain(index, value as number);
  };

  // Handle save preset
  const handleSavePreset = () => {
    if (newPresetName.trim()) {
      saveCustomPreset(newPresetName.trim());
      setNewPresetName('');
      setSaveDialogOpen(false);
    }
  };

  // Visualize frequency response curve
  const FrequencyCurve = useMemo(() => {
    const width = isMobile ? 280 : 500;
    const height = 80;
    const padding = 10;
    
    // Create smooth curve through EQ points
    const points = gains.map((gain, index) => {
      const x = padding + (index / (gains.length - 1)) * (width - padding * 2);
      const y = height / 2 - (gain / MAX_GAIN) * (height / 2 - padding);
      return { x, y };
    });

    // Create SVG path with smooth bezier curves
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      pathD += ` Q ${cpx} ${prev.y} ${cpx} ${(prev.y + curr.y) / 2}`;
      pathD += ` Q ${cpx} ${curr.y} ${curr.x} ${curr.y}`;
    }

    return (
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          mb: 2,
          opacity: enabled ? 1 : 0.3,
          transition: 'opacity 0.3s',
        }}
      >
        <svg width={width} height={height} style={{ overflow: 'visible' }}>
          {/* Background grid */}
          <line
            x1={padding}
            y1={height / 2}
            x2={width - padding}
            y2={height / 2}
            stroke={alpha(theme.palette.text.secondary, 0.2)}
            strokeDasharray="4 4"
          />
          {/* +6dB line */}
          <line
            x1={padding}
            y1={height / 4}
            x2={width - padding}
            y2={height / 4}
            stroke={alpha(theme.palette.text.secondary, 0.1)}
            strokeDasharray="2 4"
          />
          {/* -6dB line */}
          <line
            x1={padding}
            y1={(3 * height) / 4}
            x2={width - padding}
            y2={(3 * height) / 4}
            stroke={alpha(theme.palette.text.secondary, 0.1)}
            strokeDasharray="2 4"
          />
          
          {/* Gradient fill under curve */}
          <defs>
            <linearGradient id="curveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.4} />
              <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          
          {/* Filled area */}
          <path
            d={`${pathD} L ${points[points.length - 1].x} ${height / 2} L ${points[0].x} ${height / 2} Z`}
            fill="url(#curveGradient)"
          />
          
          {/* Main curve */}
          <path
            d={pathD}
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
            strokeLinecap="round"
          />
          
          {/* Control points */}
          {points.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={4}
              fill={theme.palette.primary.main}
              stroke={theme.palette.background.paper}
              strokeWidth={1}
            />
          ))}
        </svg>
      </Box>
    );
  }, [gains, enabled, theme, isMobile]);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            backgroundImage: 'none',
          },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EqualizerIcon color="primary" />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Equalizer
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                color="primary"
              />
            }
            label={enabled ? 'On' : 'Off'}
          />
        </DialogTitle>
        
        <DialogContent>
          {/* Frequency Response Curve */}
          {FrequencyCurve}
          
          {/* Preset Selection */}
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Preset</InputLabel>
              <Select
                value={activePresetId === 'custom' ? '' : activePresetId}
                onChange={handlePresetChange}
                label="Preset"
                displayEmpty
              >
                {activePresetId === 'custom' && (
                  <MenuItem value="" disabled>
                    <em>Custom</em>
                  </MenuItem>
                )}
                <MenuItem disabled sx={{ opacity: 0.7, fontSize: '0.75rem' }}>
                  — Built-in —
                </MenuItem>
                {BUILTIN_PRESETS.map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </MenuItem>
                ))}
                {customPresets.length > 0 && (
                  <MenuItem disabled sx={{ opacity: 0.7, fontSize: '0.75rem' }}>
                    — Custom —
                  </MenuItem>
                )}
                {customPresets.map((preset) => (
                  <MenuItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Tooltip title="Reset to Flat">
              <IconButton onClick={resetToFlat} size="small">
                <RestartAltIcon />
              </IconButton>
            </Tooltip>
            
            <Tooltip title="Save as Custom Preset">
              <IconButton 
                onClick={() => setSaveDialogOpen(true)} 
                size="small"
                color="primary"
              >
                <SaveIcon />
              </IconButton>
            </Tooltip>
            
            {activePreset?.isCustom && (
              <Tooltip title="Delete Custom Preset">
                <IconButton
                  onClick={() => deleteCustomPreset(activePresetId)}
                  size="small"
                  color="error"
                >
                  <DeleteIcon />
                </IconButton>
              </Tooltip>
            )}
            
            {isCustom && (
              <Chip
                icon={<TuneIcon sx={{ fontSize: 16 }} />}
                label="Custom"
                size="small"
                color="secondary"
                variant="outlined"
              />
            )}
          </Box>
          
          <Divider sx={{ mb: 3 }} />
          
          {/* EQ Sliders */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: isMobile ? 0.5 : 1,
              px: isMobile ? 0 : 2,
              opacity: enabled ? 1 : 0.4,
              transition: 'opacity 0.3s',
              pointerEvents: enabled ? 'auto' : 'none',
            }}
          >
            {EQ_LABELS.map((label, index) => (
              <Box
                key={label}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  flex: 1,
                }}
              >
                {/* Gain value */}
                <Typography
                  variant="caption"
                  sx={{
                    mb: 1,
                    color: gains[index] > 0 
                      ? 'success.main' 
                      : gains[index] < 0 
                        ? 'error.main' 
                        : 'text.secondary',
                    fontWeight: 600,
                    fontSize: isMobile ? '0.65rem' : '0.75rem',
                  }}
                >
                  {gains[index] > 0 ? '+' : ''}{gains[index]}
                </Typography>
                
                {/* Vertical slider */}
                <Slider
                  orientation="vertical"
                  value={gains[index]}
                  min={MIN_GAIN}
                  max={MAX_GAIN}
                  step={1}
                  onChange={handleSliderChange(index)}
                  sx={{
                    height: isMobile ? 100 : 150,
                    '& .MuiSlider-track': {
                      width: 4,
                      background: (theme) => 
                        gains[index] >= 0
                          ? `linear-gradient(to top, ${theme.palette.primary.main}, ${theme.palette.success.main})`
                          : `linear-gradient(to bottom, ${theme.palette.primary.main}, ${theme.palette.error.main})`,
                    },
                    '& .MuiSlider-rail': {
                      width: 4,
                      opacity: 0.3,
                    },
                    '& .MuiSlider-thumb': {
                      width: isMobile ? 14 : 16,
                      height: isMobile ? 14 : 16,
                      '&:hover, &.Mui-focusVisible': {
                        boxShadow: (theme) => `0 0 0 8px ${alpha(theme.palette.primary.main, 0.16)}`,
                      },
                    },
                  }}
                />
                
                {/* Frequency label */}
                <Typography
                  variant="caption"
                  sx={{
                    mt: 1,
                    color: 'text.secondary',
                    fontSize: isMobile ? '0.6rem' : '0.7rem',
                    fontWeight: 500,
                  }}
                >
                  {label}
                </Typography>
              </Box>
            ))}
          </Box>
          
          {/* dB scale labels */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              mt: 2,
              px: 2,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              +{MAX_GAIN}dB
            </Typography>
            <Typography variant="caption" color="text.secondary">
              0dB
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {MIN_GAIN}dB
            </Typography>
          </Box>
          
          {/* Quick preset chips for mobile */}
          {isMobile && (
            <Box sx={{ mt: 3, display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              {BUILTIN_PRESETS.slice(0, 6).map((preset) => (
                <Chip
                  key={preset.id}
                  label={preset.name}
                  size="small"
                  variant={activePresetId === preset.id ? 'filled' : 'outlined'}
                  color={activePresetId === preset.id ? 'primary' : 'default'}
                  onClick={() => selectPreset(preset.id)}
                  sx={{ fontSize: '0.75rem' }}
                />
              ))}
            </Box>
          )}
        </DialogContent>
        
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>
      
      {/* Save Preset Dialog */}
      <Dialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Save Custom Preset</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Preset Name"
            fullWidth
            variant="outlined"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newPresetName.trim()) {
                handleSavePreset();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleSavePreset}
            variant="contained"
            disabled={!newPresetName.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
