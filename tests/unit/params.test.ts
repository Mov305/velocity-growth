import { describe, expect, it } from 'vitest';
import { parseListParams } from '@/lib/params';

describe('parseListParams', () => {
  it('defaults to page 1, no query, no status', () => {
    expect(parseListParams({})).toEqual({ page: 1, q: '', status: undefined });
  });

  it('clamps page to 1 or more and ignores garbage', () => {
    expect(parseListParams({ page: '0' }).page).toBe(1);
    expect(parseListParams({ page: '-4' }).page).toBe(1);
    expect(parseListParams({ page: 'abc' }).page).toBe(1);
    expect(parseListParams({ page: '3.7' }).page).toBe(1);
    expect(parseListParams({ page: '12' }).page).toBe(12);
  });

  it('trims and caps the search text', () => {
    expect(parseListParams({ q: '  simon ' }).q).toBe('simon');
    expect(parseListParams({ q: 'x'.repeat(500) }).q).toHaveLength(100);
  });

  it('accepts only known statuses', () => {
    expect(parseListParams({ status: 'active' }).status).toBe('active');
    expect(parseListParams({ status: 'ACTIVE' }).status).toBeUndefined();
    expect(parseListParams({ status: 'deleted' }).status).toBeUndefined();
  });

  it('takes the first value when a param repeats', () => {
    expect(parseListParams({ page: ['2', '9'] }).page).toBe(2);
  });

  it('keeps dots, commas and quotes in the search text and drops only control characters', () => {
    // mary.nk must search for mary.nk; the query layer quotes the value for PostgREST.
    expect(parseListParams({ q: 'mary.nk' }).q).toBe('mary.nk');
    expect(parseListParams({ q: 'a,b(c)."d"' }).q).toBe('a,b(c)."d"');
    expect(parseListParams({ q: 'a\u0000b\u001fc' }).q).toBe('abc');
  });
});
