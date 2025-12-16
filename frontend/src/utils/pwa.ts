/**
 * Service Worker Registration and PWA Utilities
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

class PWAManager {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private isInstalled = false;
  private isOnline = navigator.onLine;
  private listeners: Map<string, Set<Function>> = new Map();
  private registration: ServiceWorkerRegistration | null = null;

  constructor() {
    this.init();
  }

  private init() {
    // Check if already installed
    this.checkIfInstalled();

    // Listen for install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.emit('canInstall', true);
    });

    // Listen for app installed
    window.addEventListener('appinstalled', () => {
      this.isInstalled = true;
      this.deferredPrompt = null;
      this.emit('installed', true);
    });

    // Listen for online/offline
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.emit('online', true);
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.emit('offline', true);
    });

    // Listen for service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        this.emit('update', true);
      });
    }
  }

  private checkIfInstalled() {
    // Check if running in standalone mode
    if (window.matchMedia('(display-mode: standalone)').matches) {
      this.isInstalled = true;
      return true;
    }

    // Check iOS
    if ((navigator as any).standalone === true) {
      this.isInstalled = true;
      return true;
    }

    return false;
  }

  /**
   * Register service worker
   */
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      // Silently return for non-HTTPS environments
      return null;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      });

      console.log('Service Worker registered:', this.registration);

      // Check for updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration!.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              this.emit('updateAvailable', newWorker);
            }
          });
        }
      });

      return this.registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }

  /**
   * Show install prompt
   */
  async showInstallPrompt(): Promise<boolean> {
    if (!this.deferredPrompt) {
      console.warn('Install prompt not available');
      return false;
    }

    try {
      await this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted install prompt');
        this.deferredPrompt = null;
        return true;
      } else {
        console.log('User dismissed install prompt');
        return false;
      }
    } catch (error) {
      console.error('Error showing install prompt:', error);
      return false;
    }
  }

  /**
   * Update service worker
   */
  async updateServiceWorker() {
    if (!this.registration) {
      return;
    }

    const newWorker = this.registration.waiting;
    if (newWorker) {
      newWorker.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const messageChannel = new MessageChannel();

      return new Promise((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data.success);
        };

        registration.active?.postMessage(
          { type: 'CLEAR_CACHE' },
          [messageChannel.port2]
        );
      });
    } catch (error) {
      console.error('Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Cache audio file for offline playback
   */
  async cacheAudio(url: string): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const messageChannel = new MessageChannel();

      return new Promise((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data.success);
        };

        registration.active?.postMessage(
          { type: 'CACHE_AUDIO', url },
          [messageChannel.port2]
        );
      });
    } catch (error) {
      console.error('Error caching audio:', error);
      return false;
    }
  }

  /**
   * Request notification permission
   */
  async requestNotificationPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported');
      return 'denied';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission;
    }

    return Notification.permission;
  }

  /**
   * Show local notification
   */
  async showNotification(title: string, options?: NotificationOptions): Promise<void> {
    if (Notification.permission !== 'granted') {
      return;
    }

    if (!this.registration) {
      // Fallback to browser notification
      new Notification(title, options);
      return;
    }

    await this.registration.showNotification(title, {
      icon: '/img/icon-192x192.png',
      badge: '/img/icon-72x72.png',
      ...options,
    });
  }

  /**
   * Check if can install
   */
  canInstall(): boolean {
    return this.deferredPrompt !== null;
  }

  /**
   * Check if installed
   */
  getIsInstalled(): boolean {
    return this.isInstalled;
  }

  /**
   * Check if online
   */
  getIsOnline(): boolean {
    return this.isOnline;
  }

  /**
   * Event emitter
   */
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    if (this.listeners.has(event)) {
      this.listeners.get(event)!.forEach((callback) => callback(data));
    }
  }

  /**
   * Cache entire playlist for offline access
   */
  async cachePlaylist(playlistId: string, audioUrls: string[]): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const messageChannel = new MessageChannel();

      return new Promise((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data.success);
        };

        registration.active?.postMessage(
          { type: 'CACHE_PLAYLIST', playlistId, audioUrls },
          [messageChannel.port2]
        );
      });
    } catch (error) {
      console.error('Error caching playlist:', error);
      return false;
    }
  }

  /**
   * Remove playlist from cache
   */
  async removePlaylistCache(playlistId: string, audioUrls: string[]): Promise<boolean> {
    if (!('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      const messageChannel = new MessageChannel();

      return new Promise((resolve) => {
        messageChannel.port1.onmessage = (event) => {
          resolve(event.data.success);
        };

        registration.active?.postMessage(
          { type: 'REMOVE_PLAYLIST_CACHE', playlistId, audioUrls },
          [messageChannel.port2]
        );
      });
    } catch (error) {
      console.error('Error removing playlist cache:', error);
      return false;
    }
  }

  /**
   * Get cache size estimate
   */
  async getCacheSize(): Promise<{ usage: number; quota: number } | null> {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    }
    return null;
  }
}

// Export singleton instance
export const pwaManager = new PWAManager();

// Export helper functions
export const registerServiceWorker = () => pwaManager.registerServiceWorker();
export const showInstallPrompt = () => pwaManager.showInstallPrompt();
export const updateServiceWorker = () => pwaManager.updateServiceWorker();
export const clearCache = () => pwaManager.clearCache();
export const cacheAudio = (url: string) => pwaManager.cacheAudio(url);
export const cachePlaylist = (playlistId: string, audioUrls: string[]) => 
  pwaManager.cachePlaylist(playlistId, audioUrls);
export const removePlaylistCache = (playlistId: string, audioUrls: string[]) =>
  pwaManager.removePlaylistCache(playlistId, audioUrls);
export const requestNotificationPermission = () => pwaManager.requestNotificationPermission();
export const showNotification = (title: string, options?: NotificationOptions) =>
  pwaManager.showNotification(title, options);
export const canInstall = () => pwaManager.canInstall();
export const isInstalled = () => pwaManager.getIsInstalled();
export const isOnline = () => pwaManager.getIsOnline();
export const getCacheSize = () => pwaManager.getCacheSize();
