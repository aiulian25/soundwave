import { channelAPI, downloadAPI, playlistAPI } from '../api/client';

export type AddMusicRequest = { kind: 'track' | 'playlist' | 'channel'; url: string };
export type AddMusicOutcome = 'downloadStarted' | 'alreadyInLibrary' | 'subscribedToPlaylist' | 'subscribedToChannel';

// The queue row the server answers with when the track is already downloaded.
const FINISHED_STATUS = 'completed';

/** Sends a link to where it belongs: one track to the download queue, the rest to a subscription. */
export async function addMusic(request: AddMusicRequest): Promise<AddMusicOutcome> {
  if (request.kind === 'playlist') {
    await playlistAPI.create({ url: request.url });
    return 'subscribedToPlaylist';
  }
  if (request.kind === 'channel') {
    await channelAPI.subscribe({ url: request.url });
    return 'subscribedToChannel';
  }

  const response = await downloadAPI.add({ urls: [request.url], auto_start: true });
  const isAlreadyDownloaded = response.data?.[0]?.status === FINISHED_STATUS;
  return isAlreadyDownloaded ? 'alreadyInLibrary' : 'downloadStarted';
}

/** The server's own explanation when it gave one in a form meant for people. */
export function serverExplanation(error: unknown): string {
  const data = (error as { response?: { data?: { detail?: unknown; error?: unknown } } })?.response?.data;
  const explanation = data?.detail ?? data?.error;
  return typeof explanation === 'string' ? explanation : '';
}
