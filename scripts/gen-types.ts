/**
 * Regenerates database.types.ts from the local stack, but only writes the file when the CLI
 * actually produced types. A failed generation (Docker down) used to redirect its error JSON
 * into the file and break the build.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const out = execSync('pnpm exec supabase gen types typescript --local --schema public,app', {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});
if (!out.startsWith('export type Json')) {
  console.error('type generation did not produce types; file left untouched');
  process.exit(1);
}
writeFileSync('src/lib/supabase/database.types.ts', out);
console.log(`wrote database.types.ts (${out.length} chars)`);
