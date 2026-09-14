import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../../scripts/import/parse';

const enc = (s: string) => new TextEncoder().encode(s);
const HEADER =
  'event_id,external_contact_id,campaign_external_id,event_type,channel,occurred_at_utc';

describe('parseCsv', () => {
  it('strips a UTF-8 BOM so the first header is not "\\ufeffevent_id"', () => {
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...enc(`${HEADER}\nEV-1,CT-1,KIL-1,open,email,2026-03-01T00:00:00Z\n`),
    ]);
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' });
    expect(r.encoding).toBe('utf-8');
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toEqual({
      line: 2,
      values: {
        event_id: 'EV-1',
        external_contact_id: 'CT-1',
        campaign_external_id: 'KIL-1',
        event_type: 'open',
        channel: 'email',
        occurred_at_utc: '2026-03-01T00:00:00Z',
      },
    });
    expect(r.errors).toEqual([]);
  });

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    const head = enc(
      'Full Name,Email,External Id,Phone,Country,Status,City,Signup At,Consent Marketing,Brand Code,Deleted At,Suppressed Until,Notes\n',
    );
    const row1 = enc('Ann');
    const dash = new Uint8Array([0x96]); // en dash in cp1252, invalid as a UTF-8 lead byte
    const row2 = enc(
      'Marie Botha,a@b.test,CT-1,0712,ZA,active,Cape Town,2026-01-01T00:00:00Z,true,KAROO,,,\n',
    );
    const bytes = new Uint8Array([...head, ...row1, ...dash, ...row2]);
    const r = parseCsv(bytes, { brandCode: 'KAROO', kind: 'contacts' });
    expect(r.encoding).toBe('windows-1252');
    expect(r.records[0].values.full_name).toBe('Ann–Marie Botha');
    expect(r.records[0].values.external_id).toBe('CT-1');
  });

  it('maps Karoo headers onto canonical names', () => {
    const bytes = enc(
      'Full Name,Email,External Id,Phone,Country,Status,City,Signup At,Consent Marketing,Brand Code,Deleted At,Suppressed Until,Notes\nJ,j@x.test,CT-2,1,ZA,active,C,2026-01-01,1,KAROO,,,\n',
    );
    const r = parseCsv(bytes, { brandCode: 'KAROO', kind: 'contacts' });
    expect(Object.keys(r.records[0].values).sort()).toEqual([
      'brand_code',
      'city',
      'consent_marketing',
      'country',
      'deleted_at',
      'email',
      'external_id',
      'full_name',
      'notes',
      'phone',
      'signup_at',
      'status',
      'suppressed_until',
    ]);
  });

  it('reads semicolon files with Marrakech aliases', () => {
    const bytes = enc(
      'external_id;full_name;e_mail;mobile;pays;city;signup_at;status;consent_marketing;deleted_at;suppressed_until;brand_code;notes\nCT-3;L;l@x.test;+212 6;MA;Agadir;2026-01-01T00:00:00Z;active;TRUE;;;MARRAKECH;\n',
    );
    const r = parseCsv(bytes, { brandCode: 'MARRAKECH', kind: 'contacts' });
    expect(r.records[0].values.email).toBe('l@x.test');
    expect(r.records[0].values.phone).toBe('+212 6');
    expect(r.records[0].values.country).toBe('MA');
  });

  it('reports a short row as an error with its line number instead of padding it', () => {
    const bytes = enc(
      `${HEADER}\nEV-1,CT-1,KIL-1,open,email\nEV-2,CT-2,KIL-2,click,sms,2026-03-01T00:00:00Z\n`,
    );
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' });
    expect(r.records.map((x) => x.values.event_id)).toEqual(['EV-2']);
    expect(r.errors).toEqual([
      {
        line: 2,
        reason: 'row has 5 columns, expected 6',
        raw: {
          event_id: 'EV-1',
          external_contact_id: 'CT-1',
          campaign_external_id: 'KIL-1',
          event_type: 'open',
          channel: 'email',
        },
      },
    ]);
  });

  it('passes a repeated header row through as a record for the mapper to reject', () => {
    const bytes = enc(`${HEADER}\n${HEADER}\nEV-2,CT-2,KIL-2,click,sms,2026-03-01T00:00:00Z\n`);
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' });
    expect(r.records.map((x) => x.values.event_id)).toEqual(['event_id', 'EV-2']);
  });

  it('rejects a row containing a NUL byte, naming the column, with the NUL made visible', () => {
    const bytes = new Uint8Array([
      ...enc(`${HEADER}\nEV-1,CT-1,KIL-1,op`),
      0x00,
      ...enc(`en,email,2026-03-01T00:00:00Z\nEV-2,CT-2,KIL-2,click,sms,2026-03-01T00:00:00Z\n`),
    ]);
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' });
    expect(r.records.map((x) => x.values.event_id)).toEqual(['EV-2']);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    expect(r.errors[0].reason).toBe('event_type contains a NUL byte');
    expect(r.errors[0].raw.event_type).toBe('op<NUL>en');
  });

  it('makes a NUL visible in a short row too, so the reject can be stored', () => {
    const bytes = new Uint8Array([
      ...enc(`${HEADER}\nEV-1,CT-1,KIL-1,op`),
      0x00,
      ...enc(`en,email\n`),
    ]);
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].reason).toBe('row has 5 columns, expected 6');
    expect(r.errors[0].raw.event_type).toBe('op<NUL>en');
  });

  it('refuses a file whose headers do not match the kind', () => {
    const bytes = enc('foo,bar\n1,2\n');
    expect(() => parseCsv(bytes, { brandCode: 'KILELE', kind: 'events' })).toThrowError(
      /headers.*expected/i,
    );
  });

  it('keeps embedded newlines inside quoted notes', () => {
    const bytes = enc(
      'external_id,full_name,email,phone,country,city,signup_at,status,consent_marketing,deleted_at,suppressed_until,brand_code,notes\nCT-9,V,v@x.test,1,KE,N,2026-01-01T00:00:00Z,active,true,,,KILELE,"VIP customer\nfollow up next quarter"\n',
    );
    const r = parseCsv(bytes, { brandCode: 'KILELE', kind: 'contacts' });
    expect(r.records[0].values.notes).toBe('VIP customer\nfollow up next quarter');
    expect(r.records[0].line).toBe(2);
  });
});
