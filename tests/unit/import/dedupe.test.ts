import { describe, expect, it } from 'vitest';
import { dedupeLastWins } from '../../../scripts/import/dedupe';

describe('dedupeLastWins', () => {
  it('keeps the last row for a repeated key and counts the rest', () => {
    const rows = [
      { id: 'A', v: 1 },
      { id: 'B', v: 1 },
      { id: 'A', v: 2 },
      { id: 'A', v: 3 },
    ];
    const r = dedupeLastWins(rows, (x) => x.id);
    expect(r.kept).toEqual([
      { id: 'A', v: 3 },
      { id: 'B', v: 1 },
    ]);
    expect(r.skipped).toBe(2);
  });

  it('is a no-op without duplicates', () => {
    const r = dedupeLastWins([{ id: 'A' }, { id: 'B' }], (x) => x.id);
    expect(r.kept).toHaveLength(2);
    expect(r.skipped).toBe(0);
  });
});
