/**
 * Audio Visualizer Component
 * Supports multiple visualization styles and color schemes
 */

import { Box, useTheme } from '@mui/material';
import { useMemo, useRef, useEffect, useCallback } from 'react';
import {
  VisualizerStyle,
  VisualizerColorScheme,
  getColorArray,
  getVisualizerTheme,
  DEFAULT_VISUALIZER_THEME,
} from '../config/visualizerThemes';

interface AudioVisualizerProps {
  data: number[];
  isPlaying: boolean;
  themeId?: string;
  style?: VisualizerStyle;
  colorScheme?: VisualizerColorScheme;
  height?: number;
  showGlow?: boolean;
}

export default function AudioVisualizer({
  data,
  isPlaying,
  themeId = DEFAULT_VISUALIZER_THEME,
  style: styleProp,
  colorScheme: colorSchemeProp,
  height = 120,
  showGlow = true,
}: AudioVisualizerProps) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  
  // Get theme configuration
  const visualizerTheme = useMemo(() => getVisualizerTheme(themeId), [themeId]);
  const currentStyle = styleProp || visualizerTheme.style;
  const currentColorScheme = colorSchemeProp || visualizerTheme.colorScheme;
  
  // Get colors based on scheme
  const colors = useMemo(() => 
    getColorArray(currentColorScheme, data.length, theme.palette.primary.main),
    [currentColorScheme, data.length, theme.palette.primary.main]
  );

  // Particle type for particle visualizer
  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    size: number;
    color: string;
  }

  // Create particles
  const createParticle = useCallback((x: number, y: number, intensity: number): Particle => {
    const colorIndex = Math.floor(Math.random() * colors.length);
    return {
      x,
      y,
      vx: (Math.random() - 0.5) * 4 * intensity,
      vy: -Math.random() * 3 * intensity - 1,
      life: 1,
      maxLife: 0.5 + Math.random() * 0.5,
      size: 2 + Math.random() * 4 * intensity,
      color: colors[colorIndex],
    };
  }, [colors]);

  // Draw visualizer on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const draw = () => {
      const width = rect.width;
      const height = rect.height;
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Draw based on style
      switch (currentStyle) {
        case 'bars':
          drawBars(ctx, data, colors, width, height, false, showGlow);
          break;
        case 'bars-rounded':
          drawBars(ctx, data, colors, width, height, true, showGlow);
          break;
        case 'wave':
          drawWave(ctx, data, colors, width, height, showGlow);
          break;
        case 'circular':
          drawCircular(ctx, data, colors, width, height, showGlow);
          break;
        case 'particles':
          drawParticles(ctx, data, colors, width, height, particlesRef, createParticle, isPlaying);
          break;
        case 'spectrum':
          drawSpectrum(ctx, data, colors, width, height, showGlow);
          break;
        case 'mirror-bars':
          drawMirrorBars(ctx, data, colors, width, height, showGlow);
          break;
        case 'dots':
          drawDots(ctx, data, colors, width, height, showGlow);
          break;
        default:
          drawBars(ctx, data, colors, width, height, false, showGlow);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [data, colors, currentStyle, showGlow, isPlaying, createParticle]);

  // Use Box-based fallback for simple bar visualization (for performance on low-end devices)
  const SimpleBarsVisualizer = useMemo(() => {
    if (currentStyle !== 'bars' && currentStyle !== 'bars-rounded') return null;
    
    return (
      <Box sx={{ 
        height, 
        display: 'flex', 
        alignItems: 'flex-end', 
        justifyContent: 'center', 
        gap: 0.5, 
        width: '100%',
        px: 2,
      }}>
        {data.map((value, i) => {
          const barHeight = 15 + (value * 80);
          const isRounded = currentStyle === 'bars-rounded';
          
          return (
            <Box
              key={i}
              sx={{
                flex: 1,
                maxWidth: 12,
                minWidth: 4,
                bgcolor: colors[i],
                borderRadius: isRounded ? '8px' : '4px 4px 0 0',
                height: `${barHeight}%`,
                opacity: 0.7 + value * 0.3,
                transition: 'height 0.08s ease-out, opacity 0.15s ease',
                boxShadow: showGlow && value > 0.6 
                  ? `0 0 12px ${colors[i]}80` 
                  : 'none',
                '&:hover': {
                  transform: 'scaleX(1.2)',
                  opacity: 1,
                },
              }}
            />
          );
        })}
      </Box>
    );
  }, [data, colors, currentStyle, height, showGlow]);

  // For canvas-based visualizers
  return (
    <Box sx={{ width: '100%', height, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </Box>
  );
}

// Drawing functions for different visualizer styles

function drawBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  rounded: boolean,
  showGlow: boolean
) {
  const barWidth = (width / data.length) * 0.7;
  const gap = (width / data.length) * 0.3;

  data.forEach((value, i) => {
    const barHeight = value * height * 0.85;
    const x = i * (barWidth + gap) + gap / 2;
    const y = height - barHeight;
    
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.7 + value * 0.3;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 15 * value;
    } else {
      ctx.shadowBlur = 0;
    }
    
    if (rounded) {
      const radius = Math.min(barWidth / 2, 8);
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barWidth, barHeight);
    }
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerY = height / 2;
  const segmentWidth = width / (data.length - 1);
  
  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  colors.forEach((color, i) => {
    gradient.addColorStop(i / (colors.length - 1), color);
  });
  
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  if (showGlow) {
    ctx.shadowColor = colors[Math.floor(colors.length / 2)];
    ctx.shadowBlur = 20;
  }
  
  // Draw wave
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  
  for (let i = 0; i < data.length; i++) {
    const x = i * segmentWidth;
    const amplitude = data[i] * height * 0.4;
    const y = centerY + Math.sin(i * 0.5) * amplitude * (i % 2 === 0 ? 1 : -1);
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevX = (i - 1) * segmentWidth;
      const prevAmplitude = data[i - 1] * height * 0.4;
      const prevY = centerY + Math.sin((i - 1) * 0.5) * prevAmplitude * ((i - 1) % 2 === 0 ? 1 : -1);
      
      const cpX = (prevX + x) / 2;
      ctx.quadraticCurveTo(cpX, prevY, cpX, (prevY + y) / 2);
      ctx.quadraticCurveTo(cpX, y, x, y);
    }
  }
  
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // Draw filled area below
  ctx.lineTo(width, centerY);
  ctx.lineTo(0, centerY);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawCircular(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * 0.25;
  
  data.forEach((value, i) => {
    const angle = (i / data.length) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * baseRadius * 0.8 + 5;
    
    const x1 = centerX + Math.cos(angle) * baseRadius;
    const y1 = centerY + Math.sin(angle) * baseRadius;
    const x2 = centerX + Math.cos(angle) * (baseRadius + barLength);
    const y2 = centerY + Math.sin(angle) * (baseRadius + barLength);
    
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = Math.max(2, (width / data.length) * 0.5);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.7 + value * 0.3;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 15 * value;
    }
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw center circle
  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  particlesRef: React.MutableRefObject<Particle[]>,
  createParticle: (x: number, y: number, intensity: number) => Particle,
  isPlaying: boolean
) {
  // Update and draw existing particles
  particlesRef.current = particlesRef.current.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05; // gravity
    p.life -= 0.02;
    
    if (p.life <= 0) return false;
    
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
    ctx.fill();
    
    return true;
  });
  
  ctx.globalAlpha = 1;
  
  // Create new particles based on audio data
  if (isPlaying) {
    data.forEach((value, i) => {
      if (value > 0.3 && Math.random() < value * 0.3) {
        const x = (i / data.length) * width + Math.random() * 20 - 10;
        const y = height - value * height * 0.5;
        particlesRef.current.push(createParticle(x, y, value));
      }
    });
    
    // Limit particles
    if (particlesRef.current.length > 200) {
      particlesRef.current = particlesRef.current.slice(-200);
    }
  }
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const barWidth = width / data.length;
  
  // Draw spectrum gradient bars
  data.forEach((value, i) => {
    const barHeight = value * height * 0.9;
    const x = i * barWidth;
    const y = height - barHeight;
    
    // Create vertical gradient for each bar
    const gradient = ctx.createLinearGradient(x, height, x, y);
    gradient.addColorStop(0, colors[Math.min(i, colors.length - 1)]);
    gradient.addColorStop(1, colors[Math.min(i + 1, colors.length - 1)] || colors[colors.length - 1]);
    
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.8;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 10;
    }
    
    ctx.fillRect(x, y, barWidth - 1, barHeight);
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawMirrorBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const barWidth = (width / data.length) * 0.7;
  const gap = (width / data.length) * 0.3;
  const centerY = height / 2;
  
  data.forEach((value, i) => {
    const barHeight = value * height * 0.4;
    const x = i * (barWidth + gap) + gap / 2;
    
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.7 + value * 0.3;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 15 * value;
    }
    
    // Top bar (mirrored)
    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
    
    // Bottom bar
    ctx.fillRect(x, centerY, barWidth, barHeight);
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw center line
  ctx.strokeStyle = colors[Math.floor(colors.length / 2)];
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.3;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDots(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const dotSpacing = width / (data.length + 1);
  
  data.forEach((value, i) => {
    const x = (i + 1) * dotSpacing;
    const y = height - (value * height * 0.7) - 20;
    const radius = 4 + value * 12;
    
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.6 + value * 0.4;
    
    if (showGlow && value > 0.4) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 20 * value;
    }
    
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw stem
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(x, y + radius);
    ctx.lineTo(x, height);
    ctx.stroke();
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}
