/**
 * Export requests ask for a file, so an error body arrives as a Blob rather than parsed JSON.
 * Returns the server's message, or undefined when it did not send one.
 */
export async function exportErrorMessage(error: any): Promise<string | undefined> {
  const data = error?.response?.data;
  if (!(data instanceof Blob)) return data?.error;

  try {
    return JSON.parse(await data.text())?.error;
  } catch {
    return undefined;
  }
}
