/**
 * Network Quality Detection Utility
 * 
 * Uses the Network Information API to detect connection quality
 * and adjust app behavior accordingly for better mobile performance.
 */

// Extend Navigator interface to include connection property
interface NetworkInformation extends EventTarget {
  type: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
  effectiveType: 'slow-2g' | '2g' | '3g' | '4g';
  downlinkMax?: number;
  downlink?: number;
  rtt?: number;
  saveData: boolean;
  onchange?: ((this: NetworkInformation, ev: Event) => void) | null;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  }
}

export type ConnectionQuality = 'excellent' | 'good' | 'moderate' | 'poor' | 'offline';

export interface NetworkInfo {
  quality: ConnectionQuality;
  effectiveType: string;
  isOnline: boolean;
  isSaveData: boolean;
  isCellular: boolean;
  isSlowConnection: boolean;
  downlink: number | null;  // Mbps
  rtt: number | null;       // Round-trip time in ms
}

// Get network connection object (if available)
function getConnection(): NetworkInformation | null {
  return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
}

/**
 * Get current network quality information
 */
export function getNetworkInfo(): NetworkInfo {
  const connection = getConnection();
  const isOnline = navigator.onLine;
  
  if (!isOnline) {
    return {
      quality: 'offline',
      effectiveType: 'none',
      isOnline: false,
      isSaveData: false,
      isCellular: false,
      isSlowConnection: true,
      downlink: null,
      rtt: null,
    };
  }
  
  // If Network Information API is not available, assume good connection
  if (!connection) {
    return {
      quality: 'good',
      effectiveType: 'unknown',
      isOnline: true,
      isSaveData: false,
      isCellular: false,
      isSlowConnection: false,
      downlink: null,
      rtt: null,
    };
  }
  
  const effectiveType = connection.effectiveType || '4g';
  const saveData = connection.saveData || false;
  const isCellular = connection.type === 'cellular';
  const downlink = connection.downlink ?? null;
  const rtt = connection.rtt ?? null;
  
  // Determine quality based on effective type and RTT
  let quality: ConnectionQuality;
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || (rtt && rtt > 1000)) {
    quality = 'poor';
  } else if (effectiveType === '3g' || (rtt && rtt > 500)) {
    quality = 'moderate';
  } else if (downlink && downlink >= 10) {
    quality = 'excellent';
  } else {
    quality = 'good';
  }
  
  // Override to poor if save data is enabled
  if (saveData) {
    quality = 'poor';
  }
  
  const isSlowConnection = quality === 'poor' || quality === 'moderate' || saveData;
  
  return {
    quality,
    effectiveType,
    isOnline,
    isSaveData: saveData,
    isCellular,
    isSlowConnection,
    downlink,
    rtt,
  };
}

/**
 * Check if we should prefetch audio (based on network conditions)
 */
export function shouldPrefetch(): boolean {
  const info = getNetworkInfo();
  
  // Don't prefetch if offline
  if (!info.isOnline) return false;
  
  // Don't prefetch if save-data is enabled
  if (info.isSaveData) return false;
  
  // Don't prefetch on very slow connections
  if (info.quality === 'poor') return false;
  
  return true;
}

/**
 * Get recommended prefetch count based on network
 */
export function getPrefetchCount(): number {
  const info = getNetworkInfo();
  
  if (!info.isOnline || info.isSaveData) return 0;
  
  switch (info.quality) {
    case 'excellent':
      return 3;  // Full prefetch on excellent connection
    case 'good':
      return 2;  // Moderate prefetch
    case 'moderate':
      return 1;  // Only next track
    case 'poor':
    case 'offline':
    default:
      return 0;  // No prefetch
  }
}

/**
 * Get recommended polling interval based on network (in ms)
 */
export function getPollingInterval(baseInterval: number): number {
  const info = getNetworkInfo();
  
  if (!info.isOnline) return baseInterval * 10;  // Very slow polling when offline
  
  switch (info.quality) {
    case 'excellent':
      return baseInterval;
    case 'good':
      return baseInterval * 1.5;
    case 'moderate':
      return baseInterval * 2;
    case 'poor':
      return baseInterval * 4;
    default:
      return baseInterval * 2;
  }
}

/**
 * Get recommended batch size for API requests
 */
export function getRecommendedBatchSize(): number {
  const info = getNetworkInfo();
  
  if (info.quality === 'excellent') return 20;
  if (info.quality === 'good') return 15;
  if (info.quality === 'moderate') return 10;
  return 5;
}

// Listeners for network changes
type NetworkChangeListener = (info: NetworkInfo) => void;
const listeners = new Set<NetworkChangeListener>();

/**
 * Subscribe to network quality changes
 */
export function onNetworkChange(listener: NetworkChangeListener): () => void {
  listeners.add(listener);
  
  // Set up connection change listener if not already done
  const connection = getConnection();
  if (connection && !connection.onchange) {
    connection.onchange = () => {
      const info = getNetworkInfo();
      listeners.forEach(l => l(info));
    };
  }
  
  // Also listen for online/offline events
  const handleOnline = () => {
    const info = getNetworkInfo();
    listeners.forEach(l => l(info));
  };
  
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOnline);
  
  // Return unsubscribe function
  return () => {
    listeners.delete(listener);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOnline);
  };
}

/**
 * Exponential backoff helper for failed requests
 */
export class ExponentialBackoff {
  private baseDelay: number;
  private maxDelay: number;
  private failures: number = 0;
  private lastFailure: number = 0;
  
  constructor(baseDelay: number = 1000, maxDelay: number = 60000) {
    this.baseDelay = baseDelay;
    this.maxDelay = maxDelay;
  }
  
  /**
   * Record a failure and get the delay before next retry
   */
  recordFailure(): number {
    this.failures++;
    this.lastFailure = Date.now();
    
    // Exponential backoff with jitter
    const exponentialDelay = this.baseDelay * Math.pow(2, Math.min(this.failures - 1, 10));
    const jitter = Math.random() * 0.3 * exponentialDelay;
    const delay = Math.min(exponentialDelay + jitter, this.maxDelay);
    
    return delay;
  }
  
  /**
   * Record a success, reset failure count
   */
  recordSuccess(): void {
    this.failures = 0;
    this.lastFailure = 0;
  }
  
  /**
   * Check if we should attempt now (based on backoff)
   */
  shouldAttempt(): boolean {
    if (this.failures === 0) return true;
    
    const delay = this.baseDelay * Math.pow(2, Math.min(this.failures - 1, 10));
    const timeSinceFailure = Date.now() - this.lastFailure;
    
    return timeSinceFailure >= delay;
  }
  
  /**
   * Get current failure count
   */
  getFailureCount(): number {
    return this.failures;
  }
  
  /**
   * Reset the backoff state
   */
  reset(): void {
    this.failures = 0;
    this.lastFailure = 0;
  }
}

/**
 * Global backoff instances for different API endpoints
 */
export const apiBackoffs = {
  playbackSync: new ExponentialBackoff(5000, 120000),  // 5s base, 2min max
  homepage: new ExponentialBackoff(2000, 60000),       // 2s base, 1min max
  downloads: new ExponentialBackoff(3000, 90000),      // 3s base, 1.5min max
  prefetch: new ExponentialBackoff(5000, 300000),      // 5s base, 5min max
};

export default {
  getNetworkInfo,
  shouldPrefetch,
  getPrefetchCount,
  getPollingInterval,
  getRecommendedBatchSize,
  onNetworkChange,
  ExponentialBackoff,
  apiBackoffs,
};
