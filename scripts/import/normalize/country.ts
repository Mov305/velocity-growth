import { ok, type Norm } from '../types';

/**
 * ISO 3166-1 alpha-2 codes the portal accepts. Deliberately a list, not "any two letters":
 * ZZ appears in column-shifted rows and must not pass as a country.
 */
const ISO2: ReadonlySet<string> = new Set([
  'KE',
  'ZA',
  'MA',
  'SS',
  'UG',
  'RW',
  'ET',
  'TZ',
  'NG',
  'GH',
  'EG',
  'DZ',
  'TN',
  'SN',
  'CI',
  'CM',
  'ZM',
  'ZW',
  'MZ',
  'BW',
  'NA',
  'MW',
  'MU',
  'AE',
  'SA',
  'QA',
  'KW',
  'BH',
  'OM',
  'JO',
  'LB',
  'TR',
  'GB',
  'US',
  'CA',
  'FR',
  'DE',
  'ES',
  'IT',
  'NL',
  'PT',
  'IE',
  'AU',
  'NZ',
  'IN',
  'PK',
  'SG',
  'MY',
]);

const ALIASES: Record<string, string> = {
  ken: 'KE',
  kenya: 'KE',
  'south africa': 'ZA',
  zaf: 'ZA',
  morocco: 'MA',
  mar: 'MA',
  uganda: 'UG',
  tanzania: 'TZ',
  rwanda: 'RW',
  ethiopia: 'ET',
  'south sudan': 'SS',
};

/** Unknown countries never reject a contact; they become null with a flag the UI can show. */
export function normalizeCountry(raw: string): Norm<string | null> {
  const v = raw.trim();
  if (v === '') return ok(null);
  const upper = v.toUpperCase();
  if (ISO2.has(upper)) return ok(upper);
  const alias = ALIASES[v.toLowerCase()];
  if (alias) return ok(alias);
  return ok(null, 'country_unrecognised');
}
