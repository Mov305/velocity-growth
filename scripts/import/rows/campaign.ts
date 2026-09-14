import { normalizeCountry } from '../normalize/country';
import { normalizeDate } from '../normalize/date';
import { normalizeChannel } from '../normalize/enum';
import { normalizeDecimal, normalizeInteger } from '../normalize/number';
import type { CanonicalCampaign, MapResult, RawRecord } from '../types';

export const CAMPAIGN_ID = /^[A-Z]{2,5}-\d{3,6}$/;

export type CampaignContext = { decimalSeparator: '.' | ',' };

const COUNT_FIELDS = [
  'reported_sent',
  'reported_delivered',
  'reported_bounced',
  'reported_opens',
  'reported_clicks',
] as const;

export function mapCampaign(rec: RawRecord, ctx: CampaignContext): MapResult<CanonicalCampaign> {
  const v = rec.values;
  const reject = (reason: string): MapResult<CanonicalCampaign> => ({
    ok: false,
    reject: { line: rec.line, reason, raw: v },
  });

  const externalId = (v.external_id ?? '').trim();
  if (!CAMPAIGN_ID.test(externalId)) return reject(`external_id malformed: ${externalId}`);

  const name = (v.campaign_name ?? '').trim();
  if (name === '') return reject('campaign name missing');

  const channel = normalizeChannel(v.channel ?? '');
  if (!channel.ok) return reject(channel.reason);

  const country = normalizeCountry(v.target_country ?? '');
  if (!country.ok) return reject(country.reason);

  const counts: Record<(typeof COUNT_FIELDS)[number], number | null> = {
    reported_sent: null,
    reported_delivered: null,
    reported_bounced: null,
    reported_opens: null,
    reported_clicks: null,
  };
  for (const f of COUNT_FIELDS) {
    const n = normalizeInteger(v[f] ?? '');
    if (!n.ok) return reject(`${f} ${n.reason}`);
    counts[f] = n.value;
  }

  const spend = normalizeDecimal(v.spend ?? '', ctx.decimalSeparator);
  if (!spend.ok) return reject(`spend ${spend.reason}`);

  const sentAt = normalizeDate(v.sent_at_utc ?? '');
  if (!sentAt.ok) return reject(`sent_at ${sentAt.reason}`);

  const parent = (v.parent_campaign_id ?? '').trim();
  const local = (v.send_local_time ?? '').trim();

  return {
    ok: true,
    row: {
      line: rec.line,
      external_id: externalId,
      name,
      channel: channel.value,
      target_country: country.value,
      ...counts,
      spend: spend.value,
      sent_at: sentAt.value,
      send_local_time: local === '' ? null : local,
      parent_external_id: parent === '' ? null : parent,
      flags: [],
    },
  };
}
