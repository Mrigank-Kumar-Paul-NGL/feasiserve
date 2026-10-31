import Link from "next/link";
import { createSupabaseStore } from "@/lib/supabase/store";
import type { InvestigationRow } from "@/lib/supabase/types";
import { StartForm } from "./start-form";

export const dynamic = "force-dynamic";

async function recent(): Promise<InvestigationRow[]> {
  try {
    return await createSupabaseStore().listRecentInvestigations(8);
  } catch {
    return []; // database not configured: the form still renders
  }
}

const STATUS_TONE: Record<string, string> = {
  completed: "text-accent",
  partial: "text-amber",
  failed: "text-fail",
  running: "text-soft",
  pending: "text-soft",
};

export default async function Home() {
  const investigations = await recent();
  return (
    <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-14 sm:px-6">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <section>
          <h1 className="max-w-[16ch] text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">Can it be serviced where you live?</h1>
          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-soft">
            FeasiServe investigates a brand&apos;s after-sales network before you buy: official warranty and installation terms, the centres it lists near you, and what
            customers report. Every claim links to the page it came from, and anything we could not verify is marked as unknown.
          </p>
          <StartForm />
        </section>

        <section aria-labelledby="recorded" className="lg:pt-2">
          <h2 id="recorded" className="text-lg font-semibold">
            Recorded investigations
          </h2>
          <p className="mt-1 text-sm text-soft">Past runs stored with their evidence. Opening one shows the evidence as it was retrieved.</p>
          {investigations.length === 0 ? (
            <p className="mt-6 rounded-lg bg-panel p-4 text-sm text-soft">No recorded investigations yet.</p>
          ) : (
            <ul className="mt-5 space-y-2">
              {investigations.map((i) => (
                <li key={i.id}>
                  <Link href={`/report/${i.id}`} className="group block rounded-lg bg-panel px-4 py-3 transition-colors hover:bg-raised">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">
                        {i.brand} {i.product_category}
                      </span>
                      <span className={`text-sm ${STATUS_TONE[i.status] ?? "text-soft"}`}>{i.status}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-faint">
                      PIN {i.pincode} · {new Date(i.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
