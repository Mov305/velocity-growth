/**
 * Last row wins. Exports are regenerated top to bottom, so a later row for the same key is the
 * newer statement. Postgres also refuses to update one row twice in a single statement, so this
 * must happen before the upsert.
 */
export function dedupeLastWins<T>(
  rows: T[],
  key: (row: T) => string,
): { kept: T[]; skipped: number } {
  const byKey = new Map<string, T>();
  for (const row of rows) byKey.set(key(row), row);
  return { kept: [...byKey.values()], skipped: rows.length - byKey.size };
}
