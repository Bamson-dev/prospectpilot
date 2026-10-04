"use client";

import { useState } from "react";
import { requestPasswordReset } from "./actions";
import Link from "next/link";

export default function RecoverPage() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(formData: FormData) {
    setStatus("loading");
    setErrorMsg("");
    const res = await requestPasswordReset(formData);
    if (res.error) {
      setErrorMsg(res.error);
      setStatus("error");
    } else {
      setStatus("success");
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="w-full max-w-md p-6 bg-white rounded shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Recover Password</h1>
        
        {status === "success" ? (
          <div className="text-center">
            <p className="text-green-600 mb-4">If an account exists with that email, a password reset link has been sent.</p>
            <Link href="/login" className="text-blue-600 hover:underline">Return to Login</Link>
          </div>
        ) : (
          <form action={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
              <input id="email" name="email" type="email" required placeholder="name@example.com" className="w-full p-2 border rounded" />
            </div>
            {status === "error" && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button type="submit" className="w-full p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50" disabled={status === "loading"}>
              {status === "loading" ? "Sending..." : "Send Recovery Link"}
            </button>
            <div className="text-center mt-4 text-sm text-gray-600">
              Remember your password? <Link href="/login" className="text-blue-600 hover:underline">Log in</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
