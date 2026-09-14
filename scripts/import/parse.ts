import { parse } from 'csv-parse/sync';
import { brandConfig, CANONICAL_COLUMNS } from './brand-config';
import type { ImportKind, RawRecord, Reject } from './types';

export type ParseOptions = { brandCode: string; kind: ImportKind };

export type ParseResult = {
  encoding: 'utf-8' | 'windows-1252';
  headers: string[];
  records: RawRecord[];
  /** Rows the parser could not shape into a record. They become import_rejects. */
  errors: Reject[];
};

const NUL = '\u0000';

function decode(bytes: Uint8Array): { text: string; encoding: ParseResult['encoding'] } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** Postgres cannot store a NUL byte in text or jsonb; every stored raw copy has it made visible. */
function visible(raw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v.replaceAll(NUL, '<NUL>');
  return out;
}

/**
 * Bytes to records with canonical column names. Fails the whole file if the headers do not map
 * onto the expected columns for the kind: a file with the wrong shape must not half-load.
 *
 * Whole-file, synchronous parse. Measured at 16 s for 312k rows and 22 MB on a laptop; peak
 * memory is a few hundred MB. Adequate for these exports; a streaming path is the next step if
 * files grow past roughly a million rows.
 */
export function parseCsv(bytes: Uint8Array, opts: ParseOptions): ParseResult {
  const cfg = brandConfig(opts.brandCode);
  const { text: decoded, encoding } = decode(bytes);
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;

  const rows = parse(text, {
    delimiter: cfg.delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    info: true,
  }) as unknown as Array<{ record: string[]; info: { lines: number } }>;

  if (rows.length === 0) throw new Error('file is empty');

  const rawHeaders = rows[0].record.map((h) => h.trim());
  const headers = rawHeaders.map((h) => cfg.headerAliases[h] ?? h);
  const expected = CANONICAL_COLUMNS[opts.kind];
  const sortedActual = [...headers].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `headers [${rawHeaders.join(', ')}] do not match expected [${expected.join(', ')}] for ${opts.kind}`,
    );
  }

  const records: RawRecord[] = [];
  const errors: Reject[] = [];
  let prevEndLine = rows[0].info.lines;
  for (let i = 1; i < rows.length; i++) {
    const { record, info } = rows[i];
    const line = prevEndLine + 1;
    prevEndLine = info.lines;
    const raw: Record<string, string> = {};
    record.forEach((v, idx) => {
      raw[headers[idx] ?? `column_${idx + 1}`] = v;
    });
    if (record.length !== headers.length) {
      errors.push({
        line,
        reason: `row has ${record.length} columns, expected ${headers.length}`,
        raw: visible(raw),
      });
      continue;
    }
    const nulColumn = headers.find((h) => raw[h].includes(NUL));
    if (nulColumn) {
      errors.push({ line, reason: `${nulColumn} contains a NUL byte`, raw: visible(raw) });
      continue;
    }
    records.push({ line, values: raw });
  }
  return { encoding, headers, records, errors };
}
