import { describe, expect, it } from 'vitest';
import { describeSendError } from '@/lib/send/describe-error';

describe('describeSendError', () => {
  it('names the provider status without the raw body', () => {
    expect(describeSendError('provider dispatch failed: HTTP 503 {"error":"unavailable"}')).toBe(
      'The messaging provider answered HTTP 503. Nothing was sent; it can be retried.',
    );
  });
  it('keeps the audience mismatch, which names no table', () => {
    expect(describeSendError('audience size 1000 differs from approved 35502')).toBe(
      'The audience size 1000 differs from approved 35502. Nothing was sent.',
    );
  });
  it('hides database detail', () => {
    expect(describeSendError('complete_dispatch failed: permission denied for table sends')).toBe(
      'An internal error was recorded. The engineer can read the detail in the send row.',
    );
  });
  it('describes a partial poll as progress, not as a failed send', () => {
    expect(
      describeSendError(
        'poll: 3 of 72 batches did not answer: batch 23: provider events failed: HTTP 503 {"error":"service_unavailable"}',
      ),
    ).toBe(
      "3 of 72 provider batches did not answer (HTTP 503 from the provider's feedback endpoint). Nothing about the send changed; feedback is fetched again every minute, the batches waiting longest first.",
    );
  });
  it('is null for no error', () => {
    expect(describeSendError(null)).toBeNull();
  });
});
