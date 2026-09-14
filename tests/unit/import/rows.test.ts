import { describe, expect, it } from 'vitest';
import { mapCampaign } from '../../../scripts/import/rows/campaign';
import { mapContact } from '../../../scripts/import/rows/contact';
import { mapEvent } from '../../../scripts/import/rows/event';
import { mapSendLog } from '../../../scripts/import/rows/send-log';
import type { RawRecord } from '../../../scripts/import/types';

const rec = (values: Record<string, string>, line = 2): RawRecord => ({ line, values });

const goodContact = {
  external_id: 'CT-000001',
  full_name: ' Simon Kamau ',
  email: 'Simon@VG-Eval.test',
  phone: '254-731-694774',
  country: 'kenya',
  city: 'Nakuru',
  signup_at: '2026-02-19T23:47:04Z',
  status: 'ACTIVE',
  consent_marketing: 'Y',
  deleted_at: '',
  suppressed_until: '2027-02-20T00:00:00Z',
  brand_code: 'KILELE',
  notes: 'acquired via web signup',
};

describe('mapContact', () => {
  it('normalises every field of a good row', () => {
    const r = mapContact(rec(goodContact), { brandCode: 'KILELE' });
    expect(r).toEqual({
      ok: true,
      row: {
        line: 2,
        external_id: 'CT-000001',
        full_name: 'Simon Kamau',
        email: 'simon@vg-eval.test',
        phone: '254731694774',
        country: 'KE',
        city: 'Nakuru',
        signup_at: '2026-02-19T23:47:04Z',
        status: 'active',
        consent_marketing: true,
        deleted_at: null,
        suppressed_until: '2027-02-20T00:00:00Z',
        notes: 'acquired via web signup',
        flags: [],
      },
    });
  });

  it('rejects a malformed id, which also catches shifted rows and repeated headers', () => {
    const r = mapContact(rec({ ...goodContact, external_id: 'external_id' }), {
      brandCode: 'KILELE',
    });
    expect(r).toMatchObject({
      ok: false,
      reject: { line: 2, reason: 'external_id malformed: external_id' },
    });
    const shifted = mapContact(rec({ ...goodContact, external_id: 'z2424@vg-eval.test' }), {
      brandCode: 'KAROO',
    });
    expect(shifted).toMatchObject({
      ok: false,
      reject: { reason: 'external_id malformed: z2424@vg-eval.test' },
    });
  });

  it('rejects a row tagged with another brand', () => {
    const r = mapContact(rec({ ...goodContact, brand_code: 'KAROO' }), { brandCode: 'KILELE' });
    expect(r).toMatchObject({
      ok: false,
      reject: { reason: 'brand_code mismatch: KAROO in KILELE file' },
    });
  });

  it('keeps a row with an empty brand code and flags it', () => {
    const r = mapContact(rec({ ...goodContact, brand_code: '' }), { brandCode: 'KILELE' });
    expect(r).toMatchObject({ ok: true, row: { flags: ['brand_code_missing'] } });
  });

  it('rejects missing or unknown status', () => {
    expect(mapContact(rec({ ...goodContact, status: '' }), { brandCode: 'KILELE' })).toMatchObject({
      ok: false,
      reject: { reason: 'status missing' },
    });
  });

  it('rejects unrecognised consent, flags empty consent', () => {
    expect(
      mapContact(rec({ ...goodContact, consent_marketing: 'maybe' }), { brandCode: 'KILELE' }),
    ).toMatchObject({
      ok: false,
      reject: { reason: 'consent unrecognised: maybe' },
    });
    expect(
      mapContact(rec({ ...goodContact, consent_marketing: '' }), { brandCode: 'KILELE' }),
    ).toMatchObject({
      ok: true,
      row: { consent_marketing: false, flags: ['consent_missing'] },
    });
  });

  it('rejects unparseable dates with the field name', () => {
    expect(
      mapContact(rec({ ...goodContact, signup_at: 'active' }), { brandCode: 'KILELE' }),
    ).toMatchObject({
      ok: false,
      reject: { reason: 'signup_at unparseable: active' },
    });
    expect(
      mapContact(rec({ ...goodContact, deleted_at: 'x' }), { brandCode: 'KILELE' }),
    ).toMatchObject({
      ok: false,
      reject: { reason: 'deleted_at unparseable: x' },
    });
  });

  it('keeps a spreadsheet-corrupted phone as null with a flag', () => {
    expect(
      mapContact(rec({ ...goodContact, phone: '2.54E+11' }), { brandCode: 'KILELE' }),
    ).toMatchObject({
      ok: true,
      row: { phone: null, flags: ['phone_corrupted'] },
    });
  });

  it('keeps an invalid email as null with a flag, and flags a contact with no channel at all', () => {
    const r = mapContact(rec({ ...goodContact, email: 'john doe@vg-eval.test' }), {
      brandCode: 'KILELE',
    });
    expect(r).toMatchObject({ ok: true, row: { email: null, flags: ['email_invalid'] } });
    const none = mapContact(rec({ ...goodContact, email: 'no-tld@vg-eval', phone: '' }), {
      brandCode: 'KILELE',
    });
    expect(none).toMatchObject({
      ok: true,
      row: { email: null, phone: null, flags: ['email_invalid', 'no_channel'] },
    });
  });

  it('flags unknown country and missing name and signup, keeping the row', () => {
    const r = mapContact(rec({ ...goodContact, country: 'NULL', full_name: '', signup_at: '' }), {
      brandCode: 'KILELE',
    });
    expect(r).toMatchObject({
      ok: true,
      row: {
        country: null,
        full_name: null,
        signup_at: null,
        flags: ['name_missing', 'country_unrecognised', 'signup_missing'],
      },
    });
  });
});

const goodCampaign = {
  external_id: 'KIL-0016',
  campaign_name: 'Promo KIL-0016',
  channel: 'email',
  target_country: '',
  reported_sent: '10640',
  reported_delivered: '10108',
  reported_bounced: '532',
  reported_opens: '12679',
  reported_clicks: '2291',
  spend: '650.07',
  sent_at_utc: '2026-02-09T00:08:45Z',
  send_local_time: '2026-02-09 03:08',
  parent_campaign_id: '',
};

describe('mapCampaign', () => {
  it('normalises a good row', () => {
    const r = mapCampaign(rec(goodCampaign), { decimalSeparator: '.' });
    expect(r).toEqual({
      ok: true,
      row: {
        line: 2,
        external_id: 'KIL-0016',
        name: 'Promo KIL-0016',
        channel: 'email',
        target_country: null,
        reported_sent: 10640,
        reported_delivered: 10108,
        reported_bounced: 532,
        reported_opens: 12679,
        reported_clicks: 2291,
        spend: 650.07,
        sent_at: '2026-02-09T00:08:45Z',
        send_local_time: '2026-02-09 03:08',
        parent_external_id: null,
        flags: [],
      },
    });
  });

  it('parses Marrakech comma decimals', () => {
    const r = mapCampaign(rec({ ...goodCampaign, spend: '221,09' }), { decimalSeparator: ',' });
    expect(r).toMatchObject({ ok: true, row: { spend: 221.09 } });
  });

  it('keeps a parent reference as text for later resolution', () => {
    const r = mapCampaign(
      rec({ ...goodCampaign, external_id: 'CMP-014', parent_campaign_id: 'KIL-0007' }),
      { decimalSeparator: '.' },
    );
    expect(r).toMatchObject({ ok: true, row: { parent_external_id: 'KIL-0007' } });
  });

  it('rejects bad id, missing name, bad channel, bad count, bad spend, bad date', () => {
    const dec = { decimalSeparator: '.' as const };
    expect(mapCampaign(rec({ ...goodCampaign, external_id: '' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'external_id malformed: ' },
    });
    expect(mapCampaign(rec({ ...goodCampaign, campaign_name: ' ' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'campaign name missing' },
    });
    expect(mapCampaign(rec({ ...goodCampaign, channel: 'push' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'channel unrecognised: push' },
    });
    expect(mapCampaign(rec({ ...goodCampaign, reported_opens: '12.5' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'reported_opens not a whole number: 12.5' },
    });
    expect(mapCampaign(rec({ ...goodCampaign, spend: 'free' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'spend not a number: free' },
    });
    expect(mapCampaign(rec({ ...goodCampaign, sent_at_utc: 'yesterday' }), dec)).toMatchObject({
      ok: false,
      reject: { reason: 'sent_at unparseable: yesterday' },
    });
  });
});

const ids = {
  contactIds: new Map([['CT-032188', 'c-uuid']]),
  campaignIds: new Map([['KIL-0043', 'k-uuid']]),
};

describe('mapEvent', () => {
  it('resolves ids and normalises', () => {
    const r = mapEvent(
      rec({
        event_id: 'EV-00107252',
        external_contact_id: 'CT-032188',
        campaign_external_id: 'KIL-0043',
        event_type: 'bounce',
        channel: 'email',
        occurred_at_utc: '2026-03-07T10:42:18.187492Z',
      }),
      ids,
    );
    expect(r).toEqual({
      ok: true,
      row: {
        line: 2,
        event_id: 'EV-00107252',
        contact_id: 'c-uuid',
        campaign_id: 'k-uuid',
        event_type: 'bounce',
        raw_event_type: 'bounce',
        channel: 'email',
        occurred_at: '2026-03-07T10:42:18.187492Z',
      },
    });
  });

  it('rejects unknown campaign, unknown contact, unknown type, bad time, missing id', () => {
    const base = {
      event_id: 'EV-1',
      external_contact_id: 'CT-032188',
      campaign_external_id: 'KIL-0043',
      event_type: 'open',
      channel: 'sms',
      occurred_at_utc: '2026-03-07T10:42:18Z',
    };
    expect(mapEvent(rec({ ...base, campaign_external_id: 'MAR-0011' }), ids)).toMatchObject({
      ok: false,
      reject: { reason: 'unknown campaign MAR-0011' },
    });
    expect(mapEvent(rec({ ...base, external_contact_id: 'CT-9' }), ids)).toMatchObject({
      ok: false,
      reject: { reason: 'unknown contact CT-9' },
    });
    expect(mapEvent(rec({ ...base, event_type: 'spam' }), ids)).toMatchObject({
      ok: false,
      reject: { reason: 'event_type unrecognised: spam' },
    });
    expect(mapEvent(rec({ ...base, occurred_at_utc: 'soon' }), ids)).toMatchObject({
      ok: false,
      reject: { reason: 'occurred_at unparseable: soon' },
    });
    expect(mapEvent(rec({ ...base, event_id: ' ' }), ids)).toMatchObject({
      ok: false,
      reject: { reason: 'event_id missing' },
    });
  });
});

describe('mapSendLog', () => {
  it('normalises and takes the attempt number from the caller', () => {
    const r = mapSendLog(
      rec({
        batch_key: 'BATCH-0003',
        campaign_external_id: 'KIL-0043',
        queued_at_utc: '2026-03-13T03:15:00Z',
        recipient_count: '31205',
        status: 'sent',
      }),
      { campaignIds: ids.campaignIds, attemptNo: 2 },
    );
    expect(r).toEqual({
      ok: true,
      row: {
        line: 2,
        batch_key: 'BATCH-0003',
        campaign_id: 'k-uuid',
        campaign_external_id: 'KIL-0043',
        queued_at: '2026-03-13T03:15:00Z',
        recipient_count: 31205,
        status: 'sent',
        attempt_no: 2,
      },
    });
  });

  it('keeps an unknown campaign as null id (the log is historical), rejects bad count or time or key', () => {
    const base = {
      batch_key: 'B',
      campaign_external_id: 'NOPE',
      queued_at_utc: '2026-03-13T03:15:00Z',
      recipient_count: '1',
      status: 'sent',
    };
    const opts = { campaignIds: ids.campaignIds, attemptNo: 1 };
    expect(mapSendLog(rec(base), opts)).toMatchObject({ ok: true, row: { campaign_id: null } });
    expect(mapSendLog(rec({ ...base, recipient_count: 'many' }), opts)).toMatchObject({
      ok: false,
      reject: { reason: 'recipient_count not a whole number: many' },
    });
    expect(mapSendLog(rec({ ...base, queued_at_utc: '' }), opts)).toMatchObject({
      ok: false,
      reject: { reason: 'queued_at unparseable: ' },
    });
    expect(mapSendLog(rec({ ...base, status: 'delivered!' }), opts)).toMatchObject({
      ok: false,
      reject: { reason: 'status unrecognised: delivered!' },
    });
    expect(mapSendLog(rec({ ...base, status: '' }), opts)).toMatchObject({
      ok: false,
      reject: { reason: 'status missing' },
    });
    expect(mapSendLog(rec({ ...base, batch_key: '' }), opts)).toMatchObject({
      ok: false,
      reject: { reason: 'batch_key missing' },
    });
  });
});
