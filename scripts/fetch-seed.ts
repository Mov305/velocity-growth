/**
 * Downloads the seed zip named in the brief, verifies its SHA-256 against the value printed in the
 * brief, and unzips it into data/seed/. Refuses to unzip on a hash mismatch.
 *
 * Run: pnpm seed:fetch
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_FROM_BRIEF =
  'https://dispatcher-production-72fc.up.railway.app/data/SivIPYk5jesN2MTvMX9aEA/vg-growth-engineer-seed.zip';
const SHA256_FROM_BRIEF = '4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c';
const OUT_DIR = join('data', 'seed');

async function main() {
  const res = await fetch(URL_FROM_BRIEF);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== SHA256_FROM_BRIEF) {
    throw new Error(`SHA-256 mismatch. Expected ${SHA256_FROM_BRIEF}, got ${hash}. Not unzipping.`);
  }
  mkdirSync('data', { recursive: true });
  writeFileSync(join('data', 'seed.zip'), bytes);
  mkdirSync(OUT_DIR, { recursive: true });
  const zip = new AdmZip(bytes);
  const entries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.endsWith('.csv'));
  for (const e of entries) {
    writeFileSync(join(OUT_DIR, e.entryName.split('/').pop()!), e.getData());
  }
  console.log(`sha256 ${hash} verified`);
  console.log(`${entries.length} files written to ${OUT_DIR}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
