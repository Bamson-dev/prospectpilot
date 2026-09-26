"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingLabel, variant = "primary" }: { children: string; pendingLabel: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  const className = variant === "primary" ? "button button-primary" : "button button-secondary";
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  );
}
