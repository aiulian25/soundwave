import { useState } from 'react';

export type TrackListView = 'list' | 'cards';

const STORAGE_KEY = 'soundwave_track_list_view';
const DEFAULT_VIEW: TrackListView = 'list';

function savedView(): TrackListView {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'cards' ? 'cards' : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

/** How track lists are shown on this device; a phone and a desktop can each keep their own. */
export function useTrackListView(): [TrackListView, (view: TrackListView) => void] {
  const [view, setView] = useState<TrackListView>(savedView);

  const chooseView = (next: TrackListView) => {
    setView(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing can refuse storage; the choice then lasts until the page closes.
    }
  };

  return [view, chooseView];
}
