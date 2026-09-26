import Link from "next/link";

export function Flash({ error, notice }: { error?: string; notice?: string }) {
  if (error) return <p role="alert" className="mb-4 rounded-2xl border border-[#5a3030] bg-[#241618] px-4 py-3 text-sm text-wine">{error.slice(0, 300)}</p>;
  if (notice) return <p role="status" className="mb-4 rounded-2xl border border-[#24523a] bg-[#122018] px-4 py-3 text-sm text-tide">{notice.slice(0, 300)}</p>;
  return null;
}

export function PageHeader({ title, detail }: { title: string; detail?: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-4xl tracking-tight">{title}</h1>
      {detail ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{detail}</p> : null}
    </header>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-panel p-4 ${className}`}>{children}</section>;
}

export function Pill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full border border-line bg-panel-2 px-2 py-0.5 text-xs text-muted">{children}</span>;
}

export function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <p className="font-display text-2xl">{title}</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted">{detail}</p>
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="text-tide underline-offset-2 hover:underline" href={href}>{children}</Link>;
}
