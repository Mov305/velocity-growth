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
  it('is null for no error', () => {
    expect(describeSendError(null)).toBeNull();
  });
});
