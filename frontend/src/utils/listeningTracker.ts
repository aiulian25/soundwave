/**
 * Measures one play of one track from how far playback really moved, so buffering (position
 * stands still) and seeks (position jumps) add nothing, however long they take.
 */

// Timeupdate fires several times a second, even at high playback speed; a bigger step is a jump.
const LARGEST_PLAYBACK_STEP_SECONDS = 2;
export const MIN_RECORDED_SECONDS = 10;

export interface FinishedPlay {
  youtube_id: string;
  duration_listened: number;
  completed: boolean;
}

export class ListeningTracker {
  private youtubeId: string | null = null;
  private listenedSeconds = 0;
  private lastPosition: number | null = null;

  begin(youtubeId: string): void {
    this.youtubeId = youtubeId;
    this.listenedSeconds = 0;
    this.lastPosition = null;
  }

  observePosition(position: number): void {
    if (this.lastPosition !== null) {
      const step = position - this.lastPosition;
      if (step > 0 && step <= LARGEST_PLAYBACK_STEP_SECONDS) this.listenedSeconds += step;
    }
    this.lastPosition = position;
  }

  /** The next position is measured from here, so even a short seek adds nothing. */
  observeSeek(position: number): void {
    this.lastPosition = position;
  }

  /** Ends the play. Returns what to record, or null if it was too short to count. */
  finish(completed: boolean): FinishedPlay | null {
    const youtubeId = this.youtubeId;
    const seconds = Math.floor(this.listenedSeconds);
    this.youtubeId = null;
    this.listenedSeconds = 0;
    this.lastPosition = null;

    if (!youtubeId || seconds < MIN_RECORDED_SECONDS) return null;
    return { youtube_id: youtubeId, duration_listened: seconds, completed };
  }
}
