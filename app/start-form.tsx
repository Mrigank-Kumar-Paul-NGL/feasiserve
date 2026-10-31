"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

// Samsung and LG are supported. Refrigerator first because Samsung centre pages name it explicitly.
const CATEGORIES = ["Refrigerator", "Split Air Conditioner", "Washing Machine", "Television"];

export function StartForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch("/api/investigate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json()) as { id?: string; error?: string; fields?: Record<string, string> };
      if (!res.ok || !data.id) {
        setError([data.error, ...Object.values(data.fields ?? {})].filter(Boolean).join(". "));
        setBusy(false);
        return;
      }
      router.push(`/report/${data.id}`);
    } catch {
      setError("Could not reach FeasiServe. Check your connection and try again.");
      setBusy(false);
    }
  }

  const field = "mt-1.5 block w-full rounded-md bg-raised px-3 py-2.5 text-ink outline-none ring-1 ring-transparent transition focus:ring-accent";
  return (
    <form onSubmit={submit} className="mt-10 grid gap-4 rounded-xl bg-panel p-5 sm:grid-cols-2 sm:p-6">
      <label className="text-sm">
        <span className="text-soft">Brand</span>
        <select name="brand" defaultValue="Samsung" className={field}>
          <option>Samsung</option>
          <option>LG</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="text-soft">Product</span>
        <select name="product_category" defaultValue="Refrigerator" className={field}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-soft">Model (optional)</span>
        <input name="product_model" autoComplete="off" className={field} />
      </label>
      <label className="text-sm">
        <span className="text-soft">PIN code</span>
        <input name="pincode" required inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} defaultValue="560001" aria-describedby="pin-help" className={field} />
        <span id="pin-help" className="mt-1 block text-xs text-faint">
          6 digits; used as the region for the investigation, not as proof of coverage. Centre listings: Samsung, Bengaluru (560xxx).
        </span>
      </label>
      <button
        disabled={busy}
        className="rounded-md bg-accent px-5 py-3 font-semibold text-accent-ink transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60 sm:col-span-2"
      >
        {busy ? "Starting investigation…" : "Investigate serviceability"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-fail sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  );
}
