"use client";

import { animate, motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InvestigationView } from "@/lib/investigation/view";
import type { EvidenceRef, Rating, RatingKey, Report } from "@/lib/scoring/engine";

const TERMINAL = new Set(["completed", "partial", "failed"]);
const ORDER: RatingKey[] = ["availability", "installation", "distance", "experience"];
const SOURCE_LABEL: Record<string, string> = {
  official_manufacturer: "Official site",
  manufacturer_linked: "Samsung-linked directory",
  community: "Customer post",
  third_party: "Third party",
  unknown: "Unclassified",
};
const METHOD_LABEL: Record<string, string> = { tinyfish_search: "Search", tinyfish_fetch: "Page fetch", tinyfish_agent: "Browser agent" };
const TASK_TONE: Record<string, string> = { succeeded: "text-accent", failed: "text-fail", timed_out: "text-fail", skipped: "text-amber", running: "text-ink", pending: "text-faint" };

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

type Centre = {
  name: string;
  address: string;
  pin: string | null;
  coordinates: { lat: number; lng: number } | null;
  products_explicit: string[] | null;
  detail_url: string | null;
  source_url: string;
  retrieved_at: string;
};

export function ReportView({ id }: { id: string }) {
  const [view, setView] = useState<InvestigationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorded = useRef<boolean | null>(null); // finished before we opened it -> recorded evidence

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/investigate/${id}`, { cache: "no-store" });
        const data = (await res.json()) as InvestigationView & { error?: string };
        if (stopped) return;
        if (!res.ok) {
          setError(data.error ?? `Request failed (${res.status})`);
          return;
        }
        if (recorded.current === null) recorded.current = TERMINAL.has(data.status);
        setView(data);
        setError(null);
        if (!TERMINAL.has(data.status)) timer = setTimeout(poll, 4000);
      } catch {
        if (!stopped) {
          setError("Lost contact with FeasiServe; retrying.");
          timer = setTimeout(poll, 8000);
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (!view) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-16 sm:px-6">
        <h1 className="text-2xl font-semibold">{error ? "Investigation unavailable" : "Opening investigation…"}</h1>
        {error && <p className="mt-2 text-soft">{error}</p>}
      </main>
    );
  }

  const r = view.report;
  const running = !TERMINAL.has(view.status);
  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto max-w-[1120px] px-4 pb-24 pt-10 sm:px-6">
        <Header view={view} recorded={recorded.current === true} running={running} />
        {error && <p className="mt-4 text-sm text-amber">{error}</p>}
        {running && <Activity view={view} />}

        <Reveal i={0} className="mt-8 grid gap-4 lg:grid-cols-[0.9fr_1.6fr]">
          <ScorePanel report={r} running={running} />
          <div className="grid gap-4 sm:grid-cols-2">
            {ORDER.map((k, i) => (
              <RatingCard key={k} rating={r.ratings[k]} i={i} />
            ))}
          </div>
        </Reveal>

        <Reveal i={1}>
          <Section title="Service centres" note={centreNote(view, r)}>
            <Centres centres={(view.locator?.service_centers ?? []) as unknown as Centre[]} report={r} pin={view.input.pincode} />
          </Section>
        </Reveal>

        <Reveal i={2}>
          <Section title="Promise vs reality" note="What the manufacturer commits to, what its service network shows, and what customers report, side by side.">
            <PromiseReality report={r} />
          </Section>
        </Reveal>

        <Reveal i={3} className="grid gap-x-10 lg:grid-cols-2">
          <Section title="Community intelligence" note={r.community.assessment}>
            <EvidenceList items={r.community.sources} empty="No public customer posts were retrieved." />
          </Section>
          <Section title="What to do before buying">
            <ul className="space-y-3">
              {r.recommendations.map((t) => (
                <li key={t} className="flex gap-3 leading-relaxed">
                  <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  {t}
                </li>
              ))}
            </ul>
            <h3 className="mt-8 font-semibold">Still unresolved</h3>
            <ul className="mt-3 space-y-2 text-soft">
              {r.unresolved.map((t) => (
                <li key={t} className="flex gap-3 leading-relaxed">
                  <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-amber" />
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        </Reveal>

        <Reveal i={4}>
          <Section title="Evidence sources" note={`${view.evidence.length} source(s) retrieved by TinyFish and stored with this investigation.`}>
            <Sources view={view} />
          </Section>
        </Reveal>

        {!running && (
          <Reveal i={5}>
            <Section title="Investigation log">
              <Tasks view={view} />
            </Section>
          </Reveal>
        )}
      </main>
    </MotionConfig>
  );
}

function centreNote(view: InvestigationView, r: Report): string {
  const loc = view.locator;
  if (!loc) return "No service-centre lookup was run.";
  if (loc.status === "skipped") return `Service-centre listings were not retrieved: ${loc.reasons[0] ?? "not supported for this brand yet"} Network accessibility is assessed from the official pages below instead.`;
  if (loc.strategy === "static_directory") {
    return `Listed as authorised on Samsung's linked service directory. These are city-level candidates: none is confirmed to cover PIN ${view.input.pincode}, and distances are not shown because the PIN has no coordinates.`;
  }
  return `Official locator result: ${loc.verification ?? "not validated"}. ${r.ratings.availability.summary}`;
}

// ---------------------------------------------------------------------------------------------

function Reveal({ i, className, children }: { i: number; className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, delay: 0.08 * i, ease: [0.2, 0.7, 0.2, 1] }}>
      {children}
    </motion.div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      {note && <p className="mt-2 max-w-[75ch] leading-relaxed text-soft">{note}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Header({ view, recorded, running }: { view: InvestigationView; recorded: boolean; running: boolean }) {
  const { brand, product_category, product_model, pincode } = view.input;
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {brand} {product_category}
          {product_model ? ` ${product_model}` : ""} in {pincode}
        </h1>
        <p className="mt-2 text-soft">
          {running
            ? "Investigation in progress. Findings appear as each source is retrieved."
            : view.status === "completed"
              ? "Investigation complete."
              : "Investigation finished with gaps. Each gap is named below; none is counted against the brand."}
        </p>
      </div>
      <div className="text-right text-sm">
        <span className={`inline-block rounded-md px-2.5 py-1 font-medium ${running ? "bg-accent text-accent-ink" : recorded ? "bg-amber-ground text-amber" : "bg-raised text-ink"}`}>
          {running ? "Live investigation" : recorded ? "Recorded investigation" : "Finished just now"}
        </span>
        <div className="mt-2 text-faint">Started {when(view.created_at)}</div>
        {view.completed_at && <div className="text-faint">Finished {when(view.completed_at)}</div>}
      </div>
    </div>
  );
}

function Activity({ view }: { view: InvestigationView }) {
  return (
    <div className="mt-6 rounded-xl bg-panel p-5" aria-live="polite">
      <Tasks view={view} />
    </div>
  );
}

function Tasks({ view }: { view: InvestigationView }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {view.tasks.map((t) => (
        <li key={t.operation} className="rounded-lg bg-panel px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{t.label}</span>
            <span className={`text-sm ${TASK_TONE[t.status] ?? "text-soft"}`}>{t.status === "running" ? "working…" : t.status.replace("_", " ")}</span>
          </div>
          {t.error && <p className="mt-1 text-sm text-fail">{t.error}</p>}
          {t.recent_steps.length > 0 && t.status === "running" && <p className="mt-1 text-sm text-soft">{String(t.recent_steps.at(-1))}</p>}
        </li>
      ))}
    </ul>
  );
}

function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      setN(value);
      return;
    }
    const c = animate(0, value, { duration: 1.1, ease: [0.2, 0.7, 0.2, 1], onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [value, reduce]);
  return <>{n}</>;
}

function ScorePanel({ report, running }: { report: Report; running: boolean }) {
  const { overall, coverage, confidence } = report;
  const segments = (Object.values(report.ratings) as Rating[]).sort((a, b) => b.weight - a.weight);
  return (
    <div className="flex flex-col rounded-xl bg-panel p-6">
      <h2 className="text-sm text-soft">Serviceability score</h2>
      {overall.state === "scored" ? (
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-7xl font-semibold leading-none tracking-tight text-ink">
            <CountUp value={overall.score} />
          </span>
          <span className="text-xl text-faint">/ 100</span>
        </p>
      ) : (
        <>
          <p className="mt-2 text-3xl font-semibold leading-tight text-amber">{running ? "Collecting evidence…" : "Insufficient evidence"}</p>
          {!running && <p className="mt-2 text-sm leading-relaxed text-soft">{overall.reason}</p>}
        </>
      )}

      <div className="mt-8">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-soft">Evidence coverage</span>
          <span className="font-medium">{Math.round(coverage.supportedWeight * 100)}% of weight</span>
        </div>
        <div className="mt-2 flex h-2.5 gap-1" role="img" aria-label={`${coverage.scoredRatings} of 4 ratings have evidence`}>
          {segments.map((s) => (
            <span key={s.key} title={`${s.label}: ${s.score === null ? "N/A" : s.score}`} style={{ flexGrow: s.weight }} className={`rounded-sm ${s.score === null ? "bg-raised" : "bg-accent"}`} />
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">{coverage.scoredRatings} of 4 ratings have enough evidence. The rest are N/A, not zero.</p>
      </div>

      <div className="mt-6 rounded-lg bg-raised p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-soft">Verification confidence</span>
          <span className={`font-semibold ${confidence.level === "High" ? "text-accent" : "text-amber"}`}>{confidence.level}</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-faint">{confidence.value === null ? "Nothing verified yet." : confidence.basis}</p>
      </div>
    </div>
  );
}

function RatingCard({ rating, i }: { rating: Rating; i: number }) {
  const na = rating.score === null;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 + 0.07 * i }}
      className="flex flex-col rounded-xl bg-panel p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{rating.label}</h3>
        <span className="text-xs text-faint">{Math.round(rating.weight * 100)}% weight</span>
      </div>
      <p className={`mt-3 text-4xl font-semibold leading-none ${na ? "text-amber" : "text-ink"}`}>{na ? "N/A" : rating.score}</p>
      <p className="mt-3 text-sm leading-relaxed text-soft">{rating.summary}</p>
      {rating.criteria.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {rating.criteria.map((c) => (
            <li key={c.label} className={`flex justify-between gap-3 ${c.met ? "text-ink" : "text-faint"}`}>
              <span>
                <span aria-hidden="true">{c.met ? "✓ " : "· "}</span>
                {c.label}
              </span>
              {c.points > 0 && <span className="shrink-0 text-soft">+{c.points}</span>}
            </li>
          ))}
        </ul>
      )}
      {rating.verification && <p className="mt-3 text-xs text-faint">Evidence status: {rating.verification.replace("_", " ").toLowerCase()}</p>}
      {rating.limitations.length > 0 && (
        <details className="mt-auto pt-4 text-sm">
          <summary className="cursor-pointer text-amber">Limitations ({rating.limitations.length})</summary>
          <ul className="mt-2 space-y-1.5 text-soft">
            {rating.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </motion.article>
  );
}

function Centres({ centres, report, pin }: { centres: Centre[]; report: Report; pin: string }) {
  if (!centres.length) return <p className="rounded-lg bg-panel p-4 text-soft">No centre listings were retrieved for this investigation.</p>;
  const key = report.category.key;
  return (
    <div className="overflow-x-auto rounded-xl bg-panel">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="text-soft">
          <tr className="border-b border-raised">
            <th className="px-4 py-3 font-medium">Centre</th>
            <th className="px-4 py-3 font-medium">PIN</th>
            <th className="px-4 py-3 font-medium">Products named on its page</th>
            <th className="px-4 py-3 font-medium">{report.category.label}</th>
            <th className="px-4 py-3 font-medium">Coordinates</th>
            <th className="px-4 py-3 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {centres.map((c) => {
            const named = c.products_explicit;
            const status = !named ? "Unknown" : key && named.includes(key) ? "Named" : "Not stated";
            return (
              <tr key={`${c.name}-${c.pin}`} className="border-b border-raised/60 align-top last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="mt-0.5 text-soft">{c.address}</div>
                </td>
                <td className={`px-4 py-3 ${c.pin === pin ? "text-accent" : ""}`}>{c.pin ?? "invalid"}</td>
                <td className="px-4 py-3 text-soft">{named ? (named.length ? named.map((p) => p.replace("_", " ")).join(", ") : "none named") : "page not retrieved"}</td>
                <td className={`px-4 py-3 font-medium ${status === "Named" ? "text-accent" : "text-amber"}`}>{status}</td>
                <td className="px-4 py-3 text-soft">{c.coordinates ? `${c.coordinates.lat.toFixed(4)}, ${c.coordinates.lng.toFixed(4)}` : "—"}</td>
                <td className="px-4 py-3">
                  <a href={c.detail_url ?? c.source_url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                    Listing
                  </a>
                  <div className="text-xs text-faint">{when(c.retrieved_at)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceList({ items, empty }: { items: EvidenceRef[]; empty: string }) {
  if (!items.length) return <p className="text-soft">{empty}</p>;
  return (
    <ul className="space-y-3">
      {items.map((e, idx) => (
        <li key={`${e.url}-${idx}`} className="rounded-lg bg-panel p-4">
          {e.quote && <blockquote className="leading-relaxed">“{e.quote}”</blockquote>}
          <div className={`${e.quote ? "mt-2" : ""} flex flex-wrap gap-x-3 text-sm text-soft`}>
            <a href={e.url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
              {e.title ?? new URL(e.url).hostname}
            </a>
            <span>{SOURCE_LABEL[e.source_type] ?? e.source_type}</span>
            <span>{e.verification.replace("_", " ").toLowerCase()}</span>
            <span className="text-faint">{when(e.retrieved_at)}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function PromiseReality({ report }: { report: Report }) {
  const { promises, reality, customer, gaps } = report.promiseVsReality;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="font-semibold">Official promise</h3>
          <p className="mb-3 text-sm text-faint">From the manufacturer&apos;s own site</p>
          <EvidenceList items={promises} empty="No official commitments retrieved for this product." />
        </div>
        <div>
          <h3 className="font-semibold">Service network</h3>
          <p className="mb-3 text-sm text-faint">What the centre listings show</p>
          <ul className="space-y-2">
            {reality.map((t) => (
              <li key={t} className="rounded-lg bg-panel p-4 leading-relaxed">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">Customer reports</h3>
          <p className="mb-3 text-sm text-faint">Public posts, unverified</p>
          <EvidenceList items={customer} empty="No customer posts retrieved." />
        </div>
      </div>
      {gaps.length > 0 && (
        <div className="mt-6 rounded-xl bg-amber-ground p-5">
          <h3 className="font-semibold text-amber">Where the picture does not line up</h3>
          <ul className="mt-3 space-y-2 leading-relaxed">
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Sources({ view }: { view: InvestigationView }) {
  return (
    <div className="overflow-x-auto rounded-xl bg-panel">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="text-soft">
          <tr className="border-b border-raised">
            <th className="px-4 py-3 font-medium">Source</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Retrieved by</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Retrieved</th>
          </tr>
        </thead>
        <tbody>
          {view.evidence.map((e) => (
            <tr key={e.id} className="border-b border-raised/60 align-top last:border-0">
              <td className="max-w-[420px] px-4 py-3">
                <a href={e.canonical_url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                  {e.title ?? e.domain}
                </a>
                <div className="truncate text-xs text-faint">{e.domain}</div>
              </td>
              <td className="px-4 py-3 text-soft">{SOURCE_LABEL[e.source_type] ?? e.source_type}</td>
              <td className="px-4 py-3 text-soft">{METHOD_LABEL[e.retrieval_method] ?? e.retrieval_method}</td>
              <td className={`px-4 py-3 ${e.retrieval_status === "retrieved" ? "text-soft" : "text-fail"}`}>{e.retrieval_status}</td>
              <td className="px-4 py-3 text-faint">{when(e.retrieved_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
