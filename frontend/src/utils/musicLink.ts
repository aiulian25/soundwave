// What a pasted or shared link asks for. The server has the final say; this only picks which
// request to send, so the host and path rules mirror backend/download/claims.py.

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const PLAYLIST_PATH_PREFIX = '/playlist';
const CHANNEL_PATH_PREFIXES = ['/channel/', '/c/', '/user/', '/@'];
const WATCH_PATH = '/watch';
// "Mix" lists are generated per viewer and never end, so there is nothing to subscribe to.
const GENERATED_MIX_PREFIX = 'RD';
const LINK_PATTERN = /https?:\/\/[^\s<>"']+/i;

export type MusicLink =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'track'; url: string }
  | { kind: 'playlist'; url: string }
  | { kind: 'channel'; url: string }
  | { kind: 'trackInPlaylist'; trackUrl: string; playlistUrl: string };

/** The first web link in a piece of text; apps that share a video often send "Title https://…". */
export function firstLinkIn(text: string): string {
  return text.match(LINK_PATTERN)?.[0] ?? '';
}

function parsedLink(text: string): URL | null {
  try {
    return new URL(firstLinkIn(text));
  } catch {
    return null;
  }
}

export function classifyMusicLink(text: string): MusicLink {
  if (!text.trim()) return { kind: 'empty' };

  const link = parsedLink(text);
  if (!link) return { kind: 'invalid' };

  const isYouTube = YOUTUBE_HOSTS.has(link.hostname.toLowerCase());
  if (!isYouTube) return { kind: 'track', url: link.href };
  if (link.pathname.startsWith(PLAYLIST_PATH_PREFIX)) return { kind: 'playlist', url: link.href };
  if (CHANNEL_PATH_PREFIXES.some((prefix) => link.pathname.startsWith(prefix))) return { kind: 'channel', url: link.href };

  const videoId = link.searchParams.get('v');
  const listId = link.searchParams.get('list');
  const isVideoInRealPlaylist =
    link.pathname === WATCH_PATH && Boolean(videoId) && Boolean(listId) && !listId!.startsWith(GENERATED_MIX_PREFIX);
  if (!isVideoInRealPlaylist) return { kind: 'track', url: link.href };

  return {
    kind: 'trackInPlaylist',
    trackUrl: `https://www.youtube.com/watch?v=${videoId}`,
    playlistUrl: `https://www.youtube.com/playlist?list=${listId}`,
  };
}
