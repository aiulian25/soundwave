import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api/client', () => ({ default: http }));

import { useUserSettings } from './useUserSettings';

describe('the playback sync preference', () => {
  let root: Root;
  let latest: ReturnType<typeof useUserSettings>;

  function Probe() {
    latest = useUserSettings();
    return null;
  }

  const mount = async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    http.get.mockReset();
    http.post.mockReset();
    root = createRoot(document.createElement('div'));
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('is off while the real value is still loading, even though the default is on', async () => {
    let answer = (_value: unknown) => undefined as void;
    http.get.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    await mount();
    expect(latest.settings.playback_sync_enabled).toBe(true);
    expect(latest.playbackSyncEnabled).toBe(false);
    await act(async () => answer({ data: { playback_sync_enabled: true, extra_settings: {} } }));
    expect(latest.playbackSyncEnabled).toBe(true);
  });

  it('follows an opted-out account', async () => {
    http.get.mockResolvedValue({ data: { playback_sync_enabled: false, extra_settings: {} } });
    await mount();
    expect(latest.playbackSyncEnabled).toBe(false);
    expect(latest.settings.playback_sync_enabled).toBe(false);
  });

  it('stays off when settings cannot be loaded', async () => {
    http.get.mockRejectedValue(new Error('not signed in'));
    await mount();
    expect(latest.playbackSyncEnabled).toBe(false);
  });

  it('a field the server omits keeps its default instead of becoming undefined', async () => {
    http.get.mockResolvedValue({ data: { theme: 'dark' } });
    await mount();
    expect(latest.settings.playback_sync_enabled).toBe(true);
    expect(latest.settings.extra_settings).toEqual({});
  });

  it('saving keeps the same merged shape and turning it off takes effect', async () => {
    http.get.mockResolvedValue({ data: { playback_sync_enabled: true, extra_settings: {} } });
    http.post.mockResolvedValue({ data: { config: { playback_sync_enabled: false } } });
    await mount();
    await act(async () => {
      await latest.updateSetting('playback_sync_enabled', false);
    });
    expect(http.post).toHaveBeenCalledWith('/user/config/', { playback_sync_enabled: false });
    expect(latest.playbackSyncEnabled).toBe(false);
    expect(latest.settings.extra_settings).toEqual({});
  });

  it('a failed save puts the real value back', async () => {
    http.get.mockResolvedValue({ data: { playback_sync_enabled: true, extra_settings: {} } });
    http.post.mockRejectedValue(new Error('network down'));
    await mount();
    await act(async () => {
      await latest.updateSetting('playback_sync_enabled', false);
    });
    expect(latest.playbackSyncEnabled).toBe(true);
  });
});
