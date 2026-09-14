import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { rlsEnv } from './setup';

/** Every table that carries brand_id. brands, memberships and allowed_emails are tested separately. */
export const TENANT_TABLES = [
  'imports',
  'import_rejects',
  'contacts',
  'campaigns',
  'engagement_events',
  'send_log_entries',
  'sends',
  'send_recipients',
  'provider_events',
  'share_links',
] as const;
export type TenantTable = (typeof TENANT_TABLES)[number];

export const MARK = 'rls-fixture';

export function adminClient(): SupabaseClient {
  return createClient(rlsEnv.url, rlsEnv.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type BrandRow = { id: string; code: string };

/** One row per brand in every tenant table, linked correctly, all tagged so cleanup is exact. */
export async function seedFixtures(
  admin: SupabaseClient,
  ownerUserIdByBrand: Record<string, string>,
) {
  const { data: brands, error } = await admin.from('brands').select('id, code');
  if (error) throw error;
  if (!brands || brands.length !== 3)
    throw new Error(`expected 3 brands, got ${brands?.length ?? 0}`);

  for (const b of brands as BrandRow[]) {
    const ownerId = ownerUserIdByBrand[b.code];
    if (!ownerId) throw new Error(`no owner user id for ${b.code}`);

    const imp = await admin
      .from('imports')
      .insert({
        brand_id: b.id,
        kind: 'contacts',
        file_name: MARK,
        file_sha256: MARK,
        encoding: 'utf8',
      })
      .select('id')
      .single();
    if (imp.error) throw imp.error;

    const rej = await admin.from('import_rejects').insert({
      import_id: imp.data.id,
      brand_id: b.id,
      row_number: 1,
      reason: MARK,
      raw: { mark: MARK },
    });
    if (rej.error) throw rej.error;

    const contact = await admin
      .from('contacts')
      .insert({
        brand_id: b.id,
        external_id: 'CT-999999901',
        full_name: MARK,
        email: `fixture@${b.code.toLowerCase()}.example`,
        status: 'active',
        consent_marketing: true,
        notes: MARK,
        source_import_id: imp.data.id,
      })
      .select('id')
      .single();
    if (contact.error) throw contact.error;

    const campaign = await admin
      .from('campaigns')
      .insert({
        brand_id: b.id,
        external_id: 'FIX-0001',
        name: MARK,
        channel: 'email',
        source_import_id: imp.data.id,
      })
      .select('id')
      .single();
    if (campaign.error) throw campaign.error;

    const ev = await admin.from('engagement_events').insert({
      brand_id: b.id,
      event_id: 'EV-FIXTURE-1',
      contact_id: contact.data.id,
      campaign_id: campaign.data.id,
      event_type: 'open',
      raw_event_type: 'open',
      channel: 'email',
      occurred_at: new Date().toISOString(),
      source_import_id: imp.data.id,
    });
    if (ev.error) throw ev.error;

    const sl = await admin.from('send_log_entries').insert({
      brand_id: b.id,
      batch_key: MARK,
      campaign_id: campaign.data.id,
      campaign_external_id: 'FIX-0001',
      queued_at: new Date().toISOString(),
      recipient_count: 1,
      status: 'sent',
      attempt_no: 1,
      source_import_id: imp.data.id,
    });
    if (sl.error) throw sl.error;

    const send = await admin
      .from('sends')
      .insert({
        brand_id: b.id,
        campaign_id: campaign.data.id,
        audience_definition: MARK,
        approved_count: 1,
        approved_by: ownerId,
        idempotency_key: `${MARK}-${b.code}`,
      })
      .select('id')
      .single();
    if (send.error) throw send.error;

    const sr = await admin
      .from('send_recipients')
      .insert({ send_id: send.data.id, contact_id: contact.data.id, brand_id: b.id });
    if (sr.error) throw sr.error;

    const pe = await admin.from('provider_events').insert({
      brand_id: b.id,
      send_id: send.data.id,
      provider_event_id: `${MARK}-1`,
      event_type: 'delivered',
      recipient_id: contact.data.id,
      raw: { mark: MARK },
    });
    if (pe.error) throw pe.error;

    const share = await admin.from('share_links').insert({
      brand_id: b.id,
      campaign_id: campaign.data.id,
      token_hash: `${MARK}-${b.code}`,
      password_hash: MARK,
      created_by: ownerId,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (share.error) throw share.error;
  }
  return { brands: brands as BrandRow[] };
}

export async function cleanFixtures(admin: SupabaseClient) {
  // Order respects foreign keys. Cascades: imports -> import_rejects; sends -> send_recipients, provider_events.
  const steps: Array<[TenantTable, Record<string, unknown>]> = [
    ['share_links', { password_hash: MARK }],
    ['sends', { audience_definition: MARK }],
    ['send_log_entries', { batch_key: MARK }],
    ['engagement_events', { event_id: 'EV-FIXTURE-1' }],
    ['campaigns', { name: MARK }],
    ['contacts', { notes: MARK }],
    ['imports', { file_name: MARK }],
  ];
  for (const [table, match] of steps) {
    const { error } = await admin.from(table).delete().match(match);
    if (error) throw new Error(`cleanup ${table}: ${error.message}`);
  }
}
