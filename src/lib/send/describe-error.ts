/**
 * What a marketer may see of an error. Raw messages stay in the database and the server log;
 * they name tables and functions. Only categories that help the person on the screen get through.
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
  if (/provider (dispatch|events) failed/.test(raw) && m) {
    return `The messaging provider answered HTTP ${m[1]}. Nothing was sent; it can be retried.`;
  }
  if (/audience size \d+ differs from approved \d+/.test(raw)) {
    return raw.replace(/^.*?(audience size)/, 'The $1') + '. Nothing was sent.';
  }
  if (/timeout|aborted|fetch failed|ECONN|ENOTFOUND/i.test(raw)) {
    return 'The messaging provider could not be reached. Nothing was sent; it can be retried.';
  }
  if (/interrupted/.test(raw)) return 'The process ended before finishing.';
  return 'An internal error was recorded. The engineer can read the detail in the send row.';
}
