export type ImportKind = 'contacts' | 'campaigns' | 'events' | 'send_log';

/** One parsed CSV record: canonical column names, raw string values, and where it came from. */
export type RawRecord = {
  line: number;
  values: Record<string, string>;
};

export type Reject = {
  line: number;
  reason: string;
  raw: Record<string, string>;
};

/** Result of normalising one value. A flag marks a kept value the marketer should know about. */
export type Norm<T> = { ok: true; value: T; flag?: string } | { ok: false; reason: string };

export const ok = <T>(value: T, flag?: string): Norm<T> =>
  flag ? { ok: true, value, flag } : { ok: true, value };
export const fail = <T = never>(reason: string): Norm<T> => ({ ok: false, reason });

export type ContactStatus = 'active' | 'unsubscribed' | 'bounced' | 'pending';
export type Channel = 'email' | 'sms';
export type EventType = 'open' | 'click' | 'bounce' | 'complaint' | 'unsubscribe' | 'delivered';

export type CanonicalContact = {
  line: number;
  external_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  city: string | null;
  signup_at: string | null;
  status: ContactStatus;
  consent_marketing: boolean;
  deleted_at: string | null;
  suppressed_until: string | null;
  notes: string | null;
  flags: string[];
};

export type CanonicalCampaign = {
  line: number;
  external_id: string;
  name: string;
  channel: Channel;
  target_country: string | null;
  reported_sent: number | null;
  reported_delivered: number | null;
  reported_bounced: number | null;
  reported_opens: number | null;
  reported_clicks: number | null;
  spend: number | null;
  sent_at: string | null;
  send_local_time: string | null;
  parent_external_id: string | null;
  flags: string[];
};

export type CanonicalEvent = {
  line: number;
  event_id: string;
  contact_id: string;
  campaign_id: string;
  event_type: EventType;
  raw_event_type: string;
  channel: Channel;
  occurred_at: string;
};

export type CanonicalSendLog = {
  line: number;
  batch_key: string;
  campaign_id: string | null;
  campaign_external_id: string;
  queued_at: string;
  recipient_count: number;
  status: string;
  attempt_no: number;
};

export type MapResult<T> = { ok: true; row: T } | { ok: false; reject: Reject };

export type ImportSummary = {
  importId: string;
  brand: string;
  kind: ImportKind;
  file: string;
  encoding: string;
  rowsRead: number;
  rowsUpserted: number;
  rowsRejected: number;
  rowsSkippedDuplicate: number;
  /** Events already in the table from an earlier import; neither upserted nor rejected. */
  rowsAlreadyPresent: number;
  durationMs: number;
};
