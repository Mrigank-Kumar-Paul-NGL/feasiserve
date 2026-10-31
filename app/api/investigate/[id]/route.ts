import { defaultDeps, errorResponse } from "@/lib/investigation/deps";
import { advanceInvestigation } from "@/lib/investigation/orchestrator";
import { buildInvestigationView } from "@/lib/investigation/view";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // one search + one fetch step fits well inside this

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Polling endpoint: advances unfinished tasks one step, then returns the current state. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Invalid investigation id" }, { status: 400 });
  try {
    const deps = defaultDeps();
    const investigation = await advanceInvestigation(deps, id);
    if (!investigation) return Response.json({ error: "Investigation not found" }, { status: 404 });
    const [runs, evidence, findings] = await Promise.all([
      deps.store.listRuns(id),
      deps.store.listEvidence(id),
      deps.store.listFindings(id),
    ]);
    return Response.json(buildInvestigationView(investigation, runs, evidence, findings), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, `GET /api/investigate/${id}`);
  }
}
