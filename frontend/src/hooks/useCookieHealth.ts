import { useEffect, useState } from 'react';
import { downloadAPI } from '../api/client';

/** Whether downloads can still sign in to YouTube with the server's cookies.txt. */
export type CookieHealth = 'working' | 'needs_new_cookies' | 'file_not_accessible' | 'unknown';

/** The server's current answer, or null when it could not be asked (offline, signed out). */
export async function fetchCookieHealth(): Promise<CookieHealth | null> {
  try {
    const response = await downloadAPI.cookieHealth();
    return response.data?.state ?? null;
  } catch {
    return null;
  }
}

/** The answer once, when the page opens; null until it arrives. */
export function useCookieHealth(): CookieHealth | null {
  const [cookieHealth, setCookieHealth] = useState<CookieHealth | null>(null);

  useEffect(() => {
    let isCurrent = true;
    fetchCookieHealth().then((state) => {
      if (isCurrent) setCookieHealth(state);
    });
    return () => {
      isCurrent = false;
    };
  }, []);

  return cookieHealth;
}
