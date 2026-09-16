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

  it('strips characters PostgREST filters treat specially from the search text', () => {
    // Commas, parentheses and dots are operators inside an or() filter string.
    expect(parseListParams({ q: 'a,b(c).d*e' }).q).toBe('abcde');
  });
});
