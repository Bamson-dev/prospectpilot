import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-display text-4xl">That page is not in this workspace.</h1>
      <p className="mt-4"><Link href="/dashboard">Back to the dashboard</Link></p>
    </main>
  );
}
