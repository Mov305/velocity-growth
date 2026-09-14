import { fail, ok, type Channel, type EventType, type Norm } from '../types';

const CHANNELS: ReadonlySet<string> = new Set(['email', 'sms']);

export function normalizeChannel(raw: string): Norm<Channel> {
  const v = raw.trim().toLowerCase();
  if (CHANNELS.has(v)) return ok(v as Channel);
  return fail(`channel unrecognised: ${raw.trim()}`);
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'open',
  'click',
  'bounce',
  'complaint',
  'unsubscribe',
  'delivered',
]);

/** The seed log and the provider use different tenses for the same event. One vocabulary here. */
const EVENT_ALIASES: Record<string, EventType> = {
  opened: 'open',
  clicked: 'click',
  bounced: 'bounce',
  complained: 'complaint',
  unsubscribed: 'unsubscribe',
  deliver: 'delivered',
};

export function normalizeEventType(raw: string): Norm<EventType> {
  const v = raw.trim().toLowerCase();
  const mapped = EVENT_ALIASES[v] ?? v;
  if (EVENT_TYPES.has(mapped)) return ok(mapped as EventType);
  return fail(`event_type unrecognised: ${raw.trim()}`);
}
