/**
 * Background Download Service
 * 
 * Provides utilities for queueing downloads that persist even when the app is closed.
 * Uses Service Worker with Background Sync API for reliability.
 */

export interface PendingDownload {
  id: number;
  url: string;
  title?: string;
  status: 'pending' | 'submitted' | 'failed';
  createdAt: number;
  updatedAt?: number;
  attempts: number;
  error?: string;
}

export interface DownloadProgress {
  id: number;
  youtube_id: string;
  title: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress?: number;
  error_message?: string;
}

class BackgroundDownloadService {
  private swRegistration: ServiceWorkerRegistration | null = null;
  private isSupported: boolean = false;
  private authToken: string | null = null;
  private statusPollingInterval: number | null = null;
  private statusListeners: Set<(downloads: DownloadProgress[]) => void> = new Set();

  constructor() {
    this.checkSupport();
    this.setupServiceWorker();
    this.setupNetworkListeners();
  }

  private checkSupport() {
    this.isSupported = 
      'serviceWorker' in navigator && 
      'SyncManager' in window;
    
    console.log('[BackgroundDownload] Support:', {
      serviceWorker: 'serviceWorker' in navigator,
      syncManager: 'SyncManager' in window,
      periodicSync: 'PeriodicSyncManager' in window,
    });
  }

  private async setupServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    try {
      this.swRegistration = await navigator.serviceWorker.ready;
      console.log('[BackgroundDownload] Service Worker ready');

      // Register periodic sync for checking download status
      if ('periodicSync' in this.swRegistration) {
        try {
          const status = await navigator.permissions.query({
            name: 'periodic-background-sync' as PermissionName,
          });
          
          if (status.state === 'granted') {
            await (this.swRegistration as any).periodicSync.register('check-download-status', {
              minInterval: 60 * 1000, // Check every minute
            });
            console.log('[BackgroundDownload] Periodic sync registered');
          }
        } catch (e) {
          console.log('[BackgroundDownload] Periodic sync not available');
        }
      }

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', this.handleServiceWorkerMessage.bind(this));
    } catch (error) {
      console.error('[BackgroundDownload] Setup error:', error);
    }
  }

  private setupNetworkListeners() {
    // When coming back online, trigger sync
    window.addEventListener('online', () => {
      console.log('[BackgroundDownload] Network online, triggering sync');
      this.triggerSync();
    });
  }

  private handleServiceWorkerMessage(event: MessageEvent) {
    const { type, ...data } = event.data || {};
    
    if (type === 'GET_AUTH_TOKEN') {
      // Service worker requesting auth token
      const token = this.authToken || localStorage.getItem('token');
      event.ports?.[0]?.postMessage({ token });
    }
    
    if (type === 'DOWNLOAD_STATUS_UPDATE') {
      // Status update from service worker
      this.notifyStatusListeners(data.downloads);
    }
    
    if (type === 'PLAY_AUDIO') {
      // Request to play audio (from notification click)
      window.dispatchEvent(new CustomEvent('playAudio', { detail: data }));
    }
  }

  /**
   * Set the authentication token for API requests
   */
  setAuthToken(token: string | null) {
    this.authToken = token;
    
    // Update token in service worker for pending downloads
    if (token && this.swRegistration) {
      this.sendMessage('UPDATE_AUTH_TOKEN', { authToken: token });
    }
  }

  /**
   * Queue a download for background processing
   */
  async queueDownload(url: string, title?: string): Promise<{ success: boolean; id?: number; error?: string }> {
    const token = this.authToken || localStorage.getItem('token');
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    // If online and basic mode, try direct API call first
    if (navigator.onLine && !this.isSupported) {
      return this.directDownload(url, token);
    }

    // Use service worker for background download
    try {
      const result = await this.sendMessage('QUEUE_DOWNLOAD', {
        url,
        title,
        authToken: token,
      });
      
      return result;
    } catch (error) {
      console.error('[BackgroundDownload] Queue error:', error);
      
      // Fallback to direct API if service worker fails
      if (navigator.onLine) {
        return this.directDownload(url, token);
      }
      
      return { success: false, error: 'Failed to queue download' };
    }
  }

  /**
   * Queue multiple downloads for background processing
   */
  async queueDownloads(downloads: { url: string; title?: string }[]): Promise<{ success: boolean; ids?: number[]; error?: string }> {
    const token = this.authToken || localStorage.getItem('token');
    
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    // If online and basic mode, try direct API call
    if (navigator.onLine && !this.isSupported) {
      return this.directDownloadBatch(downloads.map(d => d.url), token);
    }

    try {
      const result = await this.sendMessage('QUEUE_DOWNLOADS_BATCH', {
        downloads,
        authToken: token,
      });
      
      return result;
    } catch (error) {
      console.error('[BackgroundDownload] Batch queue error:', error);
      
      if (navigator.onLine) {
        return this.directDownloadBatch(downloads.map(d => d.url), token);
      }
      
      return { success: false, error: 'Failed to queue downloads' };
    }
  }

  /**
   * Get all pending downloads from service worker
   */
  async getPendingDownloads(): Promise<PendingDownload[]> {
    try {
      const result = await this.sendMessage('GET_PENDING_DOWNLOADS', {});
      return result.downloads || [];
    } catch (error) {
      console.error('[BackgroundDownload] Get pending error:', error);
      return [];
    }
  }

  /**
   * Remove a pending download
   */
  async removePendingDownload(id: number): Promise<boolean> {
    try {
      const result = await this.sendMessage('REMOVE_PENDING_DOWNLOAD', { id });
      return result.success;
    } catch (error) {
      console.error('[BackgroundDownload] Remove error:', error);
      return false;
    }
  }

  /**
   * Manually trigger sync (useful when coming back online)
   */
  async triggerSync(): Promise<boolean> {
    if (!this.swRegistration) return false;

    try {
      // Try Background Sync API first
      if ('sync' in this.swRegistration) {
        await (this.swRegistration as any).sync.register('sync-downloads');
        console.log('[BackgroundDownload] Sync triggered via Background Sync API');
        return true;
      }
      
      // Fallback: send message to service worker
      const result = await this.sendMessage('TRIGGER_DOWNLOAD_SYNC', {});
      return result.success;
    } catch (error) {
      console.error('[BackgroundDownload] Trigger sync error:', error);
      return false;
    }
  }

  /**
   * Start polling for download status updates
   */
  startStatusPolling(intervalMs: number = 5000) {
    if (this.statusPollingInterval) return;

    this.statusPollingInterval = window.setInterval(async () => {
      if (!navigator.onLine) return;
      
      try {
        const token = this.authToken || localStorage.getItem('token');
        if (!token) return;

        // Fetch active downloads
        const pendingResponse = await fetch('/api/download/?filter=pending', {
          headers: { 'Authorization': `Token ${token}` },
        });
        
        const downloadingResponse = await fetch('/api/download/?filter=downloading', {
          headers: { 'Authorization': `Token ${token}` },
        });

        if (pendingResponse.ok && downloadingResponse.ok) {
          const pending = await pendingResponse.json();
          const downloading = await downloadingResponse.json();
          
          const allActive = [
            ...(pending.data || []),
            ...(downloading.data || []),
          ];
          
          this.notifyStatusListeners(allActive);
        }
      } catch (error) {
        console.error('[BackgroundDownload] Status polling error:', error);
      }
    }, intervalMs);
  }

  /**
   * Stop polling for status updates
   */
  stopStatusPolling() {
    if (this.statusPollingInterval) {
      clearInterval(this.statusPollingInterval);
      this.statusPollingInterval = null;
    }
  }

  /**
   * Subscribe to download status updates
   */
  onStatusUpdate(callback: (downloads: DownloadProgress[]) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private notifyStatusListeners(downloads: DownloadProgress[]) {
    this.statusListeners.forEach(listener => listener(downloads));
  }

  /**
   * Direct API call fallback when service worker not available
   */
  private async directDownload(url: string, token: string): Promise<{ success: boolean; id?: number; error?: string }> {
    try {
      const response = await fetch('/api/download/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify({
          urls: [url],
          auto_start: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, id: data[0]?.id };
      } else {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private async directDownloadBatch(urls: string[], token: string): Promise<{ success: boolean; ids?: number[]; error?: string }> {
    try {
      const response = await fetch('/api/download/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${token}`,
        },
        body: JSON.stringify({
          urls,
          auto_start: true,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, ids: data.map((d: any) => d.id) };
      } else {
        const errorText = await response.text();
        return { success: false, error: errorText };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Send message to service worker and wait for response
   */
  private sendMessage(type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!navigator.serviceWorker.controller) {
        // No controller yet - this is normal during SW update, just resolve with empty
        console.log('[BackgroundDownload] No service worker controller, returning empty');
        resolve({ downloads: [], success: true });
        return;
      }

      const messageChannel = new MessageChannel();
      
      // Timeout after 5 seconds (shorter timeout to fail fast)
      const timeout = setTimeout(() => {
        console.log('[BackgroundDownload] Service worker message timeout, returning empty');
        resolve({ downloads: [], success: true }); // Resolve with empty instead of rejecting
      }, 5000);

      messageChannel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(event.data);
      };

      navigator.serviceWorker.controller.postMessage(
        { type, ...data },
        [messageChannel.port2]
      );
    });
  }

  /**
   * Check if background downloads are supported
   */
  get supported(): boolean {
    return this.isSupported;
  }

  /**
   * Check if we're online
   */
  get online(): boolean {
    return navigator.onLine;
  }
}

// Singleton instance
export const backgroundDownload = new BackgroundDownloadService();
export default backgroundDownload;
