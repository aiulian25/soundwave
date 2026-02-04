/**
 * Visualizer Theme Preview Component
 * Shows a visual preview of a visualizer theme with animated demo
 * Updated for Lyrique visualizers
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
      // Bars Classic
      case 'bars-classic':
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
      
      // Bars Mirrored
      case 'bars-mirrored':
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
      
      // Bars Circular & Circle Bars
      case 'bars-circular':
      case 'circle-bars':
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
      
      // Wave Line & Oscilloscope
      case 'wave-line':
      case 'oscilloscope':
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
                  `Q ${(i + 0.5) * (100 / animationData.length)} ${20 + (v - 0.5) * 25} ${(i + 1) * (100 / animationData.length)} 20`
                ).join(' ')}`}
                fill="none"
                stroke={`url(#wave-gradient-${visualizerTheme.id})`}
                strokeWidth="2"
              />
            </svg>
          </Box>
        );
      
      // Wave Fill
      case 'wave-fill':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`wavefill-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={colors[0]} stopOpacity="0.8" />
                  <stop offset="100%" stopColor={colors[0]} stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <path
                d={`M 0 40 ${animationData.map((v, i) => 
                  `L ${(i + 1) * (100 / animationData.length)} ${40 - v * 35}`
                ).join(' ')} L 100 40 Z`}
                fill={`url(#wavefill-gradient-${visualizerTheme.id})`}
              />
            </svg>
          </Box>
        );
      
      // Circle Pulse
      case 'circle-pulse':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {[0.8, 0.5].map((scale, i) => {
                const radius = (animationData[i] * 15 + 5) * scale;
                return (
                  <circle
                    key={i}
                    cx="25"
                    cy="25"
                    r={radius}
                    fill="none"
                    stroke={colors[0]}
                    strokeWidth={2 + animationData[i] * 2}
                    opacity={0.3 + animationData[i] * 0.5}
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
            </svg>
          </Box>
        );
      
      // Particles
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
      
      // DNA Helix
      case 'dna-helix':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              {animationData.map((v, i) => {
                const x = (i + 0.5) * (100 / animationData.length);
                const y1 = 20 + Math.sin(i * 0.8) * (8 + v * 8);
                const y2 = 20 - Math.sin(i * 0.8) * (8 + v * 8);
                return (
                  <g key={i}>
                    <circle cx={x} cy={y1} r="3" fill={colors[i]} />
                    <circle cx={x} cy={y2} r="3" fill={colors[i]} opacity="0.7" />
                    <line x1={x} y1={y1} x2={x} y2={y2} stroke={colors[i]} strokeWidth="1" opacity="0.3" />
                  </g>
                );
              })}
            </svg>
          </Box>
        );
      
      // Spectrum
      case 'spectrum':
        return (
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            height: '100%',
            gap: '1px',
            p: 0.5,
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  flex: 1,
                  height: `${value * 100}%`,
                  background: `linear-gradient(to top, ${colors[0]}, ${colors[0]}CC, ${colors[0]}80)`,
                  transition: 'height 0.15s ease',
                }}
              />
            ))}
          </Box>
        );
      
      // Galaxy
      case 'galaxy':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {animationData.map((value, i) => {
                const angle = (i / animationData.length) * Math.PI * 4;
                const distance = 5 + (i / animationData.length) * 15 + value * 5;
                const x = 25 + Math.cos(angle) * distance;
                const y = 25 + Math.sin(angle) * distance * 0.6;
                const size = 1 + value * 2;
                
                return (
                  <circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={size}
                    fill={colors[i]}
                    opacity={0.3 + value * 0.7}
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
            </svg>
          </Box>
        );
      
      // Flower
      case 'flower':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {animationData.map((value, i) => {
                const angle = (i / animationData.length) * Math.PI * 2;
                const petalLength = 5 + value * 12;
                
                return (
                  <ellipse
                    key={i}
                    cx={25 + Math.cos(angle) * petalLength * 0.3}
                    cy={25 + Math.sin(angle) * petalLength * 0.3}
                    rx={petalLength * 0.2}
                    ry={petalLength * 0.5}
                    fill={colors[i]}
                    opacity={0.3 + value * 0.4}
                    transform={`rotate(${(angle * 180) / Math.PI}, ${25 + Math.cos(angle) * petalLength * 0.3}, ${25 + Math.sin(angle) * petalLength * 0.3})`}
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
            </svg>
          </Box>
        );
      
      // Matrix Rain
      case 'matrix-rain':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
            fontFamily: 'monospace',
            fontSize: '8px',
          }}>
            {animationData.map((value, i) => (
              <Box
                key={i}
                sx={{
                  position: 'absolute',
                  left: `${(i / animationData.length) * 100}%`,
                  top: `${(1 - value) * 50}%`,
                  color: colors[0],
                  opacity: value,
                  transition: 'all 0.15s ease',
                }}
              >
                {String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96))}
              </Box>
            ))}
          </Box>
        );
      
      // Aurora
      case 'aurora':
        return (
          <Box sx={{ 
            position: 'relative',
            height: '100%',
            overflow: 'hidden',
          }}>
            <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`aurora-gradient-${visualizerTheme.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor={colors[0]} stopOpacity="0.4" />
                  <stop offset="100%" stopColor={colors[0]} stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 1, 2].map(layer => (
                <path
                  key={layer}
                  d={`M 0 40 ${animationData.map((v, i) => 
                    `L ${(i + 1) * (100 / animationData.length)} ${40 - v * (25 - layer * 5) - layer * 5}`
                  ).join(' ')} L 100 40 Z`}
                  fill={`url(#aurora-gradient-${visualizerTheme.id})`}
                  opacity={1 - layer * 0.2}
                />
              ))}
            </svg>
          </Box>
        );
      
      // Radial Bars (Radial Metallic)
      case 'radial-bars':
        return (
          <Box sx={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
          }}>
            <svg width="50" height="50" viewBox="0 0 50 50">
              {animationData.concat(animationData).map((value, i) => {
                const angle = (i / (animationData.length * 2)) * Math.PI * 2 - Math.PI / 2;
                const length = 5 + value * 10;
                const innerR = 6;
                const x1 = 25 + Math.cos(angle) * innerR;
                const y1 = 25 + Math.sin(angle) * innerR;
                const x2 = 25 + Math.cos(angle) * (innerR + length);
                const y2 = 25 + Math.sin(angle) * (innerR + length);
                
                return (
                  <line
                    key={i}
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={colors[i % colors.length]}
                    strokeWidth="2"
                    strokeLinecap="round"
                    opacity={0.7 + value * 0.3}
                    style={{ transition: 'all 0.15s ease' }}
                  />
                );
              })}
              <circle 
                cx="25" 
                cy="25" 
                r="5" 
                fill={colors[0]} 
                opacity="0.5" 
              />
            </svg>
          </Box>
        );
      
      // Default fallback - bars
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
                  borderRadius: '2px',
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
        cursor: 'pointer',
        borderRadius: 2,
        overflow: 'hidden',
        border: isSelected 
          ? `2px solid ${muiTheme.palette.primary.main}` 
          : `2px solid transparent`,
        bgcolor: isSelected 
          ? `${muiTheme.palette.primary.main}15` 
          : muiTheme.palette.background.paper,
        transition: 'all 0.2s ease',
        '&:hover': {
          transform: 'scale(1.02)',
          boxShadow: muiTheme.shadows[4],
          bgcolor: isSelected 
            ? `${muiTheme.palette.primary.main}20` 
            : muiTheme.palette.action.hover,
        },
        position: 'relative',
      }}
    >
      {/* Selection indicator */}
      {isSelected && (
        <CheckCircleIcon
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            fontSize: 20,
            color: muiTheme.palette.primary.main,
            zIndex: 1,
          }}
        />
      )}
      
      {/* Preview area */}
      <Box
        sx={{
          height: 60,
          bgcolor: muiTheme.palette.mode === 'dark' 
            ? 'rgba(0,0,0,0.3)' 
            : 'rgba(0,0,0,0.05)',
          overflow: 'hidden',
        }}
      >
        {renderMiniVisualization()}
      </Box>
      
      {/* Theme info */}
      <Box sx={{ p: 1.5 }}>
        <Typography 
          variant="subtitle2" 
          sx={{ 
            fontWeight: isSelected ? 600 : 500,
            color: isSelected 
              ? muiTheme.palette.primary.main 
              : muiTheme.palette.text.primary,
            mb: 0.5,
          }}
        >
          {visualizerTheme.name}
        </Typography>
        <Typography 
          variant="caption" 
          sx={{ 
            color: muiTheme.palette.text.secondary,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.3,
          }}
        >
          {visualizerTheme.description}
        </Typography>
        
        {/* Color preview dots */}
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
          {colors.slice(0, 5).map((color, i) => (
            <Box
              key={i}
              sx={{
                width: 12,
                height: 12,
                bgcolor: color,
                borderRadius: '50%',
                border: `1px solid ${muiTheme.palette.divider}`,
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
  );
}
