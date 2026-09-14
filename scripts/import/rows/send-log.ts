import { normalizeDate } from '../normalize/date';
import { normalizeInteger } from '../normalize/number';
import {
  fail,
  ok,
  type CanonicalSendLog,
  type MapResult,
  type Norm,
  type RawRecord,
} from '../types';

export type SendLogContext = {
  campaignIds: ReadonlyMap<string, string>;
  /** 1-based occurrence of this batch_key within the file; a retried batch appears more than once. */
  attemptNo: number;
};

/** Mirrors the check constraint on send_log_entries.status. */
const STATUSES: ReadonlySet<string> = new Set(['sent', 'queued', 'failed', 'cancelled', 'partial']);

export function normalizeSendStatus(raw: string): Norm<string> {
  const v = raw.trim().toLowerCase();
  if (v === '') return fail('status missing');
  if (STATUSES.has(v)) return ok(v);
  return fail(`status unrecognised: ${raw.trim()}`);
}

export function mapSendLog(rec: RawRecord, ctx: SendLogContext): MapResult<CanonicalSendLog> {
  const v = rec.values;
  const reject = (reason: string): MapResult<CanonicalSendLog> => ({
    ok: false,
    reject: { line: rec.line, reason, raw: v },
  });

  const batchKey = (v.batch_key ?? '').trim();
  if (batchKey === '') return reject('batch_key missing');

  const campaignExt = (v.campaign_external_id ?? '').trim();

  const queued = normalizeDate(v.queued_at_utc ?? '');
  if (!queued.ok) return reject(`queued_at ${queued.reason}`);
  if (queued.value === null) return reject('queued_at unparseable: ');

  const count = normalizeInteger(v.recipient_count ?? '');
  if (!count.ok) return reject(`recipient_count ${count.reason}`);
  if (count.value === null) return reject('recipient_count not a whole number: ');

  const status = normalizeSendStatus(v.status ?? '');
  if (!status.ok) return reject(status.reason);

  return {
    ok: true,
    row: {
      line: rec.line,
      batch_key: batchKey,
      // The log is historical; a campaign we no longer know is kept, unlinked.
      campaign_id: ctx.campaignIds.get(campaignExt) ?? null,
      campaign_external_id: campaignExt,
      queued_at: queued.value,
      recipient_count: count.value,
      status: status.value,
      attempt_no: ctx.attemptNo,
    },
  };
}
