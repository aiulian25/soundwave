/**
 * Visualizer Theme Preview Component
 * Shows a visual preview of a visualizer theme with animated demo
 */

import { Box, Typography, useTheme } from '@mui/material';
import { useMemo, useEffect, useState } from 'react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { VisualizerTheme, getColorArray } from '../config/visualizerThemes';

interface VisualizerThemePreviewProps {
  theme: VisualizerTheme;
  isSelected: boolean;
  onClick: () => void;
}

export default function VisualizerThemePreview({ 
  theme: visualizerTheme, 
  isSelected, 
  onClick 
}: VisualizerThemePreviewProps) {
  const muiTheme = useTheme();
  const [animationData, setAnimationData] = useState<number[]>(Array(8).fill(0.3));
  
  // Animate the preview
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimationData(Array.from({ length: 8 }, () => 0.2 + Math.random() * 0.8));
    }, 200);
    
    return () => clearInterval(interval);
  }, []);
  
  const colors = useMemo(() => 
    getColorArray(visualizerTheme.colorScheme, 8, muiTheme.palette.primary.main),
    [visualizerTheme.colorScheme, muiTheme.palette.primary.main]
  );

  // Render mini visualization based on style
  const renderMiniVisualization = () => {
    switch (visualizerTheme.style) {
      case 'bars':
      case 'bars-rounded':
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            height: '100%',
            gap: '2px',
            p: 0.5,
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: `${value * 100}%`,
                  bgcolor: colors[i],
                  borderRadius: visualizerTheme.style === 'bars-rounded' ? '4px' : '2px 2px 0 0',
                  transition: 'height 0.15s ease',
                  opacity: 0.8,
                }}
              />
            ))}
          </Box>
        );
      
      case 'wave':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`wave-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  {colors.map((color, i) => (
                    <stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={color} />
                  ))}
                </linearGradient>
              </defs>
              <path
                d={`M 0 20 ${animationData.map((v, i) => 
                  `Q ${(i + 0.5) * (100 / animationData.length)} ${20 + (v - 0.5) * 30} ${(i + 1) * (100 / animationData.length)} 20`
                ).join(' ')}`}
                fill="none"
                stroke={`url(#wave-gradient-${visualizerTheme.id})`}
                strokeWidth="3"
              />
            </svg>
          </Box>
        );
      
      case 'circular':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {animationData.map((value, i) => {
                const angle = (i / animationData.length) * Math.PI * 2 - Math.PI / 2;
                const length = 8 + value * 10;
                const x1 = 25 + Math.cos(angle) * 10;
                const y1 = 25 + Math.sin(angle) * 10;
                const x2 = 25 + Math.cos(angle) * (10 + length);
                const y2 = 25 + Math.sin(angle) * (10 + length);
                
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={colors[i]}
                    strokeWidth="3"
                    strokeLinecap="round"
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
              <circle cx="25" cy="25" r="8" fill={colors[0]} opacity="0.5" />
            </svg>
          </Box>
        );
      
      case 'mirror-bars':
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            height: '100%',
            gap: '2px',
            p: 0.5,
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: `${value * 80}%`,
                  bgcolor: colors[i],
                  borderRadius: '2px',
                  transition: 'height 0.15s ease',
                  opacity: 0.8,
                }}
              />
            ))}
          </Box>
        );
      
      case 'dots':
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            justifyContent: 'space-around',
            height: '100%',
            p: 0.5,
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  width: 6 + value * 6,
                  height: 6 + value * 6,
                  bgcolor: colors[i],
                  borderRadius: '50%',
                  transition: 'all 0.15s ease',
                  opacity: 0.8,
                  mb: `${value * 30}%`,
                }}
              />
            ))}
          </Box>
        );
      
      case 'spectrum':
      case 'particles':
      default:
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            height: '100%',
            p: 0.5,
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: `${value * 100}%`,
                  background: `linear-gradient(to top, ${colors[i]}, ${colors[Math.min(i + 1, colors.length - 1)]})`,
                  transition: 'height 0.15s ease',
                  opacity: 0.8,
                }}
              />
            ))}
          </Box>
        );
    }
  };

  return (
    <Box
      onClick={onClick}
      sx={{
        width: '100%',
        cursor: 'pointer',
        borderRadius: 2,
        overflow: 'hidden',
        border: '2px solid',
        borderColor: isSelected ? 'primary.main' : 'transparent',
        bgcolor: 'background.default',
        transition: 'all 0.2s ease',
        position: 'relative',
        '&:hover': {
          borderColor: isSelected ? 'primary.main' : 'action.hover',
          transform: 'scale(1.02)',
        },
      }}
    >
      {/* Selection indicator */}
      {isSelected && (
        <CheckCircleIcon
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            zIndex: 2,
            color: 'primary.main',
            fontSize: 18,
            bgcolor: 'background.paper',
            borderRadius: '50%',
          }}
        />
      )}
      
      {/* Preview area */}
      <Box
        sx={{
          height: 60,
          bgcolor: 'rgba(0, 0, 0, 0.3)',
          position: 'relative',
        }}
      >
        {renderMiniVisualization()}
      </Box>
      
      {/* Theme name */}
      <Box sx={{ p: 1, textAlign: 'center' }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? 'primary.main' : 'text.secondary',
            display: 'block',
            lineHeight: 1.2,
          }}
        >
          {visualizerTheme.name}
        </Typography>
      </Box>
    </Box>
  );
}
