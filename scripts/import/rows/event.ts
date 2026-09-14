import { normalizeDate } from '../normalize/date';
import { normalizeChannel, normalizeEventType } from '../normalize/enum';
import type { CanonicalEvent, MapResult, RawRecord } from '../types';

export type EventContext = {
  /** external contact id to contacts.id, for this brand only */
  contactIds: ReadonlyMap<string, string>;
  /** external campaign id to campaigns.id, for this brand only */
  campaignIds: ReadonlyMap<string, string>;
};

export function mapEvent(rec: RawRecord, ctx: EventContext): MapResult<CanonicalEvent> {
  const v = rec.values;
  const reject = (reason: string): MapResult<CanonicalEvent> => ({
    ok: false,
    reject: { line: rec.line, reason, raw: v },
  });

  const eventId = (v.event_id ?? '').trim();
  if (eventId === '') return reject('event_id missing');

  const contactExt = (v.external_contact_id ?? '').trim();
  const contactId = ctx.contactIds.get(contactExt);
  if (!contactId) return reject(`unknown contact ${contactExt}`);

  const campaignExt = (v.campaign_external_id ?? '').trim();
  const campaignId = ctx.campaignIds.get(campaignExt);
  if (!campaignId) return reject(`unknown campaign ${campaignExt}`);

  const type = normalizeEventType(v.event_type ?? '');
  if (!type.ok) return reject(type.reason);

  const channel = normalizeChannel(v.channel ?? '');
  if (!channel.ok) return reject(channel.reason);

  const occurred = normalizeDate(v.occurred_at_utc ?? '');
  if (!occurred.ok) return reject(`occurred_at ${occurred.reason}`);
  if (occurred.value === null) return reject('occurred_at unparseable: ');

  return {
    ok: true,
    row: {
      line: rec.line,
      event_id: eventId,
      contact_id: contactId,
      campaign_id: campaignId,
      event_type: type.value,
      raw_event_type: (v.event_type ?? '').trim(),
      channel: channel.value,
      occurred_at: occurred.value,
    },
  };
}
