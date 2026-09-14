import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const signedIn = !error && data.user;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Velocity Growth campaign portal</h1>
      {signedIn ? (
        <p>Signed in as {data.user.email}.</p>
      ) : (
        <p className="text-neutral-500">Signed out. Sign-in arrives in stage 3.</p>
      )}
    </main>
  );
}
