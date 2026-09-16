import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { signInWithGoogle } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  'not-allowed': 'That Google account is not a login on this portal.',
  'google-failed': 'Google sign-in did not complete. Try again, or use your email and password.',
  'not-completed':
    'Google sign-in did not complete. If this Google account is not one of the portal’s logins, that is why. Otherwise try again in a minute.',
};

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams;
  const code = typeof params.error === 'string' ? params.error : undefined;
  const urlError = code ? (ERRORS[code] ?? 'Sign-in failed.') : undefined;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="rise">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Velocity Growth
        </p>
        <h1 className="mt-2 text-4xl">Campaign portal</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Sign in with the login you were given. Each login opens one brand and nothing else.
        </p>
      </div>

      <div className="rise rise-2 mt-10 border-t border-rule pt-8">
        <LoginForm urlError={urlError} />
      </div>

      <div className="rise rise-3 mt-8 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form action={signInWithGoogle} className="rise rise-4 mt-6">
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-sm border border-ink bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#EA4335"
              d="M24 9.5c3.5 0 6.6 1.2 9.1 3.5l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 7-10.3 7-17.7z"
            />
            <path
              fill="#FBBC05"
              d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
            />
          </svg>
          Continue with Google
        </button>
      </form>
    </main>
  );
}
