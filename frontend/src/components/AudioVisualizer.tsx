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
        case 'classic-bars':
          drawClassicBars(ctx, data, colors, width, height, showGlow);
          break;
        case 'bars-rounded':
          drawRoundedBars(ctx, data, colors, width, height, showGlow);
          break;
        case 'circular-spectrum':
          drawCircularSpectrum(ctx, data, colors, width, height, showGlow);
          break;
        case 'waveform':
          drawWaveform(ctx, data, colors, width, height, showGlow);
          break;
        case 'symmetric-bars':
          drawSymmetricBars(ctx, data, colors, width, height, showGlow);
          break;
        case 'particles':
          drawParticles(ctx, data, colors, width, height, particlesRef, createParticle, isPlaying);
          break;
        case 'frequency-rings':
          drawFrequencyRings(ctx, data, colors, width, height, showGlow);
          break;
        case 'line-spectrum':
          drawLineSpectrum(ctx, data, colors, width, height, showGlow);
          break;
        case 'radial-bars':
          drawRadialBars(ctx, data, colors, width, height, showGlow);
          break;
        case 'block-grid':
          drawBlockGrid(ctx, data, colors, width, height, showGlow);
          break;
        case 'spiral':
          drawSpiral(ctx, data, colors, width, height, showGlow);
          break;
        default:
          drawRoundedBars(ctx, data, colors, width, height, showGlow);
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
    if (currentStyle !== 'classic-bars' && currentStyle !== 'bars-rounded') return null;
    
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

// 0: Classic Bars - Traditional frequency spectrum with rainbow-colored vertical bars
function drawClassicBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const barWidth = (width / data.length) * 0.8;
  const gap = (width / data.length) * 0.2;

  data.forEach((value, i) => {
    const barHeight = value * height * 0.9;
    const x = i * (barWidth + gap) + gap / 2;
    const y = height - barHeight;
    
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.8 + value * 0.2;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 20 * value;
    } else {
      ctx.shadowBlur = 0;
    }
    
    ctx.fillRect(x, y, barWidth, barHeight);
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// User Favorite: Rounded Bars - Soft rounded bars with smooth animations
function drawRoundedBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const barWidth = (width / data.length) * 0.7;
  const gap = (width / data.length) * 0.3;

  data.forEach((value, i) => {
    const barHeight = Math.max(value * height * 0.85, 4);
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
    
    const radius = Math.min(barWidth / 2, 8);
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, [radius, radius, 0, 0]);
    ctx.fill();
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// 1: Circular Spectrum - Bars arranged in a circle radiating outward
function drawCircularSpectrum(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = Math.min(width, height) * 0.2;
  const maxRadius = Math.min(width, height) * 0.45;
  
  data.forEach((value, i) => {
    const angle = (i / data.length) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * (maxRadius - baseRadius) + 5;
    
    const x1 = centerX + Math.cos(angle) * baseRadius;
    const y1 = centerY + Math.sin(angle) * baseRadius;
    const x2 = centerX + Math.cos(angle) * (baseRadius + barLength);
    const y2 = centerY + Math.sin(angle) * (baseRadius + barLength);
    
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = Math.max(3, (width / data.length) * 0.6);
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
  const avgValue = data.reduce((a, b) => a + b, 0) / data.length;
  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.3 + avgValue * 0.3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, baseRadius * 0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 2: Waveform - Real-time audio waveform display (oscilloscope style)
function drawWaveform(
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
    ctx.shadowBlur = 15;
  }
  
  // Draw main waveform
  ctx.beginPath();
  
  for (let i = 0; i < data.length; i++) {
    const x = i * segmentWidth;
    const amplitude = data[i] * height * 0.4;
    const y = centerY + Math.sin(i * 0.3 + Date.now() * 0.002) * amplitude;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevX = (i - 1) * segmentWidth;
      const cpX = (prevX + x) / 2;
      ctx.quadraticCurveTo(prevX, ctx.getTransform().f, cpX, y);
    }
  }
  
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // Draw filled area
  ctx.lineTo(width, centerY);
  ctx.lineTo(0, centerY);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.15;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 3: Symmetric Bars - Mirrored bars extending from center (top & bottom)
function drawSymmetricBars(
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
    const barHeight = value * height * 0.45;
    const x = i * (barWidth + gap) + gap / 2;
    
    ctx.fillStyle = colors[i];
    ctx.globalAlpha = 0.7 + value * 0.3;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[i];
      ctx.shadowBlur = 15 * value;
    }
    
    // Top bar (going up from center)
    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
    
    // Bottom bar (going down from center)
    ctx.fillRect(x, centerY, barWidth, barHeight);
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw center line
  ctx.strokeStyle = colors[Math.floor(colors.length / 2)];
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();
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

// 4: Particles - Random particles that appear based on audio intensity
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
    p.vy += 0.03; // lighter gravity
    p.life -= 0.015;
    
    if (p.life <= 0) return false;
    
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
    ctx.fill();
    
    // Add glow effect
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    
    return true;
  });
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Create new particles based on audio data
  if (isPlaying) {
    data.forEach((value, i) => {
      if (value > 0.25 && Math.random() < value * 0.4) {
        const x = (i / data.length) * width + Math.random() * 30 - 15;
        const y = height - value * height * 0.6;
        particlesRef.current.push(createParticle(x, y, value));
      }
    });
    
    // Limit particles
    if (particlesRef.current.length > 300) {
      particlesRef.current = particlesRef.current.slice(-300);
    }
  }
}

// 5: Frequency Rings - Concentric circles that grow based on frequency data
function drawFrequencyRings(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;
  
  // Draw rings from outside to inside
  const numRings = Math.min(data.length, 8);
  
  for (let i = numRings - 1; i >= 0; i--) {
    const value = data[Math.floor(i * data.length / numRings)];
    const baseRadius = (i + 1) * (maxRadius / numRings);
    const ringRadius = baseRadius * (0.8 + value * 0.4);
    
    ctx.strokeStyle = colors[i % colors.length];
    ctx.lineWidth = 3 + value * 4;
    ctx.globalAlpha = 0.5 + value * 0.5;
    
    if (showGlow && value > 0.4) {
      ctx.shadowColor = colors[i % colors.length];
      ctx.shadowBlur = 20 * value;
    }
    
    ctx.beginPath();
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  
  ctx.globalAlpha = 1;
}

// 6: Line Spectrum - Smooth line graph with gradient colors (purple → blue → green)
function drawLineSpectrum(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const segmentWidth = width / (data.length - 1);
  
  // Create gradient
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  colors.forEach((color, i) => {
    gradient.addColorStop(i / (colors.length - 1), color);
  });
  
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  
  if (showGlow) {
    ctx.shadowColor = colors[Math.floor(colors.length / 2)];
    ctx.shadowBlur = 20;
  }
  
  // Draw smooth line
  ctx.beginPath();
  
  for (let i = 0; i < data.length; i++) {
    const x = i * segmentWidth;
    const y = height - (data[i] * height * 0.85) - 10;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      const prevX = (i - 1) * segmentWidth;
      const prevY = height - (data[i - 1] * height * 0.85) - 10;
      const cpX = (prevX + x) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
      ctx.quadraticCurveTo(cpX, y, x, y);
    }
  }
  
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  // Draw filled area
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.2;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 7: Radial Bars - Bars radiating from a central circle outward
function drawRadialBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const innerRadius = Math.min(width, height) * 0.15;
  const maxLength = Math.min(width, height) * 0.35;
  const numBars = data.length * 2; // Double for full circle
  
  for (let i = 0; i < numBars; i++) {
    const dataIndex = i % data.length;
    const value = data[dataIndex];
    const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * maxLength + 5;
    
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * (innerRadius + barLength);
    const y2 = centerY + Math.sin(angle) * (innerRadius + barLength);
    
    // Create gradient for each bar
    const barGradient = ctx.createLinearGradient(x1, y1, x2, y2);
    barGradient.addColorStop(0, colors[dataIndex % colors.length]);
    barGradient.addColorStop(1, colors[(dataIndex + 1) % colors.length]);
    
    ctx.strokeStyle = barGradient;
    ctx.lineWidth = Math.max(2, (2 * Math.PI * innerRadius) / numBars * 0.6);
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.7 + value * 0.3;
    
    if (showGlow && value > 0.5) {
      ctx.shadowColor = colors[dataIndex % colors.length];
      ctx.shadowBlur = 12 * value;
    }
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw center circle
  const avgValue = data.reduce((a, b) => a + b, 0) / data.length;
  const centerGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, innerRadius);
  centerGradient.addColorStop(0, colors[0]);
  centerGradient.addColorStop(1, colors[colors.length - 1]);
  ctx.fillStyle = centerGradient;
  ctx.globalAlpha = 0.4 + avgValue * 0.3;
  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// 8: Block Grid - 16×8 pixel-art style grid like an equalizer LED display
function drawBlockGrid(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const cols = 16;
  const rows = 8;
  const blockWidth = (width / cols) * 0.85;
  const blockHeight = (height / rows) * 0.85;
  const gapX = (width / cols) * 0.15;
  const gapY = (height / rows) * 0.15;
  
  // Map data to columns
  const step = data.length / cols;
  
  for (let col = 0; col < cols; col++) {
    const dataIndex = Math.floor(col * step);
    const value = data[dataIndex];
    const litBlocks = Math.floor(value * rows);
    
    for (let row = 0; row < rows; row++) {
      const x = col * (blockWidth + gapX) + gapX / 2;
      const y = height - (row + 1) * (blockHeight + gapY);
      
      const isLit = row < litBlocks;
      
      // Color gradient from green (bottom) to yellow (middle) to red (top)
      let blockColor: string;
      if (row < 3) {
        blockColor = '#00FF00'; // Green
      } else if (row < 6) {
        blockColor = '#FFFF00'; // Yellow
      } else {
        blockColor = '#FF0000'; // Red
      }
      
      if (isLit) {
        ctx.fillStyle = blockColor;
        ctx.globalAlpha = 0.9;
        
        if (showGlow) {
          ctx.shadowColor = blockColor;
          ctx.shadowBlur = 8;
        }
      } else {
        ctx.fillStyle = '#333333';
        ctx.globalAlpha = 0.3;
        ctx.shadowBlur = 0;
      }
      
      ctx.beginPath();
      ctx.roundRect(x, y, blockWidth, blockHeight, 2);
      ctx.fill();
    }
  }
  
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

// 9: Spiral - Dynamic spiral pattern that expands based on audio
function drawSpiral(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  showGlow: boolean
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.45;
  const avgValue = data.reduce((a, b) => a + b, 0) / data.length;
  const time = Date.now() * 0.001;
  
  // Create spiral gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  colors.forEach((color, i) => {
    gradient.addColorStop(i / (colors.length - 1), color);
  });
  
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  
  if (showGlow) {
    ctx.shadowColor = colors[Math.floor(colors.length / 2)];
    ctx.shadowBlur = 15;
  }
  
  // Draw spiral
  ctx.beginPath();
  
  const spiralTurns = 3;
  const points = 200;
  
  for (let i = 0; i < points; i++) {
    const t = i / points;
    const angle = t * spiralTurns * Math.PI * 2 + time;
    const dataIndex = Math.floor(t * data.length);
    const audioMod = 1 + data[dataIndex] * 0.5;
    const radius = t * maxRadius * audioMod * (0.7 + avgValue * 0.5);
    
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    
    ctx.globalAlpha = 0.3 + t * 0.7;
  }
  
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  
  // Draw center dot
  ctx.fillStyle = colors[0];
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 5 + avgValue * 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
