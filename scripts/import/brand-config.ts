import type { ImportKind } from './types';

export type BrandFileConfig = {
  delimiter: ',' | ';';
  decimalSeparator: '.' | ',';
  /** Header text as it appears in the file, mapped to the canonical column name. */
  headerAliases: Record<string, string>;
};

/** Canonical columns per kind. The parser rejects a file whose headers do not map onto exactly these. */
export const CANONICAL_COLUMNS: Record<ImportKind, readonly string[]> = {
  contacts: [
    'external_id',
    'full_name',
    'email',
    'phone',
    'country',
    'city',
    'signup_at',
    'status',
    'consent_marketing',
    'deleted_at',
    'suppressed_until',
    'brand_code',
    'notes',
  ],
  campaigns: [
    'external_id',
    'campaign_name',
    'channel',
    'target_country',
    'reported_sent',
    'reported_delivered',
    'reported_bounced',
    'reported_opens',
    'reported_clicks',
    'spend',
    'sent_at_utc',
    'send_local_time',
    'parent_campaign_id',
  ],
  events: [
    'event_id',
    'external_contact_id',
    'campaign_external_id',
    'event_type',
    'channel',
    'occurred_at_utc',
  ],
  send_log: ['batch_key', 'campaign_external_id', 'queued_at_utc', 'recipient_count', 'status'],
};

const KILELE: BrandFileConfig = { delimiter: ',', decimalSeparator: '.', headerAliases: {} };

const KAROO: BrandFileConfig = {
  delimiter: ',',
  decimalSeparator: '.',
  headerAliases: {
    'Full Name': 'full_name',
    Email: 'email',
    'External Id': 'external_id',
    Phone: 'phone',
    Country: 'country',
    Status: 'status',
    City: 'city',
    'Signup At': 'signup_at',
    'Consent Marketing': 'consent_marketing',
    'Brand Code': 'brand_code',
    'Deleted At': 'deleted_at',
    'Suppressed Until': 'suppressed_until',
    Notes: 'notes',
  },
};

const MARRAKECH: BrandFileConfig = {
  delimiter: ';',
  decimalSeparator: ',',
  headerAliases: { e_mail: 'email', mobile: 'phone', pays: 'country' },
};

export const BRAND_FILE_CONFIG: Record<string, BrandFileConfig> = {
  KILELE,
  KAROO,
  MARRAKECH,
};

export function brandConfig(brandCode: string): BrandFileConfig {
  const c = BRAND_FILE_CONFIG[brandCode];
  if (!c) throw new Error(`no file config for brand ${brandCode}`);
  return c;
}
