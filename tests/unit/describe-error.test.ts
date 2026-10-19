import { describe, expect, it } from 'vitest';
import { describeDispatchProgress, describeSendError } from '@/lib/send/describe-error';

describe('describeSendError', () => {
  it('names the provider status without the raw body', () => {
    expect(describeSendError('provider dispatch failed: HTTP 503 {"error":"unavailable"}')).toBe(
      'The messaging provider answered HTTP 503.',
    );
  });
  it('keeps the audience mismatch, which names no table', () => {
    expect(describeSendError('audience size 1000 differs from approved 35502')).toBe(
      'The audience size 1000 differs from approved 35502.',
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

describe('describeDispatchProgress', () => {
  it('with no batch recorded, never claims nothing reached the provider', () => {
    expect(
      describeDispatchProgress({
        recordedBatches: 0,
        totalBatches: 72,
        handedOver: 0,
        remaining: 35502,
      }),
    ).toBe(
      'No batch is recorded as handed over. If the provider did receive one before the run stopped, retrying returns that same batch and nothing is sent twice.',
    );
  });
  it('states what already reached the provider and what a resume sends', () => {
    expect(
      describeDispatchProgress({
        recordedBatches: 2,
        totalBatches: 72,
        handedOver: 1000,
        remaining: 34502,
      }),
    ).toBe(
      '2 of 72 batches (1,000 recipients) had already been handed to the provider; those stay sent. Resuming hands over the 34,502 recipients not yet sent; recorded batches are never posted again.',
    );
  });
  it('does not guess when progress could not be read', () => {
    expect(describeDispatchProgress(null)).toMatch(/could not be read/);
    expect(describeDispatchProgress(null)).not.toMatch(/Nothing was/);
  });
});
