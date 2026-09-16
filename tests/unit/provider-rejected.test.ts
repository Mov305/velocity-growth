import { describe, expect, it } from 'vitest';
import { PROVIDER_BATCH_CAP, rejectedEntries } from '@/lib/provider/client';
import { chunkKey } from '@/lib/send/dispatch';

describe('provider rejected entries', () => {
  it('reads the measured shape, the documented shapes, and survives anything else', () => {
    const out = rejectedEntries({
      batch_id: 'b',
      accepted: [],
      rejected: [
        { reason: 'recipient_cap_exceeded', recipient: { id: 'r1', email: 'a@b', phone: null } },
        { id: 'r2', reason: 'invalid_email' },
        'r3',
        { something: 'else' },
        42,
      ],
    });
    expect(out).toEqual([
      { id: 'r1', reason: 'recipient_cap_exceeded' },
      { id: 'r2', reason: 'invalid_email' },
      { id: 'r3', reason: 'unspecified' },
      { id: null, reason: 'unrecognised' },
      { id: null, reason: 'unrecognised' },
    ]);
  });

  it('caps a batch at the measured 500 and keys chunks off the send key', () => {
    expect(PROVIDER_BATCH_CAP).toBe(500);
    expect(chunkKey('k', 0)).toBe('k');
    expect(chunkKey('k', 7)).toBe('k:7');
  });
});
