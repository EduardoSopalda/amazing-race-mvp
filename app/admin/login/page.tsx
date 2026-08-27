"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push("/admin");
    } catch {
      setError("Could not reach the race server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Barcelona Race</h1>
      <h2>Organiser login</h2>
      <form className="card" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="password">Organiser key</label>
          <input
            id="password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="primary" disabled={submitting || !password}>
          {submitting ? "Checking..." : "Enter"}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </main>
  );
}
