import { describe, expect, it } from 'vitest';
import { normalizeBoolean } from '../../../scripts/import/normalize/boolean';
import { normalizeCountry } from '../../../scripts/import/normalize/country';
import { normalizeDate } from '../../../scripts/import/normalize/date';
import { normalizeEmail } from '../../../scripts/import/normalize/email';
import { normalizeChannel, normalizeEventType } from '../../../scripts/import/normalize/enum';
import { normalizeDecimal, normalizeInteger } from '../../../scripts/import/normalize/number';
import { normalizePhone } from '../../../scripts/import/normalize/phone';
import { normalizeStatus } from '../../../scripts/import/normalize/status';

// Every input below was observed in the seed files. See README section 2.

describe('normalizeBoolean', () => {
  it.each(['true', '1', 'TRUE', 'yes', 'Y', ' True '])('%s is true', (v) => {
    expect(normalizeBoolean(v)).toEqual({ ok: true, value: true });
  });
  it.each(['0', 'no', 'FALSE', 'false', 'f', 'N'])('%s is false', (v) => {
    expect(normalizeBoolean(v)).toEqual({ ok: true, value: false });
  });
  it('empty is false with a flag, never silently true', () => {
    expect(normalizeBoolean('')).toEqual({ ok: true, value: false, flag: 'consent_missing' });
  });
  it('anything outside the allow-list is rejected', () => {
    expect(normalizeBoolean('maybe')).toEqual({ ok: false, reason: 'consent unrecognised: maybe' });
  });
});

describe('normalizeStatus', () => {
  it.each(['active', 'ACTIVE', 'active ', 'Active'])('%s is active', (v) => {
    expect(normalizeStatus(v)).toEqual({ ok: true, value: 'active' });
  });
  it('maps the verb form', () => {
    expect(normalizeStatus('unsubscribe')).toEqual({ ok: true, value: 'unsubscribed' });
  });
  it.each(['unsubscribed', 'bounced', 'pending'])('%s passes', (v) => {
    expect(normalizeStatus(v)).toEqual({ ok: true, value: v });
  });
  it('empty is a rejection, not a default', () => {
    expect(normalizeStatus('')).toEqual({ ok: false, reason: 'status missing' });
  });
  it('unknown is a rejection', () => {
    expect(normalizeStatus('paused')).toEqual({ ok: false, reason: 'status unrecognised: paused' });
  });
});

describe('normalizeCountry', () => {
  it.each(['KE', 'KEN', 'kenya', 'Kenya', 'ke '])('%s is KE', (v) => {
    expect(normalizeCountry(v)).toEqual({ ok: true, value: 'KE' });
  });
  it.each(['ZA', 'MA', 'SS', 'UG', 'RW', 'ET', 'TZ'])('%s passes', (v) => {
    expect(normalizeCountry(v)).toEqual({ ok: true, value: v });
  });
  it.each(['254', 'NULL', 'null', 'none', 'ZZ'])('%s is null with a flag', (v) => {
    expect(normalizeCountry(v)).toEqual({ ok: true, value: null, flag: 'country_unrecognised' });
  });
  it('empty is null without a flag', () => {
    expect(normalizeCountry('')).toEqual({ ok: true, value: null });
  });
});

describe('normalizeDate', () => {
  it('keeps ISO instants', () => {
    expect(normalizeDate('2026-02-19T23:47:04Z')).toEqual({
      ok: true,
      value: '2026-02-19T23:47:04Z',
    });
  });
  it('keeps fractional seconds', () => {
    expect(normalizeDate('2026-03-29T18:39:50.722508Z')).toEqual({
      ok: true,
      value: '2026-03-29T18:39:50.722508Z',
    });
  });
  it('treats a bare date as midnight UTC', () => {
    expect(normalizeDate('2026-04-03')).toEqual({ ok: true, value: '2026-04-03T00:00:00.000Z' });
  });
  it('reads the slash form day-first', () => {
    expect(normalizeDate('01/02/2026 00:10')).toEqual({
      ok: true,
      value: '2026-02-01T00:10:00.000Z',
    });
  });
  it('rejects an impossible ISO instant', () => {
    expect(normalizeDate('2026-06-31T00:00:00Z')).toEqual({
      ok: false,
      reason: 'unparseable: 2026-06-31T00:00:00Z',
    });
  });
  it('rejects text', () => {
    expect(normalizeDate('active')).toEqual({ ok: false, reason: 'unparseable: active' });
  });
  it('rejects an impossible day-first date', () => {
    expect(normalizeDate('31/02/2026 10:00')).toEqual({
      ok: false,
      reason: 'unparseable: 31/02/2026 10:00',
    });
  });
  it('empty is null', () => {
    expect(normalizeDate('')).toEqual({ ok: true, value: null });
  });
});

describe('normalizePhone', () => {
  it('strips dashes', () => {
    expect(normalizePhone('254-731-694774')).toEqual({ ok: true, value: '254731694774' });
  });
  it('keeps a leading plus and strips spaces', () => {
    expect(normalizePhone('+254 721 913 662')).toEqual({ ok: true, value: '+254721913662' });
  });
  it('keeps local numbers as given', () => {
    expect(normalizePhone('0704279001')).toEqual({ ok: true, value: '0704279001' });
  });
  it('nulls and flags spreadsheet scientific notation instead of dropping the contact', () => {
    expect(normalizePhone('2.54E+11')).toEqual({ ok: true, value: null, flag: 'phone_corrupted' });
  });
  it('nulls and flags letters', () => {
    expect(normalizePhone('call me')).toEqual({ ok: true, value: null, flag: 'phone_invalid' });
  });
  it('empty is null', () => {
    expect(normalizePhone('')).toEqual({ ok: true, value: null });
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail(' Foo@VG-Eval.test ')).toEqual({ ok: true, value: 'foo@vg-eval.test' });
  });
  it.each([
    'john doe@vg-eval.test',
    'missing-at-sign.test',
    'no-tld@vg-eval',
    'double@@vg-eval.test',
  ])('%s is invalid: kept as null with a flag', (v) => {
    expect(normalizeEmail(v)).toEqual({ ok: true, value: null, flag: 'email_invalid' });
  });
  it('empty is null without a flag', () => {
    expect(normalizeEmail('')).toEqual({ ok: true, value: null });
  });
});

describe('normalizeInteger', () => {
  it('parses whole numbers', () => {
    expect(normalizeInteger('6585')).toEqual({ ok: true, value: 6585 });
  });
  it('rejects decimals', () => {
    expect(normalizeInteger('12.5')).toEqual({ ok: false, reason: 'not a whole number: 12.5' });
  });
  it('rejects negatives', () => {
    expect(normalizeInteger('-3')).toEqual({ ok: false, reason: 'not a whole number: -3' });
  });
  it('empty is null', () => {
    expect(normalizeInteger('')).toEqual({ ok: true, value: null });
  });
});

describe('normalizeDecimal', () => {
  it('parses a dot decimal', () => {
    expect(normalizeDecimal('365.56', '.')).toEqual({ ok: true, value: 365.56 });
  });
  it('parses a comma decimal when told to', () => {
    expect(normalizeDecimal('221,09', ',')).toEqual({ ok: true, value: 221.09 });
  });
  it('rejects a comma decimal in a dot file', () => {
    expect(normalizeDecimal('221,09', '.')).toEqual({ ok: false, reason: 'not a number: 221,09' });
  });
  it('empty is null', () => {
    expect(normalizeDecimal('', '.')).toEqual({ ok: true, value: null });
  });
});

describe('normalizeChannel', () => {
  it.each(['email', 'sms', 'EMAIL', ' Sms '])('%s passes', (v) => {
    expect(normalizeChannel(v)).toEqual({ ok: true, value: v.trim().toLowerCase() });
  });
  it('rejects unknown', () => {
    expect(normalizeChannel('push')).toEqual({ ok: false, reason: 'channel unrecognised: push' });
  });
});

describe('normalizeEventType', () => {
  it.each(['open', 'click', 'bounce', 'complaint', 'unsubscribe', 'delivered'])(
    '%s passes',
    (v) => {
      expect(normalizeEventType(v)).toEqual({ ok: true, value: v });
    },
  );
  it('maps the provider vocabulary onto ours', () => {
    expect(normalizeEventType('opened')).toEqual({ ok: true, value: 'open' });
    expect(normalizeEventType('bounced')).toEqual({ ok: true, value: 'bounce' });
    expect(normalizeEventType('unsubscribed')).toEqual({ ok: true, value: 'unsubscribe' });
    expect(normalizeEventType('clicked')).toEqual({ ok: true, value: 'click' });
  });
  it('rejects unknown', () => {
    expect(normalizeEventType('spam')).toEqual({
      ok: false,
      reason: 'event_type unrecognised: spam',
    });
  });
});
