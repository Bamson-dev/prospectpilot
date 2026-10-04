"use client";

export default function IntegrationsError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-2xl border border-[#5a3030] bg-[#241618] p-6 text-wine">
      <h2 className="text-xl font-display mb-2">Integration Error</h2>
      <p className="text-sm mb-4">{error.message || "An unexpected error occurred in the integrations module."}</p>
      <button className="button button-primary" type="button" onClick={() => reset()}>Try again</button>
    </div>
  );
}
