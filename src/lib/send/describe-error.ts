/**
 * What a marketer may see of an error. Raw messages stay in the database and the server log;
 * they name tables and functions. Only categories that help the person on the screen get through.
 *
 * A dispatch error says why the run stopped, never how much was sent: that comes from
 * describeDispatchProgress, which reads the recorded batches. A run can stop after some batches
 * already reached the provider, and the provider may have received a batch that was never
 * recorded, so "nothing was sent" is never said: only what is recorded.
 */
export function describeSendError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/HTTP (\d{3})/);
  if (/^poll:/.test(raw)) {
    const batches = raw.match(/(\d+) of (\d+) batches did not answer/);
    const what = batches
      ? `${batches[1]} of ${batches[2]} provider batches did not answer`
      : 'The last feedback fetch did not complete';
    const why = m ? ` (HTTP ${m[1]} from the provider's feedback endpoint)` : '';
    return `${what}${why}. Nothing about the send changed; feedback is fetched again every minute, the batches waiting longest first.`;
  }
  if (/^paused:/.test(raw)) {
    return 'Hand-over paused to stay inside the time one request may run.';
  }
  if (/every approved recipient became uncontactable/.test(raw)) {
    return 'Every approved recipient became uncontactable after approval, so there was nobody to hand over. Approving the campaign again freezes a new audience under a new send.';
  }
  if (/provider (dispatch|events) failed/.test(raw) && m) {
    return `The messaging provider answered HTTP ${m[1]}.`;
  }
  if (/audience size \d+ differs from approved \d+/.test(raw)) {
    return raw.replace(/^.*?(audience size)/, 'The $1') + '.';
  }
  if (/timeout|aborted|fetch failed|ECONN|ENOTFOUND/i.test(raw)) {
    return 'The messaging provider could not be reached.';
  }
  if (/interrupted/.test(raw)) return 'The process ended before finishing.';
  return 'An internal error was recorded. The engineer can read the detail in the send row.';
}

export type ProgressForMessage = {
  recordedBatches: number;
  totalBatches: number;
  handedOver: number;
  remaining: number;
};

const n = (x: number) => x.toLocaleString('en-GB');
const plural = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/**
 * How far a stopped send got, from what is recorded. Null progress means it could not be read,
 * and the sentence says that instead of assuming nothing was sent.
 */
export function describeDispatchProgress(p: ProgressForMessage | null): string {
  if (!p) {
    return 'How many batches reached the provider could not be read. Retrying is safe: recorded batches are never posted again.';
  }
  if (p.recordedBatches === 0) {
    return 'No batch is recorded as handed over. If the provider did receive one before the run stopped, retrying returns that same batch and nothing is sent twice.';
  }
  return `${n(p.recordedBatches)} of ${plural(p.totalBatches, 'batch', 'batches')} (${plural(p.handedOver, 'recipient', 'recipients')}) had already been handed to the provider; those stay sent. Resuming hands over the ${plural(p.remaining, 'recipient', 'recipients')} not yet sent; recorded batches are never posted again.`;
}
