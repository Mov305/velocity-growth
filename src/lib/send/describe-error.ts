/**
 * What a marketer may see of an error. Raw messages stay in the database and the server log;
 * they name tables and functions. Only categories that help the person on the screen get through.
 */
export function describeSendError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/HTTP (\d{3})/);
  if (/provider (dispatch|events) failed/.test(raw) && m) {
    return `The messaging provider answered HTTP ${m[1]}. Nothing was sent; it can be retried.`;
  }
  if (/audience size \d+ differs from approved \d+/.test(raw)) {
    return raw.replace(/^.*?(audience size)/, 'The $1') + '. Nothing was sent.';
  }
  if (/timeout|aborted|fetch failed|ECONN|ENOTFOUND/i.test(raw)) {
    return 'The messaging provider could not be reached. Nothing was sent; it can be retried.';
  }
  if (/^poll:/.test(raw))
    return 'The last feedback poll did not complete. It runs again every minute.';
  if (/interrupted/.test(raw)) return 'The process ended before finishing.';
  return 'An internal error was recorded. The engineer can read the detail in the send row.';
}
