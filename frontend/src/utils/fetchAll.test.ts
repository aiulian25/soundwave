import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ audio: vi.fn(), channel: vi.fn(), playlist: vi.fn() }));

vi.mock('../api/client', () => ({
  audioAPI: { list: api.audio },
  channelAPI: { list: api.channel },
  playlistAPI: { list: api.playlist },
}));

import { fetchAllAudio, fetchAllChannels, fetchAllPlaylists, MalformedPaginationError } from './fetchAll';

const PAGE_SIZE = 50;

/** Behaves like the real endpoint for a collection of `total` rows. */
function serverWith(total: number) {
  const rows = Array.from({ length: total }, (_, index) => ({ id: index }));
  return async ({ page }: { page: number }) => {
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return { data: { data: rows.slice(start, end), next: end < total ? page + 1 : null } };
  };
}

const respond = (...bodies: unknown[]) => {
  api.channel.mockReset();
  bodies.forEach((body) => api.channel.mockResolvedValueOnce({ data: body }));
};

describe('fetching every page', () => {
  beforeEach(() => {
    api.audio.mockReset();
    api.channel.mockReset();
    api.playlist.mockReset();
  });

  it.each([
    [0, 1],
    [49, 1],
    [50, 1],
    [51, 2],
    [100, 2],
    [101, 3],
  ])('%i rows arrive exactly once, in %i request(s)', async (total, requests) => {
    api.channel.mockImplementation(serverWith(total));
    const rows = await fetchAllChannels();
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: total }, (_, index) => index));
    expect(api.channel).toHaveBeenCalledTimes(requests);
  });

  it('audio follows the same traversal and keeps caller filters', async () => {
    api.audio.mockImplementation(serverWith(60));
    expect(await fetchAllAudio({ favorites: true })).toHaveLength(60);
    expect(api.audio.mock.calls.map(([params]) => params)).toEqual([
      { favorites: true, page: 1 },
      { favorites: true, page: 2 },
    ]);
  });

  it('a server that ignores `page` and repeats itself fails instead of looping', async () => {
    // Bounded, so a client that does loop fails this test instead of hanging the suite.
    const repeating = { data: { data: [{ id: 1 }], next: 1 } };
    api.channel
      .mockResolvedValueOnce(repeating)
      .mockResolvedValueOnce(repeating)
      .mockRejectedValue(new Error('kept requesting the same page'));
    await expect(fetchAllChannels()).rejects.toBeInstanceOf(MalformedPaginationError);
    expect(api.channel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the old shape with no next', { data: [{ id: 1 }], paginate: true }],
    ['no data array', { next: null }],
    ['a text next', { data: [], next: '2' }],
    ['next going backwards', { data: [{ id: 1 }], next: 0 }],
    ['an empty page claiming more', { data: [], next: 2 }],
  ])('%s fails visibly', async (_label, body) => {
    respond(body);
    await expect(fetchAllChannels()).rejects.toBeInstanceOf(MalformedPaginationError);
  });

  it('a failure on a later page is not swallowed into a partial list', async () => {
    api.channel.mockResolvedValueOnce({ data: { data: [{ id: 1 }], next: 2 } });
    api.channel.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchAllChannels()).rejects.toThrow('network down');
  });

  it('passes the abort signal to every request', async () => {
    api.channel.mockImplementation(serverWith(60));
    const { signal } = new AbortController();
    await fetchAllChannels({}, signal);
    expect(api.channel.mock.calls.map(([, config]) => config.signal)).toEqual([signal, signal]);
  });

  it('stops requesting as soon as a request is aborted', async () => {
    api.channel.mockResolvedValueOnce({ data: { data: [{ id: 1 }], next: 2 } });
    api.channel.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    await expect(fetchAllChannels()).rejects.toThrow('Aborted');
    expect(api.channel).toHaveBeenCalledTimes(2);
  });

  it('playlists come from one response, and a wrong shape fails', async () => {
    api.playlist.mockResolvedValueOnce({ data: { data: [{ id: 1 }, { id: 2 }] } });
    expect(await fetchAllPlaylists()).toHaveLength(2);
    expect(api.playlist).toHaveBeenCalledTimes(1);

    api.playlist.mockResolvedValueOnce({ data: { detail: 'nope' } });
    await expect(fetchAllPlaylists()).rejects.toBeInstanceOf(MalformedPaginationError);
  });
});
