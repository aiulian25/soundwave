/**
 * Audio Visualizer Component
 * Visualizers ported from Lyrique desktop app
 * Supports 16 visualization styles including Radial Metallic (kept)
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

// Particle interface for particle visualizer
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

// Frequency bands helper
interface FrequencyBands {
  bass: number;
  mid: number;
  high: number;
}

function getFrequencyBands(data: number[]): FrequencyBands {
  const len = data.length;
  const bassEnd = Math.floor(len * 0.15);
  const midEnd = Math.floor(len * 0.5);
  
  let bass = 0, mid = 0, high = 0;
  for (let i = 0; i < len; i++) {
    if (i < bassEnd) bass += data[i];
    else if (i < midEnd) mid += data[i];
    else high += data[i];
  }
  
  return {
    bass: bass / bassEnd,
    mid: mid / (midEnd - bassEnd),
    high: high / (len - midEnd),
  };
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
  const timeRef = useRef<number>(Date.now());
  
  // Get theme configuration
  const visualizerTheme = useMemo(() => getVisualizerTheme(themeId), [themeId]);
  const currentStyle = styleProp || visualizerTheme.style;
  const currentColorScheme = colorSchemeProp || visualizerTheme.colorScheme;
  
  // Get colors based on scheme
  const colors = useMemo(() => 
    getColorArray(currentColorScheme, data.length, theme.palette.primary.main),
    [currentColorScheme, data.length, theme.palette.primary.main]
  );

  // Primary color for single-color visualizers
  const primaryColor = useMemo(() => 
    currentColorScheme === 'theme' ? theme.palette.primary.main : colors[0],
    [currentColorScheme, theme.palette.primary.main, colors]
  );

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
      const bands = getFrequencyBands(data);
      timeRef.current = Date.now();
      
      // Clear canvas
      ctx.clearRect(0, 0, width, height);
      
      // Draw based on style
      switch (currentStyle) {
        case 'bars-classic':
          drawBarsClassic(ctx, data, colors, width, height);
          break;
        case 'bars-mirrored':
          drawBarsMirrored(ctx, data, colors, width, height);
          break;
        case 'bars-circular':
          drawBarsCircular(ctx, data, colors, width, height);
          break;
        case 'wave-line':
          drawWaveLine(ctx, data, primaryColor, width, height);
          break;
        case 'wave-fill':
          drawWaveFill(ctx, data, primaryColor, width, height);
          break;
        case 'circle-pulse':
          drawCirclePulse(ctx, bands, primaryColor, width, height);
          break;
        case 'circle-bars':
          drawCircleBars(ctx, data, colors, width, height);
          break;
        case 'particles':
          drawParticles(ctx, data, colors, width, height, particlesRef, createParticle, isPlaying);
          break;
        case 'dna-helix':
          drawDnaHelix(ctx, data, primaryColor, width, height, timeRef.current);
          break;
        case 'spectrum':
          drawSpectrum(ctx, data, primaryColor, width, height);
          break;
        case 'oscilloscope':
          drawOscilloscope(ctx, data, primaryColor, width, height);
          break;
        case 'galaxy':
          drawGalaxy(ctx, data, primaryColor, width, height, timeRef.current);
          break;
        case 'flower':
          drawFlower(ctx, data, colors, width, height, timeRef.current);
          break;
        case 'matrix-rain':
          drawMatrixRain(ctx, data, primaryColor, width, height, timeRef.current);
          break;
        case 'aurora':
          drawAurora(ctx, data, primaryColor, width, height, timeRef.current);
          break;
        case 'radial-bars':
          drawRadialBars(ctx, data, colors, width, height, showGlow);
          break;
        default:
          drawBarsClassic(ctx, data, colors, width, height);
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [data, colors, primaryColor, currentStyle, showGlow, isPlaying, createParticle]);

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

// ============================================
// VISUALIZER DRAWING FUNCTIONS (from Lyrique)
// ============================================

// Bars Classic - Traditional frequency spectrum
function drawBarsClassic(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number
) {
  const bufferLength = data.length;
  const barWidth = width / bufferLength;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = data[i] * height * 0.9;
    const x = i * barWidth;
    const hue = (i / bufferLength) * 60 + 170;
    ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
    ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
  }
}

// Bars Mirrored - Mirrored bars from center
function drawBarsMirrored(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number
) {
  const bufferLength = data.length;
  const barWidth = width / bufferLength;
  const centerY = height / 2;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = data[i] * height * 0.45;
    const x = i * barWidth;
    const hue = (i / bufferLength) * 60 + 170;
    ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
    ctx.fillRect(x, centerY - barHeight, barWidth - 1, barHeight * 2);
  }
}

// Bars Circular - Bars arranged in a circle
function drawBarsCircular(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const numBars = 64;
  const bufferLength = data.length;

  for (let i = 0; i < numBars; i++) {
    const dataIndex = Math.floor(i * bufferLength / numBars);
    const barHeight = data[dataIndex] * 35 + 5;
    const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
    const innerRadius = Math.min(width, height) * 0.15;
    
    ctx.beginPath();
    ctx.moveTo(
      centerX + Math.cos(angle) * innerRadius,
      centerY + Math.sin(angle) * innerRadius
    );
    ctx.lineTo(
      centerX + Math.cos(angle) * (innerRadius + barHeight),
      centerY + Math.sin(angle) * (innerRadius + barHeight)
    );
    const hue = (i / numBars) * 60 + 170;
    ctx.strokeStyle = `hsl(${hue}, 70%, 50%)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// Wave Line - Oscilloscope style line
function drawWaveLine(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number
) {
  const centerY = height / 2;
  const bufferLength = data.length;

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  for (let i = 0; i < bufferLength; i++) {
    const x = (i / bufferLength) * width;
    const y = centerY + ((data[i] - 0.5) * 2) * (height / 2) * 0.8;
    ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Wave Fill - Filled waveform with gradient
function drawWaveFill(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number
) {
  const bufferLength = data.length;

  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let i = 0; i < bufferLength; i++) {
    const x = (i / bufferLength) * width;
    const y = height - data[i] * height * 0.9;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height);
  ctx.closePath();
  
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, color + 'CC');
  gradient.addColorStop(1, color + '1A');
  ctx.fillStyle = gradient;
  ctx.fill();
}

// Circle Pulse - Pulsing rings based on bass/mids
function drawCirclePulse(
  ctx: CanvasRenderingContext2D,
  bands: FrequencyBands,
  color: string,
  width: number,
  height: number
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.4;

  // Outer ring based on bass
  const pulseRadius = 15 + bands.bass * maxRadius;
  ctx.beginPath();
  ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3 + bands.bass * 0.7;
  ctx.lineWidth = 2 + bands.bass * 4;
  ctx.stroke();
  
  // Inner ring based on mids
  ctx.beginPath();
  ctx.arc(centerX, centerY, pulseRadius * 0.6, 0, Math.PI * 2);
  ctx.globalAlpha = 0.2 + bands.mid * 0.5;
  ctx.lineWidth = 1 + bands.mid * 2;
  ctx.stroke();
  
  ctx.globalAlpha = 1;
}

// Circle Bars - Circular bars radiating from center
function drawCircleBars(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const numBars = 48;
  const bufferLength = data.length;
  const innerR = Math.min(width, height) * 0.12;

  for (let i = 0; i < numBars; i++) {
    const dataIndex = Math.floor(i * bufferLength / numBars);
    const barH = data[dataIndex] * 30 + 5;
    const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
    
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * innerR, centerY + Math.sin(angle) * innerR);
    ctx.lineTo(centerX + Math.cos(angle) * (innerR + barH), centerY + Math.sin(angle) * (innerR + barH));
    const hue = 175 + data[dataIndex] * 30;
    ctx.strokeStyle = `hsl(${hue}, 70%, 50%)`;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

// Particles - Floating particles based on audio
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
  const bands = getFrequencyBands(data);
  
  // Update and draw existing particles
  particlesRef.current = particlesRef.current.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.03;
    p.life -= 0.015;
    
    if (p.life <= 0) return false;
    
    ctx.fillStyle = p.color;
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
    ctx.fill();
    
    return true;
  });
  
  ctx.globalAlpha = 1;
  
  // Create new particles
  if (isPlaying) {
    const particleCount = Math.floor(20 + bands.bass * 40);
    for (let i = 0; i < particleCount; i++) {
      const dataIndex = Math.floor(i * data.length / particleCount);
      const x = (i / particleCount) * width + (Math.random() - 0.5) * 20;
      const y = height - data[dataIndex] * height * 0.9;
      const size = data[dataIndex] * 6 + 1;
      const alpha = data[dataIndex];
      
      if (Math.random() < data[dataIndex] * 0.3) {
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = colors[dataIndex % colors.length];
        ctx.globalAlpha = alpha;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// DNA Helix - Animated double helix
function drawDnaHelix(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number,
  time: number
) {
  const centerY = height / 2;
  const timeOffset = time / 500;
  const bufferLength = data.length;

  for (let i = 0; i < width; i += 8) {
    const dataIndex = Math.floor((i / width) * bufferLength);
    const amplitude = data[dataIndex] * 25 + 10;
    const y1 = centerY + Math.sin(i / 20 + timeOffset) * amplitude;
    const y2 = centerY - Math.sin(i / 20 + timeOffset) * amplitude;
    
    // Top strand
    ctx.beginPath();
    ctx.arc(i, y1, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
    // Bottom strand
    ctx.beginPath();
    ctx.arc(i, y2, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.fill();
    ctx.globalAlpha = 1;
    
    // Connector
    ctx.beginPath();
    ctx.moveTo(i, y1);
    ctx.lineTo(i, y2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Spectrum - Classic spectrum analyzer
function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number
) {
  const bufferLength = data.length;
  const barWidth = width / bufferLength;

  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.5, color + 'CC');
  gradient.addColorStop(1, color + '80');
  
  ctx.fillStyle = gradient;
  for (let i = 0; i < bufferLength; i++) {
    const barH = data[i] * height * 0.9;
    ctx.fillRect(i * barWidth, height - barH, barWidth - 1, barH);
  }
}

// Oscilloscope - Real oscilloscope with glow
function drawOscilloscope(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number
) {
  const centerY = height / 2;
  const bufferLength = data.length;

  ctx.beginPath();
  ctx.moveTo(0, centerY);
  for (let i = 0; i < bufferLength; i++) {
    const x = (i / bufferLength) * width;
    const y = centerY + ((data[i] - 0.5) * 2) * centerY * 0.8;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
  
  // Glow effect
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// Galaxy - Spiral galaxy pattern
function drawGalaxy(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number,
  time: number
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const galaxyTime = time / 1000;
  const bufferLength = data.length;

  for (let i = 0; i < 80; i++) {
    const angle = (i / 80) * Math.PI * 4 + galaxyTime;
    const dataIndex = Math.floor((i / 80) * bufferLength);
    const distance = 10 + (i / 80) * 40 + data[dataIndex] * 15;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance * 0.6;
    const size = data[dataIndex] * 3 + 1;
    const alpha = 0.3 + data[dataIndex] * 0.7;
    
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Flower - Pulsing flower petals
function drawFlower(
  ctx: CanvasRenderingContext2D,
  data: number[],
  colors: string[],
  width: number,
  height: number,
  time: number
) {
  const centerX = width / 2;
  const centerY = height / 2;
  const petalCount = 12;
  const bufferLength = data.length;

  for (let p = 0; p < petalCount; p++) {
    const dataIndex = Math.floor((p / petalCount) * bufferLength);
    const petalLength = 15 + data[dataIndex] * 30;
    const angle = (p / petalCount) * Math.PI * 2 + time / 3000;
    
    ctx.beginPath();
    ctx.ellipse(
      centerX + Math.cos(angle) * petalLength * 0.3,
      centerY + Math.sin(angle) * petalLength * 0.3,
      petalLength * 0.2, petalLength * 0.6,
      angle, 0, Math.PI * 2
    );
    const hue = 175 + (p / petalCount) * 30;
    ctx.fillStyle = `hsla(${hue}, 70%, 50%, ${0.3 + data[dataIndex] * 0.4})`;
    ctx.fill();
  }
}

// Matrix Rain - Falling characters
function drawMatrixRain(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number,
  time: number
) {
  ctx.font = '10px monospace';
  const cols = Math.floor(width / 12);
  const bufferLength = data.length;

  for (let i = 0; i < cols; i++) {
    const x = i * 12;
    const dataIndex = Math.floor((i / cols) * bufferLength);
    const chars = Math.floor(data[dataIndex] * 6) + 2;
    
    for (let j = 0; j < chars; j++) {
      const char = String.fromCharCode(0x30A0 + Math.random() * 96);
      const alpha = (1 - j / chars) * data[dataIndex];
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fillText(char, x, (j + 1) * 12 + ((time / 50 + i * 20) % height));
    }
  }
  ctx.globalAlpha = 1;
}

// Aurora - Northern lights wave
function drawAurora(
  ctx: CanvasRenderingContext2D,
  data: number[],
  color: string,
  width: number,
  height: number,
  time: number
) {
  const bufferLength = data.length;

  for (let layer = 0; layer < 3; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i <= width; i += 8) {
      const dataIndex = Math.floor((i / width) * bufferLength);
      const wave = Math.sin(i / 40 + time / (800 + layer * 150) + layer) * 15;
      const y = height - data[dataIndex] * (60 - layer * 15) - wave - layer * 15;
      ctx.lineTo(i, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const alphaHex = Math.floor((0.4 - layer * 0.1) * 255).toString(16).padStart(2, '0');
    gradient.addColorStop(0, color + alphaHex);
    gradient.addColorStop(1, color + '00');
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// Radial Bars (KEPT - Radial Metallic)
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
  const numBars = data.length * 2;

  for (let i = 0; i < numBars; i++) {
    const dataIndex = i % data.length;
    const value = data[dataIndex];
    const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * maxLength + 5;
    
    const x1 = centerX + Math.cos(angle) * innerRadius;
    const y1 = centerY + Math.sin(angle) * innerRadius;
    const x2 = centerX + Math.cos(angle) * (innerRadius + barLength);
    const y2 = centerY + Math.sin(angle) * (innerRadius + barLength);
    
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
