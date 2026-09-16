/**
 * Registers (or re-registers) the pg_cron job that polls provider feedback every minute.
 * Reads DATABASE_URL, POLL_SECRET and NEXT_PUBLIC_SITE_URL from ENV_FILE (default .env.local).
 *   pnpm poll:schedule                            (local stack)
 *   ENV_FILE=.env.production pnpm poll:schedule   (hosted project)
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: process.env.ENV_FILE ?? '.env.local', quiet: true });

const url = process.env.NEXT_PUBLIC_SITE_URL;
const secret = process.env.POLL_SECRET;
const db = process.env.DATABASE_URL;
if (!url || !secret || !db) {
  console.error('NEXT_PUBLIC_SITE_URL, POLL_SECRET and DATABASE_URL are required');
  process.exit(1);
}

async function main() {
  const sql = postgres(db!, { max: 1, prepare: false });
  try {
    const [row] = await sql<{ schedule_provider_poll: string }[]>`
      select app.schedule_provider_poll(${`${url!.replace(/\/$/, '')}/api/poll`}, ${secret!})`;
    console.log(row.schedule_provider_poll);
    const jobs = await sql`
      select jobname, schedule, active from cron.job where jobname = 'poll-provider-feedback'`;
    console.table(jobs);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
