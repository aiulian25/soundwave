import { describe, it, expect } from 'vitest';
import { describeRequestError } from './backgroundDownload';

/** Axios rejects with an error carrying the server's body under `response.data`. */
const axiosErrorWith = (data: unknown) => ({ response: { data } });

describe('describeRequestError', () => {
  it('passes a plain string body through unchanged', () => {
    expect(describeRequestError(axiosErrorWith('Invalid URL'))).toBe('Invalid URL');
  });

  it('serializes a DRF validation object instead of rendering [object Object]', () => {
    const message = describeRequestError(axiosErrorWith({ urls: ['This field is required.'] }));
    expect(message).toContain('This field is required.');
    expect(message).not.toContain('[object Object]');
  });

  it('reports the CSRF rejection this fix exists to prevent', () => {
    const message = describeRequestError(axiosErrorWith({ detail: 'CSRF Failed: CSRF token missing.' }));
    expect(message).toContain('CSRF Failed');
  });

  it('falls back to the error itself for a network failure with no response', () => {
    expect(describeRequestError(new Error('Network Error'))).toContain('Network Error');
  });

  it('falls back to the axios message when the response carries no body', () => {
    // A real AxiosError is an Error subclass, so String(error) yields its message.
    const axiosError = Object.assign(new Error('Request failed with status code 500'), {
      response: { data: null },
    });
    expect(describeRequestError(axiosError)).toContain('status code 500');
  });
});
