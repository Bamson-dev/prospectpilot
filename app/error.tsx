"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-4xl">Something went wrong</h1>
      <p className="mt-3 text-sm text-muted">{error.message}</p>
      <button className="button button-primary mt-4" type="button" onClick={reset}>Try again</button>
    </main>
  );
}
