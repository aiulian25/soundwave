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
      // User Favorite: Rounded Bars
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
                  borderRadius: '4px',
                  transition: 'height 0.15s ease',
                  opacity: 0.8,
                }}
              />
            ))}
          </Box>
        );
      
      // 0: Classic Bars
      case 'classic-bars':
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
                  borderRadius: '2px 2px 0 0',
                  transition: 'height 0.15s ease',
                  opacity: 0.9,
                }}
              />
            ))}
          </Box>
        );
      
      // 1: Circular Spectrum
      case 'circular-spectrum':
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
                const length = 8 + value * 12;
                const x1 = 25 + Math.cos(angle) * 8;
                const y1 = 25 + Math.sin(angle) * 8;
                const x2 = 25 + Math.cos(angle) * (8 + length);
                const y2 = 25 + Math.sin(angle) * (8 + length);
                
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
              <circle cx="25" cy="25" r="6" fill={colors[0]} opacity="0.4" />
            </svg>
          </Box>
        );
      
      // 2: Waveform (oscilloscope)
      case 'waveform':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`waveform-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  {colors.map((color, i) => (
                    <stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={color} />
                  ))}
                </linearGradient>
              </defs>
              <path
                d={`M 0 20 ${animationData.map((v, i) => 
                  `Q ${(i + 0.5) * (100 / animationData.length)} ${20 + (v - 0.5) * 25} ${(i + 1) * (100 / animationData.length)} 20`
                ).join(' ')}`}
                fill="none"
                stroke={`url(#waveform-gradient-${visualizerTheme.id})`}
                strokeWidth="2"
              />
            </svg>
          </Box>
        );
      
      // 3: Symmetric Bars (mirrored from center)
      case 'symmetric-bars':
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
      
      // 4: Particles
      case 'particles':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  position: 'absolute',
                  width: 4 + value * 6,
                  height: 4 + value * 6,
                  bgcolor: colors[i],
                  borderRadius: '50%',
                  left: `${(i / animationData.length) * 100}%`,
                  bottom: `${value * 60}%`,
                  transition: 'all 0.15s ease',
                  opacity: 0.8,
                  boxShadow: `0 0 ${value * 10}px ${colors[i]}`,
                }}
              />
            ))}
          </Box>
        );
      
      // 5: Frequency Rings
      case 'frequency-rings':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {animationData.slice(0, 4).map((value, i) => {
                const radius = (i + 1) * 5 * (0.8 + value * 0.4);
                return (
                  <circle
                    key={i}
                    cx="25"
                    cy="25"
                    r={radius}
                    fill="none"
                    stroke={colors[i * 2]}
                    strokeWidth="2"
                    opacity={0.5 + value * 0.5}
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
            </svg>
          </Box>
        );
      
      // 6: Line Spectrum
      case 'line-spectrum':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`line-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="100%" y2="0%">
                  {colors.map((color, i) => (
                    <stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={color} />
                  ))}
                </linearGradient>
              </defs>
              <path
                d={`M 0 ${40 - animationData[0] * 35} ${animationData.map((v, i) => 
                  `L ${(i + 1) * (100 / animationData.length)} ${40 - v * 35}`
                ).join(' ')}`}
                fill="none"
                stroke={`url(#line-gradient-${visualizerTheme.id})`}
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Box>
        );
      
      // 7: Radial Bars
      case 'radial-bars':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {Array.from({ length: 16 }).map((_, i) => {
                const dataIndex = i % animationData.length;
                const value = animationData[dataIndex];
                const angle = (i / 16) * Math.PI * 2 - Math.PI / 2;
                const length = 5 + value * 12;
                const x1 = 25 + Math.cos(angle) * 6;
                const y1 = 25 + Math.sin(angle) * 6;
                const x2 = 25 + Math.cos(angle) * (6 + length);
                const y2 = 25 + Math.sin(angle) * (6 + length);
                
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={colors[dataIndex]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
              <circle cx="25" cy="25" r="5" fill={colors[0]} opacity="0.5" />
            </svg>
          </Box>
        );
      
      // 8: Block Grid (LED equalizer)
      case 'block-grid':
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            height: '100%',
            gap: '1px',
            p: 0.5,
          }}>
            {animationData.map((value, col) => {
              const litBlocks = Math.floor(value * 4);
              return (
                <Box key={col} sx={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', gap: '1px' }}>
                  {Array.from({ length: 4 }).map((_, row) => {
                    const isLit = row < litBlocks;
                    const color = row < 2 ? '#00FF00' : row < 3 ? '#FFFF00' : '#FF0000';
                    return (
                      <Box
                        key={row}
                        sx={{
                          height: 8,
                          bgcolor: isLit ? color : '#333',
                          opacity: isLit ? 0.9 : 0.3,
                          borderRadius: '1px',
                          transition: 'all 0.1s ease',
                        }}
                      />
                    );
                  })}
                </Box>
              );
            })}
          </Box>
        );
      
      // 9: Spiral
      case 'spiral':
        const avgValue = animationData.reduce((a, b) => a + b, 0) / animationData.length;
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              <defs>
                <linearGradient id={`spiral-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  {colors.map((color, i) => (
                    <stop key={i} offset={`${(i / (colors.length - 1)) * 100}%`} stopColor={color} />
                  ))}
                </linearGradient>
              </defs>
              <path
                d={`M 25 25 ${Array.from({ length: 50 }).map((_, i) => {
                  const t = i / 50;
                  const angle = t * 6 * Math.PI;
                  const radius = t * 20 * (0.8 + avgValue * 0.4);
                  const x = 25 + Math.cos(angle) * radius;
                  const y = 25 + Math.sin(angle) * radius;
                  return `L ${x} ${y}`;
                }).join(' ')}`}
                fill="none"
                stroke={`url(#spiral-gradient-${visualizerTheme.id})`}
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="25" cy="25" r={3 + avgValue * 3} fill={colors[0]} opacity="0.8" />
            </svg>
          </Box>
        );
      
      default:
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
                  borderRadius: '4px',
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
