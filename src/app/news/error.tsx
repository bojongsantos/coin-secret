"use client";
export default function NewsError({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-2xl px-5 py-20"><h1 className="text-2xl font-bold">Articles are temporarily unavailable</h1><p className="mt-4 text-muted">Please try again in a moment.</p><button onClick={reset} className="mt-6 rounded-xl bg-accent px-5 py-3 text-white">Try again</button></main>;
}
