import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakes = vi.hoisted(() => ({
  stored: new Map<string, any>(),
  send: vi.fn(),
  owner: '7' as string | null,
  saveFails: false,
}));

vi.mock('../api/client', () => ({ statsAPI: { recordListening: fakes.send } }));
vi.mock('./accountData', () => ({ dataOwner: () => fakes.owner }));
vi.mock('./offlineStorage', () => ({
  offlineStorage: {
    saveListeningEvent: async (event: any) => {
      if (fakes.saveFails) throw new Error('Over quota');
      fakes.stored.set(event.event_id, event);
    },
    getListeningEvents: async () => [...fakes.stored.values()],
    removeListeningEvent: async (id: string) => void fakes.stored.delete(id),
  },
}));

import { flushListeningEvents, recordListeningEvent } from './listeningOutbox';

const PLAY = { youtube_id: 'X', duration_listened: 20, completed: false };
const networkDown = () => Object.assign(new Error('Network Error'), { response: undefined });
const answered = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const sentBodies = () => fakes.send.mock.calls.map(([body]) => body);
const waiting = (id: string, occurredAt: string, owner: string | null = '7') => {
  fakes.stored.set(id, { ...PLAY, event_id: id, occurred_at: occurredAt, owner });
};

beforeEach(() => {
  fakes.stored.clear();
  fakes.send.mockReset();
  fakes.send.mockResolvedValue({ data: {} });
  fakes.owner = '7';
  fakes.saveFails = false;
});

describe('listening outbox', () => {
  it('removes an event once the server has it', async () => {
    await recordListeningEvent(PLAY);

    expect(fakes.send).toHaveBeenCalledOnce();
    expect(sentBodies()[0]).toMatchObject(PLAY);
    expect(sentBodies()[0].event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sentBodies()[0]).not.toHaveProperty('owner');
    expect(fakes.stored.size).toBe(0);
  });

  it('gives each play its own identity', async () => {
    await recordListeningEvent(PLAY);
    await recordListeningEvent(PLAY);

    expect(sentBodies()[0].event_id).not.toBe(sentBodies()[1].event_id);
  });

  it.each([
    ['the network is down', networkDown()],
    ['the server fails', answered(503)],
    ['the session expired', answered(401)],
    ['the server is busy', answered(429)],
  ])('keeps the event when %s, and a retry repeats its identity and time', async (_case, failure) => {
    fakes.send.mockRejectedValueOnce(failure);
    await recordListeningEvent(PLAY);
    expect(fakes.stored.size).toBe(1);
    const first = sentBodies()[0];

    await flushListeningEvents();

    expect(sentBodies()[1].event_id).toBe(first.event_id);
    expect(sentBodies()[1].occurred_at).toBe(first.occurred_at);
    expect(fakes.stored.size).toBe(0);
  });

  it.each([400, 404])('drops an event the server refuses for good (%i)', async (status) => {
    fakes.send.mockRejectedValueOnce(answered(status));

    await recordListeningEvent(PLAY);

    expect(fakes.stored.size).toBe(0);
  });

  it('sends oldest first and stops at the first failure', async () => {
    waiting('newer', '2026-01-02T00:00:00Z');
    waiting('older', '2026-01-01T00:00:00Z');
    fakes.send.mockRejectedValueOnce(networkDown());

    await flushListeningEvents();

    expect(sentBodies().map((body) => body.event_id)).toEqual(['older']);
    expect(fakes.stored.size).toBe(2);
  });

  it('never sends another account\'s event, and removes it', async () => {
    waiting('theirs', '2026-01-01T00:00:00Z', '99');

    await flushListeningEvents();

    expect(fakes.send).not.toHaveBeenCalled();
    expect(fakes.stored.size).toBe(0);
  });

  it('a second flush during a delivery does not send twice but does pick up new events', async () => {
    waiting('first', '2026-01-01T00:00:00Z');
    let release: (value: unknown) => void = () => undefined;
    fakes.send.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const running = flushListeningEvents();
    await new Promise((done) => setTimeout(done, 0));
    waiting('second', '2026-01-02T00:00:00Z');
    await flushListeningEvents();
    release({ data: {} });
    await running;

    expect(sentBodies().map((body) => body.event_id)).toEqual(['first', 'second']);
  });

  it('still tries once when the event cannot be stored', async () => {
    fakes.saveFails = true;

    await recordListeningEvent(PLAY);

    expect(fakes.send).toHaveBeenCalledOnce();
  });

  it('passes new achievements on', async () => {
    const listener = vi.fn();
    fakes.send.mockResolvedValueOnce({ data: { new_achievements: [{ id: 1 }] } });

    await recordListeningEvent(PLAY, listener);

    expect(listener).toHaveBeenCalledWith([{ id: 1 }]);
  });
});
