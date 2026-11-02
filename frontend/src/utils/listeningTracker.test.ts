import { describe, expect, it } from 'vitest';
import { ListeningTracker, MIN_RECORDED_SECONDS } from './listeningTracker';

function playFor(tracker: ListeningTracker, seconds: number, from = 0) {
  for (let position = from; position <= from + seconds; position += 0.25) tracker.observePosition(position);
}

describe('ListeningTracker', () => {
  it('a partial listen is recorded with what was heard', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 20);

    expect(tracker.finish(false)).toEqual({ youtube_id: 'X', duration_listened: 20, completed: false });
  });

  it('a very short listen is not a play', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, MIN_RECORDED_SECONDS - 1);

    expect(tracker.finish(false)).toBeNull();
  });

  it('buffering adds nothing, however long it lasts', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 5);
    for (let tick = 0; tick < 1000; tick += 1) tracker.observePosition(5);

    expect(tracker.finish(false)).toBeNull();
  });

  it('seek distance adds nothing, forward or back', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 6);
    tracker.observePosition(150);
    playFor(tracker, 3, 150);
    tracker.observePosition(0);
    playFor(tracker, 3);

    expect(tracker.finish(false)?.duration_listened).toBe(12);
  });

  it('a small step back takes nothing away', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 12);
    tracker.observePosition(11);

    expect(tracker.finish(false)?.duration_listened).toBe(12);
  });

  it('a short seek reported by the element adds nothing', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 9);
    tracker.observeSeek(10.5);
    tracker.observePosition(10.5);

    expect(tracker.finish(false)).toBeNull();
  });

  it('finishing twice records once', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 20);

    expect(tracker.finish(true)).not.toBeNull();
    expect(tracker.finish(false)).toBeNull();
  });

  it('each begin is a new play, so repeat-one gives separate plays', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 20);
    expect(tracker.finish(true)?.duration_listened).toBe(20);

    tracker.begin('X');
    playFor(tracker, 20);
    expect(tracker.finish(true)?.duration_listened).toBe(20);
  });

  it('the jump back to the start of a new play adds nothing', () => {
    const tracker = new ListeningTracker();
    tracker.begin('X');
    playFor(tracker, 20, 100);
    tracker.finish(true);
    tracker.begin('X');
    tracker.observePosition(0);

    expect(tracker.finish(false)).toBeNull();
  });
});
