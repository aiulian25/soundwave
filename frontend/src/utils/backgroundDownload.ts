/**
 * Polls the server's download queue while the download UI is open.
 *
 * Network-aware: adjusts polling based on connection quality.
 */

import { getNetworkInfo, getPollingInterval, apiBackoffs } from './networkQuality';

export interface DownloadProgress {
  id: number;
  youtube_id: string;
  title: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress?: number;
  error_message?: string;
}

class DownloadStatusPoller {
  private statusPollingInterval: number | null = null;
  private statusListeners: Set<(downloads: DownloadProgress[]) => void> = new Set();

  /**
   * Start polling for download status updates
   * Network-aware: adjusts interval based on connection quality and backoff on errors
   */
  startStatusPolling(baseIntervalMs: number = 5000) {
    if (this.statusPollingInterval) return;

    const poll = async () => {
      if (!navigator.onLine) return;
      
      // Check backoff state
      if (!apiBackoffs.downloads.shouldAttempt()) {
        console.debug('[BackgroundDownload] Skipping poll due to backoff');
        return;
      }
      
      try {
        // Fetch active downloads
        const pendingResponse = await fetch('/api/download/?filter=pending', {
          credentials: 'include',
        });
        
        const downloadingResponse = await fetch('/api/download/?filter=downloading', {
          credentials: 'include',
        });

        if (pendingResponse.ok && downloadingResponse.ok) {
          const pending = await pendingResponse.json();
          const downloading = await downloadingResponse.json();
          
          const allActive = [
            ...(pending.data || []),
            ...(downloading.data || []),
          ];
          
          this.notifyStatusListeners(allActive);
          apiBackoffs.downloads.recordSuccess();
        } else {
          apiBackoffs.downloads.recordFailure();
        }
      } catch (error) {
        console.error('[BackgroundDownload] Status polling error:', error);
        apiBackoffs.downloads.recordFailure();
      }
    };

    // Use network-aware interval
    const setupPolling = () => {
      const interval = getPollingInterval(baseIntervalMs);
      const networkInfo = getNetworkInfo();
      console.debug(`[BackgroundDownload] Setting poll interval: ${Math.round(interval / 1000)}s (${networkInfo.quality})`);
      
      this.statusPollingInterval = window.setInterval(() => {
        poll();
        
        // Check if we need to adjust interval based on new network conditions
        const newInterval = getPollingInterval(baseIntervalMs);
        if (Math.abs(newInterval - interval) > 1000) {
          this.stopStatusPolling();
          this.startStatusPolling(baseIntervalMs);
        }
      }, interval);
    };
    
    setupPolling();
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
}

// Singleton instance
const backgroundDownload = new DownloadStatusPoller();
export default backgroundDownload;
