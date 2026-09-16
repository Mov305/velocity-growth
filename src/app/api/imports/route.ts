import { NextResponse, type NextRequest } from 'next/server';
import postgres from 'postgres';
import { z } from 'zod';
import { getMembership } from '@/lib/auth/membership';
import { serverEnv } from '@/lib/env';
import { runImport } from '../../../../scripts/import/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One file load in one request; the pipeline is one transaction and the platform ceiling is 60s.
export const maxDuration = 60;

/** Vercel accepts request bodies up to 4.5 MB; larger seed files load through the CLI. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

const Kind = z.enum(['contacts', 'campaigns', 'events', 'send_log']);

function back(request: NextRequest, error: string) {
  const url = new URL('/imports', new URL(request.url).origin);
  url.searchParams.set('error', error);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * Owner uploads one CSV for their own brand. The brand comes from the membership row, never from
 * the form; the kind is an allow-list; the file runs through the same pipeline as the CLI, so
 * rejects, duplicates and the imports row are identical whichever way a file arrives.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const self = new URL(request.url).origin;
  if (origin && origin !== self) return new NextResponse('forbidden', { status: 403 });

  const m = await getMembership();
  if (!m) return NextResponse.redirect(new URL('/login', self), { status: 303 });
  if (m.role !== 'owner') return back(request, 'owner-only');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return back(request, 'bad-form');
  }
  const kind = Kind.safeParse(form.get('kind'));
  const file = form.get('file');
  if (!kind.success) return back(request, 'bad-kind');
  if (!(file instanceof File) || file.size === 0) return back(request, 'no-file');
  if (file.size > MAX_UPLOAD_BYTES) return back(request, 'too-large');
  if (!/\.csv$/i.test(file.name)) return back(request, 'not-csv');

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Direct database connection: the pipeline writes in one transaction with the postgres driver.
  // The brand is the caller's own, checked above under RLS through the membership row.
  const sql = postgres(serverEnv().DATABASE_URL, { max: 1, prepare: false });
  try {
    const summary = await runImport({
      brandCode: m.brandCode,
      kind: kind.data,
      sql,
      source: { fileName: file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120), bytes },
    });
    return NextResponse.redirect(new URL(`/imports/${summary.importId}`, self), { status: 303 });
  } catch (e) {
    console.error('upload import failed', e instanceof Error ? e.message : e);
    return back(request, 'failed');
  } finally {
    await sql.end();
  }
}
