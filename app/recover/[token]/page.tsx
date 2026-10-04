"use client";

import { useState, use } from "react";
import { resetPassword } from "../actions";
import Link from "next/link";

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(formData: FormData) {
    formData.append("token", token);
    setStatus("loading");
    setErrorMsg("");
    const res = await resetPassword(formData);
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
        <h1 className="text-2xl font-bold mb-6 text-center">Set New Password</h1>
        
        {status === "success" ? (
          <div className="text-center">
            <p className="text-green-600 mb-4">Your password has been successfully reset.</p>
            <Link href="/login" className="text-blue-600 hover:underline">Log in now</Link>
          </div>
        ) : (
          <form action={onSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">New Password (min 8 chars)</label>
              <input id="password" name="password" type="password" required minLength={8} className="w-full p-2 border rounded" />
            </div>
            {status === "error" && <p className="text-red-500 text-sm">{errorMsg}</p>}
            <button type="submit" className="w-full p-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50" disabled={status === "loading"}>
              {status === "loading" ? "Resetting..." : "Reset Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
