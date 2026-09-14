import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws a named error when a server var is missing, instead of returning undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { serverEnv } = await import('@/lib/env');
    expect(() => serverEnv()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns parsed public env when present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    const { publicEnv } = await import('@/lib/env');
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('rejects a provider base URL that is not https', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('PROVIDER_BASE_URL', 'http://insecure.example');
    vi.stubEnv('PROVIDER_API_KEY', 'k');
    const { serverEnv } = await import('@/lib/env');
    expect(() => serverEnv()).toThrowError(/PROVIDER_BASE_URL/);
  });
});
