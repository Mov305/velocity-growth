import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { failInterruptedImports, runImport } from '../../scripts/import/run';
import type { ImportSummary } from '../../scripts/import/types';
import { rlsEnv } from './setup';

/**
 * Imports hand-made fixture files with every seed trap planted, checks every count against what
 * was planted, then imports them all again and proves nothing doubled. Runs against the local
 * database with the direct connection, exactly as the CLI does.
 */
const sql = postgres(rlsEnv.dbUrl, { max: 2 });
const FIX = 'tests/fixtures/import';
const importIds: string[] = [];
let brandId = '';

async function importAll(): Promise<Record<string, ImportSummary>> {
  const out: Record<string, ImportSummary> = {};
  for (const [kind, file] of [
    ['contacts', 'kilele-contacts.csv'],
    ['campaigns', 'kilele-campaigns.csv'],
    ['events', 'kilele-events.csv'],
    ['send_log', 'kilele-send-log.csv'],
  ] as const) {
    const s = await runImport({ brandCode: 'KILELE', kind, filePath: `${FIX}/${file}`, sql });
    importIds.push(s.importId);
    out[kind] = s;
  }
  return out;
}

async function counts() {
  const ids = importIds;
  const [c] =
    await sql`select count(*)::int as n from public.contacts where source_import_id = any(${ids})`;
  const [k] =
    await sql`select count(*)::int as n from public.campaigns where source_import_id = any(${ids})`;
  const [e] =
    await sql`select count(*)::int as n from public.engagement_events where source_import_id = any(${ids})`;
  const [s] =
    await sql`select count(*)::int as n from public.send_log_entries where source_import_id = any(${ids})`;
  const [r] =
    await sql`select count(*)::int as n from public.import_rejects where import_id = any(${ids})`;
  return { contacts: c.n, campaigns: k.n, events: e.n, sendLog: s.n, rejects: r.n };
}

beforeAll(async () => {
  const [b] = await sql<{ id: string }[]>`select id from public.brands where code = 'KILELE'`;
  brandId = b.id;
});

afterAll(async () => {
  // Fixture rows are identifiable by their import ids. Order respects foreign keys.
  await sql`delete from public.engagement_events where source_import_id = any(${importIds})`;
  await sql`delete from public.send_log_entries where source_import_id = any(${importIds})`;
  await sql`update public.campaigns set parent_campaign_id = null where source_import_id = any(${importIds})`;
  await sql`delete from public.campaigns where source_import_id = any(${importIds})`;
  await sql`delete from public.contacts where source_import_id = any(${importIds})`;
  await sql`delete from public.imports where id = any(${importIds})`;
  await sql.end();
});

describe('import pipeline against the database', () => {
  let first: Record<string, ImportSummary>;

  it('loads the fixtures with the planted counts', async () => {
    first = await importAll();

    // contacts: 9 data lines. Kept: 1, 2 (twice, last wins), 4 (bad phone, flagged), 5, 6 = 5 rows.
    // Rejected: repeated header, KAROO-tagged, shifted (12 columns) = 3. One in-file duplicate.
    expect(first.contacts).toMatchObject({
      encoding: 'utf-8',
      rowsRead: 9,
      rowsUpserted: 5,
      rowsRejected: 3,
      rowsSkippedDuplicate: 1,
    });
    // campaigns: 6 lines. Kept 4 (9001, 9002 twice, 914, 915). Rejected: push channel.
    expect(first.campaigns).toMatchObject({
      rowsRead: 6,
      rowsUpserted: 4,
      rowsRejected: 1,
      rowsSkippedDuplicate: 1,
    });
    // events: 7 lines. Kept: 0001, 0002 (twice), 0004, 0006 = 4. Rejected: unknown campaign,
    // spam type = 2.
    expect(first.events).toMatchObject({
      rowsRead: 7,
      rowsUpserted: 4,
      rowsRejected: 2,
      rowsSkippedDuplicate: 1,
    });
    // send log: 4 lines, all kept; BATCH-FX-1 twice becomes attempts 1 and 2; KIL-0000 unlinked.
    expect(first.send_log).toMatchObject({ rowsRead: 4, rowsUpserted: 4, rowsRejected: 0 });

    for (const s of Object.values(first)) {
      expect(
        s.rowsUpserted + s.rowsRejected + s.rowsSkippedDuplicate + s.rowsAlreadyPresent,
        `${s.kind}: every row read is accounted for`,
      ).toBe(s.rowsRead);
    }
    expect(await counts()).toEqual({
      contacts: 5,
      campaigns: 4,
      events: 4,
      sendLog: 4,
      rejects: 6,
    });
  });

  it('records a readable reason for every rejected row', async () => {
    const rows = await sql<{ row_number: number; reason: string }[]>`
      select row_number, reason from public.import_rejects
      where import_id = ${first.contacts.importId} order by row_number`;
    expect(rows).toEqual([
      { row_number: 5, reason: 'external_id malformed: external_id' },
      { row_number: 6, reason: 'brand_code mismatch: KAROO in KILELE file' },
      { row_number: 7, reason: 'row has 12 columns, expected 13' },
    ]);
    const [rawShape] = await sql<{ kind: string; ext: string | null }[]>`
      select jsonb_typeof(raw) as kind, raw->>'external_id' as ext from public.import_rejects
      where import_id = ${first.contacts.importId} and row_number = 6`;
    expect(rawShape).toEqual({ kind: 'object', ext: 'CT-900800184' });
    const [c4] = await sql<{ phone: string | null; flags: string[] }[]>`
      select phone, flags from public.contacts where brand_id = ${brandId} and external_id = 'CT-900000004'`;
    expect(c4).toEqual({ phone: null, flags: ['phone_corrupted'] });
    const ev = await sql<{ reason: string }[]>`
      select reason from public.import_rejects where import_id = ${first.events.importId} order by row_number`;
    expect(ev.map((r) => r.reason)).toEqual([
      'unknown campaign MAR-0011',
      'event_type unrecognised: spam',
    ]);
  });

  it('applies last-wins, flags, and within-brand parent resolution', async () => {
    const [c2] = await sql<
      { full_name: string; email: string; signup_at: Date; suppressed_until: Date }[]
    >`
      select full_name, email, signup_at, suppressed_until from public.contacts
      where brand_id = ${brandId} and external_id = 'CT-900000002'`;
    expect(c2.full_name).toBe('Second Version');
    expect(c2.email).toBe('second.fixture@vg-eval.test');
    expect(c2.signup_at.toISOString()).toBe('2026-02-01T00:10:00.000Z');
    expect(c2.suppressed_until.toISOString()).toBe('2027-05-16T00:00:00.000Z');

    const [c5] = await sql<{ email: string | null; status: string; flags: string[] }[]>`
      select email, status, flags from public.contacts where brand_id = ${brandId} and external_id = 'CT-900000005'`;
    expect(c5).toEqual({ email: null, status: 'unsubscribed', flags: ['email_invalid'] });

    const [c6] = await sql<
      { flags: string[]; consent_marketing: boolean; country: string | null }[]
    >`
      select flags, consent_marketing, country from public.contacts where brand_id = ${brandId} and external_id = 'CT-900000006'`;
    expect(c6).toEqual({
      flags: [
        'brand_code_missing',
        'name_missing',
        'country_unrecognised',
        'signup_missing',
        'consent_missing',
      ],
      consent_marketing: false,
      country: null,
    });

    const parents = await sql<{ external_id: string; parent: string | null; flags: string[] }[]>`
      select c.external_id, p.external_id as parent, c.flags
      from public.campaigns c left join public.campaigns p on p.id = c.parent_campaign_id
      where c.brand_id = ${brandId} and c.external_id in ('CMP-914', 'CMP-915') order by c.external_id`;
    expect(parents).toEqual([
      { external_id: 'CMP-914', parent: 'KIL-9001', flags: [] },
      { external_id: 'CMP-915', parent: null, flags: ['parent_unresolved'] },
    ]);

    const attempts = await sql<
      { batch_key: string; attempt_no: number; campaign_external_id: string; linked: boolean }[]
    >`
      select batch_key, attempt_no, campaign_external_id, campaign_id is not null as linked
      from public.send_log_entries where source_import_id = ${first.send_log.importId}
      order by batch_key, attempt_no`;
    expect(attempts).toEqual([
      { batch_key: 'BATCH-FX-1', attempt_no: 1, campaign_external_id: 'KIL-9001', linked: true },
      { batch_key: 'BATCH-FX-1', attempt_no: 2, campaign_external_id: 'KIL-9001', linked: true },
      { batch_key: 'BATCH-FX-2', attempt_no: 1, campaign_external_id: 'KIL-9002', linked: true },
      { batch_key: 'BATCH-FX-3', attempt_no: 1, campaign_external_id: 'KIL-0000', linked: false },
    ]);
  });

  it('importing the same files again leaves one set of rows, not two', async () => {
    const before = await counts();
    const second = await importAll();
    // Second pass: every row is re-upserted (contacts, campaigns, send log) and every event is a
    // known fact (do nothing), so events report 0 new rows. Rejects are recorded again, per import.
    expect(second.contacts.rowsUpserted).toBe(5);
    expect(second.events.rowsAlreadyPresent).toBe(4);
    for (const s of Object.values(second)) {
      expect(
        s.rowsUpserted + s.rowsRejected + s.rowsSkippedDuplicate + s.rowsAlreadyPresent,
        `${s.kind}: every row read is accounted for on the second pass`,
      ).toBe(s.rowsRead);
    }
    expect(second.events.rowsUpserted).toBe(0);
    const after = await counts();
    expect(after).toEqual({ ...before, rejects: before.rejects * 2 });
    const [imports] =
      await sql`select count(*)::int as n from public.imports where id = any(${importIds}) and status = 'succeeded'`;
    expect(imports.n).toBe(8);
  });

  it('marks an import left running by a dead process as failed with a reason', async () => {
    const [stale] = await sql<{ id: string }[]>`
      insert into public.imports (brand_id, kind, file_name, file_sha256, encoding, status)
      values (${brandId}, 'contacts', 'stale.csv', 'x', 'utf-8', 'running') returning id`;
    expect(await failInterruptedImports(sql)).toBe(1);
    const [row] = await sql<{ status: string; error: string }[]>`
      select status, error from public.imports where id = ${stale.id}`;
    expect(row).toEqual({
      status: 'failed',
      error: 'interrupted: the import process ended before finishing',
    });
    await sql`delete from public.imports where id = ${stale.id}`;
  });

  it('marks the import failed and stores nothing when the file has the wrong headers', async () => {
    await expect(
      runImport({
        brandCode: 'KILELE',
        kind: 'events',
        filePath: `${FIX}/kilele-send-log.csv`,
        sql,
      }),
    ).rejects.toThrowError(/headers/);
    const [row] = await sql<{ status: string; error: string }[]>`
      select status, error from public.imports where brand_id = ${brandId} and kind = 'events'
        and file_name = 'kilele-send-log.csv' order by started_at desc limit 1`;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/headers/);
    await sql`delete from public.imports where brand_id = ${brandId} and status = 'failed' and file_name = 'kilele-send-log.csv'`;
  });
});
