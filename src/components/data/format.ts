const num = new Intl.NumberFormat('en-GB');
const money = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});
const dateTime = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** A missing number renders as an en dash, never as 0. */
export const fmtNum = (n: number | null | undefined) => (n == null ? '–' : num.format(n));
export const fmtMoney = (n: number | string | null | undefined) =>
  n == null ? '–' : money.format(typeof n === 'string' ? Number(n) : n);
export const fmtDate = (iso: string | null | undefined) => (iso ? date.format(new Date(iso)) : '–');
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? `${dateTime.format(new Date(iso))} UTC` : '–';
export const fmtPct = (part: number | null, whole: number | null) =>
  part == null || whole == null || whole === 0 ? '–' : `${((part / whole) * 100).toFixed(1)}%`;
