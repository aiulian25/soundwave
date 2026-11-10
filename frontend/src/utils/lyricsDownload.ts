import api from '../api/client';

const FILENAME_IN_HEADER = /filename="(.+)"/;

/** Fetches a track's lyrics as a file and hands it to the browser to save. */
export async function saveLyricsFile(youtubeId: string, format: 'lrc' | 'txt'): Promise<void> {
  // `type`, not `format`: the latter collides with the API framework's content negotiation.
  const response = await api.get(`/audio/${youtubeId}/lyrics/download/?type=${format}`, { responseType: 'blob' });
  const filename = response.headers['content-disposition']?.match(FILENAME_IN_HEADER)?.[1] ?? `lyrics.${format}`;

  const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
