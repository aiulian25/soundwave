import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pwaManager } from './pwa';

const ACCOUNT_CACHES = ['soundwave-api-v3', 'soundwave-audio-v3', 'soundwave-stream-v1', 'soundwave-images-v4'];
const SHELL_CACHE = 'soundwave-v20';

describe('clearing caches does not depend on a service worker', () => {
  let cacheNames: string[];

  beforeEach(() => {
    cacheNames = [SHELL_CACHE, ...ACCOUNT_CACHES];
    vi.stubGlobal('caches', {
      keys: async () => [...cacheNames],
      delete: async (name: string) => {
        cacheNames = cacheNames.filter((existing) => existing !== name);
        return true;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const stubServiceWorker = (getRegistration: () => Promise<unknown>) =>
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration } });

  it('removes account caches directly when no worker is registered', async () => {
    stubServiceWorker(async () => undefined);
    await pwaManager.clearAccountCaches();
    expect(cacheNames).toEqual([SHELL_CACHE]);
  });

  it('stops waiting for a worker that never replies', async () => {
    vi.useFakeTimers();
    stubServiceWorker(async () => ({ active: { postMessage: vi.fn() } }));
    const clearing = pwaManager.clearAccountCaches();
    await vi.runAllTimersAsync();
    await clearing;
    expect(cacheNames).toEqual([SHELL_CACHE]);
  });

  it('tells the worker first, so it stops accepting late writes before the final delete', async () => {
    const postMessage = vi.fn((_message: unknown, [port]: MessagePort[]) => {
      expect(cacheNames).toContain(ACCOUNT_CACHES[0]);
      port.postMessage({ success: true });
    });
    stubServiceWorker(async () => ({ active: { postMessage } }));
    await pwaManager.clearAccountCaches();
    expect(postMessage).toHaveBeenCalledOnce();
    expect(postMessage.mock.calls[0][0]).toEqual({ type: 'CLEAR_ACCOUNT_DATA' });
    expect(cacheNames).toEqual([SHELL_CACHE]);
  });

  it('a full clear also removes the shell', async () => {
    stubServiceWorker(async () => undefined);
    expect(await pwaManager.clearCache()).toBe(true);
    expect(cacheNames).toEqual([]);
  });
});
