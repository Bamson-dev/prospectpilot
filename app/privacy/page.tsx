import { senderIdentityFromEnv } from "@/lib/compliance/uk-b2b";

export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const sender = senderIdentityFromEnv();
  if (!sender) return <main className="mx-auto max-w-2xl px-6 py-16"><h1 className="font-display text-3xl">Privacy notice</h1><p className="mt-4">This notice is not available yet.</p></main>;
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 space-y-4">
      <h1 className="font-display text-3xl">Privacy notice</h1>
      <p>{sender.legalName}, {sender.postalAddress}, controls the personal data described here. Contact: {sender.contactEmail}.</p>
      <p>When you subscribe we store your email address, the name and company you give, the consent wording you agreed to, and the time you subscribed and confirmed. We use this only to send the emails you asked for.</p>
      <p>Our lawful basis is your consent. You can withdraw it at any time with the unsubscribe link in every email. After you unsubscribe we keep your address on a suppression list so we do not email you again.</p>
      <p>When we contact a business whose details are published on its website, we store the company name, the published address and where we found it, and we stop on request.</p>
      <p>You can ask for a copy of your data, a correction or deletion, or object to its use, by writing to {sender.contactEmail}. You can also complain to your data protection authority.</p>
    </main>
  );
}
