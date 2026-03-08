/**
 * Wake Lock API utility for preventing screen sleep during audio playback
 * 
 * This is critical for mobile devices where the system suspends the page
 * when the screen turns off, which stops audio playback after a few songs.
 * 
 * The Wake Lock API keeps the screen awake while audio is playing,
 * preventing the system from suspending the audio context.
 */

class WakeLockManager {
  private wakeLock: WakeLockSentinel | null = null;
  private isSupported: boolean;
  private isActive: boolean = false;
  private retryAttempts: number = 0;
  private maxRetries: number = 3;

  constructor() {
    this.isSupported = 'wakeLock' in navigator;
    
    // Re-acquire wake lock when page becomes visible again
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /**
   * Request a wake lock to keep the screen awake
   * Should be called when audio playback starts
   */
  async request(): Promise<boolean> {
    if (!this.isSupported) {
      console.debug('[WakeLock] Wake Lock API not supported on this device');
      return false;
    }

    // Already have an active wake lock
    if (this.wakeLock !== null && !this.wakeLock.released) {
      console.debug('[WakeLock] Wake lock already active');
      return true;
    }

    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.isActive = true;
      this.retryAttempts = 0;
      
      console.log('[WakeLock] ✓ Wake lock acquired - screen will stay awake during playback');
      
      // Listen for release (can happen when tab loses visibility)
      this.wakeLock.addEventListener('release', () => {
        console.log('[WakeLock] Wake lock was released');
        this.isActive = false;
      });
      
      return true;
    } catch (error: any) {
      // Common reasons for failure:
      // - Low battery mode on iOS
      // - Document not visible
      // - Permission denied
      console.warn('[WakeLock] Failed to acquire wake lock:', error.message || error);
      this.isActive = false;
      return false;
    }
  }

  /**
   * Release the wake lock
   * Should be called when audio playback stops/pauses
   */
  async release(): Promise<void> {
    if (this.wakeLock !== null && !this.wakeLock.released) {
      try {
        await this.wakeLock.release();
        console.log('[WakeLock] Wake lock released');
      } catch (error) {
        console.warn('[WakeLock] Error releasing wake lock:', error);
      }
    }
    this.wakeLock = null;
    this.isActive = false;
  }

  /**
   * Handle visibility change - re-acquire wake lock when page becomes visible
   */
  private handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && this.isActive && this.wakeLock?.released) {
      console.log('[WakeLock] Page became visible, re-acquiring wake lock...');
      await this.request();
    }
  };

  /**
   * Check if wake lock is currently active
   */
  isWakeLockActive(): boolean {
    return this.isActive && this.wakeLock !== null && !this.wakeLock.released;
  }

  /**
   * Check if Wake Lock API is supported
   */
  isAPISupported(): boolean {
    return this.isSupported;
  }

  /**
   * Cleanup - should be called on unmount
   */
  cleanup(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.release();
  }
}

// Singleton instance
export const wakeLockManager = new WakeLockManager();

// Export helper functions
export const requestWakeLock = () => wakeLockManager.request();
export const releaseWakeLock = () => wakeLockManager.release();
export const isWakeLockActive = () => wakeLockManager.isWakeLockActive();
export const isWakeLockSupported = () => wakeLockManager.isAPISupported();
