import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Runs the real worker script against fake caches and fetch, so the in-flight race can be
// driven deterministically, which a browser test cannot do.
const WORKER_SOURCE = readFileSync(resolve(__dirname, '../../public/service-worker.js'), 'utf8');
const ORIGIN = 'https://soundwave.test';
const API_CACHE = 'soundwave-api-v3';
const AUDIO_CACHE = 'soundwave-audio-v3';
const SHELL_CACHE = 'soundwave-v20';
const IMAGE_CACHE = 'soundwave-images-v5';
const IMAGE_CACHE_MAX_ENTRIES = Number(WORKER_SOURCE.match(/IMAGE_CACHE_MAX_ENTRIES = (\d+)/)?.[1]);
const DAY_MS = 24 * 60 * 60 * 1000;

function fakeCaches(fetchImplementation: (...args: any[]) => Promise<any>) {
  const stores = new Map<string, Map<string, unknown>>();
  const keyOf = (key: any) => (typeof key === 'string' ? new URL(key, ORIGIN).href : key.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (key: any, value: unknown) => void store.set(keyOf(key), value),
      addAll: async (urls: string[]) => {
        const responses = await Promise.all(urls.map((url) => fetchImplementation(url)));
        if (responses.some((response) => !response.ok)) throw new TypeError('addAll failed');
        urls.forEach((url, index) => store.set(keyOf(url), responses[index]));
      },
      match: async (key: any) => store.get(keyOf(key)),
      delete: async (key: any) => store.delete(keyOf(key)),
      keys: async () => [...store.keys()].map((url) => ({ url })),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (key: any) => [...stores.values()].map((store) => store.get(keyOf(key))).find(Boolean),
    },
  };
}

function okResponse() {
  return { status: 200, ok: true, clone() { return this; } };
}

function loadWorker(fetchImplementation: (...args: any[]) => Promise<any>) {
  const caches = fakeCaches(fetchImplementation);
  const listeners: Record<string, (event: any) => void> = {};
  const self = {
    addEventListener: (type: string, listener: (event: any) => void) => { listeners[type] = listener; },
    location: { origin: ORIGIN },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  new Function('self', 'caches', 'fetch', 'clients', 'console', WORKER_SOURCE)(
    self,
    caches.api,
    fetchImplementation,
    self.clients,
    { log: () => undefined, warn: () => undefined, error: () => undefined },
  );

  const background: Promise<unknown>[] = [];
  const get = (path: string) => {
    let responded: Promise<unknown> | undefined;
    listeners.fetch({
      request: { url: `${ORIGIN}${path}`, method: 'GET', headers: new Map(), destination: '', mode: 'cors' },
      respondWith: (promise: Promise<unknown>) => { responded = promise; },
      waitUntil: (work: Promise<unknown>) => { background.push(work); },
    });
    return responded;
  };
  /** Work a fetch handler asked the browser to keep the worker alive for. */
  const backgroundWork = () => Promise.all(background);
  const message = (data: object) => {
    const pending: Promise<unknown>[] = [];
    const reply = vi.fn();
    listeners.message({ data, ports: [{ postMessage: reply }], waitUntil: (work: Promise<unknown>) => pending.push(work) });
    return Promise.all(pending).then(() => reply);
  };
  const activate = () => {
    const pending: Promise<unknown>[] = [];
    listeners.activate({ waitUntil: (work: Promise<unknown>) => pending.push(work) });
    return Promise.all(pending);
  };
  const install = () => {
    const pending: Promise<unknown>[] = [];
    listeners.install({ waitUntil: (work: Promise<unknown>) => pending.push(work) });
    return Promise.all(pending);
  };
  return { caches, get, backgroundWork, message, activate, install, self };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

function deferred() {
  let release = (_value: unknown) => undefined as void;
  const promise = new Promise((resolvePromise) => { release = resolvePromise; });
  return { promise, release };
}

describe('service worker account isolation', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => okResponse());
  });

  it('keeps offline-useful API responses', async () => {
    const worker = loadWorker(fetchMock);
    await worker.get('/api/audio/list/');
    await worker.get('/api/user/account/');
    await worker.get('/api/v1/playlist/');
    await settle();
    expect([...worker.caches.stores.get(API_CACHE)!.keys()]).toEqual([
      `${ORIGIN}/api/audio/list/`,
      `${ORIGIN}/api/user/account/`,
      `${ORIGIN}/api/v1/playlist/`,
    ]);
  });

  it('never intercepts sensitive API responses', async () => {
    const worker = loadWorker(fetchMock);
    const paths = [
      '/api/export-jobs/00000000-0000-0000-0000-000000000000/download/',
      '/api/user/api-keys/',
      '/api/user/2fa/download-codes/',
      '/api/user/passkeys/',
      '/api/user/admin/users/',
      '/api/download/',
      '/api/task/',
    ];
    paths.forEach((path) => expect(worker.get(path)).toBeUndefined());
    await settle();
    expect(worker.caches.stores.get(API_CACHE)).toBeUndefined();
  });

  it('a response in flight during a clear is not written into the emptied cache', async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const worker = loadWorker(fetchMock);

    const inFlight = worker.get('/api/audio/list/');
    const reply = await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    expect(reply).toHaveBeenCalledWith({ success: true });

    pending.release(okResponse());
    await inFlight;
    await settle();
    expect(worker.caches.stores.get(API_CACHE)?.size ?? 0).toBe(0);
  });

  it('a download in flight during a clear is not pinned', async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const worker = loadWorker(fetchMock);

    const inFlight = worker.get('/api/audio/abc/download/');
    await settle();
    await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    pending.release(okResponse());
    await inFlight;
    await settle();
    expect(worker.caches.stores.get(AUDIO_CACHE)?.size ?? 0).toBe(0);
  });

  it('a pin in flight during a clear reports failure', async () => {
    const pending = deferred();
    fetchMock.mockReturnValue(pending.promise);
    const worker = loadWorker(fetchMock);

    const pinning = worker.message({ type: 'CACHE_AUDIO', url: '/api/audio/abc/download/' });
    await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    pending.release(okResponse());
    const reply = await pinning;
    expect(reply).toHaveBeenCalledWith({ success: false });
  });

  it('a playlist save stops when caches are cleared part way through', async () => {
    const worker = loadWorker(fetchMock);
    const saving = worker.message({
      type: 'CACHE_PLAYLIST',
      playlistId: 'PL1',
      audioUrls: ['/api/audio/one/download/', '/api/audio/two/download/'],
    });
    await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    const reply = await saving;
    expect(worker.caches.stores.get(AUDIO_CACHE)?.size ?? 0).toBe(0);
    expect(reply).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'complete', success: false }));
    const requested = fetchMock.mock.calls.map(([url]) => url);
    expect(requested).not.toContain('/api/audio/one/download/');
  });

  it('requests started after a clear are cached normally', async () => {
    const worker = loadWorker(fetchMock);
    await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    await worker.get('/api/audio/list/');
    await settle();
    expect(worker.caches.stores.get(API_CACHE)!.size).toBe(1);
  });

  it('clearing account data keeps the public shell', async () => {
    const worker = loadWorker(fetchMock);
    await worker.caches.api.open(SHELL_CACHE);
    await worker.caches.api.open(API_CACHE);
    await worker.caches.api.open(AUDIO_CACHE);
    await worker.message({ type: 'CLEAR_ACCOUNT_DATA' });
    expect([...worker.caches.stores.keys()]).toEqual([SHELL_CACHE]);
  });

  it('activation prunes sensitive entries an older version stored, and keeps the rest', async () => {
    const worker = loadWorker(fetchMock);
    const cache = await worker.caches.api.open(API_CACHE);
    await cache.put('/api/user/api-keys/', okResponse());
    await cache.put('/api/user/2fa/status/', okResponse());
    await cache.put('/api/audio/list/?page=1', okResponse());
    await cache.put('/api/channel/?page=1', okResponse());
    await cache.put('/api/playlist/PL1/?include_items=true', okResponse());
    await worker.activate();
    expect([...worker.caches.stores.get(API_CACHE)!.keys()]).toEqual([
      `${ORIGIN}/api/playlist/PL1/?include_items=true`,
    ]);
  });
});

describe('service worker offline playlists', () => {
  const X = '/api/audio/X/download/';
  const Y = '/api/audio/Y/download/';
  const failedResponse = () => ({ status: 500, ok: false, clone() { return this; } });
  const lastReply = (reply: ReturnType<typeof vi.fn>) => reply.mock.calls[reply.mock.calls.length - 1][0];
  const fetchesFor = (fetchMock: ReturnType<typeof vi.fn>, url: string) =>
    fetchMock.mock.calls.filter(([requested]) => requested === url).length;
  const fill = (audioUrls: string[]) => ({ type: 'CACHE_PLAYLIST', playlistId: 'A', audioUrls });

  it('reports the tracks that arrived, not the ones attempted', async () => {
    const fetchMock = vi.fn(async (url: string) => (url === Y ? failedResponse() : okResponse()));
    const worker = loadWorker(fetchMock);

    const reply = await worker.message(fill([X, Y]));

    expect(lastReply(reply)).toMatchObject({ type: 'complete', success: true, cached: 1, failed: 1, canceled: false });
    expect([...worker.caches.stores.get(AUDIO_CACHE)!.keys()]).toEqual([`${ORIGIN}${X}`]);
  });

  it('counts a storage failure as a failed track', async () => {
    const worker = loadWorker(vi.fn(async () => okResponse()));
    const realOpen = worker.caches.api.open;
    worker.caches.api.open = async (name: string) => {
      const cache = await realOpen(name);
      if (name !== AUDIO_CACHE) return cache;
      return { ...cache, put: async () => { throw new Error('QuotaExceededError'); } };
    };

    const reply = await worker.message(fill([X]));

    expect(lastReply(reply)).toMatchObject({ success: false, cached: 0, failed: 1 });
  });

  it('saving again only fetches what is still missing', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const worker = loadWorker(fetchMock);
    await worker.message(fill([X]));

    const reply = await worker.message(fill([X, Y]));

    expect(fetchesFor(fetchMock, X)).toBe(1);
    expect(fetchesFor(fetchMock, Y)).toBe(1);
    expect(lastReply(reply)).toMatchObject({ cached: 2, failed: 0 });
  });

  it('a canceled fill stops, stores nothing further and says so', async () => {
    const firstFetch = deferred();
    const fetchMock = vi.fn((url: string) => (url === X ? firstFetch.promise : Promise.resolve(okResponse())));
    const worker = loadWorker(fetchMock);

    const filling = worker.message(fill([X, Y]));
    await settle();
    const acknowledgement = await worker.message({ type: 'CANCEL_PLAYLIST_CACHE', playlistId: 'A' });
    firstFetch.release(okResponse());
    const reply = await filling;

    expect(lastReply(acknowledgement)).toEqual({ success: true });
    expect(lastReply(reply)).toMatchObject({ type: 'complete', canceled: true, cached: 0 });
    expect(fetchesFor(fetchMock, Y)).toBe(0);
    expect(worker.caches.stores.get(AUDIO_CACHE)?.size ?? 0).toBe(0);
  });

  it('a cancel arriving while a track is being stored stops before the next one', async () => {
    const storing = deferred();
    const fetchMock = vi.fn(async () => okResponse());
    const worker = loadWorker(fetchMock);
    const realOpen = worker.caches.api.open;
    worker.caches.api.open = async (name: string) => {
      const cache = await realOpen(name);
      if (name !== AUDIO_CACHE) return cache;
      return { ...cache, put: async (key: any, value: unknown) => { await storing.promise; await cache.put(key, value); } };
    };

    const filling = worker.message(fill([X, Y]));
    await settle();
    await worker.message({ type: 'CANCEL_PLAYLIST_CACHE', playlistId: 'A' });
    storing.release(undefined);
    const reply = await filling;

    expect(fetchesFor(fetchMock, Y)).toBe(0);
    expect(lastReply(reply)).toMatchObject({ canceled: true, cached: 1 });
  });

  it('canceling one playlist leaves another fill running', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const worker = loadWorker(fetchMock);

    const filling = worker.message(fill([X]));
    await worker.message({ type: 'CANCEL_PLAYLIST_CACHE', playlistId: 'B' });

    expect(lastReply(await filling)).toMatchObject({ canceled: false, cached: 1 });
  });

  it('removing a playlist stops its fill', async () => {
    const firstFetch = deferred();
    const fetchMock = vi.fn((url: string) => (url === X ? firstFetch.promise : Promise.resolve(okResponse())));
    const worker = loadWorker(fetchMock);

    const filling = worker.message(fill([X, Y]));
    await settle();
    await worker.message({ type: 'REMOVE_PLAYLIST_CACHE', playlistId: 'A', audioUrls: [X, Y] });
    firstFetch.release(okResponse());
    await filling;

    expect(worker.caches.stores.get(AUDIO_CACHE)?.size ?? 0).toBe(0);
  });

  it('removal deletes the metadata under its real key and only the audio it was given', async () => {
    const worker = loadWorker(vi.fn(async () => okResponse()));
    await worker.message(fill([X, Y]));
    expect(worker.caches.stores.get(API_CACHE)!.has(`${ORIGIN}/api/playlist/A/`)).toBe(true);

    const reply = await worker.message({ type: 'REMOVE_PLAYLIST_CACHE', playlistId: 'A', audioUrls: [X] });

    expect(lastReply(reply)).toEqual({ success: true });
    expect(worker.caches.stores.get(API_CACHE)!.size).toBe(0);
    expect([...worker.caches.stores.get(AUDIO_CACHE)!.keys()]).toEqual([`${ORIGIN}${Y}`]);
  });
});

describe('service worker install', () => {
  const ENTRY_SCRIPT = '/assets/index-abc.js';
  const INDEX_HTML = `<script type="module" src="${ENTRY_SCRIPT}"></script><link href="/assets/index-abc.css">`;
  const OLD_INDEX = { old: true };
  const serving = (failingPath?: string) => vi.fn(async (url: string) => ({
    ...okResponse(),
    ok: url !== failingPath,
    text: async () => INDEX_HTML,
  }));
  const shellEntry = (worker: ReturnType<typeof loadWorker>, path: string) =>
    worker.caches.stores.get(SHELL_CACHE)?.get(`${ORIGIN}${path}`);

  it('stores the shell, the assets index.html names and the translations, then activates', async () => {
    const worker = loadWorker(serving());

    await worker.install();

    for (const path of ['/index.html', '/offline.html', ENTRY_SCRIPT, '/assets/index-abc.css', '/locales/ro/translation.json']) {
      expect(shellEntry(worker, path), path).toBeTruthy();
    }
    expect(worker.self.skipWaiting).toHaveBeenCalled();
  });

  it('keeps the working version when a new asset cannot be fetched', async () => {
    const worker = loadWorker(serving(ENTRY_SCRIPT));
    const shell = await worker.caches.api.open(SHELL_CACHE);
    await shell.put('/index.html', OLD_INDEX);

    await expect(worker.install()).rejects.toThrow();

    expect(shellEntry(worker, '/index.html')).toBe(OLD_INDEX);
    expect(worker.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('answers a new release\'s translation request from the installed copy when offline', async () => {
    const installing = serving();
    const worker = loadWorker(installing);
    await worker.install();

    installing.mockRejectedValue(new TypeError('offline'));
    const response = await worker.get('/locales/ro/translation.json?v=9.9.9');

    expect(response).toBe(shellEntry(worker, '/locales/ro/translation.json'));
  });
});

describe('service worker artwork', () => {
  const imageFetchedAt = (when: number) => ({
    status: 200, ok: true, headers: new Map([['date', new Date(when).toUTCString()]]), clone() { return this; },
  });
  const keptImages = (worker: ReturnType<typeof loadWorker>) => [...(worker.caches.stores.get(IMAGE_CACHE)?.keys() ?? [])];

  it('one track keeps one image, however many tickets ask for it', async () => {
    const fetchMock = vi.fn(async () => imageFetchedAt(Date.now()));
    const worker = loadWorker(fetchMock);

    await worker.get('/api/audio/A/artwork/?t=ticket-one');
    await worker.get('/api/audio/A/artwork/?t=ticket-two');
    await worker.get('/api/audio/A/artwork/');

    expect(keptImages(worker)).toEqual([`${ORIGIN}/api/audio/A/artwork/`]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('playlist and channel pictures are kept the same way', async () => {
    const worker = loadWorker(vi.fn(async () => imageFetchedAt(Date.now())));

    await worker.get('/api/playlist/PL1/artwork/');
    await worker.get('/api/v1/channel/UC1/artwork/');

    expect(keptImages(worker)).toEqual([`${ORIGIN}/api/playlist/PL1/artwork/`, `${ORIGIN}/api/v1/channel/UC1/artwork/`]);
    expect(worker.caches.stores.get(API_CACHE)).toBeUndefined();
  });

  it('the image cache drops its oldest entries instead of growing without limit', async () => {
    const worker = loadWorker(vi.fn(async () => imageFetchedAt(Date.now())));
    const extra = 3;

    for (let track = 0; track < IMAGE_CACHE_MAX_ENTRIES + extra; track += 1) {
      await worker.get(`/api/audio/T${track}/artwork/`);
    }

    const kept = keptImages(worker);
    expect(kept).toHaveLength(IMAGE_CACHE_MAX_ENTRIES);
    expect(kept[0]).toBe(`${ORIGIN}/api/audio/T${extra}/artwork/`);
  });

  it('a copy over a day old is served at once and replaced in the background', async () => {
    const replacement = imageFetchedAt(Date.now());
    const fetchMock = vi.fn(async () => replacement);
    const worker = loadWorker(fetchMock);
    const oldCopy = imageFetchedAt(Date.now() - 2 * DAY_MS);
    await (await worker.caches.api.open(IMAGE_CACHE)).put('/api/audio/A/artwork/', oldCopy);

    const served = await worker.get('/api/audio/A/artwork/');
    await worker.backgroundWork();

    expect(served).toBe(oldCopy);
    expect(worker.caches.stores.get(IMAGE_CACHE)!.get(`${ORIGIN}/api/audio/A/artwork/`)).toBe(replacement);
  });

  it('a recent copy is served without asking the server again', async () => {
    const fetchMock = vi.fn(async () => imageFetchedAt(Date.now()));
    const worker = loadWorker(fetchMock);
    const recentCopy = imageFetchedAt(Date.now() - DAY_MS / 2);
    await (await worker.caches.api.open(IMAGE_CACHE)).put('/api/audio/A/artwork/', recentCopy);

    const served = await worker.get('/api/audio/A/artwork/');
    await worker.backgroundWork();

    expect(served).toBe(recentCopy);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an old copy survives when the refresh fails, and nothing is kept for a missing image', async () => {
    const notFound = { status: 404, ok: false, clone() { return this; } };
    const worker = loadWorker(vi.fn(async () => notFound));
    const oldCopy = imageFetchedAt(Date.now() - 2 * DAY_MS);
    await (await worker.caches.api.open(IMAGE_CACHE)).put('/api/audio/A/artwork/', oldCopy);

    await worker.get('/api/audio/A/artwork/');
    const missing = await worker.get('/api/audio/B/artwork/');
    await worker.backgroundWork();

    expect(missing).toBe(notFound);
    expect(keptImages(worker)).toEqual([`${ORIGIN}/api/audio/A/artwork/`]);
    expect(worker.caches.stores.get(IMAGE_CACHE)!.get(`${ORIGIN}/api/audio/A/artwork/`)).toBe(oldCopy);
  });
});

