import type { AxiosResponse } from 'axios';
import { audioAPI, playlistAPI, channelAPI, smartPlaylistAPI } from '../api/client';

const FIRST_PAGE = 1;
const SMART_PLAYLIST_PAGE_SIZE = 100;

type RequestConfig = { signal?: AbortSignal };
type ListRequest = (params: Record<string, any>, config: RequestConfig) => Promise<AxiosResponse<any>>;

export class MalformedPaginationError extends Error {
  constructor(reason: string) {
    super(`Malformed pagination response: ${reason}`);
    this.name = 'MalformedPaginationError';
  }
}

/** Follows the server's `next` to its end; anything that could not terminate is an error. */
async function fetchAllPages(request: ListRequest, params: Record<string, any>, signal?: AbortSignal): Promise<any[]> {
  const allItems: any[] = [];
  let page: number | null = FIRST_PAGE;

  while (page !== null) {
    const response: AxiosResponse<any> = await request({ ...params, page }, { signal });
    const items = response.data?.data;
    const next = response.data?.next;

    if (!Array.isArray(items)) throw new MalformedPaginationError('no data array');
    if (next !== null && (!Number.isInteger(next) || next <= page)) {
      throw new MalformedPaginationError(`next page ${next} does not advance past ${page}`);
    }
    if (next !== null && items.length === 0) throw new MalformedPaginationError('an empty page claims more');

    allItems.push(...items);
    page = next;
  }

  return allItems;
}

export function fetchAllAudio(params: Record<string, any> = {}, signal?: AbortSignal): Promise<any[]> {
  return fetchAllPages(audioAPI.list, params, signal);
}

export function fetchAllChannels(params: Record<string, any> = {}, signal?: AbortSignal): Promise<any[]> {
  return fetchAllPages(channelAPI.list, params, signal);
}

/** Sends back the seed the first page chose, so a random playlist is one order from end to end. */
export async function fetchSmartPlaylistTracks(playlistId: number, signal?: AbortSignal) {
  let seed: number | null = null;
  let playlist: any = null;
  const tracks = await fetchAllPages(async (params, config) => {
    const seedParam = seed === null ? {} : { seed };
    const response = await smartPlaylistAPI.getTracks(playlistId, { ...params, ...seedParam }, config);
    seed = response.data?.seed ?? null;
    playlist = response.data?.playlist;
    return response;
  }, { page_size: SMART_PLAYLIST_PAGE_SIZE }, signal);
  return { playlist, tracks };
}

/** The playlist list is not paginated: one response holds every playlist. */
export async function fetchAllPlaylists(params: Record<string, any> = {}, signal?: AbortSignal): Promise<any[]> {
  const response = await playlistAPI.list(params, { signal });
  const items = response.data?.data;
  if (!Array.isArray(items)) throw new MalformedPaginationError('no data array');
  return items;
}
