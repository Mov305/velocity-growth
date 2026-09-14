/**
 * Import CLI. Loads seed files into Postgres with the direct database connection.
 *
 *   pnpm import:seed --all                                   every file in scripts/import-manifest.ts
 *   pnpm import:seed --brand KAROO --kind contacts --file data/seed/karoo-contacts.csv
 *
 * Env: DATABASE_URL from .env.local (override with ENV_FILE=.env.production).
 * Exit code 1 if any file fails; the failure is also recorded in the imports table.
 */
import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { z } from 'zod';
import { failInterruptedImports, runImport } from './import/run';
import type { ImportSummary } from './import/types';
import { SEED_MANIFEST } from './import-manifest';

const envFile = process.env.ENV_FILE ?? '.env.local';
config({ path: envFile, quiet: true });

const Args = z
  .object({
    all: z.boolean().default(false),
    brand: z
      .string()
      .regex(/^[A-Z]{3,16}$/)
      .optional(),
    kind: z.enum(['contacts', 'campaigns', 'events', 'send_log']).optional(),
    file: z.string().optional(),
    dir: z.string().default(join('data', 'seed')),
  })
  .refine((a) => a.all || (a.brand && a.kind && a.file), {
    message: 'pass --all, or --brand, --kind and --file together',
  });

function parseArgs(argv: string[]) {
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) raw[key] = true;
    else {
      raw[key] = next;
      i++;
    }
  }
  return Args.parse(raw);
}

function line(s: ImportSummary) {
  return (
    `${s.brand.padEnd(9)} ${s.kind.padEnd(9)} ${s.file.padEnd(40)} ` +
    `read ${String(s.rowsRead).padStart(6)}  upserted ${String(s.rowsUpserted).padStart(6)}  ` +
    `rejected ${String(s.rowsRejected).padStart(5)}  dup-skipped ${String(s.rowsSkippedDuplicate).padStart(5)}  already ${String(s.rowsAlreadyPresent).padStart(6)}  ` +
    `${s.encoding.padEnd(12)} ${(s.durationMs / 1000).toFixed(1)}s`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error(`${envFile} is missing DATABASE_URL`);
  const sql = postgres(dbUrl, { max: 1 });

  const jobs = args.all
    ? SEED_MANIFEST.map((m) => ({ brand: m.brand, kind: m.kind, file: join(args.dir, m.file) }))
    : [{ brand: args.brand!, kind: args.kind!, file: args.file! }];

  let failed = 0;
  try {
    const interrupted = await failInterruptedImports(sql);
    if (interrupted > 0) console.error(`marked ${interrupted} interrupted import(s) as failed`);
    for (const job of jobs) {
      if (!existsSync(job.file)) {
        console.error(`MISSING  ${job.file} (run pnpm seed:fetch)`);
        failed++;
        continue;
      }
      try {
        const s = await runImport({
          brandCode: job.brand,
          kind: job.kind,
          filePath: job.file,
          sql,
        });
        console.log(line(s));
      } catch (e) {
        failed++;
        console.error(
          `FAILED   ${job.brand} ${job.kind} ${job.file}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  } finally {
    await sql.end();
  }
  if (failed > 0) {
    console.error(`${failed} file(s) failed`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
