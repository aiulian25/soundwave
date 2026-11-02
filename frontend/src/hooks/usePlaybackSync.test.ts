import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ syncPlayback: vi.fn(), getQueue: vi.fn() }));
vi.mock('../api/client', () => ({ playbackSyncAPI: api }));

import { loadResumedQueue, queueToSync, usePlaybackSyncWriter } from './usePlaybackSync';
import type { Audio } from '../types';

const DELAY_MS = 3000;
const INTERVAL_MS = 60000;
const TRACK = { youtube_id: 'track-one', duration: 100 } as Audio;
const OTHER_TRACK = { youtube_id: 'track-two', duration: 50 } as Audio;

type WriterProps = Parameters<typeof usePlaybackSyncWriter>[0];

function Writer(props: WriterProps) {
  usePlaybackSyncWriter(props);
  return null;
}

describe('writing playback state', () => {
  let root: Root;
  const positionRef = { current: 42 };
  const baseProps: WriterProps = {
    enabled: true,
    audio: TRACK,
    isPlaying: true,
    queue: [TRACK],
    queueIndex: 0,
    volume: 80,
    positionRef,
  };

  const render = (props: Partial<WriterProps> = {}) =>
    act(() => root.render(createElement(Writer, { ...baseProps, ...props })));
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    api.syncPlayback.mockReset().mockResolvedValue({});
    root = createRoot(document.createElement('div'));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes once after the delay, with the latest position', () => {
    render();
    positionRef.current = 55;
    advance(DELAY_MS - 1);
    expect(api.syncPlayback).not.toHaveBeenCalled();
    advance(1);
    expect(api.syncPlayback).toHaveBeenCalledOnce();
    expect(api.syncPlayback.mock.calls[0][0]).toMatchObject({ youtube_id: 'track-one', position: 55, is_playing: true });
  });

  it('keeps writing while playing', () => {
    render();
    advance(DELAY_MS + 2 * INTERVAL_MS);
    expect(api.syncPlayback).toHaveBeenCalledTimes(3);
  });

  it('writes the paused state once, then stops', () => {
    render({ isPlaying: false });
    advance(DELAY_MS + 3 * INTERVAL_MS);
    expect(api.syncPlayback).toHaveBeenCalledOnce();
    expect(api.syncPlayback.mock.calls[0][0].is_playing).toBe(false);
  });

  it('writes nothing at all when disabled, across play, pause and track changes', () => {
    render({ enabled: false });
    render({ enabled: false, isPlaying: false });
    render({ enabled: false, audio: OTHER_TRACK });
    advance(DELAY_MS + 3 * INTERVAL_MS);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('opting out cancels a write that was already pending', () => {
    render();
    advance(DELAY_MS - 1);
    render({ enabled: false });
    advance(DELAY_MS + INTERVAL_MS);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('a pending pause write is cancelled by opting out', () => {
    render({ isPlaying: false });
    render({ isPlaying: false, enabled: false });
    advance(DELAY_MS * 2);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('losing the track, as logout does, cancels everything', () => {
    render();
    render({ audio: null });
    advance(DELAY_MS + INTERVAL_MS);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('unmounting cancels everything', () => {
    render();
    act(() => root.unmount());
    root = createRoot(document.createElement('div'));
    advance(DELAY_MS + INTERVAL_MS);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('changing track restarts the delay, so only the new track is written', () => {
    render();
    advance(DELAY_MS - 1);
    render({ audio: OTHER_TRACK });
    advance(DELAY_MS);
    expect(api.syncPlayback).toHaveBeenCalledOnce();
    expect(api.syncPlayback.mock.calls[0][0].youtube_id).toBe('track-two');
  });

  it('writes nothing while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render();
    advance(DELAY_MS + INTERVAL_MS);
    expect(api.syncPlayback).not.toHaveBeenCalled();
  });

  it('a failed write is not an unhandled error', async () => {
    api.syncPlayback.mockRejectedValue(new Error('network down'));
    render();
    advance(DELAY_MS);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.syncPlayback).toHaveBeenCalledOnce();
  });
});

describe('the saved queue', () => {
  const ids = (total: number) => Array.from({ length: total }, (_, index) => `id-${index}`);

  it('is sent whole when it fits', () => {
    const queue = ids(100);
    expect(queueToSync(queue, 73)).toEqual({ ids: queue, index: 73 });
  });

  it.each([
    ['near the start', 10],
    ['in the middle', 6000],
    ['near the end', 11999],
  ])('longer than the limit keeps the current track %s', (_label, index) => {
    const queue = ids(12000);
    const saved = queueToSync(queue, index);
    expect(saved.ids).toHaveLength(5000);
    expect(saved.ids[saved.index]).toBe(`id-${index}`);
  });
});

describe('resuming the queue', () => {
  beforeEach(() => {
    api.getQueue.mockReset();
  });

  it('uses the server order and index, and reports what was unavailable', async () => {
    api.getQueue.mockResolvedValue({ data: { data: [OTHER_TRACK, TRACK], index: 1, missing: 3 } });
    expect(await loadResumedQueue(TRACK)).toEqual({ tracks: [OTHER_TRACK, TRACK], index: 1, missing: 3 });
  });

  it('falls back to the current track if the queue does not contain it', async () => {
    api.getQueue.mockResolvedValue({ data: { data: [OTHER_TRACK], index: null, missing: 0 } });
    expect(await loadResumedQueue(TRACK)).toEqual({ tracks: [TRACK], index: 0, missing: 0 });
  });

  it('still reports missing tracks when nothing could be restored', async () => {
    api.getQueue.mockResolvedValue({ data: { data: [], index: null, missing: 4 } });
    expect(await loadResumedQueue(TRACK)).toEqual({ tracks: [TRACK], index: 0, missing: 4 });
  });

  it('falls back to the current track if the request fails', async () => {
    api.getQueue.mockRejectedValue(new Error('network down'));
    expect(await loadResumedQueue(TRACK)).toEqual({ tracks: [TRACK], index: 0, missing: 0 });
  });
});
