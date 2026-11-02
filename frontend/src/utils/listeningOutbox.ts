/**
 * Listening events are stored before they are sent and removed only once the server has answered,
 * so an offline play or a failed request is delivered later, with its original time. The event id
 * is what lets the server count a retry once.
 */

import { statsAPI } from '../api/client';
import { dataOwner } from './accountData';
import type { FinishedPlay } from './listeningTracker';
import { offlineStorage } from './offlineStorage';

type AchievementsListener = (achievements: any[]) => void;

interface OutboxEvent extends FinishedPlay {
  event_id: string;
  occurred_at: string;
  owner: string | null;
}

// Answers that will never change on retry, such as a track deleted in the meantime.
const PERMANENT_REJECTIONS = new Set([400, 404]);
const UUID_V4_VERSION_NIBBLE = 0x40;
const UUID_VARIANT_BITS = 0x80;

/** crypto.randomUUID is limited to secure contexts, and this app also runs over plain LAN http. */
function newEventId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | UUID_V4_VERSION_NIBBLE;
  bytes[8] = (bytes[8] & 0x3f) | UUID_VARIANT_BITS;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** True once the server has given its final answer. */
async function deliver(event: OutboxEvent, onAchievements?: AchievementsListener): Promise<boolean> {
  const { owner: _owner, ...body } = event;
  try {
    const response = await statsAPI.recordListening(body);
    if (response.data?.new_achievements?.length) onAchievements?.(response.data.new_achievements);
    return true;
  } catch (error: any) {
    return PERMANENT_REJECTIONS.has(error.response?.status);
  }
}

let flushing = false;
let flushRequested = false;

async function flushOnce(onAchievements?: AchievementsListener): Promise<void> {
  const owner = dataOwner();
  const events: OutboxEvent[] = await offlineStorage.getListeningEvents();
  events.sort((first, second) => first.occurred_at.localeCompare(second.occurred_at));

  for (const event of events) {
    const belongsToAnotherAccount = event.owner !== owner;
    if (!belongsToAnotherAccount && !(await deliver(event, onAchievements))) return;
    await offlineStorage.removeListeningEvent(event.event_id);
  }
}

/** Sends what is waiting, oldest first, and stops at the first failure to keep the order. */
export async function flushListeningEvents(onAchievements?: AchievementsListener): Promise<void> {
  flushRequested = true;
  if (flushing) return;

  flushing = true;
  try {
    while (flushRequested) {
      flushRequested = false;
      await flushOnce(onAchievements);
    }
  } catch (error) {
    console.error('[Listening] Could not deliver waiting events:', error);
  } finally {
    flushing = false;
  }
}

export async function recordListeningEvent(play: FinishedPlay, onAchievements?: AchievementsListener): Promise<void> {
  const event: OutboxEvent = {
    ...play,
    event_id: newEventId(),
    occurred_at: new Date().toISOString(),
    owner: dataOwner(),
  };
  try {
    await offlineStorage.saveListeningEvent(event);
  } catch (error) {
    console.error('[Listening] Could not store event, sending it once:', error);
    await deliver(event, onAchievements);
    return;
  }
  await flushListeningEvents(onAchievements);
}
