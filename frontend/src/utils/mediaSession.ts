/**
 * Media Session API integration for PWA
 * Enables media controls in notification tray and lock screen
 */

interface MediaMetadata {
  title: string;
  artist: string;
  album?: string;
  artwork?: Array<{
    src: string;
    sizes?: string;
    type?: string;
  }>;
}

class MediaSessionManager {
  private isSupported: boolean;

  constructor() {
    this.isSupported = 'mediaSession' in navigator;
  }

  /**
   * Set media metadata for current playing audio
   */
  setMetadata(metadata: MediaMetadata) {
    if (!this.isSupported) return;

    const artwork = metadata.artwork || [
      {
        src: '/img/icons/icon-96x96.png',
        sizes: '96x96',
        type: 'image/png',
      },
      {
        src: '/img/icons/icon-128x128.png',
        sizes: '128x128',
        type: 'image/png',
      },
      {
        src: '/img/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/img/icons/icon-384x384.png',
        sizes: '384x384',
        type: 'image/png',
      },
      {
        src: '/img/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album || '',
      artwork,
    });
  }

  /**
   * Set action handlers for media controls
   */
  setActionHandlers(handlers: {
    play?: () => void;
    pause?: () => void;
    previoustrack?: () => void;
    nexttrack?: () => void;
    seekbackward?: (details?: { seekOffset?: number }) => void;
    seekforward?: (details?: { seekOffset?: number }) => void;
    seekto?: (details: { seekTime: number }) => void;
  }) {
    if (!this.isSupported) return;

    const actions: Array<keyof typeof handlers> = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto',
    ];

    actions.forEach((action) => {
      try {
        if (handlers[action]) {
          navigator.mediaSession.setActionHandler(action, handlers[action] as any);
        } else {
          navigator.mediaSession.setActionHandler(action, null);
        }
      } catch (error) {
        console.warn(`Media Session API doesn't support ${action} action`);
      }
    });
  }

  /**
   * Set playback state
   */
  setPlaybackState(state: 'none' | 'paused' | 'playing') {
    if (!this.isSupported) return;
    navigator.mediaSession.playbackState = state;
  }

  /**
   * Set position state for seek bar
   */
  setPositionState(state: {
    duration?: number;
    playbackRate?: number;
    position?: number;
  }) {
    if (!this.isSupported) return;

    try {
      if ('setPositionState' in navigator.mediaSession) {
        // Validate state values to avoid errors
        const duration = state.duration || 0;
        let position = state.position || 0;
        
        // Clamp position to valid range (can't be greater than duration or negative)
        if (duration > 0) {
          position = Math.max(0, Math.min(position, duration));
        } else {
          position = 0;
        }
        
        // Only set if we have valid values
        if (duration > 0 && isFinite(duration) && isFinite(position)) {
          navigator.mediaSession.setPositionState({
            duration,
            playbackRate: state.playbackRate || 1,
            position,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to set position state:', error);
    }
  }

  /**
   * Clear all metadata and handlers
   */
  clear() {
    if (!this.isSupported) return;

    navigator.mediaSession.metadata = null;
    this.setPlaybackState('none');

    const actions: MediaSessionAction[] = [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto',
    ];

    actions.forEach((action) => {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (error) {
        // Ignore unsupported actions
      }
    });
  }

  /**
   * Check if Media Session API is supported
   */
  isAPISupported(): boolean {
    return this.isSupported;
  }
}

// Export singleton instance
export const mediaSessionManager = new MediaSessionManager();

// Export helper functions
export const setMediaMetadata = (metadata: MediaMetadata) =>
  mediaSessionManager.setMetadata(metadata);

export const setMediaActionHandlers = (handlers: Parameters<typeof mediaSessionManager.setActionHandlers>[0]) =>
  mediaSessionManager.setActionHandlers(handlers);

export const setPlaybackState = (state: 'none' | 'paused' | 'playing') =>
  mediaSessionManager.setPlaybackState(state);

export const setPositionState = (state: Parameters<typeof mediaSessionManager.setPositionState>[0]) =>
  mediaSessionManager.setPositionState(state);

export const clearMediaSession = () => mediaSessionManager.clear();

export const isMediaSessionSupported = () => mediaSessionManager.isAPISupported();
