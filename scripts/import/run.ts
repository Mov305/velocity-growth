import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type postgres from 'postgres';
import { brandConfig } from './brand-config';
import { dedupeLastWins } from './dedupe';
import { parseCsv } from './parse';
import { mapCampaign } from './rows/campaign';
import { mapContact } from './rows/contact';
import { mapEvent } from './rows/event';
import { mapSendLog } from './rows/send-log';
import type {
  CanonicalCampaign,
  CanonicalContact,
  CanonicalEvent,
  CanonicalSendLog,
  ImportKind,
  ImportSummary,
  MapResult,
  Reject,
} from './types';

export type Sql = postgres.Sql;

export type RunImportOptions = {
  brandCode: string;
  kind: ImportKind;
  sql: Sql;
  /** A file on disk (the CLI) ... */
  filePath?: string;
  /** ... or bytes already in memory (an upload). One of the two. */
  source?: { fileName: string; bytes: Uint8Array };
};

const BATCH = {
  contacts: 2000,
  campaigns: 500,
  events: 5000,
  send_log: 500,
  rejects: 1000,
} as const;

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function split<T>(results: MapResult<T>[]): { rows: T[]; rejects: Reject[] } {
  const rows: T[] = [];
  const rejects: Reject[] = [];
  for (const r of results) {
    if (r.ok) rows.push(r.row);
    else rejects.push(r.reject);
  }
  return { rows, rejects };
}

/**
 * Imports one file for one brand. The imports row is written first and updated last, outside the
 * transaction, so a failure is visible as `failed` with its error. Everything else, rows and
 * rejects together, is one transaction: a crash leaves nothing half-loaded.
 */
export async function runImport(opts: RunImportOptions): Promise<ImportSummary> {
  const { sql, brandCode, kind } = opts;
  if (!opts.filePath && !opts.source) throw new Error('runImport needs filePath or source');
  const started = Date.now();
  const fileName = opts.source?.fileName ?? basename(opts.filePath!);
  const bytes = opts.source?.bytes ?? readFileSync(opts.filePath!);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  const [brand] = await sql<
    { id: string }[]
  >`select id from public.brands where code = ${brandCode}`;
  if (!brand) throw new Error(`brand ${brandCode} does not exist; run db:reset`);

  // Encoding is only known after parsing; record a placeholder and correct it below.
  const [imp] = await sql<{ id: string }[]>`
    insert into public.imports (brand_id, kind, file_name, file_sha256, encoding, status)
    values (${brand.id}, ${kind}, ${fileName}, ${sha256}, 'pending', 'running')
    returning id`;
  const importId = imp.id;

  try {
    const parsed = parseCsv(bytes, { brandCode, kind });
    await sql`update public.imports set encoding = ${parsed.encoding} where id = ${importId}`;
    const rejects: Reject[] = [...parsed.errors];
    const rowsRead = parsed.records.length + parsed.errors.length;
    let upserted = 0;
    let skipped = 0;
    let alreadyPresent = 0;

    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      if (kind === 'contacts') {
        const r = split(parsed.records.map((rec) => mapContact(rec, { brandCode })));
        for (const rej of r.rejects) rejects.push(rej);
        const d = dedupeLastWins(r.rows, (c) => c.external_id);
        skipped = d.skipped;
        upserted = await upsertContacts(t, brand.id, importId, d.kept);
      } else if (kind === 'campaigns') {
        const { decimalSeparator } = brandConfig(brandCode);
        const r = split(parsed.records.map((rec) => mapCampaign(rec, { decimalSeparator })));
        for (const rej of r.rejects) rejects.push(rej);
        const d = dedupeLastWins(r.rows, (c) => c.external_id);
        skipped = d.skipped;
        upserted = await upsertCampaigns(t, brand.id, importId, d.kept);
      } else if (kind === 'events') {
        const contactIds = await idMap(t, 'contacts', brand.id);
        const campaignIds = await idMap(t, 'campaigns', brand.id);
        const r = split(parsed.records.map((rec) => mapEvent(rec, { contactIds, campaignIds })));
        for (const rej of r.rejects) rejects.push(rej);
        const d = dedupeLastWins(r.rows, (e) => e.event_id);
        skipped = d.skipped;
        upserted = await upsertEvents(t, brand.id, importId, d.kept);
        // Events are immutable facts: a known id inserts nothing and is neither an upsert nor a reject.
        alreadyPresent = d.kept.length - upserted;
      } else {
        const campaignIds = await idMap(t, 'campaigns', brand.id);
        const seen = new Map<string, number>();
        const results = parsed.records.map((rec) => {
          const key = (rec.values.batch_key ?? '').trim();
          const attemptNo = (seen.get(key) ?? 0) + 1;
          seen.set(key, attemptNo);
          return mapSendLog(rec, { campaignIds, attemptNo });
        });
        const r = split(results);
        for (const rej of r.rejects) rejects.push(rej);
        upserted = await upsertSendLog(t, brand.id, importId, r.rows);
      }
      await insertRejects(t, brand.id, importId, rejects);
      // Inside the transaction: data and the 'succeeded' mark commit together or not at all.
      await t`
        update public.imports set
          status = 'succeeded',
          rows_read = ${rowsRead},
          rows_upserted = ${upserted},
          rows_rejected = ${rejects.length},
          rows_skipped_duplicate = ${skipped},
          rows_already_present = ${alreadyPresent},
          finished_at = now()
        where id = ${importId}`;
    });

    return {
      importId,
      brand: brandCode,
      kind,
      file: fileName,
      encoding: parsed.encoding,
      rowsRead,
      rowsUpserted: upserted,
      rowsRejected: rejects.length,
      rowsSkippedDuplicate: skipped,
      rowsAlreadyPresent: alreadyPresent,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await sql`
      update public.imports set status = 'failed', error = ${message}, finished_at = now()
      where id = ${importId}`;
    throw e;
  }
}

/**
 * An import that died between starting and finishing (killed process, lost connection) can only
 * be left as 'running'. The CLI calls this before starting so the marketer sees 'failed' with a
 * reason rather than a spinner that never ends. Imports are single-process by design.
 */
export async function failInterruptedImports(sql: Sql): Promise<number> {
  const res = await sql`
    update public.imports
    set status = 'failed', error = 'interrupted: the import process ended before finishing', finished_at = now()
    where status = 'running'`;
  return res.count;
}

async function idMap(sql: Sql, table: 'contacts' | 'campaigns', brandId: string) {
  const rows = await sql<{ external_id: string; id: string }[]>`
    select external_id, id from public.${sql(table)} where brand_id = ${brandId}`;
  return new Map(rows.map((r) => [r.external_id, r.id]));
}

async function upsertContacts(
  sql: Sql,
  brandId: string,
  importId: string,
  rows: CanonicalContact[],
) {
  let n = 0;
  for (const batch of chunks(rows, BATCH.contacts)) {
    const values = batch.map((c) => ({
      brand_id: brandId,
      external_id: c.external_id,
      full_name: c.full_name,
      email: c.email,
      phone: c.phone,
      country: c.country,
      city: c.city,
      signup_at: c.signup_at,
      status: c.status,
      consent_marketing: c.consent_marketing,
      deleted_at: c.deleted_at,
      suppressed_until: c.suppressed_until,
      notes: c.notes,
      flags: c.flags,
      source_import_id: importId,
    }));
    const res = await sql`
      insert into public.contacts ${sql(values)}
      on conflict (brand_id, external_id) do update set
        full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone,
        country = excluded.country,
        city = excluded.city,
        signup_at = excluded.signup_at,
        status = excluded.status,
        consent_marketing = excluded.consent_marketing,
        deleted_at = excluded.deleted_at,
        suppressed_until = excluded.suppressed_until,
        notes = excluded.notes,
        flags = excluded.flags,
        source_import_id = excluded.source_import_id`;
    n += res.count;
  }
  return n;
}

async function upsertCampaigns(
  sql: Sql,
  brandId: string,
  importId: string,
  rows: CanonicalCampaign[],
) {
  let n = 0;
  for (const batch of chunks(rows, BATCH.campaigns)) {
    const values = batch.map((c) => ({
      brand_id: brandId,
      external_id: c.external_id,
      name: c.name,
      channel: c.channel,
      target_country: c.target_country,
      reported_sent: c.reported_sent,
      reported_delivered: c.reported_delivered,
      reported_bounced: c.reported_bounced,
      reported_opens: c.reported_opens,
      reported_clicks: c.reported_clicks,
      spend: c.spend,
      sent_at: c.sent_at,
      send_local_time: c.send_local_time,
      parent_external_id: c.parent_external_id,
      flags: c.flags,
      source_import_id: importId,
    }));
    const res = await sql`
      insert into public.campaigns ${sql(values)}
      on conflict (brand_id, external_id) do update set
        name = excluded.name,
        channel = excluded.channel,
        target_country = excluded.target_country,
        reported_sent = excluded.reported_sent,
        reported_delivered = excluded.reported_delivered,
        reported_bounced = excluded.reported_bounced,
        reported_opens = excluded.reported_opens,
        reported_clicks = excluded.reported_clicks,
        spend = excluded.spend,
        sent_at = excluded.sent_at,
        send_local_time = excluded.send_local_time,
        parent_external_id = excluded.parent_external_id,
        parent_campaign_id = null,
        flags = excluded.flags,
        source_import_id = excluded.source_import_id`;
    n += res.count;
  }
  // Parents resolve within the brand only. A parent outside the brand (Karoo CMP-014 -> KIL-0007)
  // stays unresolved and is flagged rather than linked across tenants.
  await sql`
    update public.campaigns c set parent_campaign_id = p.id
    from public.campaigns p
    where c.brand_id = ${brandId} and p.brand_id = ${brandId}
      and c.parent_external_id is not null and c.parent_external_id = p.external_id`;
  await sql`
    update public.campaigns set flags = array_append(array_remove(flags, 'parent_unresolved'), 'parent_unresolved')
    where brand_id = ${brandId} and parent_external_id is not null and parent_campaign_id is null`;
  return n;
}

async function upsertEvents(sql: Sql, brandId: string, importId: string, rows: CanonicalEvent[]) {
  let n = 0;
  for (const batch of chunks(rows, BATCH.events)) {
    const values = batch.map((e) => ({
      brand_id: brandId,
      event_id: e.event_id,
      contact_id: e.contact_id,
      campaign_id: e.campaign_id,
      event_type: e.event_type,
      raw_event_type: e.raw_event_type,
      channel: e.channel,
      occurred_at: e.occurred_at,
      source_import_id: importId,
    }));
    // Events are immutable facts: an id seen before is the same fact, never an update.
    const res = await sql`
      insert into public.engagement_events ${sql(values)}
      on conflict (brand_id, event_id) do nothing`;
    n += res.count;
  }
  return n;
}

async function upsertSendLog(
  sql: Sql,
  brandId: string,
  importId: string,
  rows: CanonicalSendLog[],
) {
  let n = 0;
  for (const batch of chunks(rows, BATCH.send_log)) {
    const values = batch.map((s) => ({
      brand_id: brandId,
      batch_key: s.batch_key,
      campaign_id: s.campaign_id,
      campaign_external_id: s.campaign_external_id,
      queued_at: s.queued_at,
      recipient_count: s.recipient_count,
      status: s.status,
      attempt_no: s.attempt_no,
      source_import_id: importId,
    }));
    const res = await sql`
      insert into public.send_log_entries ${sql(values)}
      on conflict (brand_id, batch_key, attempt_no) do update set
        campaign_id = excluded.campaign_id,
        campaign_external_id = excluded.campaign_external_id,
        queued_at = excluded.queued_at,
        recipient_count = excluded.recipient_count,
        status = excluded.status,
        source_import_id = excluded.source_import_id`;
    n += res.count;
  }
  return n;
}

async function insertRejects(sql: Sql, brandId: string, importId: string, rejects: Reject[]) {
  for (const batch of chunks(rejects, BATCH.rejects)) {
    const values = batch.map((r) => ({
      import_id: importId,
      brand_id: brandId,
      row_number: r.line,
      reason: r.reason,
      raw: r.raw,
    }));
    await sql`insert into public.import_rejects ${sql(values)}`;
  }
}
