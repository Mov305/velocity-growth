import { normalizeBoolean } from '../normalize/boolean';
import { normalizeCountry } from '../normalize/country';
import { normalizeDate } from '../normalize/date';
import { normalizeEmail } from '../normalize/email';
import { normalizePhone } from '../normalize/phone';
import { normalizeStatus } from '../normalize/status';
import type { CanonicalContact, MapResult, RawRecord } from '../types';

const EXTERNAL_ID = /^CT-\d+$/;

export type ContactContext = { brandCode: string };

function text(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

/**
 * One raw contact row to one canonical row, or a reject with a reason the marketer can read.
 * Order of checks matters only for which reason wins when several apply: identity first, then
 * ownership, then fields.
 */
export function mapContact(rec: RawRecord, ctx: ContactContext): MapResult<CanonicalContact> {
  const v = rec.values;
  const reject = (reason: string): MapResult<CanonicalContact> => ({
    ok: false,
    reject: { line: rec.line, reason, raw: v },
  });
  const flags: string[] = [];

  const externalId = (v.external_id ?? '').trim();
  if (!EXTERNAL_ID.test(externalId)) return reject(`external_id malformed: ${externalId}`);

  const brandCode = (v.brand_code ?? '').trim().toUpperCase();
  if (brandCode === '') flags.push('brand_code_missing');
  else if (brandCode !== ctx.brandCode) {
    return reject(`brand_code mismatch: ${brandCode} in ${ctx.brandCode} file`);
  }

  const fullName = text(v.full_name);
  if (fullName === null) flags.push('name_missing');

  const email = normalizeEmail(v.email ?? '');
  if (!email.ok) return reject(email.reason);
  if (email.flag) flags.push(email.flag);

  const phone = normalizePhone(v.phone ?? '');
  if (!phone.ok) return reject(phone.reason);
  if (phone.flag) flags.push(phone.flag);
  if (email.value === null && phone.value === null) flags.push('no_channel');

  const country = normalizeCountry(v.country ?? '');
  if (!country.ok) return reject(country.reason);
  if (country.flag) flags.push(country.flag);

  const signup = normalizeDate(v.signup_at ?? '');
  if (!signup.ok) return reject(`signup_at ${signup.reason}`);
  if (signup.value === null) flags.push('signup_missing');

  const status = normalizeStatus(v.status ?? '');
  if (!status.ok) return reject(status.reason);

  const consent = normalizeBoolean(v.consent_marketing ?? '');
  if (!consent.ok) return reject(consent.reason);
  if (consent.flag) flags.push(consent.flag);

  const deleted = normalizeDate(v.deleted_at ?? '');
  if (!deleted.ok) return reject(`deleted_at ${deleted.reason}`);

  const suppressed = normalizeDate(v.suppressed_until ?? '');
  if (!suppressed.ok) return reject(`suppressed_until ${suppressed.reason}`);

  return {
    ok: true,
    row: {
      line: rec.line,
      external_id: externalId,
      full_name: fullName,
      email: email.value,
      phone: phone.value,
      country: country.value,
      city: text(v.city),
      signup_at: signup.value,
      status: status.value,
      consent_marketing: consent.value,
      deleted_at: deleted.value,
      suppressed_until: suppressed.value,
      notes: text(v.notes),
      flags,
    },
  };
}
