// Closing the browser's passkey prompt reports these; the person changed their mind, it isn't a failure.
const DISMISSED_PROMPT_ERRORS = new Set(['NotAllowedError', 'AbortError']);
// The authenticator recognised one of the excluded credentials.
const ALREADY_REGISTERED_ERROR = 'InvalidStateError';

export const isDismissedPasskeyPrompt = (error: unknown) =>
  error instanceof Error && DISMISSED_PROMPT_ERRORS.has(error.name);

/** Translation key for a refused passkey request; the backend's codes have a key each. */
export function passkeyErrorKey(error: any): string {
  if (error instanceof Error && error.name === ALREADY_REGISTERED_ERROR) return 'passkeys.errors.passkey_already_registered';
  const code = error?.response?.data?.code;
  return code ? `passkeys.errors.${code}` : 'passkeys.errors.generic';
}
